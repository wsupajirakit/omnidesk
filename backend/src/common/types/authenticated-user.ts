/**
 * JWT payload issued by this service.
 *
 * The field names and their contents are fixed by the legacy backend: a token
 * minted there must verify here and vice-versa, so operators are not logged out
 * when traffic moves between the two. Renaming or dropping a field here is a
 * breaking API change, not a refactor.
 */
export interface JwtPayload {
  user_id: string;
  role_id: string | null;
  role_name: string | null;
  /**
   * The caller's effective permissions.
   *
   * These are the user's own permissions, **not** the union with the role's.
   * The role only seeds the form when an account is created; whatever remains
   * after the operator unticks boxes is that account's real permission set.
   * Unioning them was tried and was wrong — it handed every role permission back
   * to accounts that had been deliberately narrowed.
   *
   * The one exception is a superadmin/superuser role, which takes the role's
   * permissions instead. Login and refresh must compute this identically, or
   * permissions would silently change when a token is refreshed.
   */
  permissions: string[];
  username: string;
  display_name: string;
  /** Bumped on the user document to invalidate every earlier token. */
  token_version: number;
  groups: string[];
  /** `null` = no allowlist: superuser, or an account predating the feature. */
  allowed_hooks: string[] | null;
  /**
   * [FIX-20260820-SESSIONCEILING] absolute session deadline, epoch SECONDS.
   *
   * Optional on purpose. ABSENT means "not yet stamped" and never "expired" —
   * every token minted before this shipped, and every token the legacy backend
   * mints, has no such claim, and refusing those would log the whole estate out
   * on deploy. `refresh` stamps one instead.
   */
  sess_exp?: number;
  iat?: number;
  exp?: number;
}

/** What the authentication guard attaches to the request. */
export interface AuthenticatedUser {
  /** [FIX-20260820-SESSIONCEILING] mirrors `JwtPayload.sess_exp`. */
  sessionExpiresAt?: number;
  userId: string;
  roleId: string | null;
  roleName: string | null;
  permissions: string[];
  username: string;
  displayName: string;
  tokenVersion: number;
  groups: string[];
  allowedHooks: string[] | null;
}
