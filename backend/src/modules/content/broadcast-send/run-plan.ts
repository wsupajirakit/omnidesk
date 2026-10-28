/**
 * [FEAT-20260822-BCASTRUNPLAN] What will this run cost, which OAs can go, and
 * does the whole thing still fit?
 * ===========================================================================
 * A pure decision. No database, no I/O, no clock.
 *
 * 🔑 TWO CEILINGS, AND THEY ANSWER DIFFERENT QUESTIONS (owner, 2026-08-22:
 * "มันก็ต้อง dynamic เพดานรวม เพดานแยก")
 *
 *   PER OA  — "may THIS OA be sent to?"  An OA over its recipient ceiling is
 *             SKIPPED, and the rest of the run continues. One oversized OA
 *             must never cost the others their campaign; that is the rule this
 *             file used to break by judging the run on its largest OA alone.
 *   PER RUN — "may the run as a whole go?"  Serial depth, hook count, and
 *             whether the type/sub-type combination is possible at all. These
 *             are fatal: they are about the process, not about one channel.
 *
 * 🔑 DEPTH, NOT TOTAL REQUESTS, IS WHAT BOUNDS A RUN.
 * OAs are separate LINE channels with separate rate-limit budgets, so a run
 * sends to several at once (`SendCell.maxParallelOa`). Wall time is therefore
 * the deepest wave, not the sum of everything sent.
 *
 *     waves = ceil(sendableOaCount / maxParallelOa)
 *     depth = waves * requestsPerOa      ← bounded by MAX_REQUESTS_PER_RUN
 *     wall  = depth * p99
 *
 * A 5-OA plain run sends 100 requests but is only 60 deep, so it finishes in
 * about a minute. Three personalised OAs are 600 deep and are refused.
 *
 * ⚠️ RECIPIENT COUNTS ARE PER OA. A LINE user id belongs to one channel, so the
 *    audience is selected once per OA and each OA has its own headcount — see
 *    `content/audience/oa-scope.ts` for why that selection needs `chat_rooms`.
 *
 * revert: delete this file with the rest of `broadcast-send/`.
 */
/* [FEAT-20260903-BCASTEMPTYAUD] whether a headcount of zero skips an OA — the
   answer depends on the CELL, because a broadcast request names nobody. */
import { skipsEmptyAudience } from './empty-audience.policy';
import { MAX_REQUESTS_PER_RUN, NEAR_LIMIT_RATIO, P99_MS } from './limits';
import { type SendCell, requestsPerOaFor } from './send-matrix.registry';

export interface RunPlanInput {
  /** The type x sub-type the admin ticked. Carries its own ceilings. */
  readonly cell: SendCell;
  /** Recipients selected FOR EACH OA, in the order the run will send them. */
  readonly recipientsByOa: readonly number[];
  /**
   * [FEAT-20260903-BCASTSRFRESH] OAs another step has already ruled out, by the
   * SAME index as `recipientsByOa`.
   *
   * Optional, and absent means "none" — so every existing caller plans exactly
   * what it planned before. It exists so a decision that needs I/O (did this
   * OA's site rules arrive?) can be made where I/O is allowed, and still be
   * carried by the one thing that already knows how to skip an OA, write its
   * history row and keep the rest of the run going.
   * ⚠️ Deliberately NOT a reason string: the wording belongs to `skipDetail`,
   *    which is where every other skip is worded. ตัดสินที่นี่ พูดที่เดิม.
   */
  readonly blockedByOa?: readonly boolean[];
}

/** Why one OA cannot be sent to. The run carries on without it. */
export type OaSkipReason =
  | 'too-many-recipients'
  | 'unreadable'
  | 'empty'
  /**
   * [FEAT-20260903-BCASTSRFRESH] The card fills `{{site_rules.*}}` and this OA
   * has no site rules to fill them with — not even after the run tried to fetch
   * some. Sending would put `N/A` in front of every customer, silently.
   * ไม่มีข้อมูลจะเติม และการ์ดต้องใช้ ⇒ ข้าม OA นี้ ไม่ใช่ส่งการ์ดว่าง.
   */
  | 'no-site-rules';

export interface OaPlan {
  /** Position in the input list — the caller's handle on which OA this is. */
  readonly index: number;
  readonly recipients: number;
  readonly requests: number;
  readonly sendable: boolean;
  readonly skipReason?: OaSkipReason;
}

export type RunVerdict =
  | { readonly kind: 'ok' }
  | { readonly kind: 'near-limit'; readonly ratio: number }
  /** This type x sub-type cannot exist — e.g. broadcast with per-person values. */
  | { readonly kind: 'not-allowed'; readonly reason: string }
  /** More OAs than this combination allows. Fatal on purpose — see below. */
  | {
      readonly kind: 'too-many-hooks';
      readonly limit: number;
      readonly actual: number;
    }
  /** Fits per OA, but too many waves deep to finish inside the allowance. */
  | {
      readonly kind: 'too-deep';
      readonly limit: number;
      readonly actual: number;
    }
  /** Every OA was skipped, so there is nothing left to send. */
  | { readonly kind: 'nothing-to-send' }
  | { readonly kind: 'unreadable'; readonly detail: string };

export interface RunPlan {
  readonly perOa: readonly OaPlan[];
  readonly sendableOaCount: number;
  readonly skippedOaCount: number;
  /** Requests of the deepest sendable OA — the unit depth is built from. */
  readonly requestsPerOa: number;
  /** Everything the run sends. For the history row, NOT for the ceiling. */
  readonly totalRequests: number;
  readonly waves: number;
  readonly depth: number;
  readonly projectedMs: number;
  readonly budgetUsedRatio: number;
  readonly verdict: RunVerdict;
}

/**
 * A headcount we cannot read is a broken caller, not an empty OA.
 *
 * 🔴 Fails closed: `Math.trunc(NaN)` is `NaN` and `NaN > limit` is false, so an
 * unhardened version answered `ok` for a NaN audience — found in review.
 */
function count(n: unknown): number | null {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return null;
  return Math.trunc(n);
}

const EMPTY_PLAN = (verdict: RunVerdict): RunPlan => ({
  perOa: [],
  sendableOaCount: 0,
  skippedOaCount: 0,
  requestsPerOa: 0,
  totalRequests: 0,
  waves: 0,
  depth: 0,
  projectedMs: 0,
  budgetUsedRatio: 0,
  verdict,
});

/**
 * Answers "can this run go, and which OAs are in it?" without sending anything.
 *
 * Used in three places, all reading the same numbers: the dry-run preview, the
 * save-time validation, and the runner immediately before it starts. The last
 * one matters because the audience is selected live — a job that fit last week
 * may not fit today.
 */
export function planRun(input: RunPlanInput): RunPlan {
  const { cell } = input;

  if (!cell.allowed) {
    return EMPTY_PLAN({
      kind: 'not-allowed',
      reason: cell.reason ?? 'this combination is not supported',
    });
  }
  if (!Array.isArray(input.recipientsByOa)) {
    return EMPTY_PLAN({
      kind: 'unreadable',
      detail: 'recipientsByOa is not a list',
    });
  }

  // ── per-OA pass: decide each OA on its own, never on its neighbours ──────
  const perOa: OaPlan[] = input.recipientsByOa.map((raw, index) => {
    const recipients = count(raw);
    if (recipients === null) {
      return {
        index,
        recipients: 0,
        requests: 0,
        sendable: false,
        skipReason: 'unreadable',
      };
    }
    /* [FEAT-20260903-BCASTSRFRESH] Asked BEFORE the headcount, because a
       blocked OA is blocked however many people it has. */
    if (input.blockedByOa?.[index] === true) {
      return {
        index,
        recipients,
        requests: 0,
        sendable: false,
        skipReason: 'no-site-rules',
      };
    }
    /**
     * [FEAT-20260903-BCASTEMPTYAUD] Zero selected people is only a reason to
     * skip when the request would have NAMED them.
     *
     * A `/message/broadcast` carries no recipient list, so a headcount of zero
     * means "our `chat_rooms` table does not know this channel's followers",
     * not "this channel has none" — and a card built purely from
     * `{{site_rules.*}}` needs no member row to render. Multicast keeps
     * skipping, because a multicast addressed to nobody is a wasted request
     * LINE will reject. See `empty-audience.policy.ts` for the switch that
     * restores the old behaviour for every cell.
     * นับได้ 0 บนท่อ broadcast ไม่ใช่เหตุผลให้ข้าม — ท่อนั้นไม่ได้ระบุชื่อใครอยู่แล้ว.
     */
    if (recipients === 0 && skipsEmptyAudience(cell)) {
      return {
        index,
        recipients: 0,
        requests: 0,
        sendable: false,
        skipReason: 'empty',
      };
    }
    const max = cell.maxRecipientsPerOa;
    if (max !== null && recipients > max) {
      // Skipped, NOT fatal: the other OAs keep their campaign.
      return {
        index,
        recipients,
        requests: 0,
        sendable: false,
        skipReason: 'too-many-recipients',
      };
    }
    return {
      index,
      recipients,
      requests: requestsPerOaFor(cell, recipients),
      sendable: true,
    };
  });

  const sendable = perOa.filter((o) => o.sendable);
  const sendableOaCount = sendable.length;
  const skippedOaCount = perOa.length - sendableOaCount;

  // ── run-wide pass: these are about the process, so they are fatal ────────
  //
  // ⚠️ Too many OAs is fatal rather than "send to the first N". Quietly
  // dropping OAs the admin deliberately ticked changes who receives the
  // campaign without saying so — the same silent-widening hazard the audience
  // rules refuse elsewhere. ตัดเงียบ ๆ ห้ามเด็ดขาด.
  if (perOa.length > cell.maxHooks) {
    return {
      ...EMPTY_PLAN({
        kind: 'too-many-hooks',
        limit: cell.maxHooks,
        actual: perOa.length,
      }),
      perOa,
      sendableOaCount,
      skippedOaCount,
    };
  }

  const requestsPerOa = sendable.reduce((m, o) => Math.max(m, o.requests), 0);
  const totalRequests = sendable.reduce((sum, o) => sum + o.requests, 0);
  const parallel = Math.max(1, cell.maxParallelOa);
  const waves =
    sendableOaCount === 0 ? 0 : Math.ceil(sendableOaCount / parallel);
  const depth = waves * requestsPerOa;
  const projectedMs = depth * P99_MS;
  const budgetUsedRatio = depth / MAX_REQUESTS_PER_RUN;

  const base = {
    perOa,
    sendableOaCount,
    skippedOaCount,
    requestsPerOa,
    totalRequests,
    waves,
    depth,
    projectedMs,
    budgetUsedRatio,
  };

  if (sendableOaCount === 0) {
    return { ...base, verdict: { kind: 'nothing-to-send' } };
  }
  if (depth > MAX_REQUESTS_PER_RUN) {
    return {
      ...base,
      verdict: { kind: 'too-deep', limit: MAX_REQUESTS_PER_RUN, actual: depth },
    };
  }
  if (budgetUsedRatio >= NEAR_LIMIT_RATIO) {
    return { ...base, verdict: { kind: 'near-limit', ratio: budgetUsedRatio } };
  }
  return { ...base, verdict: { kind: 'ok' } };
}

/**
 * May this run start?
 *
 * `near-limit` still goes — it is a warning, not a gate. Everything else stops,
 * including `nothing-to-send`: a run with no sendable OA has nothing to do, and
 * starting it would write a history row that looks like a delivery.
 */
export function canRun(plan: RunPlan): boolean {
  return plan.verdict.kind === 'ok' || plan.verdict.kind === 'near-limit';
}
