/**
 * ==== [FIX-20260818-SECAUDIT] Security events reach the trail that already exists
 * plan §2.2b M3 · audit_18_aug M3
 * ===========================================================================
 *
 * WHAT WAS MISSING. `grep -rn audit src/modules/auth/` returned nothing, and so
 * did the same grep over `src/modules/admin/`. Signing in, creating an account,
 * changing someone's role and resetting a password all left **no trace at all**,
 * while flex cards, categories and broadcasts have been audited for months. The
 * capability was never absent — only unused on the paths where it matters most.
 *
 * WHY A HELPER RATHER THAN A CALL AT EACH SITE. Three things must be true of
 * every one of these rows, and each is easy to forget once:
 *   1. the write is FIRE-AND-FORGET — a failed audit must never fail a login;
 *   2. the actor comes from the authenticated caller, never from input;
 *   3. no secret is ever written into `changed_fields` (see PASSWORD_CHANGED).
 * Encoding them here means a new call site cannot get them wrong by omission.
 *
 * WHY IT LIVES IN THE AUDIT MODULE. Both callers — auth and admin — already
 * depend on it, and it depends on neither, so this is the only placement that
 * adds no module edge. `buildActor` in the hooks module answers a similar
 * question, but it is NOT reused here: importing `@/modules/hooks` from this
 * module closes the cycle hooks → audit → hooks that `audit.module.ts` and
 * `audit-log.service.ts` both already carry notes about.
 *
 * ⚠️ NOT COVERED, AND ON PURPOSE — a FAILED login. It needs an `action` value
 * that the schema's enum does not have (`hook-audit-log.schema.ts:87-99`), and
 * `ref_id` is `required` while a failed attempt for an unknown username has no
 * user to point at. Adding an enum value is a schema decision and this project
 * requires it to be announced before it is made, so it is written up in the plan
 * rather than slipped in here. Brute-force detection is exactly what it would
 * buy, so it is worth asking for.
 *
 * revert: delete this file, its barrel export, and the call sites that import
 *         it (auth.service, users.service). Nothing else reads it.
 */

import type { AuthenticatedUser } from '@/common';

import type {
  AuditActorInput,
  AuditChangedFieldInput,
  AuditLogService,
} from './audit-log.service';

/** Every row written here describes a user account, so they share one parent. */
export const SECURITY_AUDIT_PARENT = 'user';

/**
 * What a password change records INSTEAD of the value. The hash must never
 * reach the trail: audit rows are readable by any authenticated caller (the
 * list endpoint carries no permission by design — see the controller header),
 * so anything written here is effectively published to every operator.
 */
export const PASSWORD_CHANGED = '[changed]';

/**
 * The actor a row is attributed to, taken from the verified token.
 *
 * Returns `undefined` when there is no authenticated caller, rather than
 * inventing a `system` actor as `buildActor` does for internal writers. The
 * difference is deliberate: `buildActor` serves trusted in-process callers where
 * "the system did it" is true, while everything routed through here is a request
 * made by somebody. No caller ⇒ no attribution ⇒ the service's own
 * `actor.user_id is required` refuses the row. Fail closed, never guess.
 */
export function actorFromUser(
  user: AuthenticatedUser | null | undefined,
): AuditActorInput | undefined {
  if (!user?.userId) return undefined;
  return {
    user_id: user.userId,
    username: user.username,
    display_name: user.displayName,
  };
}

/** Only the audit method is needed, so a stub in a test satisfies this. */
type AuditWriter = Pick<AuditLogService, 'createAuditLog'>;

/**
 * A group reference as an id, whichever shape the caller happens to hold.
 *
 * `user.groups` is raw ObjectIds or populated documents depending on the query
 * that loaded it — the same duality `auth.service.buildResponse` already spells
 * out. The login path populates, the admin path does not. Handled once here so
 * no call site has to remember which it is holding: a populated document passed
 * through unwrapped fails `normalizeObjectId`, the audit write rejects, the
 * rejection is swallowed by design, and the row silently never appears.
 */
function groupIdOf(value: unknown): unknown {
  if (value && typeof value === 'object' && '_id' in value) {
    return value._id;
  }
  return value;
}

export interface UserSecurityEvent {
  /** Must be a value the schema's enum already accepts. */
  action: 'login' | 'create' | 'update' | 'delete';
  /** The account the row is ABOUT — for a login, the account signing in. */
  targetUserId: unknown;
  actor: AuditActorInput | undefined;
  /** Scopes the row on the list endpoint, exactly as content rows are scoped. */
  groupId?: unknown;
  note: string;
  /** Required by the service for `update`; omitted for the others. */
  changedFields?: AuditChangedFieldInput[];
}

/**
 * Writes one security row and returns immediately.
 *
 * Fire-and-forget with a swallowed rejection, the same shape every existing call
 * site uses (`object-categories.service.ts:115-123`). An audit write that throws
 * must not turn a successful sign-in into a 500 — and on this path that is not a
 * theoretical worry, because a Mongo hiccup would otherwise lock everyone out.
 */
export function recordUserSecurityEvent(
  audit: AuditWriter,
  event: UserSecurityEvent,
): void {
  void audit
    .createAuditLog({
      ref_id: event.targetUserId,
      group_id: groupIdOf(event.groupId) ?? null,
      parent: SECURITY_AUDIT_PARENT,
      action: event.action,
      actor: event.actor,
      note: event.note,
      ...(event.changedFields ? { changed_fields: event.changedFields } : {}),
    })
    .catch(() => undefined);
}
