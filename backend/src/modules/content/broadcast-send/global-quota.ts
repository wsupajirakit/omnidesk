/**
 * [FEAT-20260822-BCASTGLOBALQUOTA] How much this feature may send in an hour
 * and in a day — counted across EVERY job.
 * ===========================================================================
 * A pure decision. No database, no I/O, no clock (`now` and the usage are
 * passed in).
 *
 * เจ้าของ 22/08: "เรื่องเพดาน ต่อวัน ต่อชั่วโมงด้วย ไม่ว่าจะมีกี่ job cross เพดาน
 * ต้องมี global นับกันไว้ / flexible เปลี่ยนได้ ถอดได้ ตั้งได้ว่ารวมไม่รวม default = รวม".
 *
 * 🔑 WHY THE OTHER GUARDS DO NOT COVER THIS
 *   · `run-plan.ts`   bounds ONE run.
 *   · `run-guard.ts`  bounds ONE run while it is running.
 *   · `abuse-guard.ts` bounds how OFTEN runs start — not how MUCH they send.
 * Six jobs of 10,000 people each are six perfectly legal runs, and together
 * they are 60,000 messages in an hour that nobody agreed to. This file is the
 * only place that can see that. งานละใบถูกหมด แต่รวมกันแล้วเกิน.
 *
 * WHAT IS COUNTED: recipients messaged and requests made. Recipients are what
 * burns LINE's per-OA quota and what a customer experiences; requests are what
 * costs our own time. Both are capped, because either one can be the problem.
 *
 * revert: delete this file, its line in `index.ts`, and the check in the runner.
 */

/** 🔌 Turn the whole global budget off. Every other guard keeps working. */
export const GLOBAL_QUOTA_ENABLED = true;

/**
 * Combined across all jobs and all OAs (the owner's default), or one budget per
 * OA.
 *
 * `combined` is the safe default: it is the only mode that can see "many small
 * jobs add up". `per-oa` is offered because one busy OA should not be able to
 * spend another OA's headroom — switch to it when different OAs belong to
 * different owners. ค่าเริ่มต้น = รวม.
 */
export type QuotaScope = 'combined' | 'per-oa';
export const GLOBAL_QUOTA_SCOPE: QuotaScope = 'combined';

export interface QuotaWindow {
  readonly recipients: number;
  readonly requests: number;
}

/**
 * 🎯 THE NUMBERS — policy, not physics. Change them here, once.
 *
 * ⚠️ Deliberately far below what the per-run ceilings alone would permit: 30
 * runs/user/hour x 2 OAs x 10,000 recipients is 600,000, and nobody intends
 * that. These say what the product is willing to send, not what the code can.
 * ⚠️ LINE's own per-OA monthly quota is a SEPARATE limit that belongs to LINE;
 *    `LineQuotaApi` reads it and it is not modelled here.
 */
export const GLOBAL_QUOTA: {
  readonly hour: QuotaWindow;
  readonly day: QuotaWindow;
} = {
  hour: { recipients: 50_000, requests: 2_000 },
  day: { recipients: 300_000, requests: 10_000 },
};

/** What has already been spent in each window, for the scope being checked. */
export interface QuotaUsage {
  readonly lastHour: QuotaWindow;
  readonly lastDay: QuotaWindow;
}

/** What the run about to start intends to spend. */
export interface QuotaDemand {
  readonly recipients: number;
  readonly requests: number;
}

export type QuotaReason =
  | 'hour-recipients'
  | 'hour-requests'
  | 'day-recipients'
  | 'day-requests'
  | 'unreadable-usage';

export type QuotaVerdict =
  | { readonly allow: true; readonly remaining: QuotaWindow }
  | {
      readonly allow: false;
      readonly reason: QuotaReason;
      readonly detail: string;
      /** How much of the demand WOULD have fitted — for the message, not to auto-trim. */
      readonly remaining: QuotaWindow;
    };

const ZERO: QuotaWindow = { recipients: 0, requests: 0 };

/** A usage figure we cannot read means we do not know how much is left. */
function unusable(n: unknown): boolean {
  return typeof n !== 'number' || !Number.isFinite(n) || n < 0;
}

function windowUnusable(w: QuotaWindow | undefined | null): boolean {
  return !w || unusable(w.recipients) || unusable(w.requests);
}

/**
 * May this run spend what it intends to?
 *
 * ⚠️ Never trims the demand down to fit. Sending "as much as fits" would pick
 * winners and losers out of one audience with no way to explain the choice, and
 * the leftover people would look delivered. Refuse, report the remaining room,
 * and let a human decide. ไม่หั่น — บอกว่าเหลือเท่าไหร่แล้วให้คนตัดสิน.
 */
export function checkGlobalQuota(
  usage: QuotaUsage,
  demand: QuotaDemand,
): QuotaVerdict {
  if (!GLOBAL_QUOTA_ENABLED) return { allow: true, remaining: ZERO };

  if (windowUnusable(usage?.lastHour) || windowUnusable(usage?.lastDay)) {
    return {
      allow: false,
      reason: 'unreadable-usage',
      detail:
        'how much was already sent could not be read — refusing rather than sending blind',
      remaining: ZERO,
    };
  }
  const want = {
    recipients: unusable(demand?.recipients)
      ? 0
      : Math.trunc(demand.recipients),
    requests: unusable(demand?.requests) ? 0 : Math.trunc(demand.requests),
  };

  const remaining: QuotaWindow = {
    recipients: Math.max(
      0,
      Math.min(
        GLOBAL_QUOTA.hour.recipients - usage.lastHour.recipients,
        GLOBAL_QUOTA.day.recipients - usage.lastDay.recipients,
      ),
    ),
    requests: Math.max(
      0,
      Math.min(
        GLOBAL_QUOTA.hour.requests - usage.lastHour.requests,
        GLOBAL_QUOTA.day.requests - usage.lastDay.requests,
      ),
    ),
  };

  // Checked in this order so the message names the tightest real limit: the
  // hour is the one a person can wait out, the day is the one they cannot.
  if (
    usage.lastHour.recipients + want.recipients >
    GLOBAL_QUOTA.hour.recipients
  ) {
    return refuse(
      'hour-recipients',
      'recipients',
      'hour',
      usage.lastHour.recipients,
      want.recipients,
      GLOBAL_QUOTA.hour.recipients,
      remaining,
    );
  }
  if (usage.lastHour.requests + want.requests > GLOBAL_QUOTA.hour.requests) {
    return refuse(
      'hour-requests',
      'requests',
      'hour',
      usage.lastHour.requests,
      want.requests,
      GLOBAL_QUOTA.hour.requests,
      remaining,
    );
  }
  if (
    usage.lastDay.recipients + want.recipients >
    GLOBAL_QUOTA.day.recipients
  ) {
    return refuse(
      'day-recipients',
      'recipients',
      'day',
      usage.lastDay.recipients,
      want.recipients,
      GLOBAL_QUOTA.day.recipients,
      remaining,
    );
  }
  if (usage.lastDay.requests + want.requests > GLOBAL_QUOTA.day.requests) {
    return refuse(
      'day-requests',
      'requests',
      'day',
      usage.lastDay.requests,
      want.requests,
      GLOBAL_QUOTA.day.requests,
      remaining,
    );
  }
  return { allow: true, remaining };
}

function refuse(
  reason: QuotaReason,
  unit: string,
  window: string,
  used: number,
  want: number,
  limit: number,
  remaining: QuotaWindow,
): QuotaVerdict {
  return {
    allow: false,
    reason,
    detail: `this ${window} has used ${used} ${unit} and this run wants ${want} more — the limit is ${limit}`,
    remaining,
  };
}
