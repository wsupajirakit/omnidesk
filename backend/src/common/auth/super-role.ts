import type { AuthenticatedUser } from '../types/authenticated-user';

/**
 * Role names that bypass group and OA scoping.
 *
 * `superadmin` ONLY — decided 2026-08-07 after querying the database directly
 * rather than trusting the legacy source:
 *
 *   roles collection      : superadmin · admin · operator · assist_admin
 *   users per role        : superadmin 2 · assist_admin 3 · admin 1
 *   roles matching /superuser/i : 0
 *
 * The legacy backend checks `superadmin || superuser` inline across
 * broadcastController, autoReplyController, ticketController, chatController
 * and userController, but `superuser` exists in none of those places — no role
 * document, no user holding it. It is a dead branch, so dropping it is
 * behaviour-preserving: the golden suite stays green because no request can
 * reach that branch. Should a `superuser` role ever be created, it will NOT be
 * treated as super here; that is deliberate, and this comment is the record.
 *
 * The list lives here once because getting it wrong is silent and expensive in
 * both directions:
 *
 *   - dropping `superadmin` locks every real superadmin out of group-scoped
 *     lists with a 403 that looks like a permissions problem
 *   - adding a name the legacy backend never treated as super (`admin`) hands
 *     that role cross-group visibility it was never granted — a privilege
 *     escalation that no test asserting "200 OK" would catch
 *
 * Both defects shipped in an earlier port of the content and ticket modules,
 * from a hand-copied `superuser || admin`. Import this; do not re-declare it.
 */
export const SUPER_ROLE_NAMES: readonly string[] = ['superadmin'];

/** True when the account bypasses group/OA scoping, per the legacy rule. */
export function isSuperUser(user?: AuthenticatedUser | null): boolean {
  if (!user) return false;
  return isSuperRoleName(user.roleName);
}

/**
 * Same rule, for the call sites that hold only a role name.
 *
 * Several handlers read `roleName` off a claim or a lean document rather than a
 * full `AuthenticatedUser`. Before this existed they each wrote the comparison
 * inline, which is how `superuser || admin` spread to six files — the defect V10
 * records. One predicate, two entry points.
 */
export function isSuperRoleName(roleName?: string | null): boolean {
  return SUPER_ROLE_NAMES.includes(roleName || '');
}
