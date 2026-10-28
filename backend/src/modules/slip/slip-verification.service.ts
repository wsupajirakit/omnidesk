/**
 * LIFTED — pending rewrite.
 *
 * Source: legacy-api/src/controllers/slip/slipVerificationController.js
 *
 * Straight port of the five slip CRUD handlers so they can be diffed against
 * the live legacy backend. Not split further yet because the split only becomes
 * safe once the golden cases are green — see check-list.md §"Accepted debt".
 *
 * One legacy behaviour deliberately NOT reproduced, recorded in check-list.md:
 * the 30s Redis response cache on the list (`apiCacheService`) — legacy may
 * serve a stale page; this service always reads through. Bodies match, only the
 * freshness differs.
 *
 * The other one used to be the per-detail partner-API call behind
 * `external_data`. That is now ported and verified against the running legacy
 * backend — see `getById`.
 */

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, SortOrder, Types } from 'mongoose';

import type { AuthenticatedUser } from '@/common';
// [FEAT-20260817-SLIPDATERANGE] the one date policy every log listing shares
import { resolveLogDateRange } from '@/common/utils/date-range';
// [FEAT-20260823-SLIPPHONE] the two shape questions, kept pure and testable
import { normalizeLineUserIdTerm, normalizePhoneTerm } from './search-term';
import { AuditLogService, type AuditRequestMetaInput } from '@/modules/audit';
import { Member, type MemberDocument } from '@/modules/chat';
import {
  providerScreenHiddenPaths,
  redactByPaths,
} from '@/modules/customer-provider';
import { CustomToolService } from '@/modules/external';
import {
  Hook,
  buildActor,
  getAllowedHookIds,
  scopeFilter,
  type HookDocument,
} from '@/modules/hooks';

import type {
  ListSlipVerificationsQueryDto,
  SlipVerificationPayloadDto,
} from './dto';
import { SlipVerification } from './schemas/slip-verification.schema';

/** A lean slip row plus whatever the populate calls attached. */
type LeanSlip = Record<string, unknown> & {
  _id: Types.ObjectId;
  line_user?: LeanMember | null;
  metadata?: unknown;
};

type LeanMember = {
  full_name?: string;
  phone_number?: string;
  contract_code?: string;
};

/** Shape of the `external_data` block the list endpoint synthesises. */
interface ListExternalData {
  customer: { customer_name: string; customer_tel: string };
  contract: { contract_number: string };
}

export interface SlipListResult {
  data: Array<Record<string, unknown>>;
  meta: { total: number; page: number; limit: number; pages: number };
}

/** The body fields legacy copies on create — and the same list it patches on update. */
const UPDATABLE_FIELDS = [
  'transaction_date',
  'api_status',
  'trans_ref',
  'sender_account_no',
  'sender_account_name',
  'sender_bank',
  'receiver_account_no',
  'receiver_account_name',
  'receiver_bank',
  'slip_type',
  'amount',
  'branch',
  'internal_content_id',
  'raw_content',
  'raw_response',
  'metadata',
] as const;

type UpdatableField = (typeof UPDATABLE_FIELDS)[number];

/**
 * [FEAT-20260823-SLIPPHONE] Ceiling on the member ids one phone may expand into.
 *
 * Real data has no duplicate phone at all, so this never binds — it exists so a
 * pathological set of rows cannot grow the `$in` without bound. Matches the 200
 * the ticket member search already uses (`tickets/member-search.util.ts`), so
 * the two searches answer to the same number.
 */
const PHONE_MEMBER_CAP = 200;

@Injectable()
export class SlipVerificationService {
  private readonly logger = new Logger(SlipVerificationService.name);

  constructor(
    @InjectModel(SlipVerification.name)
    private readonly slipModel: Model<SlipVerification>,
    /* [FEAT-20260827-BPCUSTOMSLIP] Replaced ExternalApiService IN PLACE (same
       argument position) so the positional specs keep their order. The legacy
       client's only caller in this file was the getById block below; after the
       owner's custool-only rule (docs/v2.md §2.6, 06/09/2026) keeping that
       injection would be an unused dependency — debt. */
    private readonly customToolService: CustomToolService,
    // [FEAT-20260808-AUDITSITE] audit_logs writer, matching legacy
    // slipVerificationController.js:4 (auditLogService). Fire-and-forget below.
    private readonly auditLogService: AuditLogService,
    /* [FIX-20260818-SLIPSCOPE · plan §8 = T3-3] Added LAST on purpose: the three
       specs that build this service with `new` pass the first three arguments
       positionally, so appending keeps them compiling. It is only read by the
       hook-scope resolver. */
    @InjectModel(Hook.name)
    private readonly hookModel: Model<HookDocument>,
    /* [FEAT-20260823-SLIPPHONE] Appended LAST for the same reason the Hook model
       was: specs that build this service with `new` pass arguments positionally,
       so adding to the end keeps every one of them compiling. Read on exactly
       one path — a search term that is a full phone number. */
    @InjectModel(Member.name)
    private readonly memberModel: Model<MemberDocument>,
  ) {}

  /**
   * `metadata` usually carries partner tokens, so legacy strips it from every
   * response. Keeping that strip is R4 *and* parity — legacy already withheld it.
   */
  private stripMetadata(record: LeanSlip): Record<string, unknown> {
    const { metadata: _metadata, ...clean } = record;
    void _metadata;
    return clean;
  }

  /**
   * Legacy parses `?sort=field:dir`, `?sort=field dir` or `?sort=-field`.
   * Anything else falls back to newest-first.
   */
  private parseSort(sort?: string): Record<string, SortOrder> {
    if (!sort) return { created_at: -1 };

    const parts = sort.split(/[:\s]+/);
    if (parts.length === 2) {
      const [field, rawDir] = parts;
      if (field) {
        return { [field]: rawDir?.toLowerCase() === 'desc' ? -1 : 1 };
      }
    }
    if (sort.startsWith('-')) {
      return { [sort.substring(1)]: -1 };
    }
    return { created_at: -1 };
  }

  /**
   * [FEAT-20260817-SLIPSEARCHID] Turn one search box into the right query.
   *
   * Exact ids go to indexed fields; everything else keeps the previous `$text`
   * behaviour. Kept as its own method so the branch is unit-testable and so
   * `buildFilters` stays a list of filters rather than growing a parser inside.
   */
  private searchFilter(
    term: string,
    /**
     * [FEAT-20260823-SLIPPHONE] member ids a phone term already resolved to, or
     * null when the term is not a phone. Passed IN rather than looked up here so
     * this method stays synchronous and free of I/O — see `search-term.ts`.
     * An EMPTY array is not the same as null: it means "a phone, matching nobody".
     */
    memberIds: readonly string[] | null,
  ): {
    filter: Record<string, unknown>;
    /** True for the exact shapes — a direct lookup, not a text match. */
    exact: boolean;
  } {
    // A slip's own id: 24 hex chars, exactly what Mongo prints.
    if (/^[0-9a-f]{24}$/i.test(term)) {
      return { filter: { _id: new Types.ObjectId(term) }, exact: true };
    }
    /* [FEAT-20260823-SLIPPHONE] A phone number the caller already turned into
       member ids. It comes BEFORE the LINE-id branch only for readability — the
       two shapes cannot both match the same string.

       ⚠️ An empty list must still take this branch and return nothing. Falling
       through to `$text` would answer a phone search with unrelated rows that
       happen to share a token, which reads as "here are their slips" and is a
       worse answer than an empty page. เบอร์ไม่ตรงใคร = ต้องว่าง ห้ามตกไป $text. */
    if (memberIds) {
      return {
        filter: { sender_member_user_id: { $in: [...memberIds] } },
        exact: true,
      };
    }
    /* A LINE user id: `U` + 32 hex. The row carries it under two names
       (dual-write in the schema), and old rows may have only one — try both,
       both indexed.

       ⚠️ [FIX-20260823-SLIPIDCASE] Match on the NORMALISED id, never on the raw
       term. The shape test accepts lowercase (`/i`), but the rows store `U` +
       lowercase hex, so a pasted `u2e2f…` used to take this branch and compare a
       spelling no row has — an empty page, no error. Measured before the fix:
       `U2e…` → 81 rows, `u2e…` → 0. */
    const lineUserId = normalizeLineUserIdTerm(term);
    if (lineUserId) {
      return {
        filter: {
          $or: [
            { sender_line_user_id: lineUserId },
            { sender_member_user_id: lineUserId },
          ],
        },
        exact: true,
      };
    }
    // Unchanged: reference number / account names via the text index.
    return { filter: { $text: { $search: term } }, exact: false };
  }

  /**
   * [FEAT-20260823-SLIPPHONE] Turn a phone number into the members who carry it.
   *
   * The ONE query this feature adds, and it runs only when the term is a full
   * phone number — every other search reaches this and returns null having
   * touched nothing. `members.phone_number` is indexed (sparse), so the lookup
   * is a point lookup: measured on real data, keysExamined=1, docsExamined=1.
   *
   * The caller runs this CONCURRENTLY with the hook-scope resolver it already
   * awaits, so a phone search costs no extra wall-clock time either.
   *
   * @returns member ids (possibly empty), or null when the term is not a phone.
   */
  private async resolveMemberIdsForPhone(
    rawTerm: string | undefined,
  ): Promise<string[] | null> {
    const term = rawTerm?.trim();
    if (!term) return null;
    const phone = normalizePhoneTerm(term);
    if (!phone) return null;
    /* Older specs build this service positionally without a member model. They
       never search by phone, but a missing model must degrade to "no match"
       rather than throw on a path they do not exercise. */
    if (!this.memberModel) return [];

    const rows = (await this.memberModel
      .find({ phone_number: phone })
      .select('member_user_id')
      /* A phone is unique in practice — real data has zero duplicates — so this
         cap never binds. It is here so a pathological row set cannot turn into
         an unbounded `$in`. */
      .limit(PHONE_MEMBER_CAP)
      .lean()
      .exec()) as unknown as Array<{ member_user_id?: string }>;

    return rows
      .map((row) => row?.member_user_id)
      .filter((id): id is string => Boolean(id));
  }

  private buildFilters(
    query: ListSlipVerificationsQueryDto,
    /* [FEAT-20260823-SLIPPHONE] null for every search that is not a phone, which
       is what keeps this method — and `searchFilter` below it — synchronous. */
    memberIds: readonly string[] | null = null,
  ): Record<string, unknown> {
    const filters: Record<string, unknown> = {};

    /**
     * [FEAT-20260817-SLIPSEARCHID] one box, three kinds of term.
     *
     * Owner, 17/08: "หน้า slip-verify + search ต้องค้นหาด้วย record id (mongo id) ของ
     * slip ได้ + ค้นหาด้วย member line user id ได้".
     *
     * WHY IT COULD NOT WORK BEFORE: the box fed `$text`, and the text index covers
     * only `trans_ref`, `sender_account_name`, `receiver_account_name`
     * (`slip-verification.schema.ts:152-156`). A Mongo id or a `U…` LINE id is in
     * none of them, so those searches were guaranteed to return nothing — no error,
     * just an empty page.
     *
     * The two id shapes are matched EXACTLY on indexed fields instead of being fed
     * to the text engine:
     *   · 24 hex chars ⇒ `_id`
     *   · `U` + 32 hex ⇒ the member id, which this collection dual-writes to BOTH
     *     `sender_line_user_id` and `sender_member_user_id` (schema `pre('save')`,
     *     the two names of the same value during the channel-neutral rename). Older
     *     rows may carry only one, so both are tried — each has its own index.
     * Anything else keeps the old `$text` behaviour byte-for-byte.
     * ค้นด้วย id = แมตช์ตรง ๆ บน field ที่มี index ไม่ใช่ยัดเข้า text index.
     * revert: `if (query.search) filters['$text'] = { $search: query.search };`
     */
    const term = query.search?.trim();
    const search = term ? this.searchFilter(term, memberIds) : null;
    if (search) Object.assign(filters, search.filter);
    if (query.api_status) filters['api_status'] = query.api_status;
    if (query.branch) filters['branch'] = query.branch;

    /**
     * [FEAT-20260817-SLIPDATERANGE] one date policy for every log-shaped listing.
     *
     * WAS: `new Date(query.start_date)` inline, uncapped. Two defects the shared
     * helper fixes at once:
     *   · a bare `2026-08-17` parsed as UTC midnight = 07:00 Bangkok, so every
     *     slip transferred between 00:00 and 06:59 fell out of "today" — a wrong
     *     answer that looks like a working filter;
     *   · no ceiling, so one request could ask for the whole collection.
     * `resolveLogDateRange` already owns both rules for webhook/audit/handoff
     * (MAX_RANGE_DAYS = 3, Bangkok days) and is field-agnostic — the caller picks
     * the field. Owner's decision (17/08): slip filters on **`transaction_date`**
     * (the day the money moved), which already carries an index.
     *
     * A full ISO instant still passes through untouched, so any caller that was
     * already sending one behaves exactly as before. The dashboard never sent
     * these params at all before today.
     * นโยบายวันที่มีที่เดียว — หน้า log ทุกหน้าใช้ตัวเดียวกัน ห้ามเขียนซ้ำ.
     * revert: restore the four inline lines above (git history) — nothing else
     * in this file reads the helper.
     */
    /**
     * ⚠️ An EXACT id search ignores the window on purpose. The control defaults to
     * "today", so pasting the id of last week's slip would answer "not found" for a
     * row that plainly exists — the filter would be lying. An id is already unique,
     * so the window adds no bound worth having. A TEXT search keeps the window: it
     * can match many rows and that is exactly where the cap earns its keep.
     * ค้นด้วย id = ข้ามช่วงวันที่ · ค้นด้วยข้อความ = ยังคุมด้วยช่วงวันที่.
     */
    if (!search?.exact) {
      const range = resolveLogDateRange(query.start_date, query.end_date);
      if (range.filter) filters['transaction_date'] = range.filter;
    }

    return filters;
  }

  async list(
    query: ListSlipVerificationsQueryDto,
    auth?: AuthenticatedUser,
  ): Promise<SlipListResult> {
    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 25, 1), 200);
    const skip = (page - 1) * limit;

    /**
     * [FIX-20260818-SLIPSCOPE · plan §8 = T3-3, closes audit C2.2] This listing
     * had no caller in its signature at all, so every operator saw the finance
     * rows of EVERY tenant in one page — customer name, phone and contract code
     * included, since the list denormalises them for speed. All 87 rows carry a
     * `hook_id`, so scoping is a filter, not a migration.
     */
    /* [FEAT-20260823-SLIPPHONE] The phone lookup rides ALONGSIDE the scope query
       this method already awaited — the two are independent, so a phone search
       adds a query but no waiting. Every other search resolves to null without
       querying anything. ค้นเบอร์ = +1 query แต่ +0 เวลา เพราะวิ่งขนานของเดิม. */
    const [allowed, memberIds] = await Promise.all([
      getAllowedHookIds(auth, this.hookModel),
      this.resolveMemberIdsForPhone(query.search),
    ]);
    const filters = {
      ...this.buildFilters(query, memberIds),
      ...scopeFilter(allowed),
    };

    const [total, rows] = await Promise.all([
      this.slipModel.countDocuments(filters).exec(),
      this.slipModel
        .find(filters)
        .sort(this.parseSort(query.sort))
        .skip(skip)
        .limit(limit)
        .populate('internal_content_id')
        .populate('line_user')
        .lean<LeanSlip[]>()
        .exec(),
    ]);

    // Customer info comes from the member denormalised at slip-creation time,
    // never from a per-row partner call — that is what made this list slow.
    const data = rows.map((record) => {
      const member = record.line_user;
      const externalData: ListExternalData | null = member
        ? {
            customer: {
              customer_name: member.full_name ?? '',
              customer_tel: member.phone_number ?? '',
            },
            contract: { contract_number: member.contract_code ?? '' },
          }
        : null;

      return { ...this.stripMetadata(record), external_data: externalData };
    });

    return {
      data,
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  async getById(id: string): Promise<{ data: Record<string, unknown> }> {
    const record = await this.slipModel
      .findById(id)
      .populate('internal_content_id')
      .populate('line_user')
      .lean<LeanSlip | null>()
      .exec();

    if (!record) {
      throw new NotFoundException('Slip verification record not found');
    }

    /**
     * [FEAT-20260827-BPCUSTOMSLIP] `external_data` reads the CUSTOM TOOL ONLY.
     * ------------------------------------------------------------------------
     * Owner rule (docs/v2.md §2.6, 06/09/2026): the legacy ExternalApiService
     * leg was REMOVED from this path, not forked around — this block was that
     * client's only caller in the file, so its injection left with it.
     *
     * What comes out is the raw partner body in the exact shape the legacy
     * branch emitted (`block.data ?? block ?? null`), located by the
     * endpoint's `is_profile` flag — never a hardcoded name. The condition is
     * copied word-for-word from the webhook fork (`webhook.service.ts`
     * usesCustomTool): two spellings of one rule is how a hook gets migrated
     * by halves with nobody noticing.
     *
     * Measured before shipping (docs/v2.md §3b-G2, 06/09): on real data every
     * hook runs the custom tool and zero hooks carry live legacy config, so
     * the no-tool `null` answer reaches nobody today. On shop-api hooks this
     * block CHANGES what the panel sees — from the legacy error-object (the
     * legacy client was unconfigured everywhere) to the REAL profile block.
     * That is the ONE sanctioned behaviour change of the v2 plan (§12.0.5).
     *
     * Side effects, stated honestly: the legacy leg wrote a webhook_logs row
     * per view plus token/breaker keys. The custom-tool leg logs through
     * getCombinedData's own per-endpoint webhook-log persist and refreshes
     * raw_profile_data / raw_site_rules_data on success — the operator audit
     * trail moves to those rows; it does not disappear.
     *
     * 🔴 A PRE-EXISTING BUG STAYS REPRODUCED, NOT FIXED (same call as the
     * dev_custom lane made): the dashboard reads
     * `external_data.customer.customer_name` (`SlipDetailModal.tsx`) but this
     * value is the raw body, where `customer` sits one level deeper under
     * `.data` — those rows have been blank on every path since the port
     * existed (gap #8). Fixing the shape here would break the read contract
     * of the modal and the outbound callback; it stays its own task.
     *
     * revert: restore the ExternalApiService injection (constructor position
     * 2) and the getValidToken/getCustomerProfile block — see git history.
     */
    const userId =
      (record['sender_member_user_id'] as string | undefined) ||
      (record['sender_line_user_id'] as string | undefined); // Phase 3.1f read-cutover
    let externalData: unknown = null;

    if (userId) {
      try {
        const hookRow = record['hook_id']
          ? await this.hookModel
              .findById(record['hook_id'] as never)
              .lean()
              .exec()
          : null;
        const useCustomTool =
          (hookRow as Record<string, unknown> | null)?.[
            'custom_tool_status'
          ] === true &&
          !!(hookRow as Record<string, unknown> | null)?.['custom_tool_id'];

        if (useCustomTool) {
          const combined = await this.customToolService.getCombinedData(
            userId,
            hookRow,
          );
          const tool = await this.customToolService.getToolForHook(hookRow);
          const profileKey = (
            (tool?.endpoints ?? []) as Array<{
              key?: string;
              is_profile?: boolean;
            }>
          ).find((e) => e.is_profile)?.key;
          const block = profileKey
            ? (combined[profileKey] as Record<string, unknown> | undefined)
            : undefined;
          externalData = block?.['data'] ?? block ?? null;
        }
      } catch (err) {
        this.logger.error(
          `[external_data] Failed for user ${userId}: ${(err as Error).message}`,
        );
      }
    }

    /* [FEAT-20261014-SCREENHIDE] the modal prints this raw — hide what the provider declares
       (loan_v1: device ids) · none declared (shop-api) = the same object */
    externalData = redactByPaths(externalData, providerScreenHiddenPaths());
    return {
      data: { ...this.stripMetadata(record), external_data: externalData },
    };
  }

  async create(
    dto: SlipVerificationPayloadDto,
    user?: AuthenticatedUser,
    requestMeta?: AuditRequestMetaInput,
  ): Promise<{ data: Record<string, unknown> }> {
    const payload: Record<string, unknown> = {
      transaction_date: dto.transaction_date
        ? new Date(dto.transaction_date)
        : new Date(),
      api_status: dto.api_status,
      trans_ref: dto.trans_ref,
      sender_account_no: dto.sender_account_no,
      sender_account_name: dto.sender_account_name,
      sender_bank: dto.sender_bank,
      receiver_account_no: dto.receiver_account_no,
      receiver_account_name: dto.receiver_account_name,
      receiver_bank: dto.receiver_bank,
      slip_type: dto.slip_type,
      amount: dto.amount,
      branch: dto.branch,
      internal_content_id: dto.internal_content_id,
      raw_content: dto.raw_content,
      raw_response: dto.raw_response,
      metadata: dto.metadata,
    };

    /*
     * Legacy wraps the whole handler in a catch answering
     * `400 { error: error.message }`, so a Mongoose validation failure — a
     * missing `trans_ref` or `amount` — comes back as 400 carrying the
     * validation text. Without this the error escapes to the global filter and
     * the endpoint answers `500 { error: "internal error" }`: wrong status, and
     * a caller who sent a bad body is told the server broke.
     */
    try {
      const record = await this.slipModel.create(payload);

      // [FEAT-20260808-AUDITSITE] writes audit_logs row
      // {parent:'slip_verification', action:'create', ref_id, changed_fields,
      //  actor, request_meta, note} — additive only, no schema change.
      // changed_fields = every payload key {from:null, to:payload[key]}, exactly
      // as slipVerificationController.js:204-217. Fire-and-forget.
      const actor = buildActor(user);
      void this.auditLogService
        .createAuditLog({
          ref_id: record._id,
          parent: 'slip_verification',
          action: 'create',
          changed_fields: Object.keys(payload).map((key) => ({
            field: key,
            from: null,
            to: payload[key],
          })),
          actor,
          request_meta: requestMeta,
          note: `Created slip verification for trans_ref: ${String(
            (record as unknown as Record<string, unknown>)['trans_ref'],
          )} (by ${actor.display_name || actor.username})`,
        })
        .catch(() => undefined);

      return { data: record.toObject() as unknown as Record<string, unknown> };
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  async update(
    id: string,
    dto: SlipVerificationPayloadDto,
    user?: AuthenticatedUser,
    requestMeta?: AuditRequestMetaInput,
  ): Promise<{ data: Record<string, unknown> }> {
    const record = await this.slipModel.findById(id).exec();
    if (!record) {
      throw new NotFoundException('Slip verification record not found');
    }

    const body = dto as unknown as Record<UpdatableField, unknown>;
    for (const field of UPDATABLE_FIELDS) {
      if (body[field] !== undefined) {
        record.set(field, body[field]);
      }
    }

    // [FEAT-20260808-AUDITSITE] `existing` is snapshotted AFTER the fields are
    // set, exactly as legacy slipVerificationController.js:255. Legacy's own
    // filter (`JSON.stringify(existing[field]) !== JSON.stringify(body[field])`)
    // therefore compares the already-updated value against the request value, so
    // changed_fields is effectively always empty and NO update row is written.
    // Reproduced verbatim — matching legacy 1:1 (a legacy quirk, not a fix).
    const existing = record.toObject() as unknown as Record<string, unknown>;

    // Same 400-on-validation-failure contract as create, above.
    try {
      await record.save();
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }

    const changedFields = UPDATABLE_FIELDS.filter(
      (field) =>
        body[field] !== undefined &&
        JSON.stringify(existing[field]) !== JSON.stringify(body[field]),
    ).map((field) => ({
      field,
      from: existing[field],
      to: body[field],
    }));

    if (changedFields.length > 0) {
      const actor = buildActor(user);
      void this.auditLogService
        .createAuditLog({
          ref_id: record._id,
          parent: 'slip_verification',
          action: 'update',
          changed_fields: changedFields,
          actor,
          request_meta: requestMeta,
          note: `Updated slip verification ID: ${String(record._id)} (by ${
            actor.display_name || actor.username
          })`,
        })
        .catch(() => undefined);
    }

    return { data: record.toObject() as unknown as Record<string, unknown> };
  }

  async remove(
    id: string,
    user?: AuthenticatedUser,
    requestMeta?: AuditRequestMetaInput,
  ): Promise<void> {
    const result = await this.slipModel.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException('Slip verification record not found');
    }

    // [FEAT-20260808-AUDITSITE] writes audit_logs row
    // {parent:'slip_verification', action:'delete', ref_id, actor, request_meta,
    //  note} — additive only, no schema change. ref_id is the id string, exactly
    // as slipVerificationController.js:305-312. Fire-and-forget.
    const actor = buildActor(user);
    void this.auditLogService
      .createAuditLog({
        ref_id: id,
        parent: 'slip_verification',
        action: 'delete',
        actor,
        request_meta: requestMeta,
        note: `Deleted slip verification ID: ${id} (by ${
          actor.display_name || actor.username
        })`,
      })
      .catch(() => undefined);
  }

  /** Exposed for the golden suite's cleanup assertion — never routed. */
  countByTransRef(transRef: string): Promise<number> {
    return this.slipModel.countDocuments({ trans_ref: transRef }).exec();
  }
}
