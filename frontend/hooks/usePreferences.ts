import { useCallback, useEffect, useRef, useState } from 'react';
import { getInitialPreferences, savePreferences, saveLocalPreference, deepMerge, Preferences } from '../services/admin';
import { readPath } from '../utils/readPath';

/* [REFACTOR-20260905-READPATHTRUTH] this local reader WAS byte-identical to
   utils/readPath.ts's algorithm already — repointed to the shared one instead
   of keeping a second copy. No behaviour change: see that file's header for
   the measurement showing every real usePreference() path in this app agrees. */

// Build a nested patch object for a dot-path: setPath("a.b", 1) => {a:{b:1}}.
const buildPatch = (path: string, value: any): Preferences => {
  const keys = path.split('.');
  const patch: any = {};
  let cur = patch;
  keys.forEach((k, i) => {
    if (i === keys.length - 1) cur[k] = value;
    else cur = cur[k] = {};
  });
  return patch;
};

/**
 * Read/write one preference by dot-path, backed by the DB.
 *
 * - Initial value: the user's stored preferences, or `fallback` (a code
 *   default) if they have none — so an account that never saved anything
 *   behaves exactly as before. Seamless, no migration.
 * - Writing updates local state immediately and PUTs a deep-merge patch to the
 *   backend (debounced), so independent settings never clobber each other.
 * - Adding a NEW preference is just a new path — no backend/type change.
 *
 *   const [cols, setCols] = usePreference('tables.users.columns', DEFAULT_COLS);
 *   const [color, setColor] = usePreference('chat.bubbleColor', '#00b900');
 */
export function usePreference<T>(
  path: string,
  fallback: T,
  options?: { immediate?: boolean }
): [T, (value: T | ((prev: T) => T)) => void] {
  // Discrete single-click settings (theme, sound, group mode, column visibility)
  // should PUT immediately — the 500ms debounce made them lose the write if the
  // user reloaded within the window (the "theme reverts on refresh" bug). The
  // debounce is kept only for high-frequency updates like column-width drags.
  const immediate = options?.immediate === true;
  const [value, setValue] = useState<T>(() => {
    const stored = readPath(getInitialPreferences(), path);
    return stored === undefined ? fallback : (stored as T);
  });

  const latest = useRef(value);
  latest.current = value;
  const timer = useRef<number | null>(null);

  // Re-read when preferences load (login on a fresh browser fires this), so the
  // DB value applies without a manual refresh. Only pulls in a stored value —
  // if none exists at this path we keep the current one, not the fallback.
  useEffect(() => {
    const resync = () => {
      const stored = readPath(getInitialPreferences(), path);
      if (stored !== undefined) {
        latest.current = stored as T;
        setValue(stored as T);
      }
    };
    window.addEventListener('preferences:updated', resync);
    return () => window.removeEventListener('preferences:updated', resync);
  }, [path]);

  // Accepts a value or an updater fn (like useState), so callers that need the
  // previous value (column resize/toggle) keep working.
  const update = useCallback((next: T | ((prev: T) => T)) => {
    const resolved = typeof next === 'function' ? (next as (p: T) => T)(latest.current) : next;
    latest.current = resolved;
    setValue(resolved);
    if (timer.current) window.clearTimeout(timer.current);
    const patch = buildPatch(path, resolved);

    // ALWAYS mirror to the local caches SYNCHRONOUSLY, for EVERY preference —
    // both the localStorage cache and the stored-auth login snapshot. This is
    // the fix for "refresh reverts": getInitialPreferences() reads the login
    // snapshot first, so if we only wrote localStorage the stale snapshot would
    // win on reload. Writing both here means the value is correct on the next
    // load no matter when (or whether) the async DB PUT lands.
    saveLocalPreference(patch);

    const put = () => savePreferences(patch).catch((err) => {
      // A failed save leaves local state as-is; the caches still hold it and the
      // next successful write re-syncs. Never throw into the UI.
      console.warn('savePreferences failed', err);
    });
    if (immediate) {
      put(); // discrete setting → hit the DB now too
    } else {
      // Debounce only the NETWORK PUT (rapid column-resize drags collapse into
      // one request); the local caches above were already updated synchronously.
      timer.current = window.setTimeout(put, 500);
    }
  }, [path, immediate]);

  return [value, update];
}

// Merge helper for callers that manage a whole prefs subtree themselves.
export { deepMerge };
