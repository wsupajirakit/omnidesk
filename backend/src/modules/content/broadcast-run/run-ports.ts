/**
 * [FEAT-20260822-BCASTRUNPORTS] Every seam one broadcast run touches, named in
 * one place.
 * ===========================================================================
 * `runBroadcast` sequences pure decisions. The only impure things it needs are
 * listed here as PORTS: take the job, give it back, count an audience, read the
 * flood counters, read the budget, write the history. Mongo satisfies them in
 * production; a plain object satisfies them in the spec, which is what lets a
 * whole campaign — claim, ceiling, quota, send, history, release — run with no
 * database and no LINE. ประตูเข้าออกทั้งหมดอยู่ไฟล์เดียว.
 *
 * 🔑 EVERY PORT MAY FAIL, AND FAILING NEVER MEANS "CARRY ON".
 * A count that cannot be read is not zero, and a usage figure that cannot be
 * read is not "plenty left". The runner hands the unreadable value to the
 * module that owns the rule (`checkAbuse`, `planRun`, `checkGlobalQuota`) and
 * lets IT refuse — so there is exactly one place that decides, and it is the
 * place with the spec. อ่านไม่ได้ = ให้เจ้าของกฎปฏิเสธ ไม่ใช่เดาเอง.
 *
 * ⚠️ NOT WIRED. Nothing constructs these yet — no route, no scheduler, no
 *    provider. The folder is the orchestration contract, and the only sink that
 *    exists is `DryRunChunkSink`, which sends nothing.
 *
 * revert: delete this folder. Nothing outside it refers to these names.
 */
import type { AudienceQuery } from '../audience';
import type {
  AbuseCheckInput,
  BroadcastChunkSink,
  ClaimQuery,
  Clock,
  QuotaUsage,
  RecipientPager,
  ResumePoint,
  RunPlan,
  RunResult,
  RunTrigger,
  SendCell,
} from '../broadcast-send';
import type { HistoryRow } from '../broadcast-history';

/** What `checkAbuse` needs that only a database can answer. */
export type AbuseState = Omit<AbuseCheckInput, 'nowMs'>;

/**
 * The I/O seams of one run.
 *
 * ⚠️ `claim` and `release` are handed a QUERY SHAPE built by `claim.ts`, never
 *    a set of fields to assemble themselves. The filter IS the lock, and a
 *    caller that rebuilds it by hand is a caller that can get it subtly wrong —
 *    which is a customer messaged twice, silently. อย่าประกอบ filter เอง.
 */
export interface BroadcastRunPorts {
  /**
   * Run `findOneAndUpdate` with the claim shape.
   *
   * `null`/`undefined` back means another process already holds the job. That
   * is the NORMAL answer in a race, not an error.
   */
  claim(query: ClaimQuery): Promise<unknown>;

  /** Run the release shape. The job goes back to rest with its final status. */
  release(query: ClaimQuery): Promise<unknown>;

  /**
   * How many recipients THIS OA has, live, under the audience filter.
   *
   * ⚠️ Per OA, never once for the run: a LINE user id belongs to one channel,
   *    so each OA has its own headcount (`audience/oa-scope.ts`).
   */
  countRecipients(
    hookId: string,
    filter: Record<string, unknown>,
  ): Promise<number>;

  /** The flood counters. See `broadcast-history/usage-queries.ts` for the shapes. */
  readAbuseState(): Promise<AbuseState>;

  /** What the whole feature has already spent this hour and this day. */
  readQuotaUsage(): Promise<QuotaUsage>;

  /** One row PER OA, already built. The port only writes them. */
  saveHistory(rows: readonly HistoryRow[]): Promise<void>;

  readonly pager: RecipientPager;
  readonly sink: BroadcastChunkSink;
  readonly clock: Clock;

  /**
   * Push the lease out while a long run is still going.
   *
   * Optional: a run shorter than the lease never needs it. When absent the
   * executor is given no heartbeat at all rather than a no-op, so nothing
   * pretends a lease is being kept alive when it is not.
   */
  renewLease?(query: ClaimQuery): Promise<unknown>;

  /**
   * [FEAT-20260823-BCASTCARDTYPE] Load one page of per-recipient values.
   *
   * 🔴 ONE READ PER PAGE, and ONLY for a personal card. Absent ⇒ the executor
   *    is given nothing and a plain run reads exactly what it always did — no
   *    no-op call, no extra query. ไม่มี port = ไม่มีการอ่านเพิ่มเลย.
   */
  prefetchRecipients?(
    hookId: string,
    lineUserIds: readonly string[],
  ): Promise<void>;
}

/** Everything about the job being run that the ports cannot answer. */
export interface BroadcastRunInput {
  /** `_id` of the `broadcasts` row. */
  readonly jobId: unknown;
  /**
   * Who is holding the claim — the worker/process identity.
   *
   * ⚠️ NOT the admin who pressed the button. The release filters on it, so two
   *    processes with the same owner id could release each other's claim.
   */
  readonly ownerId: string;
  readonly trigger: RunTrigger;
  /** The type x sub-type the admin ticked. Must be the cell the plan uses. */
  readonly cell: SendCell;
  /** The OAs this job targets. Index N here is index N of the plan. */
  readonly hookIds: readonly string[];
  /** The audience rules, turned into a filter at RUN time, not at save time. */
  readonly audience: AudienceQuery;
  readonly broadcastName?: string;
  /**
   * OA display names keyed by hook id — see `HistoryRowInput.hookAliases`.
   * Was one string for the whole run, which named the wrong OA on every row
   * after the first. ชื่อ OA ต้องมาเป็นราย OA.
   */
  readonly hookAliases?: Readonly<Record<string, string>>;
  /** How stale the site-rules blob was, when one was used. */
  readonly siteRulesAgeDays?: number;
  /**
   * [FEAT-20260903-BCASTSRAGE] The same, per OA — see `history-row.ts`. Absent
   * for every caller that does not measure it, which is what every caller did
   * before today: this column has existed end to end since 24/08 and had NO
   * producer at all. คอลัมน์มีมาตลอด แต่ไม่เคยมีใครเขียน.
   */
  readonly siteRulesAgeDaysByHook?: Readonly<Record<string, number>>;
  /**
   * [FEAT-20260903-BCASTSRFRESH] OAs a pre-run step has already ruled out, by
   * the SAME index as `hookIds`.
   *
   * Handed to `planRun`, so a blocked OA is skipped by the ONE mechanism that
   * already knows how to skip an OA, write its history row and let the rest of
   * the run continue. Absent ⇒ nothing is blocked, exactly as before.
   */
  readonly blockedByOa?: readonly boolean[];
  /** Where each OA got to last time, read off its previous history row. */
  readonly resumeByHook?: Readonly<Record<string, ResumePoint>>;
  /**
   * A job that will come round again.
   *
   * It is released back to `scheduled` instead of resting at `sent`, which is
   * the case `buildReleaseQuery` documents. Nothing sets this today — no
   * repeat column exists yet — so it defaults to a one-shot job.
   */
  readonly repeating?: boolean;
  /**
   * [FEAT-20260824-RUNSNAPSHOT] The campaign's settings, frozen for this run.
   *
   * Optional: a caller that supplies none writes no snapshot, and the history
   * reader treats a missing one as "this round predates the feature" rather
   * than as an empty configuration. absent ≠ ตั้งค่าว่างไว้.
   */
  readonly settingsSnapshot?: Record<string, unknown>;
}

export type BroadcastRunOutcome =
  /** The flood guard said no. Nothing was claimed. */
  | 'refused-abuse'
  /** The claim shape could not even be built — a bad job id, owner or clock. */
  | 'not-claimable'
  /** Another process holds the job. NORMAL, not an error. */
  | 'not-claimed'
  /** The audience rules could not be turned into a filter. */
  | 'refused-audience'
  /** The live count no longer fits the ceiling. */
  | 'refused-plan'
  /** The hour/day budget is spent. */
  | 'refused-quota'
  /** The run happened. `result.summary.status` says how well. */
  | 'ran'
  /** Something threw. The job was still handed back. */
  | 'crashed';

/**
 * What happened, as a value.
 *
 * 🔴 `runBroadcast` NEVER THROWS for a runtime failure. A campaign that dies
 * with an exception leaves a job stuck in `sending`, invisible to the next
 * scheduler round until its lease expires — so every failure is reported here
 * instead. โยน exception ออกไป = งานค้างสถานะ sending.
 */
export interface BroadcastRunReport {
  readonly outcome: BroadcastRunOutcome;
  readonly runId: string;
  /** Why, in the words the module that refused used. */
  readonly detail?: string;
  /** The job was taken. False also covers "we do not know" — see `runBroadcast`. */
  readonly claimed: boolean;
  /** A release was run and did not throw. */
  readonly released: boolean;
  /** The status the job was handed back with. Absent when nothing was claimed. */
  readonly releaseStatus?: string;
  readonly historyRowsWritten: number;
  /** Present once the live count was taken — including when it refused the run. */
  readonly plan?: RunPlan;
  /** Present only when the executor actually ran. */
  readonly result?: RunResult;
  /** The message of whatever threw, or of a history write that failed. */
  readonly error?: string;
}
