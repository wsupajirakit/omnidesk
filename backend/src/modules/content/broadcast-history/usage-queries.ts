/**
 * [FEAT-20260822-BCASTUSAGE] The memory behind the flood guard and the global
 * budget — built as query shapes, run by the caller.
 * ===========================================================================
 * A pure decision. No database, no clock (`now` is passed in).
 *
 * 🔑 WHY THIS FILE CLOSES A REAL GAP
 * `abuse-guard` and `global-quota` were decisions with no counters: they took
 * `runsOfThisJobLastHour`, `runsInFlightGlobal`, `usage.lastDay` and so on as
 * parameters that nothing produced. A limit whose input nobody computes is not
 * a limit. These are the queries that produce them, now that
 * `broadcasts_history` exists to be counted. ตัวตัดสินมีแล้ว นี่คือตัวนับ.
 *
 * ⚠️ EVERY QUERY IS A RANGE ON `started_at`, WHICH IS INDEXED — on its own, and
 *    paired with `broadcast_id`, `hook_id` and `triggered_by_user`. A counter
 *    that scans the collection would make the guard itself the bottleneck the
 *    guard exists to prevent.
 *
 * ⚠️ `deleted_at` is not filtered here: history rows are evidence and are never
 *    soft-deleted. If that ever changes, every count below changes with it.
 *
 * revert: delete this file with the rest of `broadcast-history/`.
 */

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

export interface CountQuery {
  readonly collection: 'broadcasts_histories';
  readonly filter: Record<string, unknown>;
}

export interface SumQuery {
  readonly collection: 'broadcasts_histories';
  readonly filter: Record<string, unknown>;
  /** Fields to add up. The caller runs one `$group` over these. */
  readonly sum: readonly string[];
}

function since(now: Date, ms: number): Date | null {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return null;
  return new Date(now.getTime() - ms);
}

/** How many runs of ONE job started in the last hour. */
export function countRunsOfJob(
  broadcastId: unknown,
  now: Date,
  windowMs: number = HOUR_MS,
): CountQuery | null {
  const from = since(now, windowMs);
  if (!from || broadcastId === null || broadcastId === undefined) return null;
  return {
    collection: 'broadcasts_histories',
    filter: { broadcast_id: broadcastId, started_at: { $gte: from } },
  };
}

/** How many runs ONE user started in the last hour, across every job. */
export function countRunsOfUser(
  userId: unknown,
  now: Date,
  windowMs: number = HOUR_MS,
): CountQuery | null {
  const from = since(now, windowMs);
  if (!from || userId === null || userId === undefined) return null;
  return {
    collection: 'broadcasts_histories',
    filter: { triggered_by_user: userId, started_at: { $gte: from } },
  };
}

/**
 * How many runs are in flight right now.
 *
 * ⚠️ "In flight" is a row that STARTED and has no `finished_at`. It is not a
 * time window: a run that began 40 minutes ago and never finished still holds a
 * slot, and pretending otherwise would let a stuck run be forgotten and the
 * system oversubscribed. The claim sweep is what eventually clears it.
 */
export function countRunsInFlight(): CountQuery {
  return {
    collection: 'broadcasts_histories',
    filter: { started_at: { $exists: true }, finished_at: { $exists: false } },
  };
}

/**
 * What the whole system has spent in a window.
 *
 * ⚠️ Sums `sent`, not `targeted`: the budget is about messages that actually
 * left, because that is what LINE counted and what customers received. A run
 * that was refused spent nothing and must not consume anyone's quota.
 */
export function sumUsageSince(
  now: Date,
  windowMs: number,
  hookId?: unknown,
): SumQuery | null {
  const from = since(now, windowMs);
  if (!from) return null;
  const filter: Record<string, unknown> = { started_at: { $gte: from } };
  // Present only in `per-oa` scope; `combined` (the default) omits it.
  if (hookId !== null && hookId !== undefined) filter['hook_id'] = hookId;
  return {
    collection: 'broadcasts_histories',
    filter,
    sum: ['sent', 'requests_made'],
  };
}

/** The pair `global-quota` needs: one hour and one day, same scope. */
export function usageWindowQueries(
  now: Date,
  hookId?: unknown,
): { readonly hour: SumQuery; readonly day: SumQuery } | null {
  const hour = sumUsageSince(now, HOUR_MS, hookId);
  const day = sumUsageSince(now, DAY_MS, hookId);
  if (!hour || !day) return null;
  return { hour, day };
}

/**
 * Where an interrupted run for one OA left off.
 *
 * Sorted newest-first and limited to one, because a job that has run many times
 * has many rows and only the latest carries a live cursor.
 */
export function findResumePoint(
  broadcastId: unknown,
  hookId: unknown,
  runId: unknown,
): {
  readonly collection: 'broadcasts_histories';
  readonly filter: Record<string, unknown>;
  readonly sort: { readonly started_at: -1 };
  readonly limit: 1;
} | null {
  if (broadcastId === null || broadcastId === undefined) return null;
  if (hookId === null || hookId === undefined) return null;
  if (typeof runId !== 'string' || runId === '') return null;
  return {
    collection: 'broadcasts_histories',
    filter: { broadcast_id: broadcastId, hook_id: hookId, run_id: runId },
    sort: { started_at: -1 },
    limit: 1,
  };
}
