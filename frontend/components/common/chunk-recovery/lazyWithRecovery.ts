import { lazy, type ComponentType } from 'react';

/**
 * [FIX-20260922-CHUNKSTUCK] A failed page chunk must end in a screen the user
 * can act on — never in a spinner that waits forever.
 * ===========================================================================
 * WHAT WENT WRONG (found 22/09 while chasing "หน้า ticket support ช้า/ค้าง").
 * An admin sent a screenshot of the app sitting on `กำลังโหลด…` — the route
 * Suspense fallback — with nothing else on screen. Every server-side measure
 * was clean: API routes answered in ~25ms, no 4xx/5xx on the page's endpoints,
 * no missing asset (205 `.js` requests in 24h, all 200), Cloudflare serving a
 * fresh `index.html` (`no-store`, `cf-cache-status: DYNAMIC`) and gzipping the
 * assets. Nothing was slow. The page was simply never going to finish.
 *
 * The previous helper (`retryLazy` in App.tsx) recovered from a chunk error by
 * calling `window.location.reload()` and then returning
 * `new Promise<never>(() => {})` — a promise with no resolve and no reject —
 * on the assumption that the reload would tear the document down immediately.
 * When the reload does NOT land (a tab in the background, a stalled navigation,
 * a flaky mobile link) that assumption leaves React suspended on a promise that
 * can never settle. No error is thrown, no request is made, nothing reaches the
 * server. The user waits on a spinner with no way back.
 *
 * 🔴 THE DEFECT IS THE UNBOUNDED WAIT, NOT THE RELOAD. Reloading once to pick
 *    up a fresh `index.html` is the right move — a browser holding an old
 *    document asks for hashed chunks that a later deploy removed, and only a
 *    fresh document knows the new names. What cannot stand is having no answer
 *    for "the reload did not happen". So the wait is bounded: after
 *    `RELOAD_GRACE_MS` the original error is rethrown and `RouteErrorBoundary`
 *    renders a screen with a button. รีโหลดได้ แต่ห้ามรอแบบไม่มีวันจบ
 *
 * ## Three more traps this file closes, each of which produced its own symptom
 *
 * 1. **The anti-loop flag was cleared by `window.addEventListener('load', …)`.**
 *    `load` fires when the document's initial resources finish — always BEFORE
 *    React mounts and reaches a dynamic import. So the flag written just before
 *    a reload was wiped by the very reload it was meant to survive, and a
 *    genuinely missing chunk could reload the page over and over. The flag is
 *    now cleared on a SUCCESSFUL import, which is the moment that actually
 *    proves the current build is usable.
 *
 * 2. **`sessionStorage` was touched bare inside the error path.** Safari with
 *    storage blocked throws on read and on write, turning the recovery handler
 *    itself into a second error. Every access goes through a guarded helper.
 *
 * 3. **Storage refusing the write meant the loop guard could not hold.** If the
 *    flag cannot be persisted we deliberately do NOT reload: a reload we cannot
 *    remember is a reload that repeats forever. We surface the error instead
 *    and let the user press the button. เขียน flag ไม่ได้ = ห้ามรีโหลดเอง
 *
 * ⚠️ THIS FILE CANNOT MAKE A CHUNK LOAD. It decides what happens when one does
 *    not. The trigger (a deploy during an open session, a dropped connection)
 *    is outside the app; what belongs to us is never stranding the user.
 *
 * revert: delete this folder, restore the `retryLazy` block + the `load`
 *   listener in App.tsx (see git history for [FIX-20260729-SPACACHE]) and
 *   change `lazyWithRecovery(...)` back to `retryLazy(...)`.
 */

/** Session flag marking "we already reloaded once for a chunk failure". */
export const CHUNK_RELOAD_KEY = 'chunk_reload_once';

/**
 * How long to let `window.location.reload()` prove itself before giving up.
 *
 * A reload that is going to happen replaces the document well inside this
 * window, so on the healthy path nobody ever waits it out — the page is gone
 * long before the timer matters. It only pays out in the failure case this
 * whole file exists for, which is why it is generous rather than tight: a
 * premature error card on a slow-but-working reload would be its own bug.
 */
export const RELOAD_GRACE_MS = 4_000;

/**
 * What a browser says when a dynamic import fails. Three spellings because
 * three engines: Chromium, Firefox and Safari each word it differently, and
 * matching only one of them silently disables recovery on the other two.
 */
const CHUNK_ERROR_PATTERN =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;

export const isChunkLoadError = (err: unknown): boolean =>
  err instanceof Error && CHUNK_ERROR_PATTERN.test(err.message);

/**
 * The browser things this module touches, named so a test can drive them.
 *
 * ⚠️ Not an abstraction for its own sake: `window.location.reload` and
 * `sessionStorage` are exactly the two pieces that cannot be exercised honestly
 * in jsdom, and they are also where all four bugs above lived. Injecting them
 * is what lets the failure modes be asserted rather than described.
 */
export interface RecoveryDeps {
  /** true = we already reloaded once this session */
  readFlag: () => boolean;
  /** false = storage refused the write, so the guard cannot be trusted */
  writeFlag: () => boolean;
  clearFlag: () => void;
  reload: () => void;
  wait: (ms: number) => Promise<void>;
}

/** Real browser wiring. Every storage access is guarded — see trap 2 above. */
export const browserRecoveryDeps: RecoveryDeps = {
  readFlag: () => {
    try {
      return sessionStorage.getItem(CHUNK_RELOAD_KEY) === '1';
    } catch {
      return false;
    }
  },
  writeFlag: () => {
    try {
      sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
      return true;
    } catch {
      return false;
    }
  },
  clearFlag: () => {
    try {
      sessionStorage.removeItem(CHUNK_RELOAD_KEY);
    } catch {
      /* storage blocked — nothing to clear, and nothing to report */
    }
  },
  reload: () => window.location.reload(),
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Decide what a failed import becomes. ALWAYS ends in a rejection — the caller
 * gets an error it can render, never a promise left open.
 *
 * Order matters and each branch is a decision, not a formality:
 *   not a chunk error   → rethrow untouched (a real bug in the page's module
 *                         must not be disguised as a network hiccup)
 *   already reloaded    → rethrow (one reload is the budget; a second would be
 *                         the loop)
 *   flag unwritable     → rethrow WITHOUT reloading (see trap 3)
 *   otherwise           → reload, wait out the grace, then rethrow
 */
export async function recoverFromChunkError(
  err: unknown,
  deps: RecoveryDeps = browserRecoveryDeps,
): Promise<never> {
  if (!isChunkLoadError(err)) throw err;
  if (deps.readFlag()) throw err;
  if (!deps.writeFlag()) throw err;

  deps.reload();
  await deps.wait(RELOAD_GRACE_MS);
  /* Reaching this line means the document is still here, so the reload did not
     take. Surfacing the original error hands the user the retry screen instead
     of an endless spinner — the whole point of this change. */
  throw err;
}

/**
 * One import attempt, wrapped in the policy above.
 *
 * The success path clears the flag: an import that resolved is proof the build
 * in this document is usable, which is the honest moment to forget the failure
 * (and is what trap 1 got wrong by using the `load` event instead).
 *
 * ⚠️ Kept separate from `lazyWithRecovery` so a test can drive it directly.
 * `React.lazy` swallows its factory, and a test that pokes at `_payload` to
 * reach it asserts React's internals rather than this policy.
 */
export function withRecovery<T extends ComponentType<any>>(
  load: () => Promise<{ default: T }>,
  deps: RecoveryDeps = browserRecoveryDeps,
): Promise<{ default: T }> {
  return load()
    .then((mod) => {
      deps.clearFlag();
      return mod;
    })
    .catch((err) => recoverFromChunkError(err, deps));
}

/** Drop-in replacement for `React.lazy` that survives a failed chunk. */
export function lazyWithRecovery<T extends ComponentType<any>>(
  load: () => Promise<{ default: T }>,
  deps: RecoveryDeps = browserRecoveryDeps,
) {
  return lazy(() => withRecovery(load, deps));
}
