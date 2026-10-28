/**
 * [FEAT-20260822-BCASTRUNSVC] One broadcast run, from "may it start?" to
 * "here is the job back".
 * ===========================================================================
 * This file OWNS NO RULES. It owns an ORDER. Every ceiling, every status, every
 * chunk size and every retry key is asked of the module that owns it, and if a
 * number is ever typed into this file, the change belongs somewhere else.
 * ที่นี่คือคนเรียงลำดับ ไม่ใช่คนตั้งกฎ.
 *
 * THE SEQUENCE, and why it is this order:
 *   1. flood guard   — refuse BEFORE claiming, so a refused run leaves nothing
 *                      to clean up and cannot itself become the flood
 *   2. claim         — one atomic `findOneAndUpdate`; `null` means somebody else
 *                      has it, which is NORMAL
 *   3. ceiling       — the audience is selected LIVE, so the count is taken NOW.
 *                      A job that fitted last week may not fit today
 *                      (`mustRecheckCeiling`)
 *   4. global budget — the only guard that can see many legal jobs adding up
 *   5. send          — `executeRun`, with the pager/sink/clock handed in
 *   6. history       — one row PER OA, because `hook_id` is a single field
 *   7. release       — ALWAYS, including after a throw
 *
 * 🔴 WHY A FUNCTION AND NOT AN @Injectable
 * Everything below it is pure and injectable-free, and a function keeps a whole
 * campaign drivable from a spec with no Nest test module, no Mongo and no LINE.
 * A Nest wrapper can come later holding nothing but injection.
 *
 * 🔴 WHY IT NEVER THROWS
 * A job left in `sending` is invisible to the next scheduler round until its
 * lease expires — up to twenty minutes in which nobody can restart the
 * campaign. So every failure comes back as a `BroadcastRunReport`, and the
 * release runs on the way out of the success path AND of the catch.
 * คืนงานเสมอ แม้ตอนพัง.
 *
 * ⚠️ The kill switch is NOT re-asked here. `run-guard.ts` owns `SENDING_ENABLED`
 *    and `executeOa` asks it per OA, so a switched-off run still writes its rows
 *    and hands the job back rather than vanishing. Asking twice would be a
 *    second copy of a rule this folder is not allowed to hold.
 *
 * ⚠️ NOT WIRED. No route, no scheduler and no provider constructs this yet, and
 *    the only sink that exists (`DryRunChunkSink`) sends nothing.
 *
 * revert: delete this folder. Nothing outside it refers to these names.
 */
import { buildAudienceFilter } from '../audience';
import {
  canRun,
  checkAbuse,
  checkGlobalQuota,
  executeRun,
  mustRecheckCeiling,
  planRun,
  type RunPlan,
  type RunResult,
} from '../broadcast-send';

import { claimJob, heartbeatFor, releaseJob } from './run-lease';
import { RELEASE_ON_CRASH, releaseStatusFor } from './release-status';
import {
  countRecipients,
  describeVerdict,
  groupsForResult,
  message,
  outcomesForHooks,
  outcomesForPlan,
  readAbuseState,
  readQuotaUsage,
  safeNow,
  writeHistory,
  type HistoryWrite,
} from './run-io';
import type {
  BroadcastRunInput,
  BroadcastRunOutcome,
  BroadcastRunPorts,
  BroadcastRunReport,
} from './run-ports';

/** What happened between the claim and the release. Never includes the release. */
interface ClaimedReport {
  readonly outcome: BroadcastRunOutcome;
  readonly detail?: string;
  readonly error?: string;
  readonly historyRowsWritten: number;
  /** The status the job must be handed back with. Every path sets it. */
  readonly releaseStatus: string;
  readonly plan?: RunPlan;
  readonly result?: RunResult;
}

/**
 * Run one broadcast job to the end, whatever the end turns out to be.
 *
 * Returns a report; never rejects for a runtime failure. A rejection would mean
 * every caller has to know how to release a claim — which is exactly the
 * knowledge this function exists to hold in one place.
 */
export async function runBroadcast(
  input: BroadcastRunInput,
  ports: BroadcastRunPorts,
): Promise<BroadcastRunReport> {
  const runId = input.trigger.runId;
  const nowMs = safeNow(ports.clock);
  const startedAt = new Date(nowMs);

  /* ── 1. flood guard, BEFORE anything is taken ─────────────────────────── */
  const abuse = checkAbuse({ nowMs, ...(await readAbuseState(ports)) });
  if (!abuse.allow) {
    return untouched('refused-abuse', runId, abuse.detail);
  }

  /* ── 2. claim ─────────────────────────────────────────────────────────── */
  const attempt = await claimJob(input, ports, startedAt);
  if (!attempt.buildable) {
    // A missing job id or owner would build a filter matching the wrong row —
    // or every row. Refusing costs nothing; guessing costs a campaign.
    return untouched(
      'not-claimable',
      runId,
      'the job id, the owner id or the clock could not be read',
    );
  }
  if (attempt.error === null && (attempt.doc ?? null) === null) {
    /**
     * NORMAL, NOT AN ERROR. The filter is the lock: whoever flipped `scheduled`
     * to `sending` first has the job, and the loser matches nothing. Nothing was
     * claimed, so nothing is released and no history row is written — the
     * process that DID claim it writes one. แพ้แข่งคือเรื่องปกติ.
     */
    return untouched(
      'not-claimed',
      runId,
      'another process is already running this job',
    );
  }

  /**
   * 🔴 FROM HERE THE JOB MAY BE OURS, SO IT MUST BE HANDED BACK.
   *
   * Including when the claim itself threw: a write that times out may still
   * have landed, and the release filters on `status: sending` AND
   * `claimed_by: <us>`, so running it when we did not claim matches nothing and
   * changes nothing. Attempting it is free; skipping it can strand the job for
   * a whole lease. เขียนพลาดอาจติดไปแล้ว — คืนไว้ก่อน ปลอดภัยกว่า.
   */
  let body: ClaimedReport;
  if (attempt.error !== null) {
    body = {
      outcome: 'crashed',
      detail: 'the claim write failed — releasing in case it landed anyway',
      error: attempt.error,
      historyRowsWritten: 0,
      releaseStatus: RELEASE_ON_CRASH,
    };
  } else {
    try {
      body = await runClaimed(input, ports, startedAt);
    } catch (e) {
      body = {
        outcome: 'crashed',
        detail: 'the run threw — the job is being handed back',
        error: message(e),
        historyRowsWritten: 0,
        releaseStatus: RELEASE_ON_CRASH,
      };
    }
  }

  /* ── 7. release, on every path out ────────────────────────────────────── */
  const released = await releaseJob(input, ports, body.releaseStatus);

  return {
    outcome: body.outcome,
    runId,
    ...(body.detail ? { detail: body.detail } : {}),
    // A claim that threw leaves us genuinely unsure, and "we do not know" is
    // reported as not claimed rather than as claimed.
    claimed: attempt.error === null,
    released,
    releaseStatus: body.releaseStatus,
    historyRowsWritten: body.historyRowsWritten,
    ...(body.plan ? { plan: body.plan } : {}),
    ...(body.result ? { result: body.result } : {}),
    ...(body.error ? { error: body.error } : {}),
  };
}

/** Steps 3-6. The caller owns the release, so nothing here needs to. */
async function runClaimed(
  input: BroadcastRunInput,
  ports: BroadcastRunPorts,
  startedAt: Date,
): Promise<ClaimedReport> {
  /* ── 3a. the audience rules, turned into a filter NOW ─────────────────── */
  const built = buildAudienceFilter(input.audience);
  if (!built.ok) {
    // Fails closed on purpose: a rule that cannot be built is a filter that
    // would be DROPPED, and a dropped filter makes the audience WIDER.
    return refused(
      'refused-audience',
      built.reason,
      await writeHistory(input, ports, startedAt, [
        {
          perOa: outcomesForHooks(input.hookIds),
          refused: true,
          errorMessage: built.reason,
        },
      ]),
      input,
    );
  }

  /* ── 3b. re-check the ceiling against the LIVE count ──────────────────── */
  if (!mustRecheckCeiling(input.trigger)) {
    /**
     * `run-trigger.ts` answers `true` for every trigger today, and this file has
     * no saved plan to fall back on — so "do not re-check" would mean "send with
     * no ceiling at all". The day a stored plan exists, THIS branch is where it
     * gets used; until then the only safe answer is no.
     * ไม่ตรวจ = ส่งโดยไม่มีเพดาน ⇒ ปฏิเสธไว้ก่อน.
     */
    const detail = 'the run-time ceiling check is switched off';
    return refused(
      'refused-plan',
      detail,
      await writeHistory(input, ports, startedAt, [
        {
          perOa: outcomesForHooks(input.hookIds),
          refused: true,
          errorMessage: detail,
        },
      ]),
      input,
    );
  }

  const recipientsByOa: number[] = [];
  for (const hookId of input.hookIds) {
    // Sequential on purpose: these are database counts, and fanning them out
    // spends the connection share `limits.ts` reserves for everybody else.
    recipientsByOa.push(await countRecipients(ports, hookId, built.filter));
  }
  /* [FEAT-20260903-BCASTSRFRESH] An OA whose site rules never arrived is ruled
     out HERE, by the same plan that rules out an oversized or unreadable one —
     so it gets a history row, a stated reason, and the rest of the run carries
     on. The decision itself was made before the claim, where I/O is allowed;
     this file only orders. ตัดสินมาแล้ว ที่นี่แค่เรียงลำดับตามเดิม. */
  const plan = planRun({
    cell: input.cell,
    recipientsByOa,
    ...(input.blockedByOa ? { blockedByOa: input.blockedByOa } : {}),
  });

  if (!canRun(plan)) {
    const detail = describeVerdict(plan.verdict);
    const write = await writeHistory(input, ports, startedAt, [
      {
        perOa: outcomesForPlan(input.hookIds, plan),
        refused: true,
        errorMessage: detail,
      },
    ]);
    return { ...refused('refused-plan', detail, write, input), plan };
  }

  /* ── 4. the hour/day budget, across every job ─────────────────────────── */
  const sendable = plan.perOa.filter((o) => o.sendable);
  /** What will be aimed at — skipped OAs are not part of the demand. */
  const targeted = sum(sendable.map((o) => o.recipients));
  /** Everyone the rules selected, including the OAs the plan left out. */
  const matched = sum(plan.perOa.map((o) => o.recipients));
  const quota = checkGlobalQuota(await readQuotaUsage(ports), {
    recipients: targeted,
    requests: plan.totalRequests,
  });
  if (!quota.allow) {
    const write = await writeHistory(input, ports, startedAt, [
      {
        perOa: outcomesForPlan(input.hookIds, plan),
        refused: true,
        errorMessage: quota.detail,
      },
    ]);
    return { ...refused('refused-quota', quota.detail, write, input), plan };
  }

  /* ── 5. send ──────────────────────────────────────────────────────────── */
  const result = await executeRun({
    runId: input.trigger.runId,
    cell: input.cell,
    hookIds: input.hookIds,
    plan,
    pager: ports.pager,
    sink: ports.sink,
    clock: ports.clock,
    matched,
    targeted,
    ...(input.resumeByHook ? { resumeByHook: input.resumeByHook } : {}),
    // No `renewLease` port ⇒ no heartbeat at all, rather than a no-op that
    // pretends a lease is being kept alive.
    ...(ports.renewLease ? { heartbeat: heartbeatFor(input, ports) } : {}),
    /* Same rule as the heartbeat above: no port ⇒ the executor is handed
       nothing, rather than a no-op that costs a call per page and does
       nothing. ไม่มี port = ไม่ส่งอะไรลงไปเลย. */
    ...(ports.prefetchRecipients
      ? {
          prefetchRecipients: (hookId: string, ids: readonly string[]) =>
            ports.prefetchRecipients?.(hookId, ids) ?? Promise.resolve(),
        }
      : {}),
  });

  /* ── 6. one history row per OA, in one write ──────────────────────────── */
  const write = await writeHistory(
    input,
    ports,
    startedAt,
    groupsForResult(input, plan, result),
  );

  return {
    outcome: 'ran',
    historyRowsWritten: write.written,
    ...(write.error ? { error: write.error } : {}),
    /**
     * The status comes from `summarizeRun`, which derived it from the counters.
     * This file only translates the RUN's outcome into the JOB's column, and
     * `release-status.ts` is where that translation is written down.
     */
    releaseStatus: releaseStatusFor(result.summary.status, {
      repeating: input.repeating === true,
    }),
    plan,
    result,
  };
}

/** A refusal that happened before anything was claimed. Nothing to hand back. */
function untouched(
  outcome: BroadcastRunOutcome,
  runId: string,
  detail: string,
): BroadcastRunReport {
  return {
    outcome,
    runId,
    detail,
    claimed: false,
    released: false,
    historyRowsWritten: 0,
  };
}

/** Every refusal AFTER the claim reads the same: report it, and rest the job. */
function refused(
  outcome: BroadcastRunOutcome,
  detail: string,
  write: HistoryWrite,
  input: BroadcastRunInput,
): ClaimedReport {
  return {
    outcome,
    detail,
    historyRowsWritten: write.written,
    ...(write.error ? { error: write.error } : {}),
    releaseStatus: releaseStatusFor('refused', {
      repeating: input.repeating === true,
    }),
  };
}

function sum(ns: readonly number[]): number {
  return ns.reduce((t, n) => t + n, 0);
}
