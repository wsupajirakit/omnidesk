/**
 * [FEAT-20260831-QUOTESRC] The call sites, not the helper.
 * ===========================================================================
 * `sentMessageIds` having the right shape proves nothing about whether a reply
 * path actually hands the ids to `logMessage` — that is a per-site edit, and a
 * per-site edit is exactly the kind that gets dropped in a merge. This drives a
 * REAL handler with a fake LINE response and reads what reached the history
 * write.
 *
 * The slip card stands in for the eleven sites that spread the ids into
 * `logMessage`: same response shape, same spread, same position in the object.
 * The second case is the one that matters for seamlessness — LINE answering
 * without `sentMessages` must produce the row this repo wrote yesterday, with
 * no extra keys at all. ส่งไม่ผ่าน = แถวเดิมเป๊ะ.
 */
import { handleSlipFlex } from '@/modules/webhook/slip-flex/slip-flex.handler';

const FLEX_DOC = {
  _id: 'flex-err-1',
  content_json: JSON.stringify({ type: 'bubble', body: { text: 'err' } }),
};

/** Swiftcheck's shape for a code-carrying failure — routes to the error card. */
const failWith = (code: string) => ({
  success: false,
  error: { code, message: `${code} from Swiftcheck` },
});

function makeDeps(lineData: unknown) {
  const logMessage = jest.fn().mockResolvedValue(undefined);
  return {
    logMessage,
    deps: {
      findFlexById: jest.fn().mockResolvedValue(FLEX_DOC),
      sendLineFlexReply: jest
        .fn()
        .mockResolvedValue({ status: 200, data: lineData }),
      persistWebhookLog: jest.fn().mockResolvedValue(undefined),
      logMessage,
      checkQrCode: jest.fn().mockResolvedValue(true),
      formatThaiDateTime: (d: unknown) => String(d),
      lineReplyEndpoint: 'https://api.line.me/v2/bot/message/reply',
    },
  };
}

const input = (over: Record<string, unknown> = {}) => ({
  slipVerifyResult: failWith('SLIP_PENDING'),
  hook: { flex_error: 'flex-err-1', flex_not_found: 'flex-404-1' },
  slipCreatedAt: new Date('2026-08-31T11:05:54Z'),
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

/* The SUCCESS card is a different write in the same file, and a mutation proved
   the error-card case above does not cover it: deleting the success site's spread
   left that case green. Two sites, two cases. คนละจุด ต้องคนละเทส. */
const SUCCESS_HOOK = {
  _id: 'h1',
  match_account: false,
  flex_success: 'flex-err-1',
  slip_check_out_of_time: null,
  slip_check_min_amount: null,
};

const verified = {
  success: true,
  data: {
    isDuplicate: false,
    matchedAccount: true,
    amountInSlip: 200,
    rawSlip: {
      transRef: '623212823975I000000B9790',
      amount: { amount: 200 },
      sender: { displayName: 'นาง ชนัญลดา จ' },
      receiver: { displayName: 'บริษัท วรรณสุข ไ' },
    },
  },
};

describe('the slip SUCCESS card records them too', () => {
  it('⭐ the id LINE returned for the success card reaches logMessage', async () => {
    const { deps, logMessage } = makeDeps({
      sentMessages: [{ id: '628999000111222333', quoteToken: 'qt-ok' }],
    });

    await handleSlipFlex(
      input({ slipVerifyResult: verified, hook: SUCCESS_HOOK }),
      deps,
    );

    expect(logMessage).toHaveBeenCalledTimes(1);
    expect(logMessage.mock.calls[0]![0]).toMatchObject({
      senderType: 'bot',
      providerMsgId: '628999000111222333',
      quoteToken: 'qt-ok',
    });
  });
});

describe('a bot card records the ids LINE returned for it', () => {
  it('⭐ the id and the quote token reach logMessage', async () => {
    const { deps, logMessage } = makeDeps({
      sentMessages: [{ id: '628874250056892966', quoteToken: 'qt-card' }],
    });

    await handleSlipFlex(input(), deps);

    expect(logMessage).toHaveBeenCalledTimes(1);
    expect(logMessage.mock.calls[0]![0]).toMatchObject({
      senderType: 'bot',
      messageType: 'flex',
      providerMsgId: '628874250056892966',
      quoteToken: 'qt-card',
    });
  });

  it('⭐ LINE answering without sentMessages leaves the row exactly as before — no keys', async () => {
    const { deps, logMessage } = makeDeps({ ok: true });

    await handleSlipFlex(input(), deps);

    const written = logMessage.mock.calls[0]![0] as Record<string, unknown>;
    expect('providerMsgId' in written).toBe(false);
    expect('quoteToken' in written).toBe(false);
    // and the row itself is still the row this path always wrote
    expect(written).toMatchObject({ senderType: 'bot', messageType: 'flex' });
  });
});
