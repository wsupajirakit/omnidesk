/**
 * [FEAT-20260821-QUOTEREPLY] The owner's two warnings, pinned on the REAL
 * ChatMediaService driving the REAL ReplyReuseSendStrategy over a scripted core:
 *
 *   "เรื่อง 5+1 ยิ่งต้องระวัง reply ก่อนแล้ว push หรืออาจจะ push สองครั้งเหมือนเดิม
 *    เพราะว่ามันหมดอายุ reply"
 *   "เปิด ปิด dynamic reuse ง่ายๆ แล้วมันกลับไปเป็น push อย่างเดียว"
 *
 * 5+1 = two LINE calls by the batch planner. A reply token is single-use, so it
 * can only ever carry batch 0. Batch 1 is push in every branch — and when the
 * reply dies, batch 0 is pushed too, which is exactly today's two pushes.
 */
import { Types } from 'mongoose';

import {
  ChatMediaService,
  PushOnlySendStrategy,
  ReplyReuseSendStrategy,
} from '@/modules/chat';

const roomId = new Types.ObjectId();
const hookId = new Types.ObjectId();
const inboundId = new Types.ObjectId();

const mkFile = (n: number) =>
  ({
    originalname: `f${n}.jpg`,
    mimetype: 'image/jpeg',
    filename: `f${n}.jpg`,
    path: `/tmp/f${n}.jpg`,
    size: 10 + n,
  }) as never;
const files = (n: number) => Array.from({ length: n }, (_, i) => mkFile(i + 1));
const AUTH = { userId: 'a0d00000000000000000000a', username: 'op1' } as never;

type Scripted = Array<{ ok: boolean; status: number }>;

function build(
  strategyOf: (core: never) => unknown,
  script: Scripted,
  candidate: boolean,
) {
  const calls: Array<{
    kind: string;
    replyToken?: string;
    messages: unknown[];
  }> = [];
  const core = {
    dispatch: jest.fn(
      (req: { kind: string; replyToken?: string; messages: unknown[] }) => {
        calls.push(req);
        const next = script.shift() ?? { ok: true, status: 200 };
        return Promise.resolve({
          ...next,
          attempts: 1,
          durationMs: 1,
          data: {},
        });
      },
    ),
  };
  const stamped: unknown[] = [];
  const chatMessageModel = {
    create: jest
      .fn()
      .mockImplementation((doc: Record<string, unknown>) =>
        Promise.resolve({ _id: new Types.ObjectId(), ...doc }),
      ),
    // findReplyCandidate → the newest inbound row with a live token (or none)
    findOne: jest.fn(() => {
      const chain = {
        sort: () => chain,
        select: () => chain,
        lean: () =>
          Promise.resolve(
            candidate ? { _id: inboundId, reply_token: 'rt-live' } : null,
          ),
      };
      return chain;
    }),
    updateOne: jest.fn((q: unknown, u: unknown) => {
      stamped.push({ q, u });
      return { exec: () => Promise.resolve({ matchedCount: 1 }) };
    }),
  };
  const logs: Record<string, unknown>[] = [];
  const webhookLogService = {
    createLog: jest.fn((row: Record<string, unknown>) => {
      logs.push(row);
      return Promise.resolve({});
    }),
  };
  const service = new ChatMediaService(
    {
      findById: jest.fn().mockResolvedValue({
        _id: roomId,
        hook_id: hookId,
        channel_type: 'line',
        line_user_id: 'Uabc',
        channel_user_id: 'Uabc',
      }),
    } as never,
    chatMessageModel as never,
    {
      findById: jest.fn().mockResolvedValue({
        _id: hookId,
        alias: 'oa-1',
        channel_type: 'line',
        access_token: 'unit-test-token',
      }),
    } as never,
    {
      create: jest
        .fn()
        .mockImplementation(() =>
          Promise.resolve({ _id: new Types.ObjectId() }),
        ),
    } as never,
    { publish: jest.fn().mockResolvedValue(undefined) } as never,
    { safeDecrypt: jest.fn((v: unknown) => v) } as never,
    /* [FIX-20260827-CGATECHANNEL] double ต้องมี `channelType` เหมือนตัวจริง
       (line-send-adapter.ts:92) — เกตของ chat อ่านค่านี้เพื่อถามว่าคอร์ LINE
       ส่ง channel นี้ได้ไหม · ทำให้ของปลอมตรงกับของจริง ไม่ใช่ผ่อนเทสให้ผ่าน */
    {
      getSendAdapter: jest.fn(() => ({
        channelType: 'line',
        send: jest.fn(),
      })),
    } as never,
    {} as never,
    { publicBaseUrl: 'https://cdn.example.test', baseUrl: '' } as never,
    webhookLogService as never,
    strategyOf(core as never) as never,
  );
  const flush = () => new Promise((r) => setImmediate(r));
  return { service, calls, logs, stamped, chatMessageModel, flush };
}

const reuse = (core: never) => new ReplyReuseSendStrategy(core);
const pushOnly = (core: never) => new PushOnlySendStrategy(core);

describe('5+1 under reply-reuse — the token carries batch 0 only', () => {
  it('live token → batch 0 is a REPLY, batch 1 is a PUSH, token stamped spent, two log rows', async () => {
    const h = build(
      reuse,
      [
        { ok: true, status: 200 },
        { ok: true, status: 200 },
      ],
      true,
    );
    const out = await h.service.sendChatImage(
      String(roomId),
      undefined,
      files(5),
      'cap',
      AUTH,
    );
    expect(out).toMatchObject({ success: true });
    expect(h.calls.map((c) => c.kind)).toEqual(['reply', 'push']);
    expect(h.calls[0]).toMatchObject({ replyToken: 'rt-live' });
    expect(h.calls[1]).not.toHaveProperty('replyToken');
    // the owner's arrangement is untouched: [text, img1..4] then [img5]
    expect(h.calls[0]?.messages).toHaveLength(5);
    expect(h.calls[1]?.messages).toHaveLength(1);
    expect(h.stamped).toEqual([
      {
        q: { _id: String(inboundId) },
        u: { $set: { reply_token_used_at: expect.any(Date) } },
      },
    ]);
    await h.flush();
    expect(h.logs.map((r) => r['endpoint'])).toEqual([
      'https://api.line.me/v2/bot/message/reply',
      'https://api.line.me/v2/bot/message/push',
    ]);
    expect(
      h.logs.map((r) => (r['payload_summary'] as { send?: unknown }).send),
    ).toEqual([
      { kind: 'reply', quote: 'none' },
      { kind: 'push', quote: 'none' },
    ]);
  });

  it("token dead (reply 400) → push, push — exactly today's two calls, plus the dead reply's own error row", async () => {
    const h = build(
      reuse,
      [
        { ok: false, status: 400 },
        { ok: true, status: 200 },
        { ok: true, status: 200 },
      ],
      true,
    );
    const out = await h.service.sendChatImage(
      String(roomId),
      undefined,
      files(5),
      'cap',
      AUTH,
    );
    expect(out).toMatchObject({ success: true });
    expect(h.calls.map((c) => c.kind)).toEqual(['reply', 'push', 'push']);
    expect(h.stamped).toEqual([]); // nothing was spent
    await h.flush();
    expect(h.logs.map((r) => [r['endpoint'], r['status']])).toEqual([
      ['https://api.line.me/v2/bot/message/reply', 'error'],
      ['https://api.line.me/v2/bot/message/push', 'success'],
      ['https://api.line.me/v2/bot/message/push', 'success'],
    ]);
  });

  it('reply 5xx → STOP: no push for that batch, the error surfaces, batch 1 never starts', async () => {
    const h = build(reuse, [{ ok: false, status: 502 }], true);
    const out = await h.service.sendChatImage(
      String(roomId),
      undefined,
      files(5),
      'cap',
      AUTH,
    );
    expect(out).toMatchObject({ success: false });
    expect(h.calls.map((c) => c.kind)).toEqual(['reply']);
  });

  it('no live token → push, push, and the candidate lookup was the only extra read', async () => {
    const h = build(reuse, [], false);
    await h.service.sendChatImage(
      String(roomId),
      undefined,
      files(5),
      'cap',
      AUTH,
    );
    expect(h.calls.map((c) => c.kind)).toEqual(['push', 'push']);
    expect(h.chatMessageModel.findOne).toHaveBeenCalledTimes(1);
  });
});

describe('the switch — off means push only, and no lookup at all', () => {
  it('PushOnly: even with a live token in the room, push, push — and findOne is never called', async () => {
    const h = build(pushOnly, [], true);
    await h.service.sendChatImage(
      String(roomId),
      undefined,
      files(5),
      'cap',
      AUTH,
    );
    expect(h.calls.map((c) => c.kind)).toEqual(['push', 'push']);
    expect(h.chatMessageModel.findOne).not.toHaveBeenCalled();
    expect(h.stamped).toEqual([]);
    await h.flush();
    expect(
      h.logs.every(
        (r) => r['endpoint'] === 'https://api.line.me/v2/bot/message/push',
      ),
    ).toBe(true);
  });
});
