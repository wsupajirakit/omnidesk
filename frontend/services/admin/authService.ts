import { API_BASE_URL, authFetch, handleApiResponse } from '../apiClient';
import { AuthLoginResponse, AuthState } from '../../types';
import { persistAuthState, clearStoredAuth, getStoredAuth } from '../authStorage';

export const authService = {
  login: async (username: string, password: string): Promise<AuthState> => {
    const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: 'POST',
      // [FEAT-20260808-HTTPONLY-FE] (a) WHAT: send + accept credentials on login.
      // (b) WHY: this is the request that receives the Set-Cookie (HttpOnly auth
      // cookie); without `credentials:'include'` the browser drops the cookie and
      // every later call is unauthenticated. (c) REVERT: remove this line.
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    const payload = await handleApiResponse<AuthLoginResponse>(response, 'log in');
    return persistAuthState(payload);
  },
  refresh: async (): Promise<AuthState> => {
    const response = await authFetch(`${API_BASE_URL}/api/auth/refresh`, {
      method: 'POST',
    });

    const payload = await handleApiResponse<Partial<AuthLoginResponse>>(response, 'refresh auth');
    const stored = getStoredAuth();
    // Carrying the stored user forward would also carry its stale
    // allowed_hooks, which is exactly what a refresh is meant to pick up
    // (force-grant adds OAs without bumping token_version). Drop the OA
    // whitelist from the fallback so buildStoredState re-reads it from the
    // fresh response's user.
    const fallbackUser = stored?.user
      ? { ...stored.user, allowed_hooks: undefined }
      : undefined;
    const merged: AuthLoginResponse = {
      // [FEAT-20260808-HTTPONLY-FE] (a) WHAT: `token` no longer carried in the
      // merged auth; `expiresAt` now taken from the refresh body (falling back to
      // the stored value if the partial refresh omits it). (b) WHY: the refreshed
      // token is re-set as the HttpOnly cookie by the BE; the FE only needs the
      // new expiry for its session timer. (c) REVERT: restore
      //   `token: payload.token ?? stored?.token ?? '',` and drop `expiresAt`.
      expiresAt: payload.expiresAt ?? stored?.expiresAt ?? null,
      user: payload.user ?? fallbackUser ?? { id: '', username: '', display_name: '', role_id: '' },
      role: payload.role ?? stored?.role ?? { id: '', name: '', permissions: [] },
      permissions: payload.permissions ?? stored?.permissions ?? [],
      menus: payload.menus ?? stored?.menus ?? [],
    };
    return persistAuthState(merged);
  },

  // [FEAT-20260808-HTTPONLY-FE] (a) WHAT: logout is now an async network call —
  // POST /api/auth/logout (credentialed) so the BE clears the HttpOnly cookie and
  // bumps token_version, THEN we clear local (user/permissions) state.
  // (b) WHY: the token now lives in an HttpOnly cookie the FE can't touch; only
  // the server can delete it. Local-only clear would leave the browser still
  // holding a valid auth cookie. (c) REVERT: replace with the synchronous
  // `logout: (): void => { clearStoredAuth(); }` — drop the network call.
  logout: async (): Promise<void> => {
    try {
      await authFetch(`${API_BASE_URL}/api/auth/logout`, { method: 'POST' });
    } catch {
      // Best-effort: even if the network logout fails (offline, expired), still
      // clear local state so the UI logs the user out. The BE also expires the
      // cookie by TTL, and a stale cookie is rejected once token_version bumps.
    }
    clearStoredAuth();
  },
};

// [FEAT-20260808-HTTPONLY-FE] (a) WHAT: new — mints a single-use WS connection
// ticket via POST /api/auth/ws-ticket (credentialed; the HttpOnly cookie authes
// it) and returns the opaque ticket string for useTicketWS to put in the WS URL.
// (b) WHY: the WS handshake can no longer carry the JS-invisible JWT; the ticket
// is the JS-readable, short-lived, single-use stand-in omnidesk-ws validates.
// (c) REVERT: delete this export and revert useTicketWS to read the JWT from
// authStorage and connect with `?token=`.
export const mintWsTicket = async (): Promise<string> => {
  const response = await authFetch(`${API_BASE_URL}/api/auth/ws-ticket`, {
    method: 'POST',
  });
  const payload = await handleApiResponse<{ ticket: string; expiresIn: number }>(
    response,
    'mint WebSocket ticket',
  );
  return payload.ticket;
};
