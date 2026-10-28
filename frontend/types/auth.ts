// [REFACTOR-20260808-TYPESPLIT] Auth / session domain. Self-contained (no cross-module refs).

export interface AuthUser {
  id: string;
  // [FIX-20260801-HOOKTYPES] บาง endpoint ส่ง _id มาแทน id (โค้ดอ่านทั้งสองแบบ
  // ด้วย `user?.id || user?._id` อยู่แล้ว) · type แค่ไม่เคยพูดถึง
  _id?: string;
  username: string;
  display_name: string;
  role_id: string;
  allowed_hooks?: string[] | null;
  // Per-user UI preferences (language/theme/table columns/…). null or absent =
  // never set → the client uses its code defaults. Loose shape by design so new
  // sections need no type change.
  preferences?: Record<string, any> | null;
}

export interface AuthRole {
  id: string;
  name: string;
  permissions: string[];
}

export interface AuthMenuItem {
  id: string;
  label: string;
  path: string;
  parent_menu: string | null;
  order: number;
  visible: boolean;
}

export interface AuthLoginResponse {
  // [FEAT-20260808-HTTPONLY-FE] (a) WHAT: `token` dropped from the FE type; new
  // `expiresAt` (epoch ms) read straight from the login/refresh body.
  // (b) WHY: the JWT now lives in an HttpOnly cookie the FE never reads, so the
  // FE no longer stores it nor decodes it for expiry — the BE returns expiresAt
  // instead (it still returns `token` in the body during dual-support, we ignore
  // it). (c) REVERT: restore `token: string;` here and delete `expiresAt`, and
  // revert authStorage to decode the token for expiry.
  expiresAt: number | null;
  user: AuthUser;
  role: AuthRole;
  permissions: string[];
  menus: AuthMenuItem[];
}

export interface AuthState extends AuthLoginResponse {
  // [FEAT-20260808-HTTPONLY-FE] expiresAt is inherited from AuthLoginResponse
  // now (was declared here and derived by decoding the JWT). Same shape, new
  // source (response body). revert: move `expiresAt` back here + drop it above.
  // Resolved once at persist time from user.allowed_hooks. null means no
  // whitelist: superuser or a legacy account that sees every OA in its groups.
  allowed_hooks: string[] | null;
}
