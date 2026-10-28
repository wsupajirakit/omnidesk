/**
 * [FEAT-20260822-BCASTTICK] One tick of the scheduler — and the four ways a
 * tick can hurt the server.
 * ===========================================================================
 * This is the body a `@Cron`/`setInterval` would call, and NOTHING ELSE. There
 * is no decorator, no timer, no provider and no module line in this file: the
 * thing that WAKES it is a separate, owner-gated step (§S.3 ขั้น 2-5 — deploy
 * with the switch off first, index second, switch last). ตัวปลุกยังไม่มี ตั้งใจ.
 *
 * 🔑 WHY A CLASS IN A FOLDER WHOSE RULE IS "EVERY FILE IS PURE"
 * The overlap guard IS state — one boolean that must survive between two calls.
 * A pure function cannot hold it, and a module-level `let` would make two
 * workers share one flag. So this is the ONE stateful file here, and its state
 * is exactly `inFlight` + `skippedTicks`: no Mongo, no HTTP, no logger, no
 * `Date.now()`. Every impure thing is a PORT (`SchedulerWorkerPorts`), the same
 * shape `broadcast-run/run-ports.ts` states for the runner — which is why this
 * whole loop can be proven with a plain object and no database.
 *
 * ⚠️ IT DOES NOT KNOW HOW A JOB IS CLAIMED, AND MUST NOT LEARN.
 * `broadcast-send/claim.ts` owns the claim: the filter IS the lock, and a
 * second place that assembles it is a second place that can get it subtly
 * wrong — a customer messaged twice, with nothing wrong in the logs. The worker
 * hands the row to `ports.runJob` and that is the end of its interest.
 * ⇒ this file imports nothing from `broadcast-run/`. เจ้าของ claim มีคนเดียว.
 *
 * ═══ 🔴 THE FOUR DANGERS, AND WHERE EACH ONE IS ANSWERED ════════════════════
 *  1. รอบทับรอบ — a tick slower than the interval meeting the next tick.
 *     §11b.6.1: two ticks share `maxPoolSize: 40` with real customer requests.
 *     ⇒ `inFlight`, set BEFORE the first `await` (see `tick`).
 *  2. A tick that throws killing the scheduler forever.
 *     §11b.6.1 word for word: `running = false` ต้องอยู่ใน `finally` — ไม่งั้น
 *     throw ครั้งเดียว = scheduler ตายถาวรเงียบ ๆ. ⇒ `finally`, plus a per-job
 *     `catch` so ONE bad job does not cost the others their round.
 *  3. Unbounded work — `rows.slice(0, query.limit)`. Claiming more than
 *     `MAX_CONCURRENT_RUNS_GLOBAL` parks jobs in `sending` holding leases.
 *  4. Anything running while the switch is off ⇒ `buildDueScanQuery` answers
 *     `null` and the tick ends there: no scan, no sweep, no runner.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 🔴 `now` IS AN ARGUMENT, NEVER `Date.now()`. Every decision below is the
 * caller's clock, so a spec drives a whole hour of rounds without a fake timer —
 * the same contract `next-run.ts` and `due-query.ts` state for themselves.
 *
 * revert: delete this file and its line in `index.ts`. Nothing outside the
 * folder constructs this class.
 */
import {
  buildDueScanQuery,
  buildStaleRunSweep,
  isDueNow,
  type DueScanQuery,
  type SweepQuery,
} from './due-query';
import { nextRunAfterRound } from './next-run';
import { BROADCAST_SCHEDULER_ENABLED, DUE_SCAN_LIMIT } from './schedule-limits';
import {
  readDate,
  readInt,
  type BroadcastSchedule,
  type BroadcastScheduleRow,
} from './schedule-shape';

/** A scanned candidate. Exactly the columns `DueScanQuery.projection` asks for. */
export interface DueJobRow extends BroadcastScheduleRow {
  readonly _id?: unknown;
}

/**
 * What the runner tells the worker when a round ends.
 *
 * ⚠️ THE RULE COMES BACK FROM THE RUNNER, it is not read off the scanned row —
 * on purpose. The scan projects three columns (§11b.5.6 rule 5: `flex_json` is
 * `Mixed` and tens of KB per row), so the repeat rule is simply not in hand
 * here. The runner loaded the full document to claim it and already has it.
 *
 * ⚠️ `runsSoFar` is a value, not a column read: `run_count` DOES NOT EXIST in
 * `broadcast.schema.ts` yet — see the header of `schedule-shape.ts`.
 */
export interface SchedulerJobOutcome {
  readonly schedule?: BroadcastSchedule | null;
  /** When the round ENDED. Unreadable ⇒ no next round (fails closed). */
  readonly finishedAt?: Date | null;
  readonly runsSoFar?: number;
}

/**
 * The thing that actually runs one job — INJECTED, never imported.
 *
 * `null` back = "nothing to report", i.e. no next round. A runner that throws
 * is a normal outcome here, not a crash: see danger 2.
 */
export type BroadcastJobRunner = (
  job: DueJobRow,
  now: Date,
) => Promise<SchedulerJobOutcome | null>;

/**
 * Every impure seam of one tick.
 *
 * 🔑 THE PORTS ARE HANDED A QUERY SHAPE, never a set of fields to assemble.
 * `due-query.ts` owns those shapes and has the spec that proves them; a caller
 * that rebuilds a filter by hand is a caller that can drop the `deleted_at`
 * clause and send a campaign an admin already deleted. อย่าประกอบ filter เอง.
 */
export interface SchedulerWorkerPorts {
  /** Run the due-scan shape. `null` = could not read ⇒ this tick does nothing. */
  scanDue(query: DueScanQuery): Promise<readonly DueJobRow[] | null>;
  /** Run the sweep shape. Returns how many dead runs it recovered. */
  sweepStale(query: SweepQuery): Promise<number | null>;
  runJob: BroadcastJobRunner;
  /**
   * [FEAT-20260824-BCASTREPEAT] Write the computed next round back onto each
   * job. Returns how many rows it armed, or `null` when it could not write.
   *
   * 🔴 THIS PORT IS WHY REPEAT DID NOT WORK. Every piece was already here —
   *    the rule shape, `nextRunAfterRound`, the `broadcast_due` index keyed on
   *    `next_run_at` — and the computed instant was handed back in the report
   *    and DROPPED. The comment on `JobNextRun` said "the caller must ACT on
   *    that" since the day it was written, and nothing ever did: a `grep` for
   *    `next_run_at` across `src/` found a `@Prop`, an index and a constant,
   *    and not one write. A job therefore never became due a second time.
   *    คำนวณรอบถัดไปไว้แล้วไม่มีใครเขียนลง DB ⇒ ไม่มี job ไหนซ้ำได้เลย.
   *
   * ⚠️ OPTIONAL, like `renewLease` and `prefetchRecipients`. A caller that
   *    supplies no writer gets exactly today's behaviour — one run per job —
   *    instead of a DI error, and every existing spec keeps passing without
   *    being told about a port it does not care about.
   *    ไม่ส่ง writer มา = พฤติกรรมเดิมเป๊ะ ไม่ใช่ error.
   */
  armNextRun?(rows: readonly JobNextRun[]): Promise<number | null>;
}

/** Why a tick did nothing. All four are normal, none is an error. */
export type TickRefusal =
  /** The kill switch, level 1. The only answer today. */
  | 'disabled'
  /** The previous tick has not finished. Counted, never queued. */
  | 'busy'
  | 'unreadable-clock'
  | 'unreadable-scan';

export interface JobNextRun {
  readonly id: unknown;
  /** `null` = no next round. §11b.4: the caller must ACT on that. */
  readonly nextRunAt: Date | null;
}

export interface SchedulerTickReport {
  readonly ran: boolean;
  readonly refused?: TickRefusal;
  /** Rows the scan returned — may exceed `handed`; see danger 3. */
  readonly scanned: number;
  readonly handed: number;
  /** Scanned but refused by the in-memory recheck. Not an error; see below. */
  readonly rejected: number;
  readonly failed: number;
  readonly swept: number;
  readonly nextRuns: readonly JobNextRun[];
  /**
   * [FEAT-20260824-BCASTREPEAT] How many jobs had their next round WRITTEN.
   *
   * 🔴 `nextRuns` is what was COMPUTED; this is what was STORED. They were the
   * same number for exactly as long as nobody stored anything — which was the
   * bug. Reporting both is what makes "the cadence is armed" checkable instead
   * of assumed. คำนวณกับเขียนลงจริง เป็นสองตัวเลข ต้องดูตัวหลัง.
   *
   * `null` = no writer supplied, or the write failed. NOT `0`, which means
   * there was genuinely nothing to arm. absent ≠ 0.
   */
  readonly armed?: number | null;
  /**
   * CUMULATIVE count of ticks dropped by the overlap guard.
   *
   * §11b.6.1: ต้องนับจำนวนรอบที่ถูกปัดทิ้งแล้ว log — a run that takes five
   * minutes drops four rounds, and a scheduler that does not count them looks
   * perfectly healthy while other jobs starve (§PH.6.1 item 4).
   */
  readonly skippedTicks: number;
}

export class BroadcastSchedulerWorker {
  /** Danger 1. Read and written ONLY in `tick`, never across an `await`. */
  private inFlight = false;
  private skippedTicks = 0;

  constructor(
    private readonly ports: SchedulerWorkerPorts,
    /** Never a literal — `DUE_SCAN_LIMIT` is derived from the run ceiling. */
    private readonly limit: number = DUE_SCAN_LIMIT,
    private readonly enabled: boolean = BROADCAST_SCHEDULER_ENABLED,
  ) {}

  /** For a health line. The tick itself never reads these. */
  get busy(): boolean {
    return this.inFlight;
  }

  get skipped(): number {
    return this.skippedTicks;
  }

  /**
   * One round. NEVER REJECTS — that is a promise to the caller.
   *
   * 🔴 A timer callback does not await anything, so a rejected tick is an
   * unhandled rejection: no round number, no job id, and on some Node configs a
   * dead process. Every failure below therefore comes back as a REPORT the
   * caller can log. คืนรายงานเสมอ ห้าม reject.
   *
   * 🔴 WHY THE GUARD IS SAFE WITHOUT A LOCK — the two lines below run
   * SYNCHRONOUSLY. An `async` method executes its prologue to completion before
   * the first `await` yields, so a second `tick()` entering in the same task
   * queue cannot see `inFlight === false`. Move `this.inFlight = true` below any
   * `await` and the guard silently stops guarding: both ticks read `false` and
   * both scan. ต้องตั้งธงก่อน await ตัวแรกเสมอ.
   */
  async tick(now: Date): Promise<SchedulerTickReport> {
    if (this.inFlight) {
      // Dropped, not queued: a backlog of ticks is a backlog of scans, and the
      // round after this one asks the same question anyway.
      this.skippedTicks += 1;
      return this.refuse('busy');
    }
    this.inFlight = true;
    try {
      return await this.runTick(now);
    } finally {
      /**
       * 🔴 `finally`, AND `await` ABOVE. Without the await the flag would clear
       * while the tick is still running; without the `finally` a single throw
       * wedges `inFlight` at `true` and the scheduler is dead until the process
       * restarts — silently, with no error after the first one. Danger 2.
       */
      this.inFlight = false;
    }
  }

  private async runTick(now: Date): Promise<SchedulerTickReport> {
    // Fail closed on the clock first, so the two `null`s below cannot be
    // confused: after this line, a null query can only mean the kill switch.
    if (readDate(now) === null) return this.refuse('unreadable-clock');

    /**
     * 🔴 DANGER 4 — the switch is read by ASKING `due-query.ts`, not by an `if`
     * of our own. One `if (enabled)` per file is one more place that can be
     * flipped alone; here there is exactly one owner of the answer and the
     * spec proves that with it off no port is touched at all.
     */
    const query = buildDueScanQuery(now, this.limit, this.enabled);
    if (query === null) return this.refuse('disabled');

    const rows = await this.scan(query);
    if (rows === null) return this.refuse('unreadable-scan');

    /**
     * 🔴 DANGER 3 — the limit is enforced HERE too, not only in the query.
     * `limit` is part of the shape the port is handed, and a port that ignores
     * it (a bad `.limit()` call, a `$or` fallback merged in the app, a stub)
     * would hand this loop 50 jobs to claim while only
     * `MAX_CONCURRENT_RUNS_GLOBAL` can run — 47 rows flipped to `sending`,
     * each holding a ~20-minute lease, doing nothing. หยิบได้เท่าที่ยิงไหว.
     */
    const due = rows.slice(0, query.limit);

    let handed = 0;
    let rejected = 0;
    let failed = 0;
    const nextRuns: JobNextRun[] = [];

    /**
     * ⚠️ SEQUENTIAL, deliberately. `DUE_SCAN_LIMIT` is `MAX_CONCURRENT_RUNS_GLOBAL`
     * because that is how many runs the system can have in flight — firing them
     * with `Promise.all` here would multiply against that ceiling instead of
     * respecting it, the same mistake `run-executor.ts` records for OAs.
     * ⇒ raising throughput is `MAX_CONCURRENT_RUNS_GLOBAL` + the OA pool, never
     *   a `Promise.all` in this loop (§PH.6.4 lever 2 — that way lies a
     *   half-written queue, which is the debt §Q.6 warns about).
     */
    for (const job of due) {
      /**
       * The in-memory recheck. NOT a duplicate of the filter: between the scan
       * and this line another instance can take the row, an admin can cancel
       * it, someone can soft-delete it. `isDueNow` is the same rule the query
       * expresses, applied to the row in hand — and the projection carries
       * exactly the columns it reads, on purpose.
       * ⚠️ A rejected row is NORMAL (a race), not an error. It is counted so a
       *    scan that surfaces rows nobody can run is visible instead of quiet.
       */
      if (!isDueNow(job, now, this.enabled)) {
        rejected += 1;
        continue;
      }

      handed += 1;
      let outcome: SchedulerJobOutcome | null = null;
      try {
        outcome = await this.ports.runJob(job, now);
      } catch {
        /**
         * 🔴 DANGER 2, the inner half. One job that throws must not cost the
         * other due jobs their round — without this `catch` the first bad job
         * ends the tick and every job behind it waits for the next one, every
         * round, forever. งานเสียใบเดียว ห้ามล้มทั้งรอบ.
         * The error is not swallowed silently: it is `failed` in the report,
         * and the next run is `null` because a round that threw tells us
         * nothing we may act on. ⚠️ Do NOT re-arm a job here — the process that
         * held it may still be sending (§11b.6.2); its lease, and the sweep,
         * are what decide that.
         */
        failed += 1;
        nextRuns.push({ id: job._id, nextRunAt: null });
        continue;
      }
      nextRuns.push({ id: job._id, nextRunAt: this.nextRunFor(outcome, now) });
    }

    /**
     * [FEAT-20260824-BCASTREPEAT] Arm the next round — the step that was
     * missing. Without it `nextRuns` is a number in a report nobody stores and
     * no job is ever due twice.
     *
     * ⚠️ AFTER the round, never before: arming a job before it has finished
     * would make it eligible for the very next tick while this one is still
     * sending. ⚠️ AWAITED, but its failure does NOT fail the tick — the sends
     * already happened, and a write that could not land is a job that repeats
     * late, not a campaign that went out twice.
     * เขียนหลังจบรอบ · เขียนไม่ได้ = ซ้ำช้า ไม่ใช่ยิงซ้ำ.
     */
    let armed: number | null = null;
    if (this.ports.armNextRun && nextRuns.length > 0) {
      try {
        armed = await this.ports.armNextRun(nextRuns);
      } catch {
        armed = null;
      }
    }

    return {
      ran: true,
      scanned: rows.length,
      handed,
      rejected,
      failed,
      /* `null` = could not be written / no writer supplied. Distinct from `0`,
         which means "there was nothing to arm". absent ≠ 0. */
      armed,
      // The sweep runs AFTER the round's jobs so a run this tick just started
      // is holding a fresh lease by the time the stale filter looks at it.
      swept: await this.sweep(now),
      nextRuns,
      skippedTicks: this.skippedTicks,
    };
  }

  /** `null` = unreadable. A rejected port is unreadable, not an exception. */
  private async scan(
    query: DueScanQuery,
  ): Promise<readonly DueJobRow[] | null> {
    try {
      const rows = await this.ports.scanDue(query);
      // Not `?? []`: "the database did not answer" and "nothing is due" are
      // different facts, and only one of them should let the tick carry on.
      return Array.isArray(rows) ? rows : null;
    } catch {
      return null;
    }
  }

  /**
   * Put crashed runs back, and say how many.
   *
   * 🔴 `nextDueAt` IS `null` HERE — read `buildStaleRunSweep`'s re-fire trap
   * before changing it. A sweep is ONE bulk update over many rows, and the
   * instant a job should next fire depends on ITS OWN repeat rule; there is no
   * single date that is correct for all of them. Passing any date would re-arm
   * every swept row with a time computed for somebody else, and a date in the
   * past means the next scan finds it due and sends it again immediately.
   * ⇒ a swept row lands in `failed` and waits for a human. Fail closed: a
   *   campaign that did not resume is a support ticket; one that resumes twice
   *   is a customer messaged twice. กู้ผิดเวลา = ยิงซ้ำ ⇒ ยอมให้ค้างดีกว่า.
   * ⚠️ OPEN QUESTION FOR THE OWNER (not this file's to decide): a per-row sweep
   *    that recomputes each job's own next round needs either a read-then-write
   *    per row or an aggregation pipeline update. Both are new DB work.
   */
  private async sweep(now: Date): Promise<number> {
    const query = buildStaleRunSweep(now, null, this.limit, this.enabled);
    if (query === null) return 0;
    try {
      const swept = await this.ports.sweepStale(query);
      // A count we cannot read is reported as 0 rather than guessed at — the
      // rows are still swept either way; only the number is unknown.
      return readInt(swept, 0, Number.MAX_SAFE_INTEGER) ?? 0;
    } catch {
      return 0;
    }
  }

  /**
   * When does this job come round again?
   *
   * Computed, REPORTED, and not written. Where the answer is stored is the
   * owner's call — `next_run_at` is not in `broadcast.schema.ts` yet (see the
   * header of `schedule-shape.ts`), so this worker hands the instant back and
   * the caller persists it in the same write that ends the run.
   *
   * `nextRunAfterRound` counts forward from NOW, not from the finished round:
   * catch-up of missed rounds is OUT OF SCOPE (เจ้าของ 22/08 · §PH.15.1), and
   * this file does not get a vote — the default of `CATCH_UP_MISSED_ROUNDS`
   * decides, and it lives with the rule it belongs to.
   */
  private nextRunFor(
    outcome: SchedulerJobOutcome | null,
    now: Date,
  ): Date | null {
    const finished = readDate(outcome?.finishedAt);
    // No readable finish time ⇒ no next round. Guessing one here would schedule
    // a campaign off a value we could not read. อ่านไม่ออก = ไม่มีรอบถัดไป.
    if (finished === null) return null;
    return nextRunAfterRound(
      outcome?.schedule,
      finished,
      now,
      outcome?.runsSoFar ?? 0,
    );
  }

  private refuse(refused: TickRefusal): SchedulerTickReport {
    return {
      ran: false,
      refused,
      scanned: 0,
      handed: 0,
      rejected: 0,
      failed: 0,
      swept: 0,
      nextRuns: [],
      skippedTicks: this.skippedTicks,
    };
  }
}
