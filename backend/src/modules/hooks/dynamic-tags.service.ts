/**
 * Dynamic tags — the `[[tag]]` placeholders resolved at message-build time.
 *
 * Ported from legacy-api/src/controllers/hook/dynamicTagController.js.
 *
 * THE SCOPE MODEL, which every method here defends:
 * A tag applies either to ONE OA (`hook_id`) or to the GROUP SIDE
 * (`group_id` / `group_ids` whole groups, plus `hook_ids` for a hand-picked
 * subset) — never both. Setting one side clears the other, because a tag
 * holding both is a state no reader knows how to interpret, and it is not
 * visible in any UI once written.
 *
 * `primary_credential_source` names the OA whose credentials the editor uses
 * when testing or previewing. It affects the admin form ONLY — a real customer
 * conversation always uses the credentials of the OA being talked to. It must
 * stay inside the selected scope, or the editor would test against an OA the
 * operator cannot see.
 */

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';

import type { AuthenticatedUser } from '@/common';
import { TagCounter } from './schemas/tag-counter.schema';

import {
  type AuditChange,
  type AuditRequestMetaInput,
  HookAuditLogService,
  actorObjectId,
  buildActor,
} from './hook-audit-log.service';
import { toIdString, toScalarString } from './coerce';
import {
  DynamicTag,
  type DynamicTagDocument,
} from './schemas/dynamic-tag.schema';
import { Hook } from './schemas/hook.schema';

const AUDIT_PARENT = 'dynamic_tag';

const LIST_LIMIT_DEFAULT = 25;
const LIST_LIMIT_MAX = 200;

/**
 * Prefix for newly generated tag names. THIS LINE DEFINES THE TAG NAMESPACE.
 *
 * ⚠️ Only NEW tags get it. Rows written before the rename still start with the
 * old `ins_x_90` and keep working, because tags are resolved by their stored
 * value and the prefix is nowhere hardcoded in the resolver — so no migration
 * was needed. The counter deliberately keeps its original `_id`: changing it
 * would restart the sequence at 1 and immediately collide with names already
 * issued.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 [FIX-20260901-TAGREBLIND] CHANGE THIS PREFIX ⇒ GO AND FIX `TAG_MARKER_RE`
 *    `src/modules/ai/rag-engine.service.ts` — grep `TAG_MARKER_RE`
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "the prefix is nowhere hardcoded in the resolver" is true of the RESOLVER and
 * false of the SCANNER, and that gap has already cost a production incident.
 * `TAG_MARKER_RE` is the pattern that decides whether a marker in a reply counts
 * as a dynamic tag, and it was written to match the shape THIS constant emits.
 * The two then drifted apart with nothing to notice it:
 *
 *     this generator emits        odk_x_90…      rows in `dynamic_tags`:   0
 *     operators actually use      odk_p_*, odk_s_*                       801
 *
 * so the scanner matched 0 of 801 live tags and reported nothing, ever — while
 * every test stayed green, because the fixtures were written from this constant
 * too. Measured and fixed on 01/09; the regex now covers `odk_` + any middle
 * segment, and carries the mirror of this warning.
 *
 * ⚠️ Before changing the prefix, the middle segment, or the digit run, open that
 *    regex and re-run its count against `dynamic_tags`. A new shape that the
 *    scanner cannot see is invisible in exactly the way this one was: no error,
 *    no log, a green suite. There is no automated link between these two files —
 *    these two notes ARE the link.
 *    ⇒ เปลี่ยน prefix ตรงนี้เมื่อไหร่ ต้องไปแก้ TAG_MARKER_RE ด้วยเสมอ ไม่มีตัวเตือนอัตโนมัติ
 */
const TAG_PREFIX = 'odk_x_90';
const TAG_COUNTER_ID = 'dynamic_tag_ins';

type LeanTag = Record<string, unknown>;

export interface DynamicTagListQuery {
  page?: string;
  limit?: string;
  tag?: string;
  sub_type?: string;
  type?: string;
  status?: string;
  hook_id?: string;
  group_id?: string;
  scope_group_id?: string;
}

export interface DynamicTagBody {
  tag?: unknown;
  value?: unknown;
  detail?: unknown;
  status?: unknown;
  type?: unknown;
  sub_type?: unknown;
  ref_api_id?: unknown;
  hook_id?: unknown;
  group_id?: unknown;
  hook_ids?: unknown;
  group_ids?: unknown;
  primary_credential_source?: unknown;
}

export interface BulkScopeBody {
  tag_ids?: unknown;
  group_ids?: unknown;
  hook_ids?: unknown;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const asIdArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter(Boolean).map(String) : [];

@Injectable()
export class DynamicTagsService {
  constructor(
    @InjectModel(DynamicTag.name)
    private readonly tagModel: Model<DynamicTag>,
    @InjectModel(Hook.name) private readonly hookModel: Model<Hook>,
    @InjectModel(TagCounter.name)
    private readonly counterModel: Model<TagCounter>,
    private readonly audit: HookAuditLogService,
  ) {}

  /**
   * The response projection, identical on list / detail / create / update.
   *
   * Note `id`, not `_id` — the dashboard reads `id`, so renaming it is a broken
   * screen rather than a tidy-up. `hook_ids` / `group_ids` fall back to `[]` and
   * `primary_credential_source` to `null` so a tag written before scoping
   * existed renders with the same keys as a new one.
   */
  private toPublic(item: LeanTag): Record<string, unknown> {
    return {
      id: item['_id'],
      tag: item['tag'],
      value: item['value'],
      detail: item['detail'],
      status: item['status'],
      type: item['type'],
      sub_type: item['sub_type'],
      ref_api_id: item['ref_api_id'],
      hook_id: item['hook_id'],
      group_id: item['group_id'],
      hook_ids: item['hook_ids'] ?? [],
      group_ids: item['group_ids'] ?? [],
      primary_credential_source: item['primary_credential_source'] ?? null,
      created_by: item['created_by'],
      created_at: item['created_at'],
      updated_at: item['updated_at'],
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // GET /api/dynamic-tags
  // ─────────────────────────────────────────────────────────────────────

  async list(query: DynamicTagListQuery): Promise<Record<string, unknown>> {
    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(
      Math.max(Number(query.limit) || LIST_LIMIT_DEFAULT, 1),
      LIST_LIMIT_MAX,
    );

    const filters: Record<string, unknown> = { deleted_at: null };
    const and: unknown[] = [];

    if (query.tag) {
      const rx = new RegExp(escapeRegex(query.tag), 'i');
      // ⚠️ `$or` belongs to the search box. Every scope filter below uses `$and`
      // instead, because overwriting `$or` would widen the result set past the
      // requested scope without any visible sign.
      filters['$or'] = [{ tag: rx }, { detail: rx }, { value: rx }];
    }

    if (query.sub_type) {
      // Exact match, not a regex: sub_type is an endpoint key that must match
      // precisely, and the search box already covers substring matching.
      filters['sub_type'] =
        query.sub_type === '__none__' ? { $in: [null, ''] } : query.sub_type;
    }

    if (query.type) filters['type'] = query.type;
    if (query.status !== undefined) filters['status'] = query.status === 'true';

    // Filtering by OA means "every tag that actually affects this OA" — its own
    // tags plus the tags of the group it belongs to.
    if (query.hook_id) {
      const scopeOr: unknown[] = [
        { hook_id: query.hook_id },
        { hook_ids: query.hook_id },
      ];
      const hook = isValidObjectId(query.hook_id)
        ? await this.hookModel
            .findById(query.hook_id)
            .select('group')
            .lean<{ group?: unknown }>()
            .exec()
        : null;
      if (hook?.group) {
        scopeOr.push({ group_id: hook.group }, { group_ids: hook.group });
      }
      and.push({ $or: scopeOr });
    }

    if (query.group_id && isValidObjectId(query.group_id)) {
      and.push({
        $or: [{ group_id: query.group_id }, { group_ids: query.group_id }],
      });
    }

    // "Everything in effect under this group": group-level tags plus per-OA
    // tags of every hook that is a member of it.
    if (query.scope_group_id && isValidObjectId(query.scope_group_id)) {
      const members = await this.hookModel
        .find({ group: query.scope_group_id })
        .select('_id')
        .lean<{ _id: Types.ObjectId }[]>()
        .exec();
      const memberIds = members.map((m) => m._id);
      and.push({
        $or: [
          { group_id: query.scope_group_id },
          { group_ids: query.scope_group_id },
          { hook_id: { $in: memberIds } },
          { hook_ids: { $in: memberIds } },
        ],
      });
    }

    if (and.length > 0) filters['$and'] = and;

    const [total, data] = await Promise.all([
      this.tagModel.countDocuments(filters).exec(),
      this.tagModel
        .find(filters)
        /**
         * ⚠️ `_id` is the tie-breaker and must stay.
         *
         * `created_at` alone is not a total order and these rows are seeded in
         * bulk — 751 tags sharing two timestamps. Mongo may then return tied
         * documents in any order per query, so paging revisits some rows and
         * skips others entirely. Measured: four pages returned 751 rows of which
         * 118 were duplicates, meaning 118 tags never appeared at all, while the
         * total count still looked correct.
         */
        .sort({ created_at: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<LeanTag[]>()
        .exec(),
    ]);

    return {
      data: data.map((item) => this.toPublic(item)),
      pagination: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // GET /api/dynamic-tags/sub-types
  // ─────────────────────────────────────────────────────────────────────

  /**
   * The distinct endpoint keys actually present in the data, with counts.
   *
   * Asked of the data rather than hardcoded: endpoint keys come from whichever
   * custom tool an environment happens to have, so a fixed list would be wrong
   * somewhere and would go stale the moment a tool gains an endpoint.
   *
   * ⚠️ Answers `{success, data}`, not the `{data}` envelope every other tag
   * endpoint uses. That inconsistency is legacy's and the dashboard reads it, so
   * normalising it here would break the dropdown.
   */
  async subTypes(): Promise<Record<string, unknown>> {
    const rows = await this.tagModel
      .aggregate<{ _id: string; count: number }>([
        { $match: { deleted_at: null } },
        { $group: { _id: { $ifNull: ['$sub_type', ''] }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ])
      .exec();

    return {
      success: true,
      data: rows.map((row) => ({
        // A sentinel, because an empty string cannot survive a round trip
        // through a query parameter as a meaningful filter value.
        sub_type: row._id === '' ? '__none__' : row._id,
        label: row._id === '' ? '(ไม่ได้ผูก endpoint)' : row._id,
        count: row.count,
      })),
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // GET /api/dynamic-tags/:id
  // ─────────────────────────────────────────────────────────────────────

  async findOne(id: string): Promise<{ data: Record<string, unknown> }> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid ID format');
    }
    const item = await this.tagModel
      .findOne({ _id: id, deleted_at: null })
      .lean<LeanTag>()
      .exec();
    if (!item) throw new NotFoundException('Dynamic tag not found');
    return { data: this.toPublic(item) };
  }

  // ─────────────────────────────────────────────────────────────────────
  // POST /api/dynamic-tags
  // ─────────────────────────────────────────────────────────────────────

  async create(
    body: DynamicTagBody,
    user: AuthenticatedUser | undefined,
    meta: AuditRequestMetaInput,
  ): Promise<Record<string, unknown>> {
    const hookIds = asIdArray(body.hook_ids);
    const groupIds = asIdArray(body.group_ids);
    const groupId = body.group_id ? toScalarString(body.group_id) : null;
    const hookId = body.hook_id ? toScalarString(body.hook_id) : null;

    if (!body.value) throw new BadRequestException('value is required');

    const groupSide =
      Boolean(groupId) || groupIds.length > 0 || hookIds.length > 0;
    if (hookId && groupSide) {
      throw new BadRequestException(
        'เลือกได้ฝั่งเดียว: hook_id (OA เดี่ยว) หรือ ฝั่งกลุ่ม (group_ids/hook_ids)',
      );
    }
    if (
      [groupId, ...groupIds].filter(Boolean).some((g) => !isValidObjectId(g))
    ) {
      throw new BadRequestException('Invalid group_id/group_ids');
    }
    if (hookIds.some((h) => !isValidObjectId(h))) {
      throw new BadRequestException('Invalid hook_ids');
    }
    if (body.type === 'api' && !hookId && !groupSide) {
      throw new BadRequestException(
        'ต้องระบุ scope อย่างน้อย 1 แบบ (hook_id / group_ids / hook_ids) สำหรับ api type',
      );
    }

    // Single-OA mode has no primary: the credentials are that OA's by
    // definition, so the field is cleared silently rather than rejected.
    const primaryToSave = hookId
      ? null
      : body.primary_credential_source
        ? toScalarString(body.primary_credential_source)
        : null;
    if (primaryToSave) {
      await this.assertPrimaryInScope(
        primaryToSave,
        hookIds,
        [groupId, ...groupIds].filter(Boolean).map(String),
      );
    }

    const createdBy = actorObjectId(user);
    const tag = await this.nextTagName();

    const created: DynamicTagDocument = await this.tagModel.create({
      tag,
      value: body.value,
      detail: body.detail ?? '',
      status: body.status !== undefined ? body.status : true,
      type: body.type ?? 'api',
      sub_type: body.sub_type ?? null,
      ref_api_id: body.ref_api_id ?? null,
      hook_id: hookId ?? null,
      group_id: groupId ?? null,
      hook_ids: hookIds,
      group_ids: groupIds,
      primary_credential_source: primaryToSave,
      created_by: createdBy,
      updated_by: createdBy,
    } as unknown as DynamicTag);

    const actor = buildActor(user);
    await this.audit.write({
      ref_id: created._id,
      parent: AUDIT_PARENT,
      action: 'create',
      changed_fields: [
        { field: 'tag', from: null, to: created.tag },
        { field: 'value', from: null, to: created.value },
        { field: 'type', from: null, to: created.type },
        { field: 'status', from: null, to: created.status },
        { field: 'hook_id', from: null, to: created.hook_id },
        { field: 'group_id', from: null, to: created.group_id },
        { field: 'group_ids', from: null, to: created.group_ids },
        { field: 'hook_ids', from: null, to: created.hook_ids },
        {
          field: 'primary_credential_source',
          from: null,
          to: created.primary_credential_source,
        },
      ],
      actor,
      request_meta: meta,
      note: `Created dynamic tag: ${created.tag} (by ${actor.display_name || actor.username})`,
    });

    const obj = created.toObject() as unknown as LeanTag;
    // Create omits `updated_at` — legacy's create response projects
    // `created_at` only, and the dashboard's key check would flag an extra key.
    const { updated_at: _updatedAt, ...rest } = this.toPublic(obj);
    void _updatedAt;
    return { data: rest };
  }

  /**
   * Allocates the next tag name from the shared counter.
   *
   * `findOneAndUpdate` with `$inc` and `upsert` is atomic, so two concurrent
   * creates cannot receive the same number — which matters because `tag` is
   * uniquely indexed and the loser would otherwise get a duplicate-key 400.
   */
  private async nextTagName(): Promise<string> {
    const counter = await this.counterModel
      .findOneAndUpdate(
        { _id: TAG_COUNTER_ID },
        { $inc: { seq: 1 } },
        { new: true, upsert: true },
      )
      .exec();
    const running = String(counter?.seq ?? 0).padStart(5, '0');
    return `${TAG_PREFIX}${running}`;
  }

  /** The primary OA must sit inside the scope the tag was just given. */
  private async assertPrimaryInScope(
    primary: string,
    hookIds: string[],
    groupIds: string[],
  ): Promise<void> {
    if (!isValidObjectId(primary)) {
      throw new BadRequestException('Invalid primary_credential_source');
    }
    if (hookIds.map(String).includes(String(primary))) return;

    if (groupIds.length > 0) {
      const hook = await this.hookModel
        .findById(primary)
        .select('group')
        .lean<{ group?: unknown }>()
        .exec();
      if (hook?.group && groupIds.includes(toIdString(hook.group))) return;
    }

    throw new BadRequestException(
      'primary_credential_source ต้องเป็น OA ภายใต้กลุ่ม/รายการที่เลือกเท่านั้น',
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  // PUT /api/dynamic-tags/:id
  // ─────────────────────────────────────────────────────────────────────

  async update(
    id: string,
    body: DynamicTagBody,
    user: AuthenticatedUser | undefined,
    meta: AuditRequestMetaInput,
  ): Promise<Record<string, unknown>> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid ID format');
    }

    const doc = await this.tagModel
      .findOne({ _id: id, deleted_at: null })
      .exec();
    if (!doc) throw new NotFoundException('Dynamic tag not found');

    const existing = doc.toObject() as unknown as LeanTag;

    // A local copy of the patch, so the XOR rules below can rewrite it without
    // mutating the caller's request body (legacy mutates `req.body` in place).
    const patch: Record<string, unknown> = {
      ...(body as Record<string, unknown>),
    };

    const updHookIds = Array.isArray(body.hook_ids)
      ? body.hook_ids.filter(Boolean).map(String)
      : undefined;
    if (updHookIds !== undefined) patch['hook_ids'] = updHookIds;
    const updGroupIds = Array.isArray(body.group_ids)
      ? body.group_ids.filter(Boolean).map(String)
      : undefined;
    if (updGroupIds !== undefined) patch['group_ids'] = updGroupIds;

    const updGroupSide = Boolean(
      patch['group_id'] ||
      (updGroupIds && updGroupIds.length > 0) ||
      (updHookIds && updHookIds.length > 0),
    );

    if (patch['hook_id'] && updGroupSide) {
      throw new BadRequestException(
        'เลือกได้ฝั่งเดียว: hook_id (OA เดี่ยว) หรือ ฝั่งกลุ่ม (group_ids/hook_ids)',
      );
    }
    if (
      [patch['group_id'], ...(updGroupIds ?? [])]
        .filter(Boolean)
        .some((g) => !isValidObjectId(g as string))
    ) {
      throw new BadRequestException('Invalid group_id/group_ids');
    }
    if (updHookIds && updHookIds.some((h) => !isValidObjectId(h))) {
      throw new BadRequestException('Invalid hook_ids');
    }

    // Switching sides clears the other one, so a tag can never hold both.
    if (patch['hook_id']) {
      patch['group_id'] = null;
      patch['group_ids'] = [];
      patch['hook_ids'] = [];
      patch['primary_credential_source'] = null;
    }
    if (updGroupSide) patch['hook_id'] = null;

    // The primary is checked against the scope AFTER the patch is merged —
    // a field the caller did not send keeps its stored value.
    const finalPrimary =
      patch['primary_credential_source'] !== undefined
        ? patch['primary_credential_source']
        : doc.primary_credential_source;
    if (finalPrimary) {
      const finalHookIds = (
        patch['hook_ids'] !== undefined
          ? (patch['hook_ids'] as unknown[])
          : (doc.hook_ids ?? [])
      ).map(String);
      const finalGroupIds = [
        patch['group_id'] !== undefined ? patch['group_id'] : doc.group_id,
        ...(patch['group_ids'] !== undefined
          ? (patch['group_ids'] as unknown[])
          : (doc.group_ids ?? [])),
      ]
        .filter(Boolean)
        .map(String);
      await this.assertPrimaryInScope(
        toIdString(finalPrimary),
        finalHookIds,
        finalGroupIds,
      );
    }

    const updatableFields = [
      'value',
      'detail',
      'status',
      'type',
      'sub_type',
      'ref_api_id',
      'hook_id',
      'group_id',
      'hook_ids',
      'group_ids',
      'primary_credential_source',
    ] as const;

    const target = doc as unknown as Record<string, unknown>;
    for (const field of updatableFields) {
      if (patch[field] !== undefined) target[field] = patch[field];
    }
    // Legacy stores an explicit `null` when the caller's claim is not an
    // ObjectId, not `undefined` — the two differ on the wire (`updated_by: null`
    // vs the key being absent), and the schema types the field as optional.
    doc.updated_by = actorObjectId(user) as Types.ObjectId;

    await doc.save();

    const changedFields: AuditChange[] = updatableFields
      .filter(
        (field) =>
          patch[field] !== undefined &&
          JSON.stringify(existing[field]) !== JSON.stringify(patch[field]),
      )
      .map((field) => ({
        field,
        from: existing[field],
        to: patch[field],
      }));

    if (changedFields.length > 0) {
      const actor = buildActor(user);
      await this.audit.write({
        ref_id: doc._id,
        parent: AUDIT_PARENT,
        action: 'update',
        changed_fields: changedFields,
        actor,
        request_meta: meta,
        note: `Updated dynamic tag: ${doc.tag} (by ${actor.display_name || actor.username})`,
      });
    }

    // Update projects a narrower set than list/detail: no created_by/created_at.
    const obj = doc.toObject() as unknown as LeanTag;
    return {
      data: {
        id: obj['_id'],
        tag: obj['tag'],
        value: obj['value'],
        detail: obj['detail'],
        status: obj['status'],
        type: obj['type'],
        sub_type: obj['sub_type'],
        ref_api_id: obj['ref_api_id'],
        hook_id: obj['hook_id'],
        group_id: obj['group_id'],
        hook_ids: obj['hook_ids'] ?? [],
        group_ids: obj['group_ids'] ?? [],
        primary_credential_source: obj['primary_credential_source'] ?? null,
        updated_at: obj['updated_at'],
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // DELETE /api/dynamic-tags/:id
  // ─────────────────────────────────────────────────────────────────────

  async remove(
    id: string,
    user: AuthenticatedUser | undefined,
    meta: AuditRequestMetaInput,
  ): Promise<void> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid ID format');
    }

    const item = await this.tagModel
      .findOneAndUpdate(
        { _id: id, deleted_at: null },
        { deleted_at: new Date(), updated_by: actorObjectId(user) },
        { new: true },
      )
      .exec();
    if (!item) throw new NotFoundException('Dynamic tag not found');

    const actor = buildActor(user);
    await this.audit.write({
      ref_id: id,
      parent: AUDIT_PARENT,
      action: 'delete',
      actor,
      request_meta: meta,
      note: `Deleted dynamic tag: ${item.tag} (by ${actor.display_name || actor.username})`,
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // POST /api/dynamic-tags/bulk-scope
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Re-scopes many tags at once.
   *
   * ⚠️ A SEPARATE ENDPOINT ON PURPOSE, not a loop over `update`. That method can
   * change any field, so accepting a batch through it would let one request
   * rewrite values, types and statuses together with the scope. This one reads
   * ONLY the group side and ignores every other field, even when sent.
   *
   * ⚠️ REPLACE, not merge: whatever is ticked becomes the whole scope. "Add" and
   * "replace" look identical until somebody loses access they used to have, so
   * the UI warns before confirming — and this endpoint behaves the way the
   * warning says.
   */
  async bulkScope(
    body: BulkScopeBody,
    user: AuthenticatedUser | undefined,
    meta: AuditRequestMetaInput,
  ): Promise<Record<string, unknown>> {
    const ids = asIdArray(body.tag_ids);
    if (ids.length === 0) {
      throw new BadRequestException('tag_ids is required');
    }
    if (ids.some((id) => !isValidObjectId(id))) {
      throw new BadRequestException('Invalid tag id in tag_ids');
    }

    const groupIds = asIdArray(body.group_ids);
    const hookIds = asIdArray(body.hook_ids);
    if (groupIds.some((g) => !isValidObjectId(g))) {
      throw new BadRequestException('Invalid group_ids');
    }
    if (hookIds.some((h) => !isValidObjectId(h))) {
      throw new BadRequestException('Invalid hook_ids');
    }
    // Both sides are required. The UI disables the confirm button on the same
    // rule, but it is re-checked here because the UI only guards people going
    // through a screen — not somebody calling the API directly.
    if (groupIds.length === 0 || hookIds.length === 0) {
      throw new BadRequestException('ต้องเลือกอย่างน้อย 1 กลุ่ม และ 1 OA');
    }

    const tags = await this.tagModel
      .find({ _id: { $in: ids }, deleted_at: null })
      .exec();
    if (tags.length === 0) {
      throw new NotFoundException('no matching dynamic tags');
    }

    // Resolve every primary's group in ONE query — per-tag lookups would turn a
    // 20-tag batch into 20 round trips for no benefit.
    const primaryIds = [
      ...new Set(
        tags
          .map((t) => t.primary_credential_source)
          .filter(Boolean)
          .map(String),
      ),
    ];
    const primaryHooks =
      primaryIds.length > 0
        ? await this.hookModel
            .find({ _id: { $in: primaryIds } })
            .select('group')
            .lean<{ _id: Types.ObjectId; group?: unknown }[]>()
            .exec()
        : [];
    const primaryGroupOf = new Map(
      primaryHooks.map((h) => [
        String(h._id),
        h.group ? toIdString(h.group) : null,
      ]),
    );

    const updatedBy = actorObjectId(user);
    const actor = buildActor(user);
    const same = (a: unknown, b: unknown): boolean =>
      JSON.stringify(asIdArray(a)) === JSON.stringify(asIdArray(b));

    const results: { id: string; tag: string; changed: number }[] = [];

    for (const tag of tags) {
      const before = tag.toObject() as unknown as LeanTag;
      const set: Record<string, unknown> = {
        group_ids: groupIds,
        hook_ids: hookIds,
        // Moving to the group side clears single-OA mode, same rule as update.
        hook_id: null,
        // The legacy single `group_id` is folded into `group_ids`, so leaving it
        // set would double-count the group.
        group_id: null,
        updated_by: updatedBy,
      };

      // A primary outside the new scope is CLEARED per tag, not rejected for the
      // whole batch: each tag has its own primary, and failing the batch because
      // of one would leave the operator unable to change anything until they
      // hunted down which. The audit entry records the clearing.
      const primary = before['primary_credential_source']
        ? toIdString(before['primary_credential_source'])
        : null;
      if (primary) {
        const inHooks = hookIds.includes(primary);
        const primaryGroup = primaryGroupOf.get(primary);
        const inGroups = Boolean(
          primaryGroup && groupIds.includes(primaryGroup),
        );
        if (!inHooks && !inGroups) set['primary_credential_source'] = null;
      }

      const changed: AuditChange[] = [];
      for (const [field, to] of Object.entries(set)) {
        if (field === 'updated_by') continue;
        const from = before[field];
        const equal = Array.isArray(to)
          ? same(from, to)
          : toIdString(from ?? '') === toIdString(to ?? '');
        if (!equal) changed.push({ field, from: from ?? null, to });
      }

      await this.tagModel.updateOne({ _id: tag._id }, { $set: set }).exec();
      results.push({
        id: String(tag._id),
        tag: tag.tag,
        changed: changed.length,
      });

      // No real change means no audit entry — otherwise re-running a batch fills
      // the log with entries recording nothing.
      if (changed.length > 0) {
        await this.audit.write({
          ref_id: tag._id,
          parent: AUDIT_PARENT,
          action: 'update',
          changed_fields: changed,
          actor,
          request_meta: meta,
          note: `Bulk scope update: ${tag.tag} (by ${actor.display_name || actor.username})`,
        });
      }
    }

    return {
      success: true,
      matched: tags.length,
      modified: results.filter((r) => r.changed > 0).length,
      tags: results.map((r) => r.tag),
    };
  }
}
