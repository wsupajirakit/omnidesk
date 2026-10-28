/* [FIX-20260922-CHUNKSTUCK] A failed page chunk must always END somewhere.
 *
 * WHAT THIS FILE IS REALLY GUARDING. Not "does recovery work" — the old code
 * also "worked" in the happy case. The defect was that one branch had no
 * ending at all: it returned `new Promise(() => {})`, so React suspended
 * forever and the admin sat on `กำลังโหลด…` with no error, no request and
 * nothing in any server log. Every case below therefore asserts that the
 * promise SETTLES, and settles as a rejection the UI can render.
 *
 * 🔴 The three cases marked REPLAY reproduce bugs that were live in
 *    production on 22/09/2026. Deleting the fix must turn them red.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  CHUNK_RELOAD_KEY,
  RELOAD_GRACE_MS,
  browserRecoveryDeps,
  isChunkLoadError,
  lazyWithRecovery,
  recoverFromChunkError,
  withRecovery,
  type RecoveryDeps,
} from '../components/common/chunk-recovery/lazyWithRecovery';

const chunkError = () =>
  new Error('Failed to fetch dynamically imported module: https://x/assets/TicketChat-abc.js');

/** A recording stand-in for the browser. `wait` resolves instantly so the
 *  tests measure the DECISION, not the clock. */
const deps = (over: Partial<RecoveryDeps> = {}) => {
  const calls = { reload: 0, wrote: 0, cleared: 0, waited: [] as number[] };
  const base: RecoveryDeps = {
    readFlag: () => false,
    writeFlag: () => {
      calls.wrote += 1;
      return true;
    },
    clearFlag: () => {
      calls.cleared += 1;
    },
    reload: () => {
      calls.reload += 1;
    },
    wait: (ms) => {
      calls.waited.push(ms);
      return Promise.resolve();
    },
    ...over,
  };
  return { deps: base, calls };
};

describe('[CHUNKSTUCK] recovery always settles', () => {
  it('⭐⭐⭐ (REPLAY) a first chunk failure reloads — and then REJECTS, it does not hang', async () => {
    /* The old code returned a promise with no resolve and no reject here. If
       this ever hangs again, the test times out instead of passing. */
    const { deps: d, calls } = deps();
    await expect(recoverFromChunkError(chunkError(), d)).rejects.toThrow(
      /Failed to fetch dynamically imported module/,
    );
    expect({ reload: calls.reload, wrote: calls.wrote }).toEqual({ reload: 1, wrote: 1 });
    expect(calls.waited).toEqual([RELOAD_GRACE_MS]);
  });

  it('⭐⭐⭐ (REPLAY) a SECOND failure does not reload again — that was the loop', async () => {
    /* The old guard was cleared by window `load`, which fires before any
       dynamic import, so the second failure reloaded again… and again. */
    const { deps: d, calls } = deps({ readFlag: () => true });
    await expect(recoverFromChunkError(chunkError(), d)).rejects.toThrow();
    expect({ reload: calls.reload, wrote: calls.wrote }).toEqual({ reload: 0, wrote: 0 });
  });

  it('⭐⭐⭐ (REPLAY) storage refusing the write ⇒ no reload at all', async () => {
    /* Safari with storage blocked. A reload we cannot remember is a reload
       that repeats forever, so we surface the error instead. */
    const { deps: d, calls } = deps({ writeFlag: () => false });
    await expect(recoverFromChunkError(chunkError(), d)).rejects.toThrow();
    expect(calls.reload).toBe(0);
  });

  it('⭐⭐⭐ a non-chunk error is rethrown untouched and never triggers a reload', async () => {
    /* A real bug inside the page must not be disguised as a network hiccup. */
    const { deps: d, calls } = deps();
    const bug = new TypeError('cannot read properties of undefined');
    await expect(recoverFromChunkError(bug, d)).rejects.toBe(bug);
    expect({ reload: calls.reload, wrote: calls.wrote }).toEqual({ reload: 0, wrote: 0 });
  });

  it('⭐⭐⭐ a successful import clears the flag — success is the honest moment, not `load`', async () => {
    const { deps: d, calls } = deps();
    const mod = { default: (() => null) as any };
    await expect(withRecovery(() => Promise.resolve(mod), d)).resolves.toBe(mod);
    expect({ cleared: calls.cleared, reload: calls.reload }).toEqual({ cleared: 1, reload: 0 });
  });

  it('⭐⭐⭐ a failing import goes through recovery and still rejects', async () => {
    const { deps: d, calls } = deps();
    await expect(withRecovery(() => Promise.reject(chunkError()), d)).rejects.toThrow();
    expect({ cleared: calls.cleared, reload: calls.reload }).toEqual({ cleared: 0, reload: 1 });
  });

  it('⭐⭐ lazyWithRecovery hands React a component, not a promise', () => {
    const Lazy = lazyWithRecovery(() => Promise.resolve({ default: (() => null) as any }), deps().deps);
    expect(typeof Lazy).toBe('object');
    expect((Lazy as any).$$typeof).toBeDefined();
  });
});

describe('[CHUNKSTUCK] which errors count as a chunk failure', () => {
  it('⭐⭐⭐ all three browser wordings match — one engine each', () => {
    for (const msg of [
      'Failed to fetch dynamically imported module: https://x/assets/a.js', // Chromium
      'error loading dynamically imported module',                          // Firefox
      'Importing a module script failed.',                                  // Safari
    ]) {
      expect({ msg, hit: isChunkLoadError(new Error(msg)) }).toEqual({ msg, hit: true });
    }
  });

  it('⭐⭐ anything else is not one — including a string that merely mentions a module', () => {
    expect(isChunkLoadError(new TypeError('x is not a function'))).toBe(false);
    expect(isChunkLoadError('Failed to fetch dynamically imported module')).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});

describe('[CHUNKSTUCK] the real browser wiring is guarded', () => {
  it('⭐⭐⭐ (REPLAY) sessionStorage throwing does not escape — it used to be touched bare', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() {
        throw new DOMException('storage blocked');
      },
    });
    try {
      expect(browserRecoveryDeps.readFlag()).toBe(false);
      expect(browserRecoveryDeps.writeFlag()).toBe(false);
      expect(() => browserRecoveryDeps.clearFlag()).not.toThrow();
    } finally {
      if (original) Object.defineProperty(window, 'sessionStorage', original);
    }
  });

  it('⭐⭐ the flag round-trips through real storage', () => {
    sessionStorage.removeItem(CHUNK_RELOAD_KEY);
    expect(browserRecoveryDeps.readFlag()).toBe(false);
    expect(browserRecoveryDeps.writeFlag()).toBe(true);
    expect(browserRecoveryDeps.readFlag()).toBe(true);
    browserRecoveryDeps.clearFlag();
    expect(browserRecoveryDeps.readFlag()).toBe(false);
  });

  it('⭐⭐ the grace period is a real, bounded number', () => {
    /* "Bounded" is the whole fix — 0 would fire before a good reload lands,
       and something enormous would be the old hang wearing a timer. */
    expect(RELOAD_GRACE_MS).toBeGreaterThanOrEqual(1_000);
    expect(RELOAD_GRACE_MS).toBeLessThanOrEqual(10_000);
  });
});

describe('[CHUNKSTUCK] App.tsx uses it, and the old traps are gone', () => {
  const src = () =>
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('fs').readFileSync(require('path').resolve(__dirname, '..', 'App.tsx'), 'utf8') as string;

  it('⭐⭐⭐ (REPLAY) no never-settling promise survives anywhere in App.tsx', () => {
    expect(src()).not.toMatch(/new Promise<never>\(\s*\(\)\s*=>\s*\{\s*\}\s*\)/);
  });

  it('⭐⭐⭐ (REPLAY) the flag is no longer cleared by the window `load` event', () => {
    /* `load` fires before any dynamic import, so clearing there defeated the
       one-reload budget entirely. */
    /* The real line named the CONSTANT, not the string literal — a first cut of
       this assertion matched only `chunk_reload_once` and passed against the
       unfixed file, which is a test that measures nothing. */
    expect(src()).not.toMatch(
      /addEventListener\(\s*'load'[\s\S]{0,160}(CHUNK_RELOAD_KEY|chunk_reload_once)/,
    );
  });

  it('⭐⭐⭐ every lazy page goes through the recovering loader', () => {
    const body = src();
    expect(body).toContain("from './components/common/chunk-recovery/lazyWithRecovery'");
    expect(body).not.toMatch(/\bretryLazy\s*\(/);
    /* and no page slipped back to bare React.lazy */
    const bare = body.match(/=\s*lazy\(\s*\(\)\s*=>\s*import\(/g) ?? [];
    expect({ bareLazyPages: bare.length }).toEqual({ bareLazyPages: 0 });
  });

  it('⭐⭐⭐ the route tree is wrapped in the error boundary', () => {
    expect(src()).toContain('<RouteErrorBoundary>');
  });
});
