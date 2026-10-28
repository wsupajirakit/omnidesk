import { API_BASE_URL, authFetch, handleApiResponse } from '../apiClient';
import { getStoredAuth, persistAuthState } from '../authStorage';

// Arbitrary nested UI-preferences object. Kept loose on purpose so new
// sections (a new table, chat bubble colour, saved filters, ...) can be added
// with ZERO backend or type changes — the same way the backend stores it Mixed.
export type Preferences = Record<string, any>;

const LS_KEY = 'zd_user_prefs';

// Local cache so a reload paints instantly without waiting for the network.
// The DB is the source of truth; this only mirrors it.
const readCache = (): Preferences | null => {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};
const writeCache = (prefs: Preferences | null) => {
  try {
    if (prefs) localStorage.setItem(LS_KEY, JSON.stringify(prefs));
    else localStorage.removeItem(LS_KEY);
  } catch {
    /* storage full / disabled — the DB copy still stands */
  }
};

// Initial preferences for the current user: login/refresh response first (the
// authoritative copy), then the local cache, then null (never set → the caller
// uses its code defaults, so a legacy account is untouched — seamless).
export const getInitialPreferences = (): Preferences | null => {
  const fromAuth = getStoredAuth()?.user?.preferences;
  if (fromAuth && typeof fromAuth === 'object') {
    writeCache(fromAuth as Preferences);
    return fromAuth as Preferences;
  }
  return readCache();
};

// Deep-merge locally too, so optimistic state matches what the backend will
// compute. Objects merge; arrays and primitives replace wholesale.
export const deepMerge = (base: any, patch: any): any => {
  if (Array.isArray(patch) || patch === null || typeof patch !== 'object') return patch;
  const out = base && typeof base === 'object' && !Array.isArray(base) ? { ...base } : {};
  for (const k of Object.keys(patch)) out[k] = deepMerge(out[k], patch[k]);
  return out;
};

// Write a patch to the LOCAL caches SYNCHRONOUSLY (localStorage + stored-auth),
// before/independent of the network PUT. This is what makes a discrete setting
// (theme) survive an immediate reload: even if the async PUT hasn't finished (or
// gets cancelled by the navigation), getInitialPreferences() reads the freshly
// merged value on the next load instead of the stale login snapshot.
export const saveLocalPreference = (patch: Preferences): Preferences => {
  const merged = deepMerge(getInitialPreferences() || {}, patch);
  writeCache(merged);
  const auth = getStoredAuth();
  if (auth?.user) {
    persistAuthState({ ...auth, user: { ...auth.user, preferences: merged } as any });
  }
  return merged;
};

// PUT a partial patch; the backend deep-merges and returns the full object.
// Persist it to the cache AND back into the stored auth user so the next read
// (even before a re-login) sees it.
export const savePreferences = async (patch: Preferences): Promise<Preferences> => {
  const res = await authFetch(`${API_BASE_URL}/api/users/me/preferences`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preferences: patch }),
  });
  const parsed = await handleApiResponse<{ data: Preferences }>(res, 'save preferences');
  const merged = parsed?.data ?? deepMerge(getInitialPreferences() || {}, patch);
  writeCache(merged);
  // keep the stored auth user in sync (avoids a stale value until next login)
  const auth = getStoredAuth();
  if (auth?.user) {
    persistAuthState({ ...auth, user: { ...auth.user, preferences: merged } as any });
  }
  return merged;
};
