/**
 * Groups CRUD, ported from legacy-api/src/controllers/hook/groupController.js.
 *
 * This one is NOT lifted debt — the legacy file is small and well shaped, so it
 * is written properly here: a sanitiser that fixes the response contract, and
 * the same access rules stated once.
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';

import type { AuthenticatedUser } from '@/common';
import { AuditLogService, type AuditRequestMetaInput } from '@/modules/audit';

import type { CreateGroupDto } from './dto/create-group.dto';
import type { UpdateGroupDto } from './dto/update-group.dto';
import { buildActor } from './hook-audit-log.service';
import { Group } from './schemas/group.schema';

/** A group row as read with `.lean()`. */
interface LeanGroup {
  _id: Types.ObjectId;
  group_name?: string;
  description?: string;
  status?: boolean;
  created_by?: Types.ObjectId;
  created_at?: Date;
  updated_at?: Date;
  deleted_at?: Date | null;
}

/** Query parameters accepted by GET /api/groups. */
export interface GroupListQuery {
  page?: string;
  limit?: string;
  status?: string;
  group_id?: string;
  group_name?: string;
}

const LIST_LIMIT_DEFAULT = 25;
const LIST_LIMIT_MAX = 200;
const LIST_LIMIT_MIN = 1;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeGroupName(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

@Injectable()
export class GroupsService {
  constructor(
    @InjectModel(Group.name) private readonly groupModel: Model<Group>,
    // [FEAT-20260808-AUDITSITE] audit_logs writer, matching legacy
    // groupController.js:4 (auditLogService). Fire-and-forget below.
    private readonly auditLogService: AuditLogService,
  ) {}

  private isSuperUser(user?: AuthenticatedUser): boolean {
    const roleName = user?.roleName;
    return roleName === 'superadmin' || roleName === 'superuser';
  }

  /**
   * The response contract for a group. Only these seven fields are exposed —
   * `updated_by` and `deleted_at` are internal bookkeeping the dashboard never
   * reads, and `_id` is renamed to `id`.
   */
  private sanitizeGroup(
    group: LeanGroup | null,
  ): Record<string, unknown> | null {
    if (!group) return null;
    return {
      id: group._id,
      group_name: group.group_name,
      description: group.description,
      status: group.status,
      created_by: group.created_by,
      created_at: group.created_at,
      updated_at: group.updated_at,
    };
  }

  async listGroups(
    query: GroupListQuery,
    user?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(
      Math.max(Number(query.limit) || LIST_LIMIT_DEFAULT, LIST_LIMIT_MIN),
      LIST_LIMIT_MAX,
    );

    const filters: Record<string, unknown> = { deleted_at: null };

    if (query.status !== undefined) {
      // Legacy compares against the two truthy spellings the dashboard sends;
      // anything else means false. Not `Boolean(...)`, which would make the
      // string "false" true.
      filters['status'] = query.status === 'true' || query.status === '1';
    }

    if (query.group_id) {
      if (!isValidObjectId(query.group_id)) {
        throw new BadRequestException('Invalid group identifier');
      }
      filters['_id'] = query.group_id;
    }

    if (query.group_name) {
      const groupName = normalizeGroupName(query.group_name);
      if (groupName) {
        filters['group_name'] = new RegExp(escapeRegex(groupName), 'i');
      }
    }

    /**
     * Group scoping overwrites any `_id` filter above on purpose: a
     * non-superuser asking for a specific group they do not belong to must get
     * an empty list, not that group.
     */
    if (!this.isSuperUser(user)) {
      const groupIds = Array.isArray(user?.groups)
        ? user.groups.filter((id) => isValidObjectId(id))
        : [];
      if (groupIds.length === 0) {
        throw new ForbiddenException('group access is required');
      }
      filters['_id'] = { $in: groupIds };
    }

    const [total, groups] = await Promise.all([
      this.groupModel.countDocuments(filters).exec(),
      this.groupModel
        .find(filters)
        .sort({ created_at: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<LeanGroup[]>()
        .exec(),
    ]);

    return {
      data: groups.map((group) => this.sanitizeGroup(group)),
      meta: { total, page, limit },
    };
  }

  /**
   * [FIX-20260808-GROUPIDOR] H-S6 — the by-id group handlers loaded by `_id` with
   * no membership scope, so a `group.manage` holder in one tenant could
   * read/rename/soft-delete another tenant's group (which that tenant's hooks and
   * users reference). Scope to membership exactly like listGroups (which filters
   * `_id` to the caller's `user.groups`); a superuser bypasses.
   */
  private ensureGroupMembership(
    user: AuthenticatedUser | undefined,
    id: string,
  ): void {
    if (this.isSuperUser(user)) return;
    const groupIds = Array.isArray(user?.groups)
      ? user.groups.map((g) => String(g))
      : [];
    if (!groupIds.includes(String(id))) {
      throw new ForbiddenException('insufficient group access');
    }
  }

  async getGroupById(
    id: string,
    user?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid group identifier');
    }
    this.ensureGroupMembership(user, id);
    const group = await this.groupModel
      .findOne({ _id: id, deleted_at: null })
      .lean<LeanGroup>()
      .exec();
    if (!group) {
      throw new NotFoundException('Group not found');
    }
    return this.sanitizeGroup(group) ?? {};
  }

  async createGroup(
    dto: CreateGroupDto,
    user?: AuthenticatedUser,
    requestMeta?: AuditRequestMetaInput,
  ): Promise<Record<string, unknown>> {
    const groupName = normalizeGroupName(dto.group_name);
    if (!groupName) {
      throw new BadRequestException('group_name is required');
    }

    // Case-insensitive uniqueness. Note legacy does NOT exclude soft-deleted
    // rows here (unlike updateGroup), so a deleted name stays reserved.
    const nameRegex = new RegExp(`^${escapeRegex(groupName)}$`, 'i');
    const existing = await this.groupModel
      .findOne({ group_name: nameRegex })
      .lean<LeanGroup>()
      .exec();
    if (existing) {
      throw new ConflictException('group_name already exists');
    }

    const created = await this.groupModel.create({
      group_name: groupName,
      description: typeof dto.description === 'string' ? dto.description : '',
      status: dto.status !== undefined ? Boolean(dto.status) : true,
      created_by: user?.userId,
    });

    /**
     * A non-superuser who creates a group is added to it, otherwise they would
     * immediately lose access to the thing they just made (group scoping reads
     * the caller's own group list).
     */
    if (!this.isSuperUser(user)) {
      const userId = user?.userId;
      if (userId && isValidObjectId(userId)) {
        await this.groupModel.db
          .collection('users')
          .updateOne(
            { _id: new Types.ObjectId(userId), deleted_at: { $exists: false } },
            { $addToSet: { groups: created._id } },
          );
      }
    }

    // [FEAT-20260808-AUDITSITE] writes hook_audit_logs row
    // {parent:'group', action:'create', ref_id, group_id, changed_fields, actor,
    //  request_meta, note} — additive only, no schema change. Mirrors
    // groupController.js:139-153. Fire-and-forget.
    const actor = buildActor(user);
    void this.auditLogService
      .createAuditLog({
        ref_id: created._id,
        group_id: created._id,
        parent: 'group',
        action: 'create',
        changed_fields: [
          { field: 'group_name', from: null, to: created.group_name },
          { field: 'description', from: null, to: created.description },
          { field: 'status', from: null, to: created.status },
        ],
        actor,
        request_meta: requestMeta,
        note: `Created group: ${created.group_name} (by ${
          actor.display_name || actor.username
        })`,
      })
      .catch(() => undefined);

    return this.sanitizeGroup(created.toObject()) ?? {};
  }

  async updateGroup(
    id: string,
    dto: UpdateGroupDto,
    user?: AuthenticatedUser,
    requestMeta?: AuditRequestMetaInput,
  ): Promise<Record<string, unknown>> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid group identifier');
    }
    this.ensureGroupMembership(user, id); // [FIX-20260808-GROUPIDOR] H-S6

    const group = await this.groupModel
      .findOne({ _id: id, deleted_at: null })
      .exec();
    if (!group) {
      throw new NotFoundException('Group not found');
    }

    let newGroupName = group.group_name;
    if (dto.group_name !== undefined) {
      const normalized = normalizeGroupName(dto.group_name);
      if (!normalized) {
        throw new BadRequestException('group_name is required');
      }
      const nameRegex = new RegExp(`^${escapeRegex(normalized)}$`, 'i');
      const existing = await this.groupModel
        .findOne({
          group_name: nameRegex,
          _id: { $ne: group._id },
          deleted_at: null,
        })
        .lean<LeanGroup>()
        .exec();
      if (existing) {
        throw new ConflictException('group_name already exists');
      }
      newGroupName = normalized;
    }

    // `undefined` means "not supplied" and is skipped; a value equal to the
    // stored one is skipped too, so an unchanged save writes no audit entry.
    const nextName =
      group.group_name === newGroupName ? undefined : newGroupName;
    const nextDescription =
      typeof dto.description === 'string' ? dto.description : undefined;
    const nextStatus =
      dto.status !== undefined ? Boolean(dto.status) : undefined;

    // [FEAT-20260808-AUDITSITE] changed_fields captured BEFORE mutation with
    // legacy's exact filter (groupController.js:186-199): `updates[key]` maps to
    // next{Name,Description,Status}, compared to the current group value via
    // JSON.stringify. `from` is the pre-mutation value.
    const updateSpec: Array<{
      field: 'group_name' | 'description' | 'status';
      value: unknown;
    }> = [
      { field: 'group_name', value: nextName },
      { field: 'description', value: nextDescription },
      { field: 'status', value: nextStatus },
    ];
    const changedFields = updateSpec
      .filter(
        ({ field, value }) =>
          value !== undefined &&
          JSON.stringify(
            (group as unknown as Record<string, unknown>)[field],
          ) !== JSON.stringify(value),
      )
      .map(({ field, value }) => ({
        field,
        from: (group as unknown as Record<string, unknown>)[field],
        to: value,
      }));

    const changed = changedFields.length > 0;

    if (changed) {
      if (nextName !== undefined) group.group_name = nextName;
      if (nextDescription !== undefined) group.description = nextDescription;
      if (nextStatus !== undefined) group.status = nextStatus;
      if (user?.userId && isValidObjectId(user.userId)) {
        group.updated_by = new Types.ObjectId(user.userId);
      }
      await group.save();

      // [FEAT-20260808-AUDITSITE] writes hook_audit_logs row
      // {parent:'group', action:'update', ref_id, group_id, changed_fields,
      //  actor, request_meta, note} — additive only, no schema change. Only when
      // something changed (groupController.js:200-224). Fire-and-forget.
      const actor = buildActor(user);
      void this.auditLogService
        .createAuditLog({
          ref_id: group._id,
          group_id: group._id,
          parent: 'group',
          action: 'update',
          changed_fields: changedFields,
          actor,
          request_meta: requestMeta,
          note: `Updated group: ${group.group_name} (by ${
            actor.display_name || actor.username
          })`,
        })
        .catch(() => undefined);
    }

    return this.sanitizeGroup(group.toObject()) ?? {};
  }

  /**
   * ==== [FEAT-20260817-GROUPBULKSTATUS] turn many groups on or off ============
   *
   * WHAT  `PATCH /api/groups/status/bulk` — one request, one target state, and
   *       either every named group changes or none does.
   *
   * WHY ALL-OR-NOTHING  the same reasoning the hooks bulk endpoint records
   *       (`hooks.service.ts:2262-2270`): half a batch applied and then an error
   *       is worse than no batch, because the operator cannot tell which half
   *       landed. So access is checked for EVERY id before a single write, and
   *       the 403 names the groups it refused — someone who ticked twenty rows
   *       needs to know which one to untick.
   *
   * SCOPE  `ensureGroupMembership` per id, the same guard `PUT /:id` uses
   *       ([FIX-20260808-GROUPIDOR]). A non-super caller can only flip groups
   *       they belong to, so this endpoint grants no reach the single-row route
   *       did not already have — it only saves N clicks.
   *
   * AUDIT  one `hook_audit_logs` row per group that actually CHANGED, identical
   *       in shape to `updateGroup`'s, so the audit page reads the same whether
   *       a status came from one click or twenty. Groups already in the target
   *       state are skipped: no write, no audit row, and they are reported back
   *       as `unchanged` so the UI can say what really happened.
   *
   * DB-EFFECT: writes `status` (and `updated_by`) on existing rows only. No new
   * field, no index, no migration — the same two fields `PUT /:id` writes.
   * revert: delete this method, the route in the controller, the DTO, and the FE
   * bulk bar. Nothing else calls it.
   * งานหมู่: เช็คสิทธิ์ให้ครบก่อนเขียนแม้แถวเดียว · ผ่านไม่ครบ = ไม่เขียนเลย.
   */
  async bulkUpdateGroupStatus(
    ids: string[],
    status: boolean,
    user?: AuthenticatedUser,
    requestMeta?: AuditRequestMetaInput,
  ): Promise<Record<string, unknown>> {
    // The DTO already guarantees a non-empty array of valid ObjectIds; this keeps
    // the service honest when called directly (a spec, or a future internal call).
    const uniqueIds = [...new Set(ids.map((id) => String(id)))];
    if (uniqueIds.length === 0) {
      throw new BadRequestException('ids is required');
    }
    const invalid = uniqueIds.filter((id) => !isValidObjectId(id));
    if (invalid.length > 0) {
      throw new BadRequestException('Invalid group identifier');
    }

    const groups = await this.groupModel
      .find({ _id: { $in: uniqueIds }, deleted_at: null })
      .lean<LeanGroup[]>()
      .exec();
    if (groups.length === 0) {
      throw new NotFoundException('Group not found');
    }

    // Refuse the WHOLE request if any single id is out of the caller's reach, and
    // name the offenders — checked before any write, never mid-loop.
    const blocked: string[] = [];
    for (const group of groups) {
      try {
        this.ensureGroupMembership(user, String(group._id));
      } catch {
        blocked.push(group.group_name || String(group._id));
      }
    }
    // An id that matched no row is not an access failure — it is reported below
    // as `missing`, so a stale row in the UI cannot masquerade as a permission
    // problem.
    if (blocked.length > 0) {
      throw new ForbiddenException(
        `insufficient group access: ${blocked.join(', ')}`,
      );
    }

    const found = new Set(groups.map((g) => String(g._id)));
    const missing = uniqueIds.filter((id) => !found.has(id));
    const toChange = groups.filter((g) => Boolean(g.status) !== status);
    const unchanged = groups.length - toChange.length;

    if (toChange.length === 0) {
      return {
        success: true,
        matched: groups.length,
        modified: 0,
        unchanged,
        missing,
      };
    }

    const update: Record<string, unknown> = { status };
    if (user?.userId && isValidObjectId(user.userId)) {
      update['updated_by'] = new Types.ObjectId(user.userId);
    }
    const result = await this.groupModel
      .updateMany(
        { _id: { $in: toChange.map((g) => g._id) }, deleted_at: null },
        { $set: update },
      )
      .exec();

    // Fire-and-forget, exactly as the single-row path does — an audit hiccup must
    // not fail a write the operator already saw succeed.
    const actor = buildActor(user);
    for (const group of toChange) {
      void this.auditLogService
        .createAuditLog({
          ref_id: group._id,
          group_id: group._id,
          parent: 'group',
          action: 'update',
          changed_fields: [{ field: 'status', from: group.status, to: status }],
          actor,
          request_meta: requestMeta,
          note: `Bulk ${status ? 'enabled' : 'disabled'} group: ${
            group.group_name
          } (by ${actor.display_name || actor.username})`,
        })
        .catch(() => undefined);
    }

    return {
      success: true,
      matched: groups.length,
      modified: result.modifiedCount ?? toChange.length,
      unchanged,
      missing,
      changed: toChange.map((g) => g.group_name || String(g._id)),
    };
  }

  async deleteGroup(
    id: string,
    user?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid group identifier');
    }
    this.ensureGroupMembership(user, id); // [FIX-20260808-GROUPIDOR] H-S6

    const update: Record<string, unknown> = { deleted_at: new Date() };
    if (user?.userId && isValidObjectId(user.userId)) {
      update['updated_by'] = new Types.ObjectId(user.userId);
    }

    // Soft delete: hooks and users reference groups by id, and a hard delete
    // would leave those references dangling.
    const deleted = await this.groupModel
      .findOneAndUpdate({ _id: id, deleted_at: null }, update, { new: true })
      .lean<LeanGroup>()
      .exec();
    if (!deleted) {
      throw new NotFoundException('Group not found');
    }

    return { message: 'Group deleted successfully', id: deleted._id };
  }
}
