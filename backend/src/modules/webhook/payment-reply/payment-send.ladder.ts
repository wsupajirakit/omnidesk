import { buildPaymentMessage, type LineSendResult } from '@/infra/line';
import type { LineSendRequest } from '@/infra/line';

/**
 * ==== [FEAT-20260827-PUSHCORE-B] candidate B — the payment delivery ladder ====
 *
 * WHAT: reply first, push when the reply leg does not land. Extracted verbatim
 * in behaviour from `webhook.service.ts` `sendPaymentReply`, where it lived as
 * two nested try/catch blocks.
 *
 * WHY IT HAD TO MOVE AT ALL — this is the whole of candidate B:
 * the old ladder decided by EXCEPTION. `LineApiService.sendLineFlexReply` let
 * the axios rejection escape, and `catch { fall through to push }` was the rung
 * edge. The push core NEVER throws — it resolves `{ok:false}` (line-push.ts:
 * 39-40). Dropping the core in under an exception-driven ladder would have meant
 * the reply leg always "succeeding", the push leg never running, and the
 * `payment_reply_undelivered` row — the one row that says the money moved and
 * the customer was told nothing — never being written again. Every existing test
 * would have stayed green. 🔴 เส้นเงิน: ตัดสินด้วย ok ไม่ใช่ด้วย throw.
 *
 * WHY THE RUNG EDGE IS `!res.ok` AND NOT `definiteRefusal()` (4xx only):
 * the admin console's ladder (chat/channels/outbound-send-strategy.ts:107-109)
 * stops on 5xx, reasoning that delivery is unknown and a reply carries no
 * X-Line-Retry-Key. That is a DIFFERENT rule from the one this path has always
 * had: the old code caught every rejection alike, so a 5xx fell through to push
 * exactly like a 401 did. Asked and answered by the owner on 2026-08-27 —
 * **"เหมือนเดิม"** — so this ladder keeps the old edge deliberately. It is not an
 * oversight and it must not be "aligned" with the chat strategy without another
 * decision: doing so would add `payment_reply_undelivered` rows for 5xx cases
 * that today end in a delivered push.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO: no logging, no chat history, no
 * ticketing. It returns WHICH rung answered and lets `sendPaymentReply` write
 * the rows exactly where it always wrote them. That is not only separation of
 * concerns — `z-test/unit/payment-reply-undelivered-status.spec.ts:53-57` reads
 * webhook.service.ts as TEXT and matches every `await log('<action>','<status>'`
 * in it, so moving those calls here would blind a guard that exists because a
 * status value once silently failed schema validation and lost the rows.
 *
 * revert: delete this file and put the two try/catch blocks back in
 *         `sendPaymentReply` (they call `this.lineApi.sendLine*` directly).
 */

/** The one message this reply carries, in whichever pipe it ends up riding. */
export interface PaymentSendPlan {
  /** Decrypted channel access token. */
  token: string;
  /** Absent/empty ⇒ the reply rung is skipped entirely (as before). */
  replyToken?: string;
  /** Absent/empty ⇒ the push rung is skipped entirely (as before). */
  userId?: string;
  /** The bound state card, when the OA has one. Null ⇒ plain text. */
  flex?: Record<string, unknown> | null;
  /** The plain-text body, used when there is no card. */
  text: string;
  /** altText for the card — the caller passes MINT_FLEX_ALT_TEXT. */
  altText: string;
}

export interface PaymentSendDeps {
  /** `LinePushDispatcher.dispatch` — the WRAPPER, never `LinePushService`. */
  send: (req: LineSendRequest) => Promise<LineSendResult>;
  /** The reply-leg failure line, kept word for word by the caller. */
  warn: (message: string) => void;
}

export type PaymentSendOutcome =
  | { via: 'reply'; res: LineSendResult }
  | { via: 'push'; res: LineSendResult }
  /**
   * Nothing reached the customer. `pushAttempted` separates the two rows the
   * caller writes, and it reproduces a quirk of the original on purpose:
   * when a reply token exists, the reply fails and there is NO userId, the old
   * code fell out of both `if` blocks and wrote "no reply token and no userId"
   * — a wrong sentence for that case, but the one that is in the collection
   * today. Reproduced rather than corrected; changing it is a separate call.
   */
  | { via: 'none'; pushAttempted: boolean; detail?: string };

/** The message body — identical for both rungs, which is the point of the
 *  ladder ("send the same kind, just change the pipe", line-api.service.ts:268).
 *  `buildPaymentMessage` is candidate B's own builder and is already proven
 *  byte-equal to BOTH legacy senders by execution, not by copy
 *  (z-test/unit/line-push-parity.spec.ts:197,214). */
const messagesFor = (plan: PaymentSendPlan) => [
  plan.flex
    ? buildPaymentMessage({
        kind: 'flex',
        flexContents: plan.flex,
        altText: plan.altText,
      })
    : buildPaymentMessage({ kind: 'text', text: plan.text }),
];

/**
 * [FIX-20260906-PAYREASON] What went wrong, in LINE's own words — not axios's.
 * ===========================================================================
 * WHY THIS ORDER CHANGED, and it is the whole reason a real defect took an
 * afternoon instead of a minute. On 06/09/2026 a slip verified successfully and
 * the customer received nothing: both the reply and the push leg answered 400.
 * Everything this function fed the log and the audit row said was:
 *
 *     Request failed with status code 400
 *
 * — axios's generic sentence, taken from `res.raw.message`, which the old order
 * preferred. `res.reason` is `describeLineFailure`'s answer and had been there
 * the whole time:
 *
 *     HTTP 400 - A message (messages[0]) in the request body is invalid
 *       (/body/contents/1/contents/0/contents/0/url: invalid uri scheme, …)
 *
 * That names the offending property, and the fault was found the moment it was
 * readable. The sibling ladder never had this problem — `replyThenPush` logs
 * `res.reason`, which is why "HTTP 429 - You have reached your monthly limit."
 * was legible on the same machine minutes earlier.
 *
 * ⚠️ IT FEEDS THE ONE AUDIT ROW THAT MATTERS MOST. `payment_reply_undelivered`
 * is written only when BOTH legs failed — the money may have moved and the
 * customer was told nothing — and it carries this string as `review_detail`.
 * An operator chasing a lost reply reading a bare status code cannot act on it.
 *
 * ⚠️ 400 vs 429 ON THE PUSH LEG IS A DIAGNOSIS, and this is what makes it
 * visible: 429 means the payload was legal and the channel is out of monthly
 * budget; 400 means LINE rejected the BODY before reaching the metre. The old
 * order rendered both as the same sentence.
 *
 * Nothing else changes: the fallback chain below is untouched, and when
 * `reason` is absent the previous two answers apply in the previous order.
 * revert: restore `z-test/tmp/payment-send.ladder-BEFORE.ts`.
 * เก็บถ้อยคำของ LINE ไว้ ไม่งั้นไล่บั๊กไม่ได้
 */
const reasonOf = (res: LineSendResult): string => {
  if (res.reason) return res.reason;
  if (res.raw instanceof Error) return res.raw.message;
  return `LINE ${res.status}`;
};

export async function deliverPaymentReply(
  plan: PaymentSendPlan,
  deps: PaymentSendDeps,
): Promise<PaymentSendOutcome> {
  const messages = messagesFor(plan);

  // ── 1) reply token ──────────────────────────────────────────────────
  if (plan.replyToken) {
    const res = await deps.send({
      kind: 'reply',
      token: plan.token,
      replyToken: plan.replyToken,
      messages,
    });
    if (res.ok) return { via: 'reply', res };
    // Word for word from the original catch — operators grep this line.
    deps.warn(
      `[PAYREPLY] reply failed, falling back to push: ${reasonOf(res)}`,
    );
  }

  // ── 2) push, SAME KIND ──────────────────────────────────────────────
  if (plan.userId) {
    const res = await deps.send({
      kind: 'push',
      token: plan.token,
      to: plan.userId,
      messages,
    });
    if (res.ok) return { via: 'push', res };
    return { via: 'none', pushAttempted: true, detail: reasonOf(res) };
  }

  return { via: 'none', pushAttempted: false };
}
