/**
 * [FEAT-20260822-BCASTLIMITS] The numbers that bound one broadcast run.
 * ===========================================================================
 * ตัวตั้งทั้งหมดของงานนี้อยู่ไฟล์นี้ไฟล์เดียว — แก้ที่นี่ที่เดียว ห้ามมีสำเนาที่สอง.
 *
 * Nothing here is a magic number: every value is either MEASURED or COMPUTED
 * from a measured one, and the formula lives next to it so the next person can
 * recompute instead of guess.
 *
 * WHERE THE MEASUREMENT CAME FROM (2026-08-22, this dev machine):
 *   `webhook_logs` · action_type `push_message` · 143 real calls
 *   p50 315 ms · p90 627 ms · p99 1,223 ms
 *   ⚠️ dev numbers. Re-measure on stg the same way and update P99_MS — every
 *      ceiling below follows automatically.
 *
 * WHY p99 AND NOT p50: a budget built on the median is not a reserve. At p99 a
 * p90-based budget overruns itself by ~95%. เผื่อต้องคิดจากกรณีแย่สุด.
 *
 * revert: delete this file with the rest of `broadcast-send/`.
 */

/** Measured worst-case latency of one LINE send. @see header. */
export const P99_MS = 1223;

/**
 * WHERE P99_MS CAME FROM — carried next to the number so a reader never has to
 * trust it blindly, and so the system can tell when it has gone stale.
 *
 * ⚠️ `environment` is 'dev' today. A run compares what it ACTUALLY observed
 * against `P99_MS` and records the drift (`p99DriftRatio`), so nobody has to
 * remember to re-measure — the history row says it. ตัวเลขบอกเองว่าตัวเองเก่า.
 */
export const P99_PROVENANCE = {
  environment: 'dev' as 'dev' | 'stg' | 'prod',
  source: 'webhook_logs · action_type=push_message',
  sampleSize: 143,
  measuredOn: '2026-08-22',
} as const;

/** Drift above this means the configured p99 no longer describes reality. */
export const P99_DRIFT_ALERT = 0.25;

/**
 * How far the observed p99 is from the configured one, as a signed ratio.
 * +0.4 means reality is 40% slower than the ceiling assumes ⇒ the budget is
 * optimistic and a full run may overrun its allowance.
 */
export function p99DriftRatio(observedP99Ms: number): number {
  if (!Number.isFinite(observedP99Ms) || observedP99Ms <= 0) return 0;
  return (observedP99Ms - P99_MS) / P99_MS;
}

/** Should someone be told the ceilings are computed on a stale number? */
export function p99NeedsRemeasure(observedP99Ms: number): boolean {
  return Math.abs(p99DriftRatio(observedP99Ms)) > P99_DRIFT_ALERT;
}

/**
 * How long ONE run may occupy the process.
 *
 * ⚠️ Not arbitrary: the scanner is single-flight, so a run that lasts N minutes
 * discards N scan rounds and every OTHER scheduled job waits that long.
 * 10 minutes is the longest wait we accept for an unrelated job.
 */
export const RUN_TIME_ALLOWANCE_SEC = 600;

/** Owner's rule: keep at least this much of the allowance unused. */
export const SERVER_RESERVE = 0.3;

/**
 * The SERIAL DEPTH budget — the longest chain of requests one run may perform
 * one after another.
 *
 * ⚠️ NOT "total requests of the run" — that reading was wrong and is corrected
 * here after review. OAs are separate LINE channels and run in parallel, so a
 * 5-OA run legitimately SENDS 5x this while only being this DEEP. Wall time
 * follows depth, and wall time is what this budget protects.
 * ⇒ `run-plan.ts` bounds `depth` against this · `totalRequests` is reported for
 *   history only · the run-wide hard ceiling lives in `run-guard.ts`.
 * งบนี้คือ "ความลึก" ไม่ใช่ "จำนวนรวม".
 *
 * = floor((600 / 1.223) * 0.70) = 343 → rounded DOWN to 300 for a rounder
 * number and a little more air. A spec pins this against the formula, so
 * editing P99_MS without editing this is caught by a red test, not by a
 * surprise in production.
 */
export const MAX_REQUESTS_PER_RUN = 300;

/** Warn the admin once a run is projected to use this share of the budget. */
export const NEAR_LIMIT_RATIO = 0.8;

/** floor((allowance / p99) * (1 - reserve)) — the ceiling the budget must respect. */
export function computeMaxRequests(
  p99Ms: number = P99_MS,
  allowanceSec: number = RUN_TIME_ALLOWANCE_SEC,
  reserve: number = SERVER_RESERVE,
): number {
  if (p99Ms <= 0 || allowanceSec <= 0) return 0;
  if (reserve < 0 || reserve >= 1) return 0;
  return Math.floor(((allowanceSec * 1000) / p99Ms) * (1 - reserve));
}

/** Worst-case wall time of a full-budget run, in ms. */
export function projectedRunMs(
  requests: number,
  p99Ms: number = P99_MS,
): number {
  return Math.max(0, Math.trunc(requests)) * p99Ms;
}

/**
 * Lease for a claimed run — DERIVED, never hand-set.
 *
 * ⚠️ A lease shorter than the worst-case run makes the recovery worker reclaim
 * a run that is STILL SENDING, and the customer gets the message twice. So the
 * lease is computed from the budget, with head-room on top.
 * lease ต้องยาวกว่างานที่ยาวที่สุดเสมอ — ห้ามตั้งมือ.
 */
export function computeLeaseMs(
  maxRequests: number = MAX_REQUESTS_PER_RUN,
  p99Ms: number = P99_MS,
  // 3.3 → a full-budget run (300 * 1.223 s = 6.1 min worst case) gets a
  // ~20 minute lease. Chosen so the lease reads as a round number in ops;
  // the only hard requirement is that it EXCEEDS the worst case, which the
  // spec asserts. ⚠️ 2.7 was written first and gives 16.5 min — the spec
  // caught the mismatch with the plan's "≥ 20 นาที". เลขต้องมาจากสูตร ไม่ใช่ความจำ.
  safetyFactor = 3.3,
): number {
  return Math.ceil(projectedRunMs(maxRequests, p99Ms) * safetyFactor);
}

/** LINE's hard cap on recipients per multicast request. Not ours to tune. */
export const LINE_MULTICAST_MAX_TO = 500;

/**
 * How many OAs a run may send to AT THE SAME TIME.
 *
 * 🔑 WHY PARALLEL ACROSS OAs IS SAFE AND PARALLEL WITHIN ONE OA IS NOT:
 * LINE rate-limits "per endpoint PER CHANNEL" — stated twice in the core
 * (`push/line-push-error.ts:100`, `push/queue/line-push-dispatcher.ts:15`).
 * Two OAs are two channels with two separate budgets, so sending to both at
 * once does not stack on either. Two chunks of the SAME OA do stack, and the
 * real per-channel limit is not documented anywhere in this repo — so within
 * an OA we stay at one request at a time. ข้าม OA ขนานได้ · ใน OA เดียวห้าม.
 *
 * 🔴 THE CAP MUST BE DIVIDED BY HOW MANY RUNS CAN OVERLAP — this was wrong and
 * review caught it. The old value of 5 was justified as "5 connections of 40 =
 * 12.5%", but `abuse-guard.ts` allows 3 runs at once, so the real worst case
 * was 3 x 5 = 15 connections = 37.5% of the pool — nearly double the 20% the
 * owner set. The budget is shared, so it is divided:
 *
 *     MAX_PARALLEL_OA = floor(poolBudget() / MAX_CONCURRENT_RUNS_GLOBAL)
 *                     = floor(8 / 3) = 2
 *
 * A spec now multiplies the two and pins the product against `poolBudget()`,
 * so raising either one without the other cannot pass. ต้องคูณกัน ไม่ใช่ดูตัวเดียว.
 */
export const MAX_PARALLEL_OA = 2;

/** Requests in flight for one OA. Fixed at 1 until LINE's real limit is known. */
export const MAX_PARALLEL_PER_OA = 1;

/**
 * Mirror of `infra/mongo/mongo.module.ts:45` (`maxPoolSize: 40`).
 *
 * ⚠️ A MIRROR, NOT THE SOURCE. If the pool size ever changes there, change it
 * here too — the spec pins the ratio below, not the pool itself, so a stale
 * mirror would compute a reserve that is not real. ถ้าแก้ pool ต้องมาแก้ที่นี่ด้วย.
 */
export const MONGO_MAX_POOL_MIRROR = 40;

/**
 * Share of the connection pool this feature may hold while sending.
 *
 * Owner, 2026-08-22: "ยิงขนาน server ห้ามพัง gap 20%" — so at least 80% of the
 * pool stays available to everything else (customer traffic, the webhook path,
 * tickets). A run at full parallelism holds one connection per OA sender while
 * it pages recipients, so the ceiling below is what must respect this share.
 */
export const MAX_POOL_SHARE = 0.2;

/** Connections a run may hold at once — MAX_PARALLEL_OA must stay under this. */
export function poolBudget(
  pool: number = MONGO_MAX_POOL_MIRROR,
  share: number = MAX_POOL_SHARE,
): number {
  return Math.floor(pool * share);
}
