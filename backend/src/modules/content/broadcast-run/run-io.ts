/**
 * [FEAT-20260822-BCASTRUNIO] Talking to the ports without ever deciding
 * anything.
 * ===========================================================================
 * Every function here does one of two things: it reads a port and turns a
 * failure into a value the RULE OWNER will refuse, or it turns something the
 * run already knows into rows. Not one of them contains a ceiling, a status or
 * a threshold — those all live in the modules that own them.
 * ที่นี่แค่ "อ่าน/เขียน" ไม่ตัดสินอะไรเลย.
 *
 * 🔴 THE FAIL-CLOSED PATTERN, ONCE, HERE.
 * A port that throws or answers nonsense is turned into an UNREADABLE value —
 * `NaN`, never `0`. Zero is a real answer that means "nobody", and every guard
 * in this feature waves zero through. `NaN` is what `checkAbuse`, `planRun` and
 * `checkGlobalQuota` are each hardened to refuse, so the refusal comes from the
 * module with the spec rather than from an `if` written here.
 * พังแล้วต้องเป็น NaN ไม่ใช่ 0 — ศูนย์คือคำตอบจริงที่ทุกด่านปล่อยผ่าน.
 *
 * revert: delete this file with the rest of `broadcast-run/`.
 */
import {
  buildHistoryRows,
  countersForOa,
  currentCaptureFlags,
  type HistoryRow,
  type HistoryRowInput,
} from '../broadcast-history';
import {
  FRESH_RESUME,
  /* [FEAT-20260907-BCASTUNUSEDRULES] derived here, never passed in — see
     `rowInput` below for why nothing new travels down the call chain. */
  flagsUnusedRules,
  type Clock,
  type OaOutcome,
  type OaPlan,
  type QuotaUsage,
  type RunPlan,
  type RunResult,
  type RunVerdict,
  type SendCell,
} from '../broadcast-send';

import type {
  AbuseState,
  BroadcastRunInput,
  BroadcastRunPorts,
} from './run-ports';

/** Every counter unreadable ⇒ `checkAbuse` answers `unreadable-state`. */
const UNREADABLE_ABUSE_STATE: AbuseState = {
  jobIsRunning: false,
  lastRunFinishedAtMs: null,
  runsOfThisJobLastHour: Number.NaN,
  runsByThisUserLastHour: Number.NaN,
  runsInFlightGlobal: Number.NaN,
};

/** Both windows unreadable ⇒ `checkGlobalQuota` answers `unreadable-usage`. */
const UNREADABLE_USAGE: QuotaUsage = {
  lastHour: { recipients: Number.NaN, requests: Number.NaN },
  lastDay: { recipients: Number.NaN, requests: Number.NaN },
};

/**
 * The clock is a seam like any other, so it can be broken like any other.
 *
 * A `NaN` here rides straight into `checkAbuse`, which refuses the run before
 * anything is claimed — which is why nothing downstream has to re-check it.
 */
export function safeNow(clock: Clock): number {
  try {
    const t = clock.now();
    return typeof t === 'number' ? t : Number.NaN;
  } catch {
    return Number.NaN;
  }
}

export async function readAbuseState(
  ports: BroadcastRunPorts,
): Promise<AbuseState> {
  try {
    const s = await ports.readAbuseState();
    return s ?? UNREADABLE_ABUSE_STATE;
  } catch {
    return UNREADABLE_ABUSE_STATE;
  }
}

export async function readQuotaUsage(
  ports: BroadcastRunPorts,
): Promise<QuotaUsage> {
  try {
    const u = await ports.readQuotaUsage();
    return u ?? UNREADABLE_USAGE;
  } catch {
    return UNREADABLE_USAGE;
  }
}

/**
 * The live headcount for ONE OA.
 *
 * ⚠️ A failure is scoped to the OA that failed: `planRun` marks it `unreadable`
 *    and skips it, and the other OAs keep their campaign. That is the same
 *    per-OA-versus-per-run split `run-plan.ts` exists to hold.
 */
export async function countRecipients(
  ports: BroadcastRunPorts,
  hookId: string,
  filter: Record<string, unknown>,
): Promise<number> {
  try {
    const n = await ports.countRecipients(hookId, filter);
    return typeof n === 'number' ? n : Number.NaN;
  } catch {
    return Number.NaN;
  }
}

/** One or more OAs' rows, and how they should read. */
export interface HistoryGroup {
  readonly perOa: readonly OaOutcome[];
  readonly refused?: boolean;
  readonly errorMessage?: string;
}

/**
 * The per-OA shape a REFUSED OA reports.
 *
 * A refused OA never reached the executor, so there is no outcome to build a
 * row from — but the row still has to exist, or the refusal is invisible both
 * to whoever reads the history and to the flood counters, which count the same
 * table. The counts are what the OA WOULD have targeted.
 * ถูกปฏิเสธก็ต้องมีแถว ไม่งั้นไม่มีใครรู้ว่าเคยพยายาม.
 */
export function outcomeForPlan(oa: OaPlan, hookId: string): OaOutcome {
  return {
    index: oa.index,
    hookId,
    counters: countersForOa(oa.recipients, oa.requests),
    unknownTags: [],
    // Nothing rendered, so nothing was measured — `images_replaced` must be
    // left out of the row entirely rather than written as 0.
    imagesMeasured: false,
    resume: FRESH_RESUME(hookId),
  };
}

/** Every OA the plan looked at, for a refusal that ends the whole run. */
export function outcomesForPlan(
  hookIds: readonly string[],
  plan: RunPlan,
): OaOutcome[] {
  const out: OaOutcome[] = [];
  for (const oa of plan.perOa) {
    const hookId = hookIds[oa.index];
    if (hookId !== undefined) out.push(outcomeForPlan(oa, hookId));
  }
  return out;
}

/** The same, for a refusal that happened BEFORE any count was taken. */
export function outcomesForHooks(hookIds: readonly string[]): OaOutcome[] {
  return hookIds.map((hookId, index) => ({
    index,
    hookId,
    counters: countersForOa(0, 0),
    unknownTags: [],
    imagesMeasured: false,
    resume: FRESH_RESUME(hookId),
  }));
}

/** Why the plan left this OA out, in the words of its own skip reason. */
export function skipDetail(oa: OaPlan, cell: SendCell): string {
  switch (oa.skipReason) {
    case 'too-many-recipients':
      return `${oa.recipients} recipients, and this combination allows ${String(cell.maxRecipientsPerOa)} for one OA`;
    case 'unreadable':
      return 'the recipient count could not be read — refusing rather than sending blind';
    case 'empty':
      return 'nobody on this OA matched the audience rules';
    /* [FEAT-20260903-BCASTSRFRESH] The run already TRIED to fetch — this
       sentence is the outcome of that attempt, not a guess about why. */
    case 'no-site-rules':
      return 'this card fills {{site_rules.*}} and this OA has no site rules — a fetch was attempted and did not produce any';
    default:
      return 'this OA was left out of the run';
  }
}

/**
 * One group per OA, in the order the plan listed them.
 *
 * 🔴 AN OA THE PLAN SKIPPED STILL GETS A ROW. `executeRun` reports it in
 * `skippedOa` and never runs it, so it has no outcome — and without a row of
 * its own, an OA silently left out of a campaign looks exactly like an OA that
 * was never ticked. That is the silent-partial-send failure this whole design
 * exists to make visible. OA ที่ถูกข้ามต้องมีแถวบอกว่าถูกข้ามเพราะอะไร.
 */
export function groupsForResult(
  input: BroadcastRunInput,
  plan: RunPlan,
  result: RunResult,
): HistoryGroup[] {
  const ran = new Map(result.perOa.map((o) => [o.index, o]));
  const groups: HistoryGroup[] = [];
  for (const oa of plan.perOa) {
    const done = ran.get(oa.index);
    if (done) {
      groups.push({ perOa: [done] });
      continue;
    }
    const hookId = input.hookIds[oa.index];
    if (hookId === undefined) continue;
    groups.push({
      perOa: [outcomeForPlan(oa, hookId)],
      refused: true,
      errorMessage: skipDetail(oa, input.cell),
    });
  }
  return groups;
}

export interface HistoryWrite {
  readonly written: number;
  readonly error?: string;
}

/**
 * Build every row of the run and write them in ONE call.
 *
 * ⚠️ One call, not one per group: a run whose rows land in several writes can
 *    be read half-written, and "how did OA #3 do?" would answer differently
 *    depending on when it was asked. เขียนทีเดียวจบ.
 *
 * 🔴 A FAILED WRITE IS REPORTED, NEVER THROWN. The messages have already left;
 * losing the paperwork must not also lose the release, which would leave the
 * job stuck in `sending`. เขียนไม่ได้ = บอกไว้ แต่ต้องคืนงานให้ได้.
 */
export async function writeHistory(
  input: BroadcastRunInput,
  ports: BroadcastRunPorts,
  startedAt: Date,
  groups: readonly HistoryGroup[],
): Promise<HistoryWrite> {
  const rows: HistoryRow[] = [];
  for (const group of groups) {
    /* [FIX-20260825-HISTALWAYS] 🔴 A GROUP WITH NO PER-OA RESULT STILL GETS A ROW.
       Owner, 25/08: *"ประวัติการส่ง Broadcast LINE API กับ ประวัติรายรอบ
       ต้องบันทึกเสมอไม่ว่าจะล้มเหลวแบบใด"*

       This used to `continue`, and combined with the `rows.length === 0` guard
       below it meant a run that died BEFORE producing any per-OA outcome wrote
       NOTHING AT ALL — no run row, no LINE-API row. On screen that is
       indistinguishable from "the send never happened", which is exactly the
       report that started this: the operator pressed send, saw no history, and
       had no way to tell a refusal from a crash from a silent no-op.

       A run always has the two columns the schema requires (`broadcast_id`,
       `run_id` — `broadcast-history.schema.ts:41,51`); `hook_id` is optional
       there, so a row with no OA is a valid row, not a broken one.

       ⚠️ The synthetic outcome carries ZERO counters, so the numbers stay
          honest: nothing matched, nothing was targeted, nothing was sent.
          `refused: true` is what marks it as "this round did not run".
       ⚠️ Reuses `outcomesForHooks` — the same helper the refusal branches in
          `run-broadcast.ts` already use — so there is one shape of "a round
          that produced nothing", not two.
       ล้มแบบไหนก็ต้องมีแถว · ไม่มีแถว = แยกไม่ออกว่าไม่ได้ยิง หรือยิงแล้วพัง.
       ⚠️ revert (corrected 25/08 — the first wording was wrong and would have
          deleted a guard that is still needed): restore the `continue` at the
          top of the loop and delete the run-level fallback block below.
          The early `return { written: 0 }` was NEVER removed — it still lives
          at the end of this function and must stay, because `groups` itself can
          be empty. คำสั่ง revert เดิมสั่งคืนของที่ไม่เคยถูกเอาออก */
    const perOa =
      group.perOa.length > 0
        ? group.perOa
        : outcomesForHooks(input.hookIds ?? []);
    rows.push(
      ...buildHistoryRows(rowInput(input, ports, startedAt, group), perOa, {
        refused: group.refused === true || group.perOa.length === 0,
      }),
    );
  }

  /* Still nothing? That means the job had no hooks at all — write one row for
     the RUN itself so the round is visible, keyed on the two required columns.
     รอบที่ไม่มี OA เลย ก็ยังต้องเห็นว่ามีรอบนี้เกิดขึ้น. */
  if (rows.length === 0 && groups.length > 0) {
    rows.push(
      ...buildHistoryRows(
        rowInput(input, ports, startedAt, groups[0] as HistoryGroup),
        outcomesForHooks(['']),
        { refused: true },
      ),
    );
  }
  if (rows.length === 0) return { written: 0 };

  try {
    await ports.saveHistory(rows);
    return { written: rows.length };
  } catch (e) {
    return { written: 0, error: message(e) };
  }
}

function rowInput(
  input: BroadcastRunInput,
  ports: BroadcastRunPorts,
  startedAt: Date,
  group: HistoryGroup,
): HistoryRowInput {
  const finishedMs = safeNow(ports.clock);
  return {
    broadcastId: input.jobId,
    runId: input.trigger.runId,
    ...(input.broadcastName ? { broadcastName: input.broadcastName } : {}),
    cell: input.cell,
    /* [FEAT-20260824-RUNSNAPSHOT] Passed straight through — this file does not
         build the snapshot, the caller freezes it off the job before the send
         starts. Absent for any caller that supplies none. */
    ...(input.settingsSnapshot === undefined
      ? {}
      : { settingsSnapshot: input.settingsSnapshot }),
    ...(input.hookAliases ? { hookAliases: input.hookAliases } : {}),
    triggeredBy: input.trigger.source,
    ...(input.trigger.userId ? { triggeredByUser: input.trigger.userId } : {}),
    ...(input.trigger.userName
      ? { triggeredByName: input.trigger.userName }
      : {}),
    startedAt,
    /**
     * ⚠️ An `Invalid Date` in a stored row can never be read, sorted or
     * repaired, so a clock that broke mid-run falls back to the start time —
     * wrong by the run's duration, but still a date.
     * เวลาผิดยังอ่านได้ ค่าเสียอ่านไม่ได้เลย.
     */
    finishedAt: Number.isFinite(finishedMs) ? new Date(finishedMs) : startedAt,
    ...(input.siteRulesAgeDays !== undefined
      ? { siteRulesAgeDays: input.siteRulesAgeDays }
      : {}),
    /* [FEAT-20260903-BCASTSRAGE] passed through per OA; `history-row.ts` picks
       this OA's entry and falls back to the run-level number above. */
    ...(input.siteRulesAgeDaysByHook !== undefined
      ? { siteRulesAgeDaysByHook: input.siteRulesAgeDaysByHook }
      : {}),
    // ⚠️ Asked, never hand-written: `recipient-ledger.ts` owns which lists are
    // being captured, and all three are off today. Spread so one row's flags
    // cannot follow a later change to the shared object.
    recipientsCaptured: { ...currentCaptureFlags() },
    /**
     * [FEAT-20260907-BCASTUNUSEDRULES] DERIVED, NOT PLUMBED.
     *
     * 🔴 `BroadcastRunInput` already carries both halves of the question —
     *    `cell` (`run-ports.ts:123`) and `audience` (`:127`) — so asking it here
     *    adds NO field to any interface and NO argument to any caller. A new
     *    input field would have to be set by every construction site of
     *    `BroadcastRunInput`, and the one that forgot would silently write rows
     *    with no flag: the exact failure mode this flag exists to expose.
     *    Ask what is already in hand rather than threading a new value down a
     *    long chain that gives somebody a place to forget it.
     *
     * ⚠️ Spread, so an ordinary round adds no key at all — see the field's own
     *    note in `broadcast-history.schema.ts`.
     */
    ...(flagsUnusedRules(input.cell, input.audience)
      ? { audienceRulesIgnored: true }
      : {}),
    ...(group.errorMessage ? { errorMessage: group.errorMessage } : {}),
  };
}

/**
 * A verdict in words, for the history row and for whoever is standing there.
 *
 * ⚠️ It only READS the verdict — every number in the sentence comes from the
 *    verdict itself, so this file cannot disagree with `run-plan.ts`.
 */
export function describeVerdict(verdict: RunVerdict): string {
  switch (verdict.kind) {
    case 'not-allowed':
      return verdict.reason;
    case 'too-many-hooks':
      return `${verdict.actual} OAs, and this combination allows ${verdict.limit}`;
    case 'too-deep':
      return `${verdict.actual} requests deep, and the budget is ${verdict.limit}`;
    case 'nothing-to-send':
      return 'every OA was skipped — there is nobody left to send to';
    case 'unreadable':
      return verdict.detail;
    default:
      // `ok` and `near-limit` both mean the run may go, so nothing reaches here
      // by way of a refusal. Named rather than left blank so a future verdict
      // that forgets its wording is still readable in the row.
      return verdict.kind;
  }
}

/**
 * ⚠️ Never `String(e)`: a thrown object stringifies to `[object Object]`, the
 *    same trap `retry-key.ts` documents, and that lands in a stored row.
 */
export function message(e: unknown): string {
  return e instanceof Error ? e.message : 'a non-Error value was thrown';
}
