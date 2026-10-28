import { Logger } from '@nestjs/common';
import axios from 'axios';

import { LineSendAdapter } from '@/modules/chat';
import type { OutboundMessage, SendContext } from '@/modules/chat';
import { buildCustomerRegisterFlex, LineApiService } from '@/modules/webhook';
import {
  buildChatMessages,
  buildLinkedNoticeMessage,
  buildPaymentMessage,
  buildRegisterFlexMessage,
  buildReplyFlexMessage,
  buildReplyTextMessage,
} from '@/infra/line';

/**
 * ==== [FEAT-20260820-LINEPUSHADAPTERS] parity BY EXECUTION, not by copy ====
 *
 * The adapters spec (line-push-adapters.spec.ts) pins the new builders against
 * expectations TRANSCRIBED from the live senders. This file removes the human
 * from that loop wherever the live sender is importable: it RUNS the real
 * production code (LineSendAdapter, LineApiService, buildCustomerRegisterFlex)
 * with axios stubbed, captures the exact wire body it produces, and
 * deep-equals it against the new adapter's output. If either side drifts, this
 * goes red naming the case — no second truth, per line-flow-test §2.
 * fixture = ของจริงที่รันสด ไม่ใช่สำเนามือ.
 *
 * NOT provable by execution here (documented, not hidden):
 *  · broadcast `buildLineMessage` and hook-outbound `buildPayloadMessage` are
 *    module-PRIVATE (function/method) and their services need Mongo models to
 *    instantiate — those two stay transcription-pinned in the adapters spec
 *    with file:line cites, and become executable parity only in Phase 3 when
 *    the call sites themselves switch over.
 *  · the register altText 'ลงทะเบียนสมาชิก' lives at the handler CALL SITE
 *    (customer-register.handler.ts:291), not in the builder — transcribed.
 *
 * Same absolute no-network rule as every LINE spec: axios.post/get and fetch
 * reject by default; every case asserts what was captured.
 */

const FAKE_TOKEN = 'unit-test-not-a-real-channel-token';
const FAKE_USER_ID = 'unit-test-user-id';
const FAKE_REPLY_TOKEN = 'unit-test-reply-token';

/** Capture of one axios.post: the JSON body the live sender put on the wire. */
interface CapturedBody {
  to?: unknown;
  replyToken?: unknown;
  messages: Array<Record<string, unknown>>;
}

describe('parity by execution — live senders vs infra/line adapters', () => {
  let postSpy: jest.SpyInstance;

  beforeEach(() => {
    const reject = (target: unknown) =>
      Promise.reject(
        new Error(`unstubbed outbound request: ${String(target)}`),
      );
    postSpy = jest
      .spyOn(axios, 'post')
      .mockImplementation((url: unknown) => reject(url));
    jest.spyOn(axios, 'get').mockImplementation((url: unknown) => reject(url));
    jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input: RequestInfo | URL) =>
        reject(input instanceof Request ? input.url : String(input)),
      );
    // sendLineFlexReply logs the whole payload on every send — silenced.
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const lastBody = (): CapturedBody => {
    const calls = postSpy.mock.calls;
    const call = calls[calls.length - 1] as unknown[];
    return call[1] as CapturedBody;
  };

  const okOnce = () =>
    postSpy.mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      data: {},
      headers: {},
      config: {},
    });

  // ── candidate C: LineSendAdapter vs buildChatMessages ────────────────────

  const CHAT_CASES: Array<[string, OutboundMessage]> = [
    ['text', { kind: 'text', text: 'สวัสดีค่ะ' }],
    ['image without caption', { kind: 'image', imageUrl: 'https://x/a.jpg' }],
    [
      'image with caption',
      { kind: 'image', imageUrl: 'https://x/a.jpg', text: 'ตามนี้เลยค่ะ' },
    ],
    [
      'images with trailing caption',
      {
        kind: 'images',
        imageUrls: ['https://x/1.jpg', 'https://x/2.jpg', 'https://x/3.jpg'],
        text: 'ครบ 3 รูปค่ะ',
      },
    ],
    [
      'images with leading caption (textFirst overflow batch)',
      {
        kind: 'images',
        imageUrls: ['https://x/4.jpg'],
        text: 'ต่อจากชุดแรกนะคะ',
        textFirst: true,
      },
    ],
    ['sticker', { kind: 'sticker', packageId: '11537', stickerId: '52002734' }],
  ];

  it.each(CHAT_CASES)(
    'chat %s: the REAL LineSendAdapter wire body equals buildChatMessages',
    async (_label, msg) => {
      okOnce();
      const adapter = new LineSendAdapter();
      const ctx: SendContext = { to: FAKE_USER_ID, accessToken: FAKE_TOKEN };
      await adapter.send(ctx, msg);

      const body = lastBody();
      expect(body.to).toBe(FAKE_USER_ID);
      // the two sides never met: live adapter built one, new adapter the other
      expect(body.messages).toEqual(buildChatMessages(msg));
    },
  );

  // ── candidate A: LineApiService reply text/flex vs reply builders ────────

  it('reply text without quickReply: REAL sendLineReplyMessage equals buildReplyTextMessage', async () => {
    okOnce();
    await new LineApiService().sendLineReplyMessage(
      FAKE_TOKEN,
      FAKE_REPLY_TOKEN,
      'ระบบได้รับเรื่องแล้วค่ะ',
    );
    const body = lastBody();
    expect(body.replyToken).toBe(FAKE_REPLY_TOKEN);
    expect(body.messages).toEqual([
      buildReplyTextMessage('ระบบได้รับเรื่องแล้วค่ะ'),
    ]);
  });

  it('reply text WITH quickReply: quickReply rides inside the message on both sides', async () => {
    okOnce();
    const quickReply = { items: [{ type: 'action' }] };
    await new LineApiService().sendLineReplyMessage(
      FAKE_TOKEN,
      FAKE_REPLY_TOKEN,
      'เลือกได้เลยค่ะ',
      quickReply,
    );
    expect(lastBody().messages).toEqual([
      buildReplyTextMessage('เลือกได้เลยค่ะ', quickReply),
    ]);
  });

  it('reply flex with the DEFAULT altText: both sides say "Bank Transfer Details"', async () => {
    okOnce();
    const contents = { type: 'bubble', body: { type: 'box' } };
    await new LineApiService().sendLineFlexReply(
      FAKE_TOKEN,
      FAKE_REPLY_TOKEN,
      contents,
    );
    expect(lastBody().messages).toEqual([buildReplyFlexMessage(contents)]);
  });

  it('reply flex with Thai altText + quickReply: equal', async () => {
    okOnce();
    const contents = { type: 'bubble' };
    const quickReply = { items: [] };
    await new LineApiService().sendLineFlexReply(
      FAKE_TOKEN,
      FAKE_REPLY_TOKEN,
      contents,
      'รายละเอียดการโอนเงิน',
      quickReply,
    );
    expect(lastBody().messages).toEqual([
      buildReplyFlexMessage(contents, 'รายละเอียดการโอนเงิน', quickReply),
    ]);
  });

  // ── candidates B + F: push text/flex vs payment & customer-link builders ─

  it('push text: REAL sendLinePushMessage equals buildPaymentMessage(text) and buildLinkedNoticeMessage', async () => {
    okOnce();
    await new LineApiService().sendLinePushMessage(
      FAKE_TOKEN,
      FAKE_USER_ID,
      'เชื่อมต่อสำเร็จแล้วค่ะ',
    );
    const body = lastBody();
    expect(body.to).toBe(FAKE_USER_ID);
    expect(body.messages).toEqual([
      buildPaymentMessage({ kind: 'text', text: 'เชื่อมต่อสำเร็จแล้วค่ะ' }),
    ]);
    expect(body.messages).toEqual([
      buildLinkedNoticeMessage('เชื่อมต่อสำเร็จแล้วค่ะ'),
    ]);
  });

  it('push flex: REAL sendLinePushFlexMessage equals buildPaymentMessage(flex), default and custom altText', async () => {
    okOnce();
    const contents = { type: 'bubble' };
    await new LineApiService().sendLinePushFlexMessage(
      FAKE_TOKEN,
      FAKE_USER_ID,
      contents,
    );
    expect(lastBody().messages).toEqual([
      buildPaymentMessage({ kind: 'flex', flexContents: contents }),
    ]);

    okOnce();
    await new LineApiService().sendLinePushFlexMessage(
      FAKE_TOKEN,
      FAKE_USER_ID,
      contents,
      'แจ้งสถานะยอดเงิน',
    );
    expect(lastBody().messages).toEqual([
      buildPaymentMessage({
        kind: 'flex',
        flexContents: contents,
        altText: 'แจ้งสถานะยอดเงิน',
      }),
    ]);
  });

  // ── candidate G: the register bubble, function against function ──────────

  it('register bubble: buildRegisterFlexMessage.contents === the REAL buildCustomerRegisterFlex output', () => {
    const url = 'https://liff.line.me/xxx?t=unit-test-token';
    const live = buildCustomerRegisterFlex(url);
    const mine = buildRegisterFlexMessage(url);
    expect(mine['contents']).toEqual(live);
    // altText is set at the handler call site, not in the builder — pinned
    // from customer-register.handler.ts:291.
    expect(mine['altText']).toBe('ลงทะเบียนสมาชิก');
  });
});
