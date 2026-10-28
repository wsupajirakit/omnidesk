import { Logger } from '@nestjs/common';

import { handleSlipFlex } from '@/modules/webhook/slip-flex/slip-flex.handler';

/**
 * [FEAT-20260808-PAYTOOL-P3] `suppressSlipReply` — the "one slip, one answer"
 * rule.
 *
 * THE SITUATION: when the payment tool is ON it answers the slip itself. If the
 * legacy slip card ALSO went out, the customer would get two cards for one slip
 * — one from payment, one from Swiftcheck — saying different things.
 *
 * WHAT THIS PINS, and why each half matters:
 *   · suppressed ⇒ NO card is SENT.
 *   · suppressed ⇒ `isFlexSent` is STILL true. That flag is what the caller
 *     keys `handleSlipCallback` on — the DEPOSIT CALLBACK. Money must not depend
 *     on whether a card was displayed. Flipping it to false would silently stop
 *     credits: the exact bug this test exists to prevent.
 *   · not suppressed ⇒ byte-identical to before the flag existed (the default),
 *     which is what keeps every hook WITHOUT payment untouched.
 */

const FLEX_DOC = {
  _id: 'flex-1',
  content_json: JSON.stringify({
    type: 'bubble',
    body: { text: '{{amount}}' },
  }),
};

/** A Swiftcheck success result — the path that selects and sends the card. */
const successResult = () => ({
  success: true,
  data: {
    amountInSlip: 100,
    isDuplicate: false,
    rawSlip: {
      date: '2026-08-09T10:00:00Z',
      transRef: 'TR1',
      amount: { amount: 100 },
      sender: { bank: { name: 'BBL' }, account: { name: { th: 'ก' } } },
      receiver: { bank: { name: 'KBANK' }, account: { name: { th: 'ข' } } },
    },
  },
});

function makeDeps() {
  const sendLineFlexReply = jest.fn().mockResolvedValue({
    status: 200,
    data: { ok: true },
  });
  const persistWebhookLog = jest.fn().mockResolvedValue(undefined);
  return {
    sendLineFlexReply,
    persistWebhookLog,
    deps: {
      findFlexById: jest.fn().mockResolvedValue(FLEX_DOC),
      sendLineFlexReply,
      persistWebhookLog,
      logMessage: jest.fn().mockResolvedValue(undefined),
      checkQrCode: jest.fn().mockResolvedValue(true),
      formatThaiDateTime: (d: unknown) => String(d),
      lineReplyEndpoint: 'https://api.line.me/v2/bot/message/reply',
    },
  };
}

const baseInput = (over: Record<string, unknown> = {}) => ({
  slipVerifyResult: successResult(),
  hook: { flex_success: 'flex-1' },
  slipCreatedAt: new Date('2026-08-09T10:00:00Z'),
  userId: 'unit-test-user-id',
  mediaUrl: 'https://example.invalid/slip.jpg',
  accessToken: 'unit-test-not-a-real-channel-token',
  replyToken: 'unit-test-reply-token',
  eventId: 'evt-1',
  incomingType: 'image',
  baseUrl: 'https://example.invalid',
  logContext: {},
  ...over,
});

describe('[P3] suppressSlipReply — one slip, one answer', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('does NOT send the card when payment already answered', async () => {
    const { sendLineFlexReply, deps } = makeDeps();

    const r = await handleSlipFlex(
      baseInput({ suppressSlipReply: true }) as never,
      deps,
    );

    expect(sendLineFlexReply).not.toHaveBeenCalled();
    expect(r.isFlexSent).toBe(true); // ⬅ see next test for why
  });

  it('⭐ still reports isFlexSent — the deposit callback must not be lost', async () => {
    // LOAD-BEARING. The caller fires `handleSlipCallback` (the deposit credit)
    // only when `isFlexSent` is true. If suppression flipped this to false, the
    // customer would be answered by payment but never credited by the callback.
    // ถ้าเป็น false ตอน suppress = callback ไม่ยิง = เครดิตหาย.
    const { deps } = makeDeps();

    const suppressed = await handleSlipFlex(
      baseInput({ suppressSlipReply: true }) as never,
      deps,
    );
    const normal = await handleSlipFlex(
      baseInput({ suppressSlipReply: false }) as never,
      makeDeps().deps,
    );

    expect(suppressed.isFlexSent).toBe(normal.isFlexSent);
    expect(suppressed.isFlexSent).toBe(true);
  });

  it('sends the card normally when payment did not answer (the default)', async () => {
    // The path every hook WITHOUT the payment tool takes. Must be unchanged.
    const { sendLineFlexReply, deps } = makeDeps();

    const r = await handleSlipFlex(baseInput() as never, deps);

    expect(sendLineFlexReply).toHaveBeenCalledTimes(1);
    expect(r.isFlexSent).toBe(true);
  });

  it('omitting the flag behaves exactly as passing false', async () => {
    // Byte-identical default: an existing caller that never heard of this flag
    // must be unaffected by its introduction.
    const a = makeDeps();
    const b = makeDeps();

    await handleSlipFlex(baseInput() as never, a.deps);
    await handleSlipFlex(
      baseInput({ suppressSlipReply: false }) as never,
      b.deps,
    );

    expect(a.sendLineFlexReply.mock.calls.length).toBe(
      b.sendLineFlexReply.mock.calls.length,
    );
  });

  it('still writes the audit row when suppressed, marked as such', async () => {
    // The operator must be able to see WHICH card was selected and why it was
    // not sent — otherwise a suppressed slip looks like a slip that was ignored.
    const { persistWebhookLog, deps } = makeDeps();

    await handleSlipFlex(baseInput({ suppressSlipReply: true }) as never, deps);

    const row = persistWebhookLog.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((e) => e['action_type'] === 'slip_flex_reply');

    expect(row).toBeDefined();
    expect(row!['status']).toBe('suppressed');
    // No HTTP call was made, so there is no status to report.
    expect(row!['http_status']).toBeUndefined();
    expect(
      (row!['payload_summary'] as Record<string, unknown>)['suppressed_by'],
    ).toBe('payment_tool_replied');
  });

  /* ==== [FIX-20260810-SUPPRESSHISTORY] history must match what was received ====
   * Reported by the owner: Swiftcheck verified a slip, topup answered `fail`
   * ("บัญชีผู้รับไม่ตรงบัญชีระบบ"), the customer correctly got the FAIL reply — and
   * chat history recorded "สลิปถูกต้อง". An admin reading that concludes the top-up
   * succeeded. Owner's rule: "ต้องเก็บเหมือนที่ลูกค้าได้รับ".
   * See `todo/be_todo21_10082026.md`. */

  it('⭐ does NOT write chat history for a card it never sent', async () => {
    const { deps } = makeDeps();

    await handleSlipFlex(baseInput({ suppressSlipReply: true }) as never, deps);

    // The audit row above still records the decision; the CONVERSATION must not
    // claim the customer was shown a success card they never received.
    expect(deps.logMessage).not.toHaveBeenCalled();
  });

  it('still writes chat history on the normal path (no regression)', async () => {
    const { deps } = makeDeps();

    await handleSlipFlex(baseInput() as never, deps);

    expect(deps.logMessage).toHaveBeenCalledTimes(1);
    const row = deps.logMessage.mock.calls[0][0] as Record<string, unknown>;
    expect(row['senderType']).toBe('bot');
    expect(row['messageType']).toBe('flex');
    expect(
      (row['metadata'] as Record<string, unknown>)['auto_reply_type'],
    ).toBe('slip_flex_reply');
  });
});
