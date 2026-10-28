/**
 * Audit trail writer for hook-scoped administrative actions.
 *
 * Ported from legacy-api/src/services/infra/auditLogService.js (write side
 * only — the list side belongs to the audit endpoints, which are not in this
 * task).
 *
 * ⚠️ An audit write must never fail the request that triggered it. Legacy
 * attaches `.catch(console.error)` at every call site; `write()` swallows the
 * error here instead, so a new caller cannot forget the catch and turn a
 * successful create into a 500. The failure is still logged.
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';

import type { AuthenticatedUser } from '@/common';

import { HookAuditLog } from './schemas/hook-audit-log.schema';

/** Actions legacy refuses to record without a non-empty `changed_fields`. */
const ACTIONS_REQUIRING_CHANGES = new Set([
  'update',
  'toggle_status',
  'toggle_fast_mode',
]);

export interface AuditChange {
  field: string;
  from?: unknown;
  to?: unknown;
}

export interface AuditActorInput {
  user_id: string;
  username: string;
  display_name?: string;
}

export interface AuditRequestMetaInput {
  request_id?: string;
  ip?: string;
  user_agent?: string;
}

export interface AuditLogInput {
  /**
   * `unknown` rather than `ObjectId | string` on purpose: the hook write paths
   * read these off a `Record<string, unknown>` document, and narrowing at every
   * call site would add a cast per field with no added safety. `toObjectId`
   * validates and throws on anything that is not a real id, so the check moved
   * from the type to the one place that can actually enforce it.
   */
  ref_id: unknown;
  hook_id?: unknown;
  group_id?: unknown;
  parent?: string;
  action: string;
  changed_fields?: AuditChange[];
  actor: AuditActorInput;
  request_meta?: AuditRequestMetaInput;
  note?: string;
  version?: number;
}

/**
 * The actor recorded on an entry, taken from the verified JWT claims.
 *
 * `"system"` mirrors legacy's fallback for a request with no authenticated
 * user — `auditLogService.ensureActor` throws without a `user_id`, so a missing
 * one would otherwise lose the audit entry entirely.
 */
export function buildActor(user?: AuthenticatedUser): AuditActorInput {
  const userId = user?.userId || 'system';
  const actor: AuditActorInput = {
    user_id: userId,
    username: user?.username || userId,
  };
  if (user?.displayName) actor.display_name = user.displayName;
  return actor;
}

/** Request headers legacy stores alongside each entry, for tracing. */
export function buildRequestMeta(
  headers: Record<string, unknown>,
  fallbackIp?: string,
): AuditRequestMetaInput {
  const header = (name: string): string | undefined => {
    const value = headers[name];
    if (typeof value === 'string') return value;
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
    return undefined;
  };
  return {
    request_id: header('x-request-id'),
    ip: header('x-forwarded-for') ?? fallbackIp,
    user_agent: header('user-agent'),
  };
}

/**
 * The id of the admin performing the action, stored on created_by/updated_by/
 * deleted_by. `null` when the claim is not an ObjectId — legacy stores null
 * rather than rejecting, because a service-issued token has no user row.
 */
export function actorObjectId(user?: AuthenticatedUser): Types.ObjectId | null {
  const id = user?.userId;
  return id && isValidObjectId(id) ? new Types.ObjectId(id) : null;
}

@Injectable()
export class HookAuditLogService {
  private readonly logger = new Logger(HookAuditLogService.name);

  constructor(
    @InjectModel(HookAuditLog.name)
    private readonly auditModel: Model<HookAuditLog>,
  ) {}

  /**
   * Writes one entry. Never throws: a failed audit write is logged and
   * swallowed, exactly as every legacy call site does.
   */
  async write(input: AuditLogInput): Promise<void> {
    try {
      await this.create(input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`${input.parent ?? 'audit'} log failed: ${message}`);
    }
  }

  /**
   * Fire-and-forget variant for handlers that must not wait on the audit write.
   *
   * Legacy calls its audit helper without awaiting in the hook write paths, so
   * the response is not held up by a second collection write. `write` already
   * swallows every error, which is what makes discarding the promise safe here
   * rather than a lost rejection.
   */
  writeInBackground(input: AuditLogInput, label = 'audit log failed'): void {
    void this.create(input).catch((error: Error) => {
      this.logger.error(`${label}: ${error.message}`);
    });
  }

  /**
   * Alias kept because the hook write paths were ported against this name.
   * Renaming their call sites would touch six handlers to no effect.
   */
  async createAuditLog(input: AuditLogInput): Promise<void> {
    await this.create(input);
  }

  private async create(input: AuditLogInput): Promise<void> {
    if (!input.ref_id) throw new Error('ref_id is required');
    if (!input.action) throw new Error('action is required');
    if (!input.actor?.user_id) throw new Error('actor.user_id is required');

    const changed = Array.isArray(input.changed_fields)
      ? input.changed_fields
      : [];
    if (ACTIONS_REQUIRING_CHANGES.has(input.action) && changed.length === 0) {
      throw new Error(`changed_fields is required for ${input.action}`);
    }

    await this.auditModel.create({
      ref_id: this.toObjectId(input.ref_id, 'ref_id'),
      hook_id: input.hook_id
        ? this.toObjectId(input.hook_id, 'hook_id')
        : undefined,
      group_id: input.group_id
        ? this.toObjectId(input.group_id, 'group_id')
        : undefined,
      parent: input.parent,
      action: input.action,
      changed_fields: changed,
      actor: input.actor,
      request_meta: input.request_meta,
      note: input.note,
      version: input.version,
    });
  }

  private toObjectId(value: unknown, label: string): Types.ObjectId {
    if (value instanceof Types.ObjectId) return value;
    if (typeof value === 'string' && isValidObjectId(value)) {
      return new Types.ObjectId(value);
    }
    throw new Error(`Invalid ${label}`);
  }
}
