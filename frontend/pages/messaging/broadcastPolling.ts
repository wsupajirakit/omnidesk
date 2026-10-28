/**
 * [PERF-20260825-POLLPOLICY] How often the Broadcasts page refetches, and what.
 * ===========================================================================
 * One file owns the whole polling policy so that changing it later is an edit
 * here and nowhere else. The page reads this; it does not decide anything.
 *
 * ── WHY THIS SHAPE, AND WHAT WAS MEASURED ─────────────────────────────────
 * The page shows three separate data sets, and the obvious idea — fetch
 * everything once into a shared client cache and filter locally — was measured
 * before being rejected (25/08/2026, live collection):
 *
 *   broadcasts               13 rows      16 KB
 *   broadcasts_histories     11 rows      tiny
 *   webhook_logs          8,829 rows      34 MB   ← the whole collection
 *   webhook_logs, scoped     13 rows      tiny    ← what this page actually asks for
 *
 * The scoped number is the one that makes a client-side cache look attractive,
 * and it is also the trap: the log table is small ONLY because every query
 * carries `channel=line_api` + `action_type=send_broadcast` + a date range. The
 * day somebody widens that scope, a "fetch once and filter locally" design
 * quietly becomes a 34 MB download into the browser, with nothing to warn them.
 * Server-side filtering degrades gracefully; client-side filtering does not.
 *
 * So the policy is deliberately boring: keep filtering and pagination on the
 * server, and simply stop asking for things nobody is looking at. That removed
 * the real waste without adding a cache layer to maintain — the page used to
 * poll the log table every 20s even while the user was on the campaigns tab,
 * and loaded it on mount even for users who never opened it.
 *
 * ── THE KNOBS ─────────────────────────────────────────────────────────────
 * Change the cadence          → AUTO_FETCH_MS
 * Change what a tick fetches  → sourceForTick()
 * Poll while a modal is open  → shouldPoll(), drop the modalOpen clause
 * Poll hidden browser tabs    → shouldPoll(), drop the hidden clause
 *                               (do not: a background tab polling forever was
 *                                the original defect [FIX-20260809-POLLVIS])
 *
 * ── WHEN TO RECONSIDER ────────────────────────────────────────────────────
 * Add a shared fetch layer only when there is real duplication to remove —
 * two components asking for the same rows in the same tick. Today there is
 * none: each tab owns one query. Adding the layer first would be machinery
 * without a problem, which is the debt this policy exists to avoid.
 *
 * If the scoped log query ever stops being small, the fix is a narrower query
 * or server-side aggregation — NOT moving the filtering into the browser.
 *
 * revert: delete this file and inline the interval back into Broadcasts.tsx.
 */

/** Which data set a tick should refresh. `null` = skip this tick entirely. */
export type PollSource = 'broadcasts' | 'logs' | null;

/**
 * How long between refreshes.
 *
 * 45s is long enough not to bother the database and short enough that a
 * campaign's `sending` badge clears within one cycle of the run finishing —
 * which is what makes "no realtime, just refresh" acceptable to look at.
 */
export const AUTO_FETCH_MS = 45_000;

export interface PollContext {
  /** The tab the user is looking at. */
  readonly tab: string;
  /** Browser tab hidden (another window, another tab, minimised). */
  readonly hidden: boolean;
  /** A form modal is open over the page. */
  readonly modalOpen: boolean;
}

/**
 * Should this tick do anything at all?
 *
 * Two refusals, both load-bearing:
 *   hidden    — a background tab polling forever is the defect this replaced.
 *   modalOpen — refetching under an open form yanks the data out from under
 *               somebody who is typing into it.
 */
export const shouldPoll = (ctx: PollContext): boolean =>
  !ctx.hidden && !ctx.modalOpen;

/**
 * Which single source this tick should refresh.
 *
 * One source per tick, never both: the user can only see one tab, and
 * refreshing the other buys nothing while costing a query every cycle.
 * Returning `null` means the tick does nothing, which is the correct answer
 * when the page is hidden or covered by a modal.
 */
export const sourceForTick = (ctx: PollContext): PollSource => {
  if (!shouldPoll(ctx)) return null;
  return ctx.tab === 'history' ? 'logs' : 'broadcasts';
};

/**
 * Should the log table be fetched right now?
 *
 * The history tab's data is loaded lazily — a user who only ever looks at the
 * campaign list should never pay for a log query at all.
 *
 * ⚠️ CORRECTED 25/08/2026. This took a latch (`openedOnce`) that stayed true
 * once the tab had been visited, on the reasoning that switching back and forth
 * should not re-trigger a load. The call site put `activeTab` in its effect's
 * dependencies — it has to, or the first visit would never fetch — so with the
 * latch stuck true EVERY later switch fired a log query, including switching
 * BACK to the campaign list, where the log table is not even mounted. The
 * docstring promised the opposite of what shipped.
 *
 * Keying on the tab that is actually showing gives the behaviour that was
 * intended all along: nothing until the first visit, a fresh load on each
 * deliberate visit, and never a query for a table that is off screen.
 *
 * revert: `() => true` restores the original always-load behaviour.
 */
export const shouldLoadLogs = (tab: string): boolean => tab === 'history';
