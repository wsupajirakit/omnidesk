/**
 * =====================================================================
 * [FEAT-20260808-PAYTOOL-P2C] payment retry-button postback handler.
 * =====================================================================
 *
 * 📍 [DOC-20260810-PAYSTATES] The state this button belongs to (`no_match_retry`)
 * and every other reply state — flex vs text, copy source, override knob, what
 * each means for the slip lock — are mapped in `docs/payment-states.md`
 * (LOCAL ONLY, not pushed: `.gitignore:46` ignores `*.md` repo-wide by policy).
 * แผนที่ state ทั้งหมดอยู่ที่ `docs/payment-states.md`.
 *
 * WHAT IT IS FOR (the real customer situation)
 * A customer transfers money and sends the slip. Several bank statements may
 * carry the same amount, and the system cannot know which one this slip belongs
 * to — so it tries them one at a time. When walletpay answers `no_match`, the run
 * PAUSES and replies with a [ลองใหม่] button. This handler is what that button
 * hits: it resumes the SAME run at the NEXT statement (x+1) with the SAME stored
 * slip image. The customer never re-photographs anything.
 *
 * Without this, a customer stalls on statement #1 forever and the money never
 * lands — which is why the button is not cosmetic.
 *
 * ── WHY A SEPARATE HANDLER FROM `handoff-postback.handler.ts` (owner: B) ─────
 * That file does the same SHAPE of job (parse → runId + nextIdx → resume) and
 * was the template for this one. It is deliberately NOT reused:
 *
 *   1. IT IS GATED BY A DIFFERENT SWITCH. It returns early on
 *      `!deps.chainsEnabled` — the handoff-chain feature flag. Payment has its
 *      own kill switch (`payment_tool_status` per hook). Sharing the handler
 *      would let someone turning OFF handoff chains silently kill the payment
 *      retry button while payment is still ON: the customer taps, nothing
 *      happens, and the money sits unclaimed. A money path must not depend on
 *      another feature's flag. เงินต้องไม่พังเพราะสวิตช์ของฟีเจอร์อื่น.
 *   2. IT IS A BYTE-FAITHFUL LEGACY PORT. Its behaviour is pinned to
 *      legacy-api chain/postback.js. Adding payment branches to it would break
 *      the "existing behaviour is byte-identical when the feature is OFF" rule
 *      this project holds.
 *   3. ITS RUNTIME IS UN-PORTED. `deps.resume` is never supplied there, so it
 *      only swallows and warns. Hanging payment off a no-op is worse than
 *      owning the path.
 *
 * Cost of the split: this file. Benefit: payment turns on and off by itself and
 * nothing already verified is touched.
 *
 * ── SHAPE ───────────────────────────────────────────────────────────────────
 * Same injected-deps style as the handoff handler and `assist-notification.ts`:
 * this file imports NO service, so it unit-tests with plain objects and has no
 * back-dependency on `webhook.service.ts`. The runner work arrives as
 * `deps.resume`; the reply send as `deps.sendReply`.
 *
 * HOW TO CHANGE LATER
 *   · payload format → PAYMENT_POSTBACK_PREFIX + `buildRetryPostbackData`
 *     below are the ONLY places that know it. The builder and the parser live
 *     together on purpose so they cannot drift apart.
 *   · a second button action (e.g. "cancel") → add one `parts[1]` branch.
 * revert: delete this file + its wire in webhook.service.
 */

// [FIX-20260817-RETRYRESUME] the shared result→reply bridge
import { replyWithResume } from './payment-reply-resume';
import { Logger } from '@nestjs/common';

const logger = new Logger('PaymentPostback');

/**
 * The payload prefix that marks a postback as OURS.
 *
 * Distinct from the handoff chain's `hoc:` so the two can never be confused:
 * an unknown prefix falls straight through, so a payment payload can never be
 * eaten by the chain handler and vice versa.
 */
export const PAYMENT_POSTBACK_PREFIX = 'pay:';

/**
 * Build the `[ลองใหม่]` button payload.
 *
 * Format: `pay:resume:<runId>:<nextIdx>`
 *   · `runId`   — which paused run to continue (carries the slip + cursor).
 *   · `nextIdx` — the statement index to try, i.e. the run's `resume_cursor`.
 *
 * The index is carried IN the payload (not read from the DB at tap time) so the
 * button is idempotent about WHICH statement it means: a double-tap re-requests
 * the same index rather than skipping one. The runner still decides whether
 * that index is still valid.
 */
export function buildRetryPostbackData(runId: string, nextIdx: number): string {
  return `${PAYMENT_POSTBACK_PREFIX}resume:${runId}:${nextIdx}`;
}

/** The minimal LINE event shape this handler reads (kept structural). */
export interface PaymentPostbackEvent {
  type?: string;
  replyToken?: string;
  postback?: { data?: string };
  source?: { userId?: string };
}

/** What `deps.resume` hands back — mirrors the runner's own reply envelope. */
export interface PaymentResumeResult {
  ran: boolean;
  skipped?: string;
  reply?: {
    state: string;
    kind: 'text' | 'flex';
    text: string;
    actions?: string[];
    detail: string;
  };
  /**
   * [FEAT-20260810-PAYSTATEFLEX] Card inputs the runner attaches on resume, passed
   * straight to `sendReply`. This branch has no slip of its own — only the run id
   * off the button — so without it a bound card's `{{amount}}` could not be
   * substituted and the retry tap would answer with the built-in card while a fresh
   * slip answered with the admin's. Opaque here on purpose: this handler routes it,
   * it does not read it.
   */
  stateFlex?: unknown;
  /**
   * [FIX-20260817-RETRYRESUME] Where a further [ลองใหม่] should resume. It sits
   * on the RESULT, not inside `reply` — forwarding only `reply` is what dropped
   * the button from every card. Routed, never read, exactly like `stateFlex`.
   */
  resume?: { run_id: string; next_idx: number };
}

export interface PaymentPostbackDeps {
  /**
   * Whether the payment tool is ON for this hook — the runner's own
   * `resolvePaymentTool(hook)` result, NOT the handoff chain flag.
   * Absent/false ⇒ the payload is still consumed (it is ours; letting it leak
   * into the text pipeline would show the customer a raw `pay:resume:...`
   * string) but no work is done.
   */
  paymentEnabled?: boolean;
  /** Resume the paused run at `nextIdx` with the stored slip image. */
  resume?: (
    runId: string,
    nextIdx: number,
    replyToken: string,
  ) => Promise<PaymentResumeResult>;
  /** Deliver the resume's reply (payment-reply delivery owns flex/text/push). */
  sendReply?: (
    reply: NonNullable<PaymentResumeResult['reply']> & {
      // [FIX-20260817-RETRYRESUME] carried through so the next card keeps its button
      resume?: { run_id: string; next_idx: number };
    },
    ctx: { replyToken: string; userId: string; stateFlex?: unknown },
  ) => Promise<unknown>;
}

/**
 * @returns `{ handled: true }` when this WAS a payment postback and was consumed
 *   — the caller must stop the normal flow so the payload never reaches the AI
 *   or the text pipeline. `{ handled: false }` ⇒ not ours, fall through
 *   untouched (seamless: a hook without payment behaves exactly as before).
 */
export async function handlePaymentPostback(
  event: PaymentPostbackEvent | null | undefined,
  deps: PaymentPostbackDeps = {},
): Promise<{ handled: boolean }> {
  if (!event || event.type !== 'postback') return { handled: false };

  const data = event.postback?.data;
  if (typeof data !== 'string' || !data.startsWith(PAYMENT_POSTBACK_PREFIX)) {
    return { handled: false }; // not ours → seamless fall-through.
  }

  // From here the payload IS ours: every path returns handled=true so a raw
  // `pay:...` string can never be echoed to the customer or fed to the AI.
  const parts = data.split(':');
  if (parts[1] !== 'resume') {
    logger.warn(`[PAYPOSTBACK] unknown payment postback action: ${data}`);
    return { handled: true };
  }

  const runId = parts[2] ?? '';
  const nextIdx = parseInt(parts[3] ?? '', 10);
  const replyToken = event.replyToken ?? '';
  const userId = event.source?.userId ?? '';

  // A malformed payload must not be turned into "statement 0" — that would
  // re-POST a statement already tried. Fail closed, loudly.
  if (!runId || !Number.isInteger(nextIdx) || nextIdx < 0) {
    logger.error(`[PAYPOSTBACK] malformed payment resume payload: ${data}`);
    return { handled: true };
  }

  if (!deps.paymentEnabled || !deps.resume) {
    // Payment is off for this hook (or the runner was not wired). Consume the
    // payload — it is ours — but do nothing. A customer tapping an old button
    // after the tool was switched off simply gets no reply, which is the same
    // outcome as the feature never having existed.
    logger.warn(
      `[PAYPOSTBACK] consumed resume (run=${runId}, idx=${nextIdx}) but payment is not active`,
    );
    return { handled: true };
  }

  const result = await deps.resume(runId, nextIdx, replyToken);

  // The runner returns the reply; this handler sends it, because the fresh
  // reply token belongs to THIS postback event and nothing else has it.
  if (result?.reply && deps.sendReply) {
    // [FEAT-20260810-PAYSTATEFLEX] forward the card inputs the runner attached.
    // [FIX-20260817-RETRYRESUME] `replyWithResume` lifts the resume target off the
    // RESULT onto the reply — sending `result.reply` alone dropped it, and with it
    // the [ลองใหม่] button on every card. See payment-reply-resume.ts.
    await deps.sendReply(replyWithResume(result)!, {
      replyToken,
      userId,
      stateFlex: result.stateFlex,
    });
  }

  return { handled: true };
}
