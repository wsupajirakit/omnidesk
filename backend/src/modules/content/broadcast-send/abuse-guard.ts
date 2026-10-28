/**
 * [FEAT-20260822-BCASTABUSE] Flood protection — the run that must not start.
 * ===========================================================================
 * A pure decision. No database, no I/O, no clock (`nowMs` is passed in).
 *
 * เจ้าของ 22/08: "ต้องระวังคนเจาะระบบ flood broadcast + flood job เข้ามา +
 * flood multicast ต้องกันด้วย".
 *
 * THREAT MODEL — who this is actually for
 * The routes already sit behind auth + `broadcast.manage`, so a stranger cannot
 * reach them. What this guards is the case where an ACCOUNT THAT IS ALLOWED TO
 * SEND is used to send far too much: a stolen session, a compromised admin, a
 * script someone left in a loop, or a UI double-click storm. ⇒ authorisation is
 * the first wall; this is the second. ด่านแรกคือสิทธิ์ · ด่านนี้คือปริมาณ.
 *
 * 🔴 WHY `retryKey` DOES NOT COVER THIS
 * A stable retry key stops a chunk being sent twice WITHIN one run. Two runs
 * have two run ids, so their keys differ and LINE happily delivers both — the
 * customer is messaged twice and nothing anywhere is "wrong". The only thing
 * that stops that is refusing to start the second run. retryKey กัน "ในรอบเดียว"
 * ไม่ได้กัน "ยิงซ้ำหลายรอบ".
 *
 * Each limit below is its own constant and can be tuned alone.
 *
 * revert: delete this file with the rest of `broadcast-send/`.
 */

/** A job cannot start again this soon after its last run ENDED. */
export const MIN_SECONDS_BETWEEN_RUNS = 60;

/** Runs of ONE job per rolling hour. Stops one job being hammered. */
export const MAX_RUNS_PER_JOB_PER_HOUR = 6;

/** Runs by ONE user per rolling hour, across all jobs. Stops one account. */
export const MAX_RUNS_PER_USER_PER_HOUR = 30;

/**
 * Runs in flight across the whole system.
 *
 * ⚠️ The last line of defence: it holds even if every other limit is somehow
 * satisfied, because it is about the SERVER, not about who asked. Sized against
 * the OA parallelism so the pool share in `limits.ts` still holds.
 */
export const MAX_CONCURRENT_RUNS_GLOBAL = 3;

/** Jobs one user may CREATE per rolling hour — flood at the door, not the send. */
export const MAX_JOBS_CREATED_PER_USER_PER_HOUR = 20;

export interface AbuseCheckInput {
  readonly nowMs: number;
  /** This job already has a run in progress (claimed and not finished). */
  readonly jobIsRunning: boolean;
  /** When this job's previous run finished. null = never run. */
  readonly lastRunFinishedAtMs: number | null;
  readonly runsOfThisJobLastHour: number;
  readonly runsByThisUserLastHour: number;
  readonly runsInFlightGlobal: number;
}

export type AbuseReason =
  /** A counter could not be read — the safe answer is no. */
  | 'unreadable-state'
  /** Too many jobs CREATED, as opposed to too many runs started. */
  | 'job-creation-limit'
  | 'already-running'
  | 'cooldown'
  | 'job-hourly-limit'
  | 'user-hourly-limit'
  | 'system-busy';

export type AbuseVerdict =
  | { readonly allow: true }
  | {
      readonly allow: false;
      readonly reason: AbuseReason;
      readonly detail: string;
      /** Seconds until this could be retried, when that is knowable. */
      readonly retryAfterSec?: number;
    };

/**
 * May this run start?
 *
 * Order matters: the cheapest and most specific answers come first so the
 * message the admin sees names the real reason, not a generic "busy".
 */
/**
 * A count we cannot read means the caller is broken, and a broken caller must
 * not be waved through.
 *
 * 🔴 FAIL CLOSED — found in review. Every comparison here is `>=` or `<`, and
 * both are false against `NaN`, so a single `new Date(undefined).getTime()` in
 * a half-written row would switch OFF every flood limit at once and answer
 * `allow`. อ่านค่าไม่ได้ = ถือว่าเต็ม ห้ามปล่อยผ่าน.
 */
function unusable(n: unknown): boolean {
  return typeof n !== 'number' || !Number.isFinite(n) || n < 0;
}

export function checkAbuse(input: AbuseCheckInput): AbuseVerdict {
  if (
    unusable(input.nowMs) ||
    unusable(input.runsOfThisJobLastHour) ||
    unusable(input.runsByThisUserLastHour) ||
    unusable(input.runsInFlightGlobal)
  ) {
    return {
      allow: false,
      reason: 'unreadable-state',
      detail:
        'a run counter could not be read — refusing rather than sending blind',
    };
  }

  if (input.jobIsRunning) {
    return {
      allow: false,
      reason: 'already-running',
      detail:
        'this job is sending right now — starting it again would deliver twice',
    };
  }

  if (input.lastRunFinishedAtMs !== null) {
    if (unusable(input.lastRunFinishedAtMs)) {
      return {
        allow: false,
        reason: 'unreadable-state',
        detail: 'the previous run has no readable finish time',
      };
    }
    // A finish time in the FUTURE is a clock problem, not a cooldown. Reporting
    // "finished -3600s ago" would be nonsense to read, so it is named for what
    // it is. (review) เวลาอนาคต = นาฬิกาเพี้ยน ไม่ใช่ cooldown.
    if (input.lastRunFinishedAtMs > input.nowMs) {
      return {
        allow: false,
        reason: 'unreadable-state',
        detail:
          'the previous run claims to finish in the future — check the clock',
      };
    }
    const sinceSec = Math.floor(
      (input.nowMs - input.lastRunFinishedAtMs) / 1000,
    );
    if (sinceSec < MIN_SECONDS_BETWEEN_RUNS) {
      return {
        allow: false,
        reason: 'cooldown',
        detail: `last run finished ${sinceSec}s ago (minimum ${MIN_SECONDS_BETWEEN_RUNS}s)`,
        retryAfterSec: MIN_SECONDS_BETWEEN_RUNS - sinceSec,
      };
    }
  }

  if (input.runsOfThisJobLastHour >= MAX_RUNS_PER_JOB_PER_HOUR) {
    return {
      allow: false,
      reason: 'job-hourly-limit',
      detail: `this job ran ${input.runsOfThisJobLastHour} times in the last hour (max ${MAX_RUNS_PER_JOB_PER_HOUR})`,
    };
  }

  if (input.runsByThisUserLastHour >= MAX_RUNS_PER_USER_PER_HOUR) {
    return {
      allow: false,
      reason: 'user-hourly-limit',
      detail: `you started ${input.runsByThisUserLastHour} runs in the last hour (max ${MAX_RUNS_PER_USER_PER_HOUR})`,
    };
  }

  if (input.runsInFlightGlobal >= MAX_CONCURRENT_RUNS_GLOBAL) {
    return {
      allow: false,
      reason: 'system-busy',
      detail: `${input.runsInFlightGlobal} runs already in flight (max ${MAX_CONCURRENT_RUNS_GLOBAL})`,
    };
  }

  return { allow: true };
}

/** The same idea at job-CREATION time, so the flood is stopped at the door. */
export function checkJobCreationFlood(
  jobsCreatedByUserLastHour: number,
): AbuseVerdict {
  if (unusable(jobsCreatedByUserLastHour)) {
    return {
      allow: false,
      reason: 'unreadable-state',
      detail: 'the job-creation count could not be read',
    };
  }
  if (jobsCreatedByUserLastHour >= MAX_JOBS_CREATED_PER_USER_PER_HOUR) {
    return {
      allow: false,
      reason: 'job-creation-limit',
      detail: `you created ${jobsCreatedByUserLastHour} jobs in the last hour (max ${MAX_JOBS_CREATED_PER_USER_PER_HOUR})`,
    };
  }
  return { allow: true };
}
