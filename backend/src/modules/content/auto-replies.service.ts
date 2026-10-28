import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import mongoose from 'mongoose';

import type { AuthenticatedUser } from '@/common';
import { escapeRegex } from '@/common/utils';
import { AuditLogService, type AuditRequestMetaInput } from '@/modules/audit';
import {
  buildActor,
  Group,
  type GroupDocument,
  Hook,
  type HookDocument,
} from '@/modules/hooks';
import {
  ensureValidResponse,
  parseActiveValue,
} from './content-broadcast-auto-reply.util';
import {
  ensureHookAccess,
  ensureValidHookIds,
  getAllowedHookIds,
  isSuperUser,
  resolveAssignGroup,
} from './content-oa-access.util';
import type {
  CreateAutoReplyDto,
  UpdateAutoReplyActiveDto,
  UpdateAutoReplyDto,
} from './dto';
import { AutoReply, type AutoReplyDocument } from './schemas/auto-reply.schema';

/**
 * `Set<string | undefined>`, not `Set<string>`, and that is deliberate.
 *
 * Legacy checks `MATCH_TYPES.has(req.body.match_type)` with no prior guard
 * (autoReplyController.js:292-295), so a request that omits the field entirely
 * reaches the same branch as one that sends a bad value, and both answer
 * `Invalid match_type`. Once the DTO stopped rejecting a missing `match_type`
 * — which it had to, so the service could reject fields in legacy's order —
 * `undefined` began arriving here.
 *
 * Narrowing it away with a `if (!matchType)` guard would look tidier and change
 * the message. Widening the set keeps the one behaviour that matters: the same
 * request gets the same string from both backends.
 */
const MATCH_TYPES = new Set<string | undefined>([
  'exact',
  'contains',
  'regex',
  'loose',
  'fuzzy',
]);
const AUTO_REPLY_MODES = new Set(['push', 'reply', 'single_reply']);

export interface SanitizedAutoReply {
  id: unknown;
  name: string;
  hook_ids: unknown[];
  assign_group: { id: unknown; name: string };
  keyword: string;
  match_type: string;
  response: unknown;
  mode: string | null;
  priority: number;
  active: boolean;
  created_by?: string;
  updated_by?: string;
  created_at?: Date;
  updated_at?: Date;
}

@Injectable()
export class AutoRepliesService {
  constructor(
    @InjectModel(AutoReply.name)
    private readonly autoReplyModel: Model<AutoReplyDocument>,
    @InjectModel(Hook.name)
    private readonly hookModel: Model<HookDocument>,
    @InjectModel(Group.name)
    private readonly groupModel: Model<GroupDocument>,
    // [FEAT-20260808-AUDITSITE] audit_logs writer, matching legacy
    // autoReplyController.js:6 (auditLogService). Fire-and-forget below.
    private readonly auditLogService: AuditLogService,
  ) {}

  public sanitizeAutoReply(
    autoReply: AutoReplyDocument | null,
  ): SanitizedAutoReply | null {
    if (!autoReply) return null;
    const raw = (autoReply.toObject
      ? autoReply.toObject()
      : autoReply) as unknown as Record<string, unknown>;

    const hookIds = Array.isArray(raw['hook_ids'])
      ? raw['hook_ids'].map((id: unknown) =>
          typeof id === 'object' && id !== null && '_id' in id ? id._id : id,
        )
      : [];

    const assignGroup = (raw['assign_group'] as {
      id?: unknown;
      name?: string;
    }) || {
      id: null,
      name: '',
    };

    return {
      id: raw['_id'],
      name: (raw['name'] as string) || '',
      hook_ids: hookIds,
      assign_group: {
        id: assignGroup.id ?? null,
        name: assignGroup.name || '',
      },
      keyword: (raw['keyword'] as string) || '',
      match_type: (raw['match_type'] as string) || 'exact',
      response: raw['response'],
      mode: (raw['mode'] as string | undefined) ?? null,
      priority: (raw['priority'] as number) ?? 0,
      active: Boolean(raw['active']),
      created_by: raw['created_by'] as string | undefined,
      updated_by: raw['updated_by'] as string | undefined,
      created_at: raw['created_at'] as Date | undefined,
      updated_at: raw['updated_at'] as Date | undefined,
    };
  }

  private async ensureAllowedHookIds(
    user: AuthenticatedUser | null | undefined,
    hookIds: unknown[],
  ): Promise<void> {
    const allowedHookIds = await getAllowedHookIds(user, this.hookModel);
    if (allowedHookIds === null) return;
    const idsStr = (hookIds || []).map((id) => String(id));
    const invalid = idsStr.filter((id) => !allowedHookIds.includes(id));
    if (invalid.length > 0) {
      throw new ForbiddenException('insufficient OA access');
    }
  }

  public async listAutoReplies(
    user: AuthenticatedUser,
    query: Record<string, string | undefined>,
  ): Promise<{
    data: Array<SanitizedAutoReply | null>;
    meta: { total: number; page: number; limit: number };
  }> {
    const page = Math.max(Number(query['page']) || 1, 1);
    const limit = Math.min(Math.max(Number(query['limit']) || 25, 1), 200);
    const filters: Record<string, unknown> = { deleted_at: { $exists: false } };

    if (!isSuperUser(user)) {
      const assignGroupIds = Array.isArray(user.groups)
        ? user.groups.filter((id) => mongoose.isValidObjectId(id))
        : [];
      if (assignGroupIds.length === 0) {
        throw new ForbiddenException('group access is required');
      }
      filters['assign_group.id'] = { $in: assignGroupIds };
    }

    if (query['active'] !== undefined) {
      filters['active'] = query['active'] === 'true' || query['active'] === '1';
    }
    if (query['match_type'] && MATCH_TYPES.has(query['match_type'])) {
      filters['match_type'] = query['match_type'];
    }
    if (query['keyword']) {
      filters['keyword'] = new RegExp(escapeRegex(query['keyword']), 'i');
    }
    if (query['hook_id']) {
      if (!mongoose.isValidObjectId(query['hook_id'])) {
        throw new BadRequestException('Invalid hook identifier');
      }
      await ensureHookAccess(user, query['hook_id'], this.hookModel);
      filters['hook_ids'] = query['hook_id'];
    } else if (!isSuperUser(user)) {
      const allowedHookIds = await getAllowedHookIds(user, this.hookModel);
      if (Array.isArray(allowedHookIds)) {
        filters['hook_ids'] = { $in: allowedHookIds };
      }
    }

    const [total, rows] = await Promise.all([
      this.autoReplyModel.countDocuments(filters),
      this.autoReplyModel
        .find(filters)
        .sort({ priority: -1, created_at: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    return {
      data: rows.map((r) => this.sanitizeAutoReply(r)),
      meta: { total, page, limit },
    };
  }

  public async listAutoRepliesByHookId(
    hookId?: string,
  ): Promise<{ data: Array<Record<string, unknown>> }> {
    if (!hookId || !mongoose.isValidObjectId(hookId)) {
      throw new BadRequestException('hook_id is required');
    }
    const replies = await this.autoReplyModel
      .find({
        hook_ids: hookId,
        active: true,
        deleted_at: { $exists: false },
      })
      .sort({ priority: -1 })
      .lean();

    const rows = replies.map((item) => {
      const resp = item.response;
      return {
        auto_reply_id: item._id,
        keyword: item.keyword,
        match_type: item.match_type,
        text_response: resp?.type === 'text' ? resp.text || '' : '',
        type_response: resp?.type || '',
        mode: item.mode ?? null,
        priority: item.priority ?? 0,
        active: Boolean(item.active),
      };
    });

    return { data: rows };
  }

  public async getAutoReplyById(id: string): Promise<SanitizedAutoReply> {
    if (!mongoose.isValidObjectId(id)) {
      throw new BadRequestException('Invalid auto reply identifier');
    }
    const autoReply = await this.autoReplyModel
      .findOne({ _id: id, deleted_at: { $exists: false } })
      .lean();
    if (!autoReply) {
      throw new NotFoundException('Auto reply not found');
    }
    const sanitized = this.sanitizeAutoReply(autoReply);
    if (!sanitized) throw new NotFoundException('Auto reply not found');
    return sanitized;
  }

  public async createAutoReply(
    user: AuthenticatedUser,
    dto: CreateAutoReplyDto,
    requestMeta?: AuditRequestMetaInput,
  ): Promise<SanitizedAutoReply> {
    const keyword = typeof dto.keyword === 'string' ? dto.keyword.trim() : '';
    if (!keyword) throw new BadRequestException('keyword is required');

    const matchType = dto.match_type;
    if (!MATCH_TYPES.has(matchType)) {
      throw new BadRequestException('Invalid match_type');
    }

    const hook_ids = await ensureValidHookIds(dto.hook_ids, this.hookModel);
    await this.ensureAllowedHookIds(user, hook_ids);
    const assign_group = await resolveAssignGroup(
      dto.assign_group,
      this.groupModel,
    );
    const response = ensureValidResponse(dto.response);

    const priority = dto.priority !== undefined ? Number(dto.priority) : 0;
    if (!Number.isInteger(priority) || priority < 0 || priority > 99) {
      throw new BadRequestException('priority must be 0-99');
    }

    const mode =
      dto.mode === undefined || dto.mode === null
        ? null
        : String(dto.mode).trim();
    if (mode && !AUTO_REPLY_MODES.has(mode)) {
      throw new BadRequestException('Invalid mode');
    }

    const autoReply = await this.autoReplyModel.create({
      name: typeof dto.name === 'string' ? dto.name.trim() : '',
      hook_ids,
      assign_group,
      keyword,
      match_type: matchType,
      response,
      mode,
      priority,
      active: dto.active !== undefined ? Boolean(dto.active) : true,
      created_by: user.userId,
      updated_by: user.userId,
    });

    // [FEAT-20260808-AUDITSITE] writes audit_logs row
    // {parent:'auto_reply', action:'create', ref_id, actor, request_meta, note}
    // — additive only, no schema change. Mirrors autoReplyController.js:332-338.
    // Fire-and-forget: an audit failure must never fail the create.
    void this.auditLogService
      .createAuditLog({
        ref_id: autoReply._id,
        parent: 'auto_reply',
        action: 'create',
        actor: buildActor(user),
        request_meta: requestMeta,
        note: dto.audit_note,
      })
      .catch(() => undefined);

    const sanitized = this.sanitizeAutoReply(autoReply);
    if (!sanitized) throw new BadRequestException('Failed to build auto reply');
    return sanitized;
  }

  public async updateAutoReply(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateAutoReplyDto,
    requestMeta?: AuditRequestMetaInput,
  ): Promise<SanitizedAutoReply> {
    if (!mongoose.isValidObjectId(id)) {
      throw new BadRequestException('Invalid auto reply identifier');
    }
    const autoReply = await this.autoReplyModel
      .findOne({ _id: id, deleted_at: { $exists: false } })
      .lean();
    if (!autoReply) {
      throw new NotFoundException('Auto reply not found');
    }

    const updates: Record<string, unknown> = {};
    if (dto.name !== undefined) {
      updates['name'] = typeof dto.name === 'string' ? dto.name.trim() : '';
    }
    if (dto.keyword !== undefined) {
      const keyword = typeof dto.keyword === 'string' ? dto.keyword.trim() : '';
      if (!keyword) throw new BadRequestException('keyword is required');
      updates['keyword'] = keyword;
    }
    if (dto.match_type !== undefined) {
      if (!MATCH_TYPES.has(dto.match_type)) {
        throw new BadRequestException('Invalid match_type');
      }
      updates['match_type'] = dto.match_type;
    }
    if (dto.hook_ids !== undefined) {
      const hook_ids = await ensureValidHookIds(dto.hook_ids, this.hookModel);
      await this.ensureAllowedHookIds(user, hook_ids);
      updates['hook_ids'] = hook_ids;
    }
    if (dto.assign_group !== undefined) {
      updates['assign_group'] = await resolveAssignGroup(
        dto.assign_group,
        this.groupModel,
      );
    }
    if (dto.response !== undefined) {
      updates['response'] = ensureValidResponse(dto.response);
    }
    if (dto.mode !== undefined) {
      const mode = dto.mode === null ? null : String(dto.mode).trim();
      if (mode && !AUTO_REPLY_MODES.has(mode)) {
        throw new BadRequestException('Invalid mode');
      }
      updates['mode'] = mode;
    }
    if (dto.priority !== undefined) {
      const priority = Number(dto.priority);
      if (!Number.isInteger(priority) || priority < 0 || priority > 99) {
        throw new BadRequestException('priority must be 0-99');
      }
      updates['priority'] = priority;
    }
    if (dto.active !== undefined) {
      updates['active'] = Boolean(dto.active);
    }

    updates['updated_by'] = user.userId;

    const updated = await this.autoReplyModel
      .findByIdAndUpdate(autoReply._id, updates, {
        new: true,
        runValidators: true,
      })
      .lean();

    // [FEAT-20260808-AUDITSITE] writes audit_logs row
    // {parent:'auto_reply', action:'update', changed_fields, actor, request_meta,
    //  note} — additive only, no schema change. changed_fields is built from
    // Object.keys(updates) (incl. updated_by) exactly as
    // autoReplyController.js:421-449. Fire-and-forget.
    const changedFields = Object.keys(updates).map((field) => ({
      field,
      from: (autoReply as unknown as Record<string, unknown>)[field],
      to: (updated as unknown as Record<string, unknown> | null)?.[field],
    }));
    void this.auditLogService
      .createAuditLog({
        ref_id: updated?._id ?? autoReply._id,
        parent: 'auto_reply',
        action: 'update',
        changed_fields: changedFields,
        actor: buildActor(user),
        request_meta: requestMeta,
        note: dto.audit_note,
      })
      .catch(() => undefined);

    const sanitized = this.sanitizeAutoReply(updated);
    if (!sanitized)
      throw new BadRequestException('Failed to update auto reply');
    return sanitized;
  }

  public async updateAutoReplyActive(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateAutoReplyActiveDto,
    requestMeta?: AuditRequestMetaInput,
  ): Promise<SanitizedAutoReply> {
    if (!mongoose.isValidObjectId(id)) {
      throw new BadRequestException('Invalid auto reply identifier');
    }
    if (dto?.active === undefined) {
      throw new BadRequestException('active is required');
    }

    const active = parseActiveValue(dto.active);
    if (active === null) {
      throw new BadRequestException('active must be 0/1 or true/false');
    }

    const autoReply = await this.autoReplyModel
      .findOne({ _id: id, deleted_at: { $exists: false } })
      .lean();
    if (!autoReply) {
      throw new NotFoundException('Auto reply not found');
    }

    const updated = await this.autoReplyModel
      .findByIdAndUpdate(
        autoReply._id,
        { active, updated_by: user.userId },
        { new: true, runValidators: true },
      )
      .lean();

    // [FEAT-20260808-AUDITSITE] writes audit_logs row
    // {parent:'auto_reply', action:'update', changed_fields:[{field:'active'}],
    //  actor, request_meta} — additive only, no schema change. Mirrors
    // autoReplyController.js:510-531. Fire-and-forget.
    void this.auditLogService
      .createAuditLog({
        ref_id: updated?._id ?? autoReply._id,
        parent: 'auto_reply',
        action: 'update',
        changed_fields: [
          {
            field: 'active',
            from: (autoReply as unknown as Record<string, unknown>)['active'],
            to: (updated as unknown as Record<string, unknown> | null)?.[
              'active'
            ],
          },
        ],
        actor: buildActor(user),
        request_meta: requestMeta,
      })
      .catch(() => undefined);

    const sanitized = this.sanitizeAutoReply(updated);
    if (!sanitized)
      throw new BadRequestException('Failed to update auto reply active state');
    return sanitized;
  }

  public async deleteAutoReply(
    user: AuthenticatedUser,
    id: string,
    requestMeta?: AuditRequestMetaInput,
  ): Promise<{ message: string; id: unknown }> {
    if (!mongoose.isValidObjectId(id)) {
      throw new BadRequestException('Invalid auto reply identifier');
    }
    const autoReply = await this.autoReplyModel
      .findOne({ _id: id, deleted_at: { $exists: false } })
      .lean();
    if (!autoReply) {
      throw new NotFoundException('Auto reply not found');
    }

    const updated = await this.autoReplyModel
      .findByIdAndUpdate(
        autoReply._id,
        { deleted_at: new Date(), updated_by: user.userId },
        { new: true },
      )
      .lean();

    // [FEAT-20260808-AUDITSITE] writes audit_logs row
    // {parent:'auto_reply', action:'delete', actor, request_meta, note} —
    // additive only, no schema change. Mirrors autoReplyController.js:463-478.
    // Fire-and-forget.
    void this.auditLogService
      .createAuditLog({
        ref_id: updated?._id ?? autoReply._id,
        parent: 'auto_reply',
        action: 'delete',
        actor: buildActor(user),
        request_meta: requestMeta,
      })
      .catch(() => undefined);

    return {
      message: 'Auto reply deleted successfully',
      id: updated?._id || autoReply._id,
    };
  }
}
