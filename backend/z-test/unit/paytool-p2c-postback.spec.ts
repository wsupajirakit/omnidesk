import { Logger } from '@nestjs/common';

import {
  buildRetryPostbackData,
  handlePaymentPostback,
  type PaymentResumeResult,
} from '@/modules/webhook/payment-reply';

/**
 * [FEAT-20260808-PAYTOOL-P2C] the [ลองใหม่] button's server side.
 *
 * THE SITUATION THIS EXISTS FOR: a customer sends a slip, several bank
 * statements carry the same amount, and walletpay can only say "not this one".
 * The run pauses and offers [ลองใหม่]; tapping it must resume the SAME run at
 * the NEXT statement with the stored slip image. If this handler is wrong the
 * customer is stuck on statement #1 and the money never lands.
 *
 * WHY A SEPARATE HANDLER FROM THE HANDOFF CHAIN ONE (owner decision B): that one
 * is gated by `chainsEnabled`, so sharing it would let someone switching off
 * handoff chains silently kill the payment retry button while payment is still
 * on. These tests pin that independence.
 *
 * Pure function + injected deps ⇒ no Nest module, no DB, no LINE.
 */

const paused = (): PaymentResumeResult => ({
  ran: true,
  reply: {
    state: 'no_match_retry',
    kind: 'flex',
    text: 'ไม่พบรายการที่ตรงกับสลิปนี้',
    actions: ['retry', 'contact_admin'],
    detail: '-',
  },
});

const postback = (data: string) => ({
  type: 'postback',
  replyToken: 'unit-test-reply-token',
  postback: { data },
  source: { userId: 'unit-test-user-id' },
});

describe('[P2C] payment retry postback', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('resumes the run at the next statement and sends the reply', async () => {
    const resume = jest.fn().mockResolvedValue(paused());
    const sendReply = jest.fn().mockResolvedValue(undefined);

    const r = await handlePaymentPostback(
      postback(buildRetryPostbackData('RUN1', 4)),
      { paymentEnabled: true, resume, sendReply },
    );

    expect(r.handled).toBe(true);
    // The index comes from the PAYLOAD, so a double-tap re-requests the same
    // statement rather than skipping one.
    expect(resume).toHaveBeenCalledWith('RUN1', 4, 'unit-test-reply-token');
    expect(sendReply).toHaveBeenCalledTimes(1);
    expect(sendReply.mock.calls[0][0].state).toBe('no_match_retry');
  });

  it('ignores postbacks that are not ours — seamless fall-through', async () => {
    const resume = jest.fn();

    // The handoff chain's own payload must pass through untouched, or the two
    // features would eat each other's buttons.
    for (const data of ['hoc:resume:RUN1:2', 'something-else', '']) {
      const r = await handlePaymentPostback(postback(data), {
        paymentEnabled: true,
        resume,
      });
      expect(r.handled).toBe(false);
    }
    expect(resume).not.toHaveBeenCalled();
  });

  it('ignores non-postback events entirely', async () => {
    const r = await handlePaymentPostback(
      { type: 'message', postback: { data: 'pay:resume:RUN1:1' } },
      { paymentEnabled: true, resume: jest.fn() },
    );
    expect(r.handled).toBe(false);
  });

  it('does NOT depend on the handoff chain flag', async () => {
    // The whole point of owner decision B: payment's retry works with the
    // handoff chain feature entirely absent from the deps.
    const resume = jest.fn().mockResolvedValue(paused());

    const r = await handlePaymentPostback(
      postback(buildRetryPostbackData('RUN1', 1)),
      { paymentEnabled: true, resume }, // no chainsEnabled anywhere
    );

    expect(r.handled).toBe(true);
    expect(resume).toHaveBeenCalled();
  });

  it('consumes but does not act when payment is off for the hook', async () => {
    const resume = jest.fn();

    const r = await handlePaymentPostback(
      postback(buildRetryPostbackData('RUN1', 1)),
      { paymentEnabled: false, resume },
    );

    // Consumed so a raw `pay:resume:...` never reaches the customer or the AI,
    // but no money work happens with the tool switched off.
    expect(r.handled).toBe(true);
    expect(resume).not.toHaveBeenCalled();
  });

  it('fails closed on a malformed payload instead of resuming statement 0', async () => {
    // MONEY SAFETY: `parseInt('')` is NaN and a `|| 0` fallback would silently
    // re-POST statement 0 — a statement already tried. Every bad payload must
    // be swallowed without touching the runner.
    const resume = jest.fn();

    for (const data of [
      'pay:resume::2', // no runId
      'pay:resume:RUN1:', // no index
      'pay:resume:RUN1:abc', // non-numeric index
      'pay:resume:RUN1:-1', // negative index
      'pay:resume', // truncated
    ]) {
      const r = await handlePaymentPostback(postback(data), {
        paymentEnabled: true,
        resume,
      });
      expect(r.handled).toBe(true);
    }
    expect(resume).not.toHaveBeenCalled();
  });

  it('swallows an unknown payment action without calling the runner', async () => {
    const resume = jest.fn();
    const r = await handlePaymentPostback(postback('pay:cancel:RUN1'), {
      paymentEnabled: true,
      resume,
    });

    expect(r.handled).toBe(true);
    expect(resume).not.toHaveBeenCalled();
  });

  it('sends the resume reply with the FRESH token from this postback', async () => {
    // The paused run's own reply token died long ago — only the token on the
    // tap event can answer now. Pinning it because using the stale one would
    // fail silently and the customer would see nothing after tapping.
    const sendReply = jest.fn().mockResolvedValue(undefined);
    await handlePaymentPostback(postback(buildRetryPostbackData('RUN1', 2)), {
      paymentEnabled: true,
      resume: jest.fn().mockResolvedValue(paused()),
      sendReply,
    });

    expect(sendReply.mock.calls[0][1]).toEqual({
      replyToken: 'unit-test-reply-token',
      userId: 'unit-test-user-id',
    });
  });

  it('handles a resume that produced no reply', async () => {
    // e.g. the run was already finished by another delivery. Nothing to send,
    // and nothing may throw.
    const sendReply = jest.fn();
    const r = await handlePaymentPostback(
      postback(buildRetryPostbackData('RUN1', 2)),
      {
        paymentEnabled: true,
        resume: jest.fn().mockResolvedValue({ ran: false, skipped: 'no_run' }),
        sendReply,
      },
    );

    expect(r.handled).toBe(true);
    expect(sendReply).not.toHaveBeenCalled();
  });
});
