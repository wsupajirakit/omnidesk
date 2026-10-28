/**
 * [FEAT-20260816-SLIPPENDINGCARD] Which card answers which Swiftcheck error code.
 *
 * The handler routes a failed verification by the error code Swiftcheck returns.
 * Two routes already existed and are PINNED here so this file also guards them:
 *   SLIP_NOT_FOUND   -> `hook.flex_not_found`
 *   VALIDATION_ERROR -> no card; the image falls through to normal media
 * The route added by this change:
 *   SLIP_PENDING     -> `hook.flex_error`
 *
 * SLIP_PENDING is the bank telling us the slip has not settled yet. Before this
 * change it fell into the catch-all "other error code" branch, which sends
 * nothing, so the customer received the ordinary image reply and an operator
 * picked up a case that resolves itself in minutes.
 */
/* [MERGE-20260816] dev wrote this import against the pre-restructure path
 * `@/modules/webhook/slip-flex.handler`. This lane moved the slip branch into
 * `webhook/slip-flex/` earlier today, and git's rename detection carried the
 * SOURCE file across the merge but cannot rewrite a new test's specifier.
 * Same module, same export — only the folder changed.
 * เส้นเดิมของ dev ชี้ path ก่อนจัดโฟลเดอร์ — ย้ายให้ตรงกับที่ไฟล์อยู่จริง */
import { handleSlipFlex } from '@/modules/webhook/slip-flex/slip-flex.handler';

const FLEX_DOC = {
  _id: 'flex-err-1',
  content_json: JSON.stringify({ type: 'bubble', body: { text: 'err' } }),
};

/** Swiftcheck's shape for a code-carrying failure. */
const failWith = (code: string) => ({
  success: false,
  error: { code, message: `${code} from Swiftcheck` },
});

function makeDeps() {
  const sendLineFlexReply = jest.fn().mockResolvedValue({
    status: 200,
    data: { ok: true },
  });
  const findFlexById = jest.fn().mockResolvedValue(FLEX_DOC);
  return {
    sendLineFlexReply,
    findFlexById,
    deps: {
      findFlexById,
      sendLineFlexReply,
      persistWebhookLog: jest.fn().mockResolvedValue(undefined),
      logMessage: jest.fn().mockResolvedValue(undefined),
      // the vision seam is off in production code; a truthy stub proves the
      // routes below never depend on it
      checkQrCode: jest.fn().mockResolvedValue(true),
      formatThaiDateTime: (d: unknown) => String(d),
      lineReplyEndpoint: 'https://api.line.me/v2/bot/message/reply',
    },
  };
}

const input = (over: Record<string, unknown> = {}) => ({
  slipVerifyResult: failWith('SLIP_PENDING'),
  hook: { flex_error: 'flex-err-1', flex_not_found: 'flex-404-1' },
  slipCreatedAt: new Date('2026-08-16T11:05:54Z'),
  slipRecordId: 'slip-1',
  userId: 'U1',
  mediaUrl: 'https://example.invalid/img',
  accessToken: 'token',
  replyToken: 'rt-1',
  eventId: 'ev-1',
  incomingType: 'image',
  baseUrl: 'https://example.invalid',
  logContext: {},
  ...over,
});

describe('[SLIPPENDINGCARD] error-code -> card routing', () => {
  it('(P1 TARGET) SLIP_PENDING answers with the configured error card', async () => {
    const { deps, sendLineFlexReply, findFlexById } = makeDeps();
    const r = await handleSlipFlex(input(), deps);

    expect(findFlexById).toHaveBeenCalledWith('flex-err-1');
    expect(sendLineFlexReply).toHaveBeenCalledTimes(1);
    expect(r.isFlexSent).toBe(true);
    // the image IS a slip — Swiftcheck read it and said "not settled yet"
    expect(r.isQrCodeSlip).toBe(true);
  });

  it('(P2 TARGET) the pending reason is recorded, not filed as damaged', async () => {
    const { deps } = makeDeps();
    const r = await handleSlipFlex(input(), deps);
    expect(String(r.slipCondition)).toMatch(/pending/i);
    expect(String(r.slipCondition)).not.toMatch(/damaged/i);
  });

  it('(P3 TARGET) with no error card configured nothing is sent and nothing throws', async () => {
    const { deps, sendLineFlexReply } = makeDeps();
    const r = await handleSlipFlex(
      input({ hook: { flex_not_found: 'flex-404-1' } }),
      deps,
    );
    expect(sendLineFlexReply).not.toHaveBeenCalled();
    expect(r.isFlexSent).toBe(false);
  });

  it('(P4 PIN) SLIP_NOT_FOUND still takes flex_not_found, not the error card', async () => {
    const { deps, findFlexById } = makeDeps();
    await handleSlipFlex(
      input({ slipVerifyResult: failWith('SLIP_NOT_FOUND') }),
      deps,
    );
    expect(findFlexById).toHaveBeenCalledWith('flex-404-1');
    expect(findFlexById).not.toHaveBeenCalledWith('flex-err-1');
  });

  it('(P5 PIN) VALIDATION_ERROR sends no card — the image is ordinary media', async () => {
    const { deps, sendLineFlexReply } = makeDeps();
    const r = await handleSlipFlex(
      input({ slipVerifyResult: failWith('VALIDATION_ERROR') }),
      deps,
    );
    expect(sendLineFlexReply).not.toHaveBeenCalled();
    expect(r.isQrCodeSlip).toBe(false);
  });

  it('(P6 PIN) an unrelated error code still sends nothing', async () => {
    const { deps, sendLineFlexReply } = makeDeps();
    const r = await handleSlipFlex(
      input({ slipVerifyResult: failWith('SOME_OTHER_CODE') }),
      deps,
    );
    expect(sendLineFlexReply).not.toHaveBeenCalled();
    expect(r.isFlexSent).toBe(false);
  });
});
