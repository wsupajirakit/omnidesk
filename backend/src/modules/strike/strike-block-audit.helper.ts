/**
 * [FEAT-20260827-ADMINBLOCK] One audit row per admin block / clear.
 * ===========================================================================
 * 📖 PLAN: `todo/task/27082026/todo8_27082026_admin-block-suspend.md`
 *
 * WHY THIS EXISTS — the owner's direct ask: *"ใครกด block ให้ใคร"* must be
 * answerable with a NAME, later, by somebody who was not there. The session row
 * already keeps `suspended_by` / `closed_by`, but those are bare ObjectIds — a
 * rename or a deleted account erases the name, and nothing surfaces them in the
 * audit UI. `hook_audit_logs` captures the actor BY VALUE (schema note on
 * `AuditActor`) and is what `/audit/logs` already renders, so both admin
 * actions land there too. Two layers, two jobs: แถว session = ความจริงของ state
 * ปัจจุบัน · แถว audit = ประวัติการกระทำพร้อมชื่อ.
 *
 * MODELLED ON `chat/member-abandon-audit.helper.ts` (same file-of-its-own
 * reasoning, same fire-and-forget stance) with ONE deliberate difference:
 * `changed_fields` is an ARRAY. The abandon helper passes an object, and
 * `AuditLogService.createAuditLog` normalises non-arrays to `[]`, then throws
 * `changed_fields is required for update` — swallowed by the catch, so ITS row
 * has never landed (live DB 27/08: zero `parent: 'line_user'` rows). The array
 * shape here is pinned by `z-test/unit/strike-block-audit.spec.ts`.
 * changed_fields ต้องเป็น array ไม่งั้นแถวหายเงียบทั้งใบ — บั๊กจริงของเพื่อนบ้าน
 *
 * ⚠️ FIRE-AND-FORGET, and written AFTER the state change succeeded: a failed
 * audit must never turn a successful block into an error the admin retries.
 * An audit gap is recoverable; a lie about the data is not (same stance as
 * `logBroadcast`, `auditAbandonShieldFlip`).
 *
 * ⚠️ NO ACTOR ⇒ NO ROW, loudly. `createAuditLog` would refuse it anyway
 * (`actor.user_id is required`); skipping with a warn keeps the refusal visible
 * without spending a rejected promise. Unreachable over HTTP — the guard always
 * puts the caller on the request — so this is defence, not a path.
 *
 * revert: delete this file, its two call sites in `strike.controller.ts`, and
 * the barrel export. Nothing else reads it.
 */
import type { AuthenticatedUser } from '@/common';

import type { StrikeSessionView } from './strike.service';

/** Just the one method — a spec hands in a recorder, never the whole service. */
export interface StrikeAuditWriter {
  createAuditLog(payload: Record<string, unknown>): Promise<unknown>;
}

export interface StrikeAuditInput {
  /** The session AFTER the write — its fields are the `to` values. */
  session: StrikeSessionView;
  auth?: AuthenticatedUser;
}

interface StrikeAuditDeps {
  audit: StrikeAuditWriter;
  /** Where a skipped/failed row is reported; the caller owns the logger. */
  warn: (msg: string) => void;
}

/** Every strike-session row shares one parent, like `'line_user'` does. */
export const STRIKE_AUDIT_PARENT = 'strike_session';

/**
 * The common shape of both rows. `ref_id` is the SESSION (`parent` says which
 * collection, per the schema's untyped-ObjectId design), and the customer the
 * action was FOR is in the note — a LINE id is not an ObjectId and cannot be
 * the ref, but it must still be readable from the row alone.
 */
function send(
  input: StrikeAuditInput,
  deps: StrikeAuditDeps,
  note: string,
  changed: { field: string; from?: unknown; to?: unknown }[],
): void {
  const userId = input.auth?.userId;
  if (!userId) {
    deps.warn('[ADMINBLOCK] audit skipped — no actor on the request');
    return;
  }

  void deps.audit
    .createAuditLog({
      ref_id: String(input.session._id),
      parent: STRIKE_AUDIT_PARENT,
      // 'update' is already in the schema's enum — no schema change spent here.
      action: 'update',
      note,
      changed_fields: changed,
      actor: {
        user_id: String(userId),
        username: input.auth?.username,
        display_name: input.auth?.displayName,
      },
    })
    .catch((err: Error) =>
      deps.warn(`[ADMINBLOCK] audit failed: ${err.message}`),
    );
}

/** The block — "Block จำกัดการคุย". Call it with the freshly stamped session. */
export function auditStrikeSuspend(
  input: StrikeAuditInput,
  deps: StrikeAuditDeps,
): void {
  const s = input.session;
  send(
    input,
    deps,
    `admin block — Block จำกัดการคุย · ${s.line_user_id} · session#${s.seq}`,
    [
      { field: 'suspended_at', from: null, to: s.suspended_at ?? null },
      { field: 'suspended_by', from: null, to: s.suspended_by ?? null },
      { field: 'suspended_reason', from: null, to: s.suspended_reason ?? null },
    ],
  );
}

/**
 * The clear — the release half, symmetric on the owner's ask. Fires on EVERY
 * clear, locked or not: closing a session is the same privileged action either
 * way, and a trail with holes is worse than none.
 */
export function auditStrikeClear(
  input: StrikeAuditInput,
  deps: StrikeAuditDeps,
): void {
  const s = input.session;
  send(
    input,
    deps,
    `clear session — เคลียร์ session · ${s.line_user_id} · session#${s.seq}` +
      (s.suspended_by ? ' · released an admin block' : ''),
    [
      { field: 'status', from: 'open', to: 'closed' },
      { field: 'closed_reason', from: null, to: s.closed_reason ?? null },
    ],
  );
}
