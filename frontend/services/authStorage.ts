import { AuthLoginResponse, AuthState, AuthUser } from '../types';

const STORAGE_KEY = 'zd_dashboard_auth';

// [FEAT-20260808-HTTPONLY-FE] (a) WHAT: the JWT decode helpers (normalizeBase64,
// decodeBase64, parseJwtPayload, getTokenExpiry) are REMOVED. (b) WHY: the token
// is now an HttpOnly cookie the FE cannot read, so there is no JWT string to
// decode — `expiresAt` comes straight from the login/refresh response body, and
// `allowed_hooks` comes from response.user (the token-claim fallback is gone).
// (c) REVERT: restore those four helpers (see git history for the exact bodies)
// and re-derive expiresAt via `getTokenExpiry(response.token)` +
// allowed_hooks via the JWT `allowed_hooks` claim fallback in buildStoredState.

const buildStoredState = (response: AuthLoginResponse): AuthState => {
  // The response carries the whitelist on user. null (no whitelist) is a real
  // value, so this tests for undefined rather than falsiness. Previously the
  // JWT `allowed_hooks` claim was the fallback for a partial response; with the
  // token JS-invisible that fallback is gone, so an absent user whitelist
  // resolves to null (see revert note above to restore the JWT-claim fallback).
  const allowed_hooks = response.user?.allowed_hooks !== undefined
    ? response.user.allowed_hooks
    : null;

  return {
    ...response,
    allowed_hooks,
    user: response.user ? {
      ...response.user,
      allowed_hooks: response.user.allowed_hooks !== undefined ? response.user.allowed_hooks : allowed_hooks,
    } : response.user,
    // [FEAT-20260808-HTTPONLY-FE] expiresAt now comes from the BE body (BE-5),
    // was: getTokenExpiry(response.token). revert: getTokenExpiry(response.token).
    expiresAt: typeof response.expiresAt === 'number' ? response.expiresAt : null,
  };
};

export const persistAuthState = (response: AuthLoginResponse): AuthState => {
  const stored = buildStoredState(response);
  // [FEAT-20260808-HTTPONLY-FE] (a) WHAT: strip any `token` the BE still returns
  // in the body (dual-support) before writing to localStorage, so NO JS-readable
  // token is ever persisted. (b) WHY: the XSS-hardening goal — the browser must
  // hold no JS-readable JWT; auth rides the HttpOnly cookie. (c) REVERT: delete
  // this delete + the cast; persist the token as before.
  delete (stored as any).token;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  // Mirror the user's preferences into the prefs cache the instant we log in,
  // so components mounting right after (i18n, tables) read the DB value on the
  // very first render — no reload needed on a fresh browser.
  try {
    const prefs = (stored.user as any)?.preferences;
    if (prefs && typeof prefs === 'object') {
      localStorage.setItem('zd_user_prefs', JSON.stringify(prefs));
    } else {
      localStorage.removeItem('zd_user_prefs');
    }
    // Tell already-mounted consumers (i18n, usePreference) to re-read, so a
    // login on a fresh browser applies the DB prefs without a manual refresh.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('preferences:updated'));
    }
  } catch {
    /* ignore storage failures */
  }
  return stored;
};

export const getStoredAuth = (): AuthState | null => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return {
        ...parsed,
        expiresAt: typeof (parsed as any).expiresAt === 'number' ? (parsed as any).expiresAt : null,
      } as AuthState;
    }
    return null;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
};

export const clearStoredAuth = () => {
  localStorage.removeItem(STORAGE_KEY);
};

// [FEAT-20260808-HTTPONLY-FE] (a) WHAT: `getAuthToken()` REMOVED. (b) WHY: nothing
// holds a JS-readable token anymore — REST rides the HttpOnly cookie, WS rides a
// minted ticket, so there is no token to hand out. (c) REVERT: restore
//   export const getAuthToken = (): string | null => getStoredAuth()?.token ?? null;

export const getAuthUser = (): AuthUser | null => {
  return getStoredAuth()?.user ?? null;
};

export const isAuthExpired = (state?: AuthState | null): boolean => {
  const candidate = state ?? getStoredAuth();
  if (!candidate) return true;
  if (candidate.expiresAt === null) return false;
  return Date.now() >= candidate.expiresAt;
};

export const getAuthExpiresAt = (state?: AuthState | null): number | null => {
  return state?.expiresAt ?? getStoredAuth()?.expiresAt ?? null;
};
