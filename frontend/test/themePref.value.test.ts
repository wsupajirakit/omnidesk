/**
 * [FIX-20260801-THEMEBOOT] resolveTheme — the three-tier order is the whole point
 * of the file, and nothing pinned it.
 *
 * hooks/themePref.ts exists because the theme used to be decided in two places at
 * once (App.tsx and the <Login> unmount cleanup), so the switch on screen and the
 * `.theme-dark` class could disagree. Collapsing both callers onto one function is
 * only a fix while that function keeps its documented precedence:
 *   1. 'ui_theme'      — written synchronously on every toggle (freshest)
 *   2. 'zd_user_prefs' — the local preference cache (used before the toggle lands)
 *   3. the caller's preference argument (from the DB, arrives async)
 *   4. 'light'
 * Flip 1 and 2, or drop either guard, and the app is wrong only in the narrow
 * window right after a toggle or on a first login — the exact bug that was
 * reported, and the one no other check here can see.
 *
 * Leak-safe on purpose: test/setup.ts polyfills localStorage with a module-level
 * store and never clears it, so this file saves and restores the two keys it
 * touches rather than clearing anything shared.
 *
 * revert: delete together with hooks/themePref.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveTheme } from '../hooks/themePref';

const KEYS = ['ui_theme', 'zd_user_prefs'] as const;
let saved: Record<string, string | null> = {};

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, localStorage.getItem(k)]));
});
afterEach(() => {
  for (const k of KEYS) {
    const v = saved[k];
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  }
});

describe('resolveTheme — ลำดับความน่าเชื่อถือ 3 ชั้น', () => {
  it('walks tier 1 → 2 → 3 → light, and neither a junk value nor broken JSON throws', () => {
    // 1 beats 2 and beats the DB preference — the toggle just written must win
    localStorage.setItem('ui_theme', 'dark');
    localStorage.setItem('zd_user_prefs', JSON.stringify({ ui: { theme: 'light' } }));
    expect(resolveTheme('light')).toBe('dark');

    // no tier 1 yet (first paint after boot) → the cache beats the DB preference
    localStorage.removeItem('ui_theme');
    expect(resolveTheme('dark')).toBe('light');

    // tier 1 present but not a ThemeName → must be refused, not passed through
    localStorage.setItem('ui_theme', 'Dark');
    expect(resolveTheme('dark')).toBe('light');

    // tier 2 corrupt → must fall through, not throw (resolveTheme runs during render)
    localStorage.removeItem('ui_theme');
    localStorage.setItem('zd_user_prefs', '{not json');
    expect(resolveTheme('dark')).toBe('dark');

    // brand-new device, preference not loaded yet → light
    localStorage.removeItem('zd_user_prefs');
    expect(resolveTheme()).toBe('light');
  });
});
