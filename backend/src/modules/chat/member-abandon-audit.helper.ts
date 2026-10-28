/**
 * [FEAT-20260821-ABANDONSHIELD] one audit row when the abandon shield is flipped.
 * ===========================================================================
 * Owner asked for it in the same breath as the shield itself: *"audit log เซฟด้วย"*.
 *
 * WHY A FILE OF ITS OWN, not four lines inside `members.service.ts`: that service
 * is already 532 lines, and the reasoning below is longer than the call it
 * guards. Owner's standing rule — *"ห้ามยัด ห้ามบวม จัดระเบียบ"*. Deleting this
 * file and its one call site removes the audit completely.
 *
 * WHY THE AUDIT LIVES IN THE BACKEND. `PATCH /api/{line,channel}-users/:id/
 * ignore-abandon` is the ONLY way this column can be written, so recording here
 * captures every change whatever made it — a screen, a script, a future bulk
 * action. The existing precedent writes its audit from the browser instead
 * (`omnidesk-console/pages/chat/TicketSupport.tsx:1625`), which only ever
 * records what THAT screen did. เขียนที่ route = ครบทุกทาง.
 *
 * ⚠️ FIRE-AND-FORGET, DELIBERATELY. By the time this runs the column is already
 * written. Failing the request now would tell the operator their change did not
 * happen when it did — and they would click again. An audit gap is recoverable;
 * a lie about the data is not. Same stance, same reason, as `logBroadcast`
 * (`content/broadcasts.service.ts:771`). ปล่อยพลาดได้ · ห้ามโกหกว่าไม่ได้เขียน.
 *
 * ⚠️ NOTHING IS WRITTEN WHEN THE VALUE DID NOT MOVE. Clicking "confirm" on the
 * state it is already in must not leave a row saying it changed — that is a
 * false entry in a trail somebody will later use to reconstruct who did what.
 * The same rule `auditBulk` follows on the hook side.
 *
 * ⚠️ FIELD NAMES ARE NOT GUESSED. `hook_audit_logs` declares `ref_id` as a bare
 * ObjectId with NO `ref`, so it can address any collection, and `parent` is what
 * says which one — hence `ref_id` = the member id and `parent: 'line_user'`,
 * copied from the FE precedent so both writers land in the same shape.
 *
 * revert: delete this file and its call in `members.service.ts`.
 */
import type { AuthenticatedUser } from '@/common';

/** Just the piece of the audit service this needs — never the whole class. */
export interface AbandonAuditWriter {
  createAuditLog(payload: Record<string, unknown>): Promise<unknown>;
}

export interface AbandonAuditInput {
  memberId: string;
  /** What the column held before the write. `undefined` on rows that predate it. */
  before: unknown;
  after: boolean;
  auth?: AuthenticatedUser;
}

/**
 * Records the flip. Returns nothing and never rejects — see the header.
 *
 * @param warn where a failure is reported; the caller owns the logger.
 */
export function auditAbandonShieldFlip(
  input: AbandonAuditInput,
  deps: { audit: AbandonAuditWriter; warn: (msg: string) => void },
): void {
  const before = input?.before === true;
  const after = input?.after === true;
  // no move, no row — see the header.
  if (before === after) return;

  const userId = input?.auth?.userId;
  // `createAuditLog` throws on a missing actor; a shield flip with no signed-in
  // user cannot happen through the route, and if it ever did, losing the row is
  // better than losing the response.
  if (!userId) {
    deps.warn('[ABANDONSHIELD] audit skipped — no actor on the request');
    return;
  }

  void deps.audit
    .createAuditLog({
      ref_id: String(input.memberId),
      parent: 'line_user',
      action: 'update',
      /* [FIX-20260827-ABANDONAUDITSHAPE] MUST be an ARRAY of {field,from,to}.
         `AuditLogService.create` normalises a non-array to `[]` and then
         REFUSES action 'update' with empty changes — and the refusal lands in
         the fire-and-forget catch below, so the old object shape meant this
         row was silently dropped every single time (live DB 27/08: zero
         `parent: 'line_user'` rows since the feature shipped 21/08).
         Shape pinned by `z-test/unit/abandon-shield-audit.spec.ts`, whose fake
         now enforces the real gate. Same array shape as
         `strike/strike-block-audit.helper.ts`. */
      changed_fields: [
        { field: 'ignore_abandon_assist', from: before, to: after },
      ],
      actor: {
        user_id: String(userId),
        username: input.auth?.username,
        display_name: input.auth?.displayName,
      },
    })
    .catch((err: Error) =>
      deps.warn(`[ABANDONSHIELD] audit failed: ${err.message}`),
    );
}
