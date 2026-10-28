/**
 * [FEAT-20260822-BCASTGUARDRAIL] The safety net — stops a run that has already
 * started going wrong.
 * ===========================================================================
 * A pure decision. No database, no I/O, no clock (elapsed time is passed IN).
 *
 * เจ้าของ 22/08: "ต้องมี safety net เพดาน กันไว้ ไม่งั้น server ล่ม (พวก multicast)".
 *
 * 🔑 TWO SCOPES, AND THEY ARE NOT INTERCHANGEABLE — this was a real bug found
 * in review. The first version had ONE state object whose scope was never
 * written down, so under the run-wide reading a legal 5-OA plain run
 * (5 x 10,000 = 50,000 recipients, blessed by `run-plan.ts`) tripped the
 * 20,000 ceiling and 30,000 customers were silently never messaged.
 *
 *   `checkOaGuard`  — ONE OA: its requests, its recipients, its failures, its
 *                     429. Ceilings here are per-OA because a LINE user id and
 *                     a rate limit both belong to ONE channel.
 *   `checkRunGuard` — THE WHOLE RUN: wall clock and total requests across every
 *                     OA. Only this scope can see a run that is slow overall.
 *
 * ⇒ the runner asks BOTH: `checkRunGuard` once per loop turn, `checkOaGuard`
 *   before every chunk of the OA it is on. ถามสองระดับ อย่าปนกัน.
 *
 * Every limit is a MULTIPLE of a planned ceiling, never a second opinion about
 * it: tripping one means something is wrong, not that the plan was tight.
 *
 * revert: delete this file with the rest of `broadcast-send/`.
 */
import {
  MAX_PARALLEL_OA,
  MAX_REQUESTS_PER_RUN,
  RUN_TIME_ALLOWANCE_SEC,
  computeLeaseMs,
} from './limits';

/**
 * 🔌 Turns off ALL broadcast/multicast sending.
 *
 * ⚠️ Typed `boolean`, not inferred as the literal `true`: with the literal type
 * TypeScript proves `!SENDING_ENABLED` is always false and the whole `disabled`
 * branch becomes unreachable dead code — found in review, and it made the kill
 * switch a switch that could not switch.
 */
export const SENDING_ENABLED: boolean = true;

/* ── per-OA ceilings ─────────────────────────────────────────────────────── */

/** Requests ONE OA may make — 2x what any profile plans for one OA. */
export const HARD_MAX_REQUESTS_PER_OA = MAX_REQUESTS_PER_RUN * 2;

/** Recipients ONE OA may attempt — 2x the widest profile (`plain` at 10,000). */
export const HARD_MAX_RECIPIENTS_PER_OA = 20_000;

/** Consecutive chunk failures on one OA that mean "the far end is not well". */
export const MAX_CONSECUTIVE_FAILURES = 5;

/* ── run-wide ceilings ───────────────────────────────────────────────────── */

/**
 * Requests the WHOLE run may make across every OA.
 *
 * = 2x (one OA's budget x how many OAs run at once). A run legitimately sends
 * more than one OA's worth; what it must never do is send an unbounded amount.
 */
export const HARD_MAX_REQUESTS_PER_RUN =
  MAX_REQUESTS_PER_RUN * MAX_PARALLEL_OA * 2;

/**
 * Wall-clock deadline for the whole run, DERIVED so it can never outlive the lease.
 *
 * 🔴 The ordering matters and is pinned by a spec: the guard must stop the run
 * BEFORE the recovery worker decides the run is dead and hands it to someone
 * else — otherwise two workers send the same chunks and the customer gets the
 * message twice. ต้องหยุดก่อน lease หมดเสมอ.
 *
 * 🔴 AND IT MUST NOT OUTLIVE THE ALLOWANCE EITHER — review caught this. 70% of
 * the lease is 14.1 minutes, but every ceiling in `limits.ts` was derived from
 * a 10-minute allowance, and §PH.6.1 argues a longer run starves every other
 * scheduled job. Taking the SMALLER of the two keeps both promises true; a spec
 * pins it against both. เอาค่าที่น้อยกว่าเสมอ.
 */
export const HARD_DEADLINE_MS = Math.min(
  Math.floor(computeLeaseMs() * 0.7),
  RUN_TIME_ALLOWANCE_SEC * 1000,
);

/* ── state ───────────────────────────────────────────────────────────────── */

/** Everything counted FOR ONE OA. */
export interface OaGuardState {
  readonly requestsMade: number;
  readonly recipientsAttempted: number;
  readonly consecutiveFailures: number;
  /** LINE answered 429 for THIS OA (its own channel, its own limit). */
  readonly sawRateLimit: boolean;
}

/** Everything counted for the whole run, across all its OAs. */
export interface RunGuardState {
  readonly elapsedMs: number;
  readonly totalRequestsMade: number;
}

export type GuardStopReason =
  | 'disabled'
  | 'oa-max-requests'
  | 'oa-max-recipients'
  | 'run-max-requests'
  | 'deadline'
  | 'consecutive-failures'
  | 'rate-limited';

export type GuardVerdict =
  | { readonly stop: false }
  | {
      readonly stop: true;
      readonly reason: GuardStopReason;
      readonly detail: string;
    };

const GO: GuardVerdict = { stop: false };

/**
 * A count that is missing, negative or not a number means the caller is broken.
 *
 * 🔴 FAIL CLOSED. Every comparison below is `>=`, and `NaN >= anything` is
 * false — so a NaN counter would sail past every ceiling. Review found exactly
 * that. An unusable count is treated as "already at the ceiling".
 * นับไม่ได้ = ถือว่าเต็มแล้ว ห้ามปล่อยผ่าน.
 */
function unusable(n: unknown): boolean {
  return typeof n !== 'number' || !Number.isFinite(n) || n < 0;
}

/** Ask before every chunk, for the OA the runner is currently on. */
export function checkOaGuard(state: OaGuardState): GuardVerdict {
  if (!SENDING_ENABLED) {
    return {
      stop: true,
      reason: 'disabled',
      detail: 'sending is switched off',
    };
  }
  if (state.sawRateLimit) {
    // The core does not retry a 429 (`line-push.ts` DESIGN RULES), and pushing
    // harder into a throttled channel is how a soft limit becomes a hard one.
    return {
      stop: true,
      reason: 'rate-limited',
      detail: 'LINE answered 429 — stop this OA, do not push into a throttle',
    };
  }
  if (
    unusable(state.consecutiveFailures) ||
    state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES
  ) {
    return {
      stop: true,
      reason: 'consecutive-failures',
      detail: `${String(state.consecutiveFailures)} chunks failed in a row`,
    };
  }
  if (
    unusable(state.requestsMade) ||
    state.requestsMade >= HARD_MAX_REQUESTS_PER_OA
  ) {
    return {
      stop: true,
      reason: 'oa-max-requests',
      detail: `${String(state.requestsMade)} requests on this OA ≥ ${HARD_MAX_REQUESTS_PER_OA}`,
    };
  }
  if (
    unusable(state.recipientsAttempted) ||
    state.recipientsAttempted >= HARD_MAX_RECIPIENTS_PER_OA
  ) {
    return {
      stop: true,
      reason: 'oa-max-recipients',
      detail: `${String(state.recipientsAttempted)} recipients on this OA ≥ ${HARD_MAX_RECIPIENTS_PER_OA}`,
    };
  }
  return GO;
}

/** Ask once per loop turn, for the run as a whole. */
export function checkRunGuard(state: RunGuardState): GuardVerdict {
  if (!SENDING_ENABLED) {
    return {
      stop: true,
      reason: 'disabled',
      detail: 'sending is switched off',
    };
  }
  if (
    unusable(state.totalRequestsMade) ||
    state.totalRequestsMade >= HARD_MAX_REQUESTS_PER_RUN
  ) {
    return {
      stop: true,
      reason: 'run-max-requests',
      detail: `${String(state.totalRequestsMade)} requests this run ≥ ${HARD_MAX_REQUESTS_PER_RUN}`,
    };
  }
  if (unusable(state.elapsedMs) || state.elapsedMs >= HARD_DEADLINE_MS) {
    return {
      stop: true,
      reason: 'deadline',
      detail: `${String(state.elapsedMs)}ms ≥ deadline ${HARD_DEADLINE_MS}ms`,
    };
  }
  return GO;
}

export const EMPTY_OA_GUARD_STATE: OaGuardState = {
  requestsMade: 0,
  recipientsAttempted: 0,
  consecutiveFailures: 0,
  sawRateLimit: false,
};

export const EMPTY_RUN_GUARD_STATE: RunGuardState = {
  elapsedMs: 0,
  totalRequestsMade: 0,
};
