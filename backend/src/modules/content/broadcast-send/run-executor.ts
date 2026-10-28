/**
 * [FEAT-20260822-BCASTEXEC] The run: which OAs go, in what order, and when to stop.
 * ===========================================================================
 * The OA-level loop lives in `oa-executor.ts`. This file owns only the
 * questions that span OAs — the plan's verdict, sequencing, per-OA counters
 * merged into a run total, and which stop reasons end everything.
 *
 * revert: delete this file and `oa-executor.ts` together; nothing outside
 * `content/` imports either.
 */
import {
  countersForOa,
  mergeCounters,
  summarizeRun,
  EMPTY_COUNTERS,
  type RunCounters,
  type RunSummary,
} from '../broadcast-history/run-counters';

import type { BroadcastChunkSink } from './chunk-sink';
import {
  executeOa,
  type Clock,
  type OaRunResult,
  type RecipientPager,
} from './oa-executor';
import type { RunPlan } from './run-plan';
import type { ResumePoint } from './resume';
import type { SendCell } from './send-matrix.registry';

export interface RunInput {
  readonly runId: string;
  /** Must be the SAME cell the plan was built from — see `planRun`. */
  readonly cell: SendCell;
  /** Same order as `plan.perOa` — index N of one is index N of the other. */
  readonly hookIds: readonly string[];
  readonly plan: RunPlan;
  readonly pager: RecipientPager;
  readonly sink: BroadcastChunkSink;
  readonly clock: Clock;
  readonly matched: number;
  readonly targeted: number;
  readonly resumeByHook?: Readonly<Record<string, ResumePoint>>;
  readonly heartbeat?: (
    hookId: string,
    point: ResumePoint,
  ) => Promise<void> | void;
  /**
   * [FEAT-20260823-BCASTCARDTYPE] Load one page of per-recipient values.
   *
   * Carries `hookId` because the values include that OA's own `hook_*` and
   * `site_rules.*` — a run may touch several OAs and their values differ.
   * Optional: a plain-card run passes nothing and nothing extra is read.
   */
  readonly prefetchRecipients?: (
    hookId: string,
    lineUserIds: readonly string[],
  ) => Promise<void>;
  /**
   * Called the moment an OA stops, with the OA and the reason.
   *
   * A SEAM, not a logger: this file stays pure and testable without Nest, and
   * the caller decides where the line goes — a log, a metric, a row. Without it
   * the only record is the returned object, which nobody reads until the whole
   * run has ended. เป็นรูให้เสียบ ไม่ใช่ logger ในตัว.
   */
  readonly onOaStopped?: (stopped: StoppedOa) => void;
}

/** An OA that started and could not finish, in words an operator can act on. */
export interface StoppedOa {
  readonly index: number;
  readonly hookId: string;
  readonly reason: string;
  /**
   * true  ⇒ only this OA stopped; the run carried on with the others.
   * false ⇒ the reason ended the whole run.
   */
  readonly othersContinued: boolean;
}

/** One OA's own numbers — this is what a `broadcasts_histories` row is made of. */
export interface OaOutcome {
  readonly index: number;
  readonly hookId: string;
  readonly counters: RunCounters;
  readonly unknownTags: readonly string[];
  readonly imagesMeasured: boolean;
  readonly resume: ResumePoint;
  /**
   * [FEAT-20260824-BCASTWHYFAILED] What LINE answered the first time this OA
   * failed — the sentence that tells "quota exhausted" apart from "token dead"
   * apart from "payload rejected". Absent = no chunk failed.
   * See `chunk-failure.ts`. โผล่มาเมื่อพังจริงเท่านั้น.
   */
  readonly firstFailure?: OaRunResult['firstFailure'];
  readonly stoppedBy?: OaRunResult['stoppedBy'];
}

export interface RunResult {
  readonly summary: RunSummary;
  readonly counters: RunCounters;
  /** Per OA, in the order they ran. The history table keeps one row from each. */
  readonly perOa: readonly OaOutcome[];
  readonly resumeByHook: Readonly<Record<string, ResumePoint>>;
  readonly stoppedBy?: OaRunResult['stoppedBy'];
  /** OAs the plan refused, by index — the run went ahead without them. */
  readonly skippedOa: readonly number[];
  /**
   * OAs that began sending and stopped early — WHICH one and WHY, not just how
   * many.
   *
   * 🔴 WAS `number[]` — a list of positions. "OA #2 stopped" tells an operator
   * nothing they can act on: not which channel, not whether it was a quota, a
   * deadline or a broken pager. The owner asked for the stop to name the job
   * and the OA, so the answer carries them.
   * บอกว่า "ตัวที่ 2 หยุด" ไม่มีประโยชน์ ต้องบอกว่า OA ไหน และหยุดเพราะอะไร.
   */
  readonly stoppedOa: readonly StoppedOa[];
}

/**
 * Which stop reasons end the RUN, and which end only the OA that hit them.
 *
 * 🔴 LINE's rate limits are PER CHANNEL. A 429 on one OA says nothing about
 * another OA's quota, so ending the whole run there would throw away channels
 * that were still allowed to send — a campaign silently reaching a fraction of
 * its list, which is the exact failure §A is built to prevent.
 * 429 เป็นเรื่องของ channel นั้น ไม่ใช่ของทั้ง run.
 *
 * ⚠️ Found by a mutation, not by review: deleting the `break` below left every
 *    test green, because the only stop the spec exercised was the deadline —
 *    which stops the next OA on its own anyway. The surviving mutant was the
 *    thing that showed the classification was missing entirely.
 */
const RUN_WIDE_STOPS: ReadonlySet<string> = new Set([
  'disabled',
  'deadline',
  'run-max-requests',
]);

/**
 * Run every sendable OA, one after another.
 *
 * ⚠️ SEQUENTIAL ON PURPOSE. `MAX_PARALLEL_PER_OA` is 1 because LINE's limits are
 *    per channel, and `MAX_PARALLEL_OA` (2) is a ceiling for the SCHEDULER
 *    deciding how many runs may overlap — not licence for one run to fan out.
 *    Parallelising here would multiply against that ceiling, which is exactly
 *    the 37.5%-of-the-pool mistake review already caught once.
 *    ขนานตรงนี้ = คูณกับเพดานอีกชั้น ห้ามทำ.
 *
 * An OA-scoped stop (429, its own ceilings, a chunk it cannot key) moves on to
 * the next OA; a run-wide stop (kill switch, deadline, total requests) ends
 * everything. An OA that merely does not fit was excluded by the plan already
 * and appears in `skippedOa`.
 */
export async function executeRun(input: RunInput): Promise<RunResult> {
  const { plan, hookIds, runId, pager, sink, clock } = input;
  const startedAt = clock.now();

  let counters: RunCounters = {
    ...EMPTY_COUNTERS,
    matched: input.matched,
    targeted: input.targeted,
    unsent: input.targeted,
    requestsPlanned: plan.totalRequests,
    chunksPlanned: plan.totalRequests,
  };
  const resumeByHook: Record<string, ResumePoint> = { ...input.resumeByHook };
  const skippedOa: number[] = [];
  /** OAs that started but could not finish — distinct from never-started. */
  const stoppedOa: StoppedOa[] = [];
  const perOa: OaOutcome[] = [];
  let requestsMade = 0;
  let stoppedBy: OaRunResult['stoppedBy'];

  if (plan.verdict.kind !== 'ok' && plan.verdict.kind !== 'near-limit') {
    return {
      summary: summarizeRun(counters, { refused: true }),
      counters,
      perOa: [],
      resumeByHook,
      skippedOa: plan.perOa.filter((o) => !o.sendable).map((o) => o.index),
      stoppedOa: [],
    };
  }

  for (const oa of plan.perOa) {
    const hookId = hookIds[oa.index];
    if (!oa.sendable || hookId === undefined) {
      skippedOa.push(oa.index);
      continue;
    }

    /**
     * ⚠️ Each OA counts for ITSELF and is merged in afterwards. Threading one
     * accumulator through every OA would make the run total right and every
     * per-OA history row wrong. ตัวนับต้องแยกราย OA ก่อนรวม.
     */
    const r = await executeOa({
      runId,
      hookId,
      cell: input.cell,
      plan: oa,
      pager,
      sink,
      clock,
      startedAt,
      requestsMadeBefore: requestsMade,
      counters: countersForOa(oa.recipients, oa.requests),
      resume: resumeByHook[hookId],
      heartbeat: input.heartbeat
        ? (p) => input.heartbeat?.(hookId, p)
        : undefined,
      prefetchRecipients: input.prefetchRecipients
        ? (ids) => input.prefetchRecipients?.(hookId, ids) ?? Promise.resolve()
        : undefined,
    });

    counters = mergeCounters(counters, r.counters);
    requestsMade = r.requestsMade;
    resumeByHook[hookId] = r.resume;
    perOa.push({
      index: oa.index,
      hookId,
      counters: r.counters,
      unknownTags: r.unknownTags,
      imagesMeasured: r.imagesMeasured,
      resume: r.resume,
      /* [FEAT-20260824-BCASTWHYFAILED] Carried verbatim — this layer decides
         which OAs run, never what an answer MEANS. Interpreting it here would
         put the same decoding in two files. ส่งต่อดิบ ๆ ห้ามตีความซ้ำ. */
      ...(r.firstFailure === undefined ? {} : { firstFailure: r.firstFailure }),
      ...(r.stoppedBy ? { stoppedBy: r.stoppedBy } : {}),
    });
    if (r.stoppedBy) {
      stoppedBy = r.stoppedBy;
      const runWide = RUN_WIDE_STOPS.has(r.stoppedBy);

      /**
       * 🔴 RECORDED BEFORE THE `break`, and for run-wide stops too.
       *
       * The earlier version pushed only OA-scoped stops and only AFTER the
       * break check — so the OA that actually ended the run was the one thing
       * the report never named. หยุดทั้ง run เพราะ OA ไหน ก็ต้องบอกเหมือนกัน.
       */
      const stopped: StoppedOa = {
        index: oa.index,
        hookId,
        reason: r.stoppedBy,
        othersContinued: !runWide,
      };
      stoppedOa.push(stopped);
      if (input.onOaStopped) input.onOaStopped(stopped);

      // OA-scoped: the next channel has its own quota and its own clock.
      if (runWide) break;
    }
  }

  return {
    summary: summarizeRun(counters, { stopped: stoppedBy !== undefined }),
    counters,
    perOa,
    resumeByHook,
    ...(stoppedBy ? { stoppedBy } : {}),
    skippedOa,
    stoppedOa,
  };
}
