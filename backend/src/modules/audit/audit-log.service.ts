import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import mongoose from 'mongoose';

import { isSuperRoleName } from '@/common/auth/super-role';
import { resolveLogDateRange } from '@/common/utils/date-range';

// [FEAT-20260808-AUDITSITE] Leaf-file import, not the '@/modules/hooks' barrel.
// HooksModule now imports AuditModule (for the group audit sites), so pulling the
// hooks barrel here would close the cycle hooks -> audit -> hooks and leave
// HookAuditLog `undefined` at decorate time. Same leaf-import cycle break the
// hooks module already uses for User/Handoff.
import {
  HookAuditLog,
  type HookAuditLogDocument,
} from '@/modules/hooks/schemas/hook-audit-log.schema';

/**
 * Append-only audit trail, ported from legacy
 * `src/services/infra/auditLogService.js`.
 *
 * It is a *service* rather than a controller helper because two very different
 * callers share it: the root-mounted `/audit/logs` endpoints, and every module
 * that records a change as a side effect (flex cards do, below). Legacy has the
 * same split for the same reason.
 */

/** Actions that are meaningless without a before/after list. */
const ACTIONS_REQUIRING_CHANGES = new Set([
  'update',
  'toggle_status',
  'toggle_fast_mode',
]);

export interface AuditActorInput {
  user_id?: string;
  username?: string;
  display_name?: string;
}

export interface AuditRequestMetaInput {
  request_id?: string;
  ip?: string;
  user_agent?: string;
}

export interface AuditChangedFieldInput {
  field: string;
  from?: unknown;
  to?: unknown;
}

export interface CreateAuditLogInput {
  ref_id?: unknown;
  hook_id?: unknown;
  group_id?: unknown;
  parent?: string;
  action?: string;
  changed_fields?: unknown;
  actor?: AuditActorInput;
  request_meta?: AuditRequestMetaInput;
  note?: string;
  version?: number;
}

export interface ListAuditLogsOptions {
  refId?: string;
  hookId?: string;
  groupIds?: string[];
  roleName?: string;
  parent?: string;
  page?: string | number;
  limit?: string | number;
  action?: string;
  actor_user_id?: string;
  from?: string;
  to?: string;
  sort?: string;
}

/**
 * [FIX-20260819-AUDITREADSCOPE] Who is asking, for the single-row read.
 *
 * Deliberately the same two fields `ListAuditLogsOptions` uses for scoping, with the same
 * names, so the two reads cannot drift apart in what "my groups" means.
 */
export interface AuditReadScope {
  groupIds?: string[];
  roleName?: string;
}

export interface AuditPagination {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

export interface ListAuditLogsResult {
  data: unknown[];
  pagination: AuditPagination;
}

/**
 * Legacy throws a plain `Error` and its controller maps `err.status ??
 * err.statusCode ?? 400` onto the response. Reproducing that here as typed Nest
 * exceptions keeps the same status codes and the same `{ error }` envelope,
 * which is what the golden diff compares.
 */
function normalizeObjectId(id: unknown, label = 'id'): mongoose.Types.ObjectId {
  if (!id) {
    throw new BadRequestException(`${label} is required`);
  }
  if (mongoose.Types.ObjectId.isValid(id as string)) {
    return new mongoose.Types.ObjectId(id as string);
  }
  throw new BadRequestException(`Invalid ${label}`);
}

/**
 * Sort spec from a `field:direction` string.
 *
 * Anything that is not `asc` sorts descending, including a missing direction —
 * copied from legacy, where `parseSort('created_at')` is descending.
 */
function parseSort(sort?: string): Record<string, mongoose.SortOrder> {
  if (!sort) return { created_at: -1 };
  const [field, direction] = sort.split(':');
  if (!field) return { created_at: -1 };
  return { [field]: direction === 'asc' ? 1 : -1 };
}

@Injectable()
export class AuditLogService {
  constructor(
    @InjectModel(HookAuditLog.name)
    private readonly auditLogModel: Model<HookAuditLogDocument>,
  ) {}

  public async createAuditLog(
    payload: CreateAuditLogInput,
  ): Promise<HookAuditLogDocument> {
    const {
      ref_id,
      hook_id,
      group_id,
      parent,
      action,
      changed_fields,
      actor,
      request_meta,
      note,
      version,
    } = payload;

    if (!ref_id) throw new BadRequestException('ref_id is required');
    if (!action) throw new BadRequestException('action is required');

    // Actor is validated before the ids, matching legacy's `ensureActor` call
    // order — a payload missing both reports the actor first.
    if (!actor?.user_id) {
      throw new BadRequestException('actor.user_id is required');
    }
    const normalizedActor = {
      user_id: actor.user_id,
      username: actor.username || actor.user_id,
      display_name: actor.display_name,
    };

    const normalizedRefId = normalizeObjectId(ref_id, 'ref_id');
    const normalizedHookId = hook_id
      ? normalizeObjectId(hook_id, 'hook_id')
      : undefined;
    const normalizedGroupId = group_id
      ? normalizeObjectId(group_id, 'group_id')
      : undefined;

    const normalizedChanges = Array.isArray(changed_fields)
      ? (changed_fields as AuditChangedFieldInput[])
      : [];

    if (
      ACTIONS_REQUIRING_CHANGES.has(action) &&
      normalizedChanges.length === 0
    ) {
      throw new BadRequestException(`changed_fields is required for ${action}`);
    }

    const log = new this.auditLogModel({
      hook_id: normalizedHookId,
      group_id: normalizedGroupId,
      action,
      changed_fields: normalizedChanges,
      actor: normalizedActor,
      request_meta,
      note,
      version,
      ref_id: normalizedRefId,
      parent,
    });

    return log.save();
  }

  public async listAuditLogs(
    options: ListAuditLogsOptions,
  ): Promise<ListAuditLogsResult> {
    const {
      refId,
      hookId,
      groupIds,
      roleName,
      parent,
      page = 1,
      limit = 20,
      action,
      actor_user_id,
      from,
      to,
      sort,
    } = options;

    const query: Record<string, unknown> = {};
    if (refId) query.ref_id = normalizeObjectId(refId, 'ref_id');
    if (hookId) query.hook_id = normalizeObjectId(hookId, 'hook_id');

    /**
     * Super-role check, kept local and narrow on purpose.
     *
     * Legacy reads `roleName === 'superadmin' || roleName === 'superuser'`
     * (auditLogService.js:121). The shared `isSuperUser` helper takes an
     * AuthenticatedUser, but here the caller has already reduced the identity to
     * a role name string, so the same list is applied to that string rather than
     * re-deriving it. `superuser` is dropped for the reason recorded in
     * src/common/auth/super-role.ts: no role document and no user holds it, so
     * the branch is dead and no request can reach it.
     */
    const isSuper = roleName === 'superadmin';
    if (!isSuper) {
      const normalizedGroupIds = Array.isArray(groupIds)
        ? groupIds.filter((id) => mongoose.Types.ObjectId.isValid(id))
        : [];

      // No groups means nothing is visible. Legacy answers an empty page with
      // `limit: 0` — an odd value, but the dashboard renders it, so it is
      // copied rather than corrected.
      if (normalizedGroupIds.length === 0) {
        return {
          data: [],
          pagination: { page: 1, limit: 0, total: 0, total_pages: 1 },
        };
      }

      const groupObjectIds = normalizedGroupIds.map(
        (id) => new mongoose.Types.ObjectId(id),
      );
      // `null` is included so entries recorded without a group stay visible to
      // group-scoped users, exactly as legacy does.
      query.group_id = { $in: [...groupObjectIds, null] };
    }

    if (parent) query.parent = parent;
    if (action) query.action = action;
    if (actor_user_id) query['actor.user_id'] = actor_user_id;

    /*
     * [FEAT-20260809-DATERANGE] Was an inline `new Date(from)` pair here. Replaced by the
     * shared policy so all three log pages agree on what a day means.
     *
     * WHAT CHANGED: a bare `YYYY-MM-DD` is now a BANGKOK day, not a UTC one, and a window
     *   wider than MAX_RANGE_DAYS is clamped. A full ISO instant still passes through
     *   untouched, and an unparsable value is still ignored rather than rejected — so the
     *   legacy-parity behaviour this comment used to describe is preserved.
     * WHY: parsed as UTC, "today" began at 07:00 Bangkok and silently hid every row from
     *   00:00–06:59. Admins read local time, so the backend owes them local days.
     * revert: restore the inline block above (see git history) — resolveLogDateRange has no
     *   other caller here, so removing it affects only this filter.
     */
    const dateRange = resolveLogDateRange(from, to);
    if (dateRange.filter) query.created_at = dateRange.filter;

    const sanitizedLimit = Math.min(
      Math.max(parseInt(String(limit), 10) || 20, 1),
      100,
    );
    const sanitizedPage = Math.max(parseInt(String(page), 10) || 1, 1);

    const [data, total] = await Promise.all([
      this.auditLogModel
        .find(query)
        .sort(parseSort(sort))
        .skip((sanitizedPage - 1) * sanitizedLimit)
        .limit(sanitizedLimit)
        .lean(),
      this.auditLogModel.countDocuments(query),
    ]);

    return {
      data,
      pagination: {
        page: sanitizedPage,
        limit: sanitizedLimit,
        total,
        // `|| 1` keeps an empty result reporting one page, not zero.
        total_pages: Math.ceil(total / sanitizedLimit) || 1,
      },
    };
  }

  /**
   * ==== [FIX-20260819-AUDITREADSCOPE] the single-row read now asks who is calling
   *
   * WHAT WAS WRONG. This was `findById(id).lean()` with no scope argument, and the
   * controller called it with no caller. The route sits behind the global JwtAuthGuard,
   * so "authenticated" was the only gate: any operator who knew or guessed a 24-hex
   * ObjectId read any tenant's row, `changed_fields` included — which is where the
   * before/after value of every edit lives. `listAuditLogs` fifty lines up has scoped the
   * same collection by `group_id` all along; only the by-id read was open.
   *
   * THE RULE IS THE LIST'S RULE, not a new one. Super skips the filter; everyone else is
   * narrowed to their groups plus `null`. Written as a FILTER rather than a load-then-check
   * so an out-of-scope row is never fetched into memory at all.
   *
   * `null` IS INCLUDED ON PURPOSE (428 of 937 real rows carry `group_id: null`): the list
   * shows those rows to group-scoped callers and says so in its own comment. Hiding them
   * only here would mean a row the list pages to an operator vanishes when they open it.
   *
   * NO GROUPS ⇒ NOTHING, not even the null-group rows — the list short-circuits to an empty
   * page before `null` is ever added, and this is that same answer for one row. Fail closed.
   *
   * WHY 404 AND NOT 403. `assertHookInScope` answers 403, but it answers about an OA the
   * caller already named. Here the id IS the secret, so a 403 on someone else's row against
   * a 404 on a row that does not exist would make this endpoint an existence oracle over the
   * whole collection. Both answer the message this route already had. Refused and missing
   * are indistinguishable, which is what the list is too (an out-of-scope row is simply
   * absent from the page).
   *
   * `scope` is REQUIRED, not optional. An optional scope defaults to "no filter", and the
   * one thing this fix must not permit is a future caller reopening the hole by forgetting
   * an argument.
   *
   * revert: drop the `scope` parameter and restore `findById(id).lean()`; the leak returns
   * with it, and the controller's `@CurrentUser()` goes with it.
   */
  public async getAuditLogById(
    id: string,
    scope: AuditReadScope,
  ): Promise<unknown> {
    if (!id) throw new BadRequestException('audit log ID is required');
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid audit log ID');
    }

    const query: Record<string, unknown> = {
      _id: new mongoose.Types.ObjectId(id),
    };

    /**
     * Same predicate as `listAuditLogs`, reached through the shared helper rather than a
     * second inline `=== 'superadmin'`: `super-role.ts` lists `superadmin` and nothing
     * else, so the two agree by construction instead of by copy. Its own header records
     * what happened the last time this comparison was written out by hand.
     */
    if (!isSuperRoleName(scope.roleName)) {
      const normalizedGroupIds = Array.isArray(scope.groupIds)
        ? scope.groupIds.filter((gid) => mongoose.Types.ObjectId.isValid(gid))
        : [];

      // No usable group ⇒ no row is readable. Reported as the ordinary "not found" so it
      // reveals nothing about whether the id exists.
      if (normalizedGroupIds.length === 0) {
        throw new NotFoundException('Audit log not found');
      }

      query.group_id = {
        $in: [
          ...normalizedGroupIds.map((gid) => new mongoose.Types.ObjectId(gid)),
          null,
        ],
      };
    }

    const log = await this.auditLogModel.findOne(query).lean();
    if (!log) throw new NotFoundException('Audit log not found');
    return log;
  }
}
