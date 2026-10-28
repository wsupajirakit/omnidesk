/**
 * [FIX-20260817-RETRYRESUME] The bridge that carries `resume` from the runner's
 * RESULT to the card builder — the one link in the retry chain nobody tested.
 *
 * WHAT WAS BROKEN (found live, 17/08)
 * -----------------------------------
 * `resume` is a member of `PaymentRunResult`, NOT of `result.reply`:
 *
 *     { ...this._result(…, 'no_match_retry', …),
 *       resume: { run_id, next_idx } }        ← sibling of `reply`, not inside it
 *
 * Both delivery paths forwarded only the child:
 *
 *     webhook.service.ts:4648        sendPaymentReply(result.reply as never, …)
 *     payment-postback.handler.ts    deps.sendReply(result.reply, …)
 *
 * and the renderer then read `reply.resume`, which was therefore ALWAYS
 * undefined. `buildAction` correctly refuses to draw a button with nothing to
 * resume to, so the [ลองใหม่] button was dropped from every card ever sent —
 * while the copy on that same card told the customer to press it. The run stayed
 * `awaiting_retry` for ever with no way for the customer to advance it.
 *
 * Confirmed live twice: run `6a82d0d7…` and `6a82d249…` both landed
 * `status=awaiting_retry, cursor=0, resume_cursor=1` — the backend had the next
 * statement ready — and both cards arrived with only [ติดต่อแอดมิน].
 *
 * NOT a regression: `git log -S` puts the runner's `resume:` in `db03518` and the
 * `result.reply as never` send in the LATER `9d4681b`, and
 * `payment-action-mint.spec.ts:24` says out loud that the wiring was left for
 * "the integrator". It was never connected.
 *
 * WHY NO TEST CAUGHT IT
 * ---------------------
 * Every existing test hands the context to the builder BY HAND
 * (`buildMintFlex(reply, { resume: { runId: 'RUN123', nextIdx: 3 } })`), so the
 * builder and the runner are each proven correct in isolation and the gap
 * between them is invisible. `payment-state-flex-wiring.spec.ts` even mirrors
 * the wiring in a local `compose()` helper — a mirror cannot catch the original
 * being wrong. Its own coverage note admits the real button was never tapped
 * because "a paused run with statements remaining … the local data has never
 * produced".
 *
 * This file tests the LINK ITSELF, through the two shared helpers both call
 * sites now use, so the mapping cannot drift again.
 */
import {
  replyWithResume,
  resumeContext,
  buildMintFlex,
  handlePaymentPostback,
} from '@/modules/webhook/payment-reply';

/** What the runner returns when walletpay said no_match and statements remain. */
const awaitingRetryResult = () => ({
  ran: true,
  reply: {
    state: 'no_match_retry',
    kind: 'flex' as const,
    text: 'ไม่พบรายการที่ตรงกับสลิปนี้ กรุณากด "ลองใหม่" เพื่อตรวจสอบรายการถัดไป',
    actions: ['retry', 'contact_admin'],
    detail: '-',
  },
  resume: { run_id: 'RUN_ABC', next_idx: 1 },
});

/** What it returns on `review` — nothing to advance to, so no resume. */
const reviewResult = () => ({
  ran: true,
  reply: {
    state: 'review',
    kind: 'flex' as const,
    text: 'กำลังตรวจสอบ',
    actions: ['retry', 'contact_admin'],
    detail: '-',
  },
});

describe('[FIX-20260817-RETRYRESUME] resume survives the trip from result to card', () => {
  it('replyWithResume lifts `resume` off the RESULT and onto the reply', () => {
    const out = replyWithResume(awaitingRetryResult());
    expect(out?.resume).toEqual({ run_id: 'RUN_ABC', next_idx: 1 });
    // the reply's own members are untouched
    expect(out?.state).toBe('no_match_retry');
    expect(out?.actions).toEqual(['retry', 'contact_admin']);
  });

  it('a state with nothing to resume to carries no resume — the button must stay away', () => {
    expect(replyWithResume(reviewResult())?.resume).toBeUndefined();
  });

  it('no reply at all ⇒ undefined, so callers keep their existing early return', () => {
    expect(replyWithResume({ ran: false })).toBeUndefined();
  });

  it('resumeContext maps the runner snake_case onto the builder camelCase', () => {
    expect(resumeContext(replyWithResume(awaitingRetryResult()))).toEqual({
      runId: 'RUN_ABC',
      nextIdx: 1,
    });
    expect(resumeContext(replyWithResume(reviewResult()))).toBeUndefined();
    expect(resumeContext(undefined)).toBeUndefined();
  });

  /** The property the customer actually experiences. */
  it('⭐ end to end: an AWAITING_RETRY result renders a WORKING [ลองใหม่] button', () => {
    const reply = replyWithResume(awaitingRetryResult());
    const flex = buildMintFlex(reply as never, {
      resume: resumeContext(reply),
    });
    const json = JSON.stringify(flex);
    expect(json).toContain('ลองใหม่');
    expect(json).toContain('postback');
    // the payload must address the paused run at the NEXT statement
    expect(json).toContain('pay:resume:RUN_ABC:1');
  });

  it('⭐ and a review result still renders NO retry button (the rule that must not break)', () => {
    const reply = replyWithResume(reviewResult());
    const flex = buildMintFlex(reply as never, {
      resume: resumeContext(reply),
    });
    const json = JSON.stringify(flex);
    expect(json).not.toContain('pay:resume');
    expect(json).toContain('ติดต่อแอดมิน');
  });

  it('the postback path forwards resume too, so a 2nd hop keeps its button', async () => {
    const sendReply = jest.fn().mockResolvedValue(undefined);
    const res = await handlePaymentPostback(
      {
        type: 'postback',
        postback: { data: 'pay:resume:RUN_ABC:1' },
        source: { userId: 'U1' },
        replyToken: 'TOKEN',
      },
      {
        paymentEnabled: true,
        resume: jest.fn().mockResolvedValue({
          ...awaitingRetryResult(),
          resume: { run_id: 'RUN_ABC', next_idx: 2 },
        }),
        sendReply,
      },
    );
    expect(res).toEqual({ handled: true });
    expect(sendReply).toHaveBeenCalledTimes(1);
    const forwarded = sendReply.mock.calls[0][0] as { resume?: unknown };
    expect(forwarded.resume).toEqual({ run_id: 'RUN_ABC', next_idx: 2 });
  });
});
