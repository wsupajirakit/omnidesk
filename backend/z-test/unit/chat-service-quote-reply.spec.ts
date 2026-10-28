/**
 * [FEAT-20260821-QUOTEREPLY] The text/sticker send on the REAL ChatService:
 * `quote_of` → LINE quoteToken on the wire, our row remembers what it quoted and
 * what LINE said about it, and a plain send is untouched. The ladder here is the
 * real PushOnlySendStrategy (the default) unless a case says otherwise.
 */
import { Types } from 'mongoose';

import {
  ChatService,
  PushOnlySendStrategy,
  ReplyReuseSendStrategy,
} from '@/modules/chat';

const roomId = new Types.ObjectId();
const hookId = new Types.ObjectId();
const quotedId = new Types.ObjectId();
const ourId = new Types.ObjectId();
const SUPER = {
  userId: 'a0d00000000000000000000a',
  username: 'op1',
  roleName: 'superadmin',
} as never;

function build(
  opts: {
    strategy?: 'push' | 'reuse';
    quotedRow?: Record<string, unknown> | null;
    lineData?: unknown;
    script?: Array<{ ok: boolean; status: number }>;
  } = {},
) {
  const script = opts.script ?? [];
  const calls: Array<Record<string, unknown>> = [];
  const core = {
    dispatch: jest.fn((req: Record<string, unknown>) => {
      calls.push(req);
      const next = script.shift() ?? { ok: true, status: 200 };
      return Promise.resolve({
        ...next,
        attempts: 1,
        durationMs: 1,
        data: opts.lineData ?? {},
      });
    }),
  };
  const updates: Array<{ q: unknown; u: unknown }> = [];
  const chatMessageModel = {
    create: jest.fn().mockImplementation((doc: Record<string, unknown>) => {
      const row: Record<string, unknown> = { _id: ourId, ...doc };
      // a Mongoose document's `set()` — the service uses it to shape the response
      row['set'] = (patch: Record<string, unknown>) =>
        Object.assign(row, patch);
      return Promise.resolve(row);
    }),
    findOne: jest.fn((q: Record<string, unknown>) => {
      const chain = {
        sort: () => chain,
        select: () => chain,
        lean: () =>
          Promise.resolve('_id' in q ? (opts.quotedRow ?? null) : null),
      };
      return chain;
    }),
    updateOne: jest.fn((q: unknown, u: unknown) => {
      updates.push({ q, u });
      return { exec: () => Promise.resolve({ matchedCount: 1 }) };
    }),
  };
  const logs: Record<string, unknown>[] = [];
  const svc = new ChatService(
    {
      findById: jest.fn().mockResolvedValue({
        _id: roomId,
        hook_id: hookId,
        channel_type: 'line',
        line_user_id: 'Uabc',
      }),
    } as never,
    chatMessageModel as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {
      findById: jest.fn().mockResolvedValue({
        _id: hookId,
        alias: 'oa-1',
        channel_type: 'line',
        access_token: 'unit-test-token',
      }),
    } as never,
    { publish: jest.fn().mockResolvedValue(undefined) } as never,
    { safeDecrypt: jest.fn((v: unknown) => v) } as never,
    {} as never,
    /* [FIX-20260827-CGATECHANNEL] double ต้องมี `channelType` เหมือนตัวจริง
       (line-send-adapter.ts:92) — เกตของ chat อ่านค่านี้ */
    {
      getSendAdapter: jest.fn(() => ({
        channelType: 'line',
        send: jest.fn(),
      })),
    } as never,
    {
      createLog: jest.fn((r: Record<string, unknown>) => {
        logs.push(r);
        return Promise.resolve({});
      }),
    } as never,
    opts.strategy === 'reuse'
      ? new ReplyReuseSendStrategy(core as never)
      : new PushOnlySendStrategy(core as never),
  );
  const flush = () => new Promise((r) => setImmediate(r));
  return { svc, calls, updates, logs, chatMessageModel, flush };
}

describe('quote_of on a text send', () => {
  it('resolves the column token, puts it on the wire, records what we quoted + what LINE returned', async () => {
    const h = build({
      quotedRow: {
        _id: quotedId,
        quote_token: 'qt-cust',
        provider_msg_id: '625',
      },
      lineData: { sentMessages: [{ id: '999', quoteToken: 'qt-ours' }] },
    });
    const out = await h.svc.sendChatReply(
      String(roomId),
      undefined,
      { text: 'ตอบกลับ', quote_of: String(quotedId) },
      SUPER,
    );
    expect(h.calls).toHaveLength(1);
    // the response the console appends already carries the quote — no reload needed
    expect(out['data']).toMatchObject({
      quoted_provider_msg_id: '625',
      quote_token: 'qt-ours',
      provider_msg_id: '999',
    });
    expect(h.calls[0]).toMatchObject({
      kind: 'push',
      messages: [{ type: 'text', text: 'ตอบกลับ', quoteToken: 'qt-cust' }],
    });
    /* [FIX-20260909-SENDFIRST] the row is written AFTER LINE accepts, so what
       LINE said rides the INSERT — there is no second write to patch a row we
       had already created. Same three fields, same values, one round trip. */
    expect(h.chatMessageModel.create).toHaveBeenCalledTimes(1);
    expect(h.chatMessageModel.create.mock.calls[0]?.[0]).toMatchObject({
      provider_msg_id: '999',
      quote_token: 'qt-ours',
      quoted_provider_msg_id: '625',
    });
    expect(h.updates).toEqual([]);
    await h.flush();
    expect(h.logs[0]?.['payload_summary']).toMatchObject({
      send: { kind: 'push', quote: 'kept' },
    });
  });

  it('a pre-column row: the token comes out of raw_content, no backfill needed', async () => {
    const h = build({
      quotedRow: {
        _id: quotedId,
        provider_msg_id: '625',
        raw_content: {
          events: [{ message: { id: '625', quoteToken: 'qt-raw' } }],
        },
      },
    });
    await h.svc.sendChatReply(
      String(roomId),
      undefined,
      { text: 'hi', quote_of: String(quotedId) },
      SUPER,
    );
    expect(h.calls[0]).toMatchObject({
      messages: [{ type: 'text', text: 'hi', quoteToken: 'qt-raw' }],
    });
  });

  it('quote_of that resolves to nothing → 400, and NOTHING is sent (no silent plain message)', async () => {
    const h = build({ quotedRow: null });
    await expect(
      h.svc.sendChatReply(
        String(roomId),
        undefined,
        { text: 'hi', quote_of: String(quotedId) },
        SUPER,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(h.calls).toHaveLength(0);
  });

  it('LINE refuses the quoted push → resent plain, row does NOT claim a quote, log says dropped', async () => {
    const h = build({
      quotedRow: {
        _id: quotedId,
        quote_token: 'qt-cust',
        provider_msg_id: '625',
      },
      script: [
        { ok: false, status: 400 },
        { ok: true, status: 200 },
      ],
    });
    await h.svc.sendChatReply(
      String(roomId),
      undefined,
      { text: 'hi', quote_of: String(quotedId) },
      SUPER,
    );
    expect(
      h.calls.map((c) => JSON.stringify(c['messages']).includes('qt-cust')),
    ).toEqual([true, false]);
    expect(h.updates).toEqual([]); // no sentMessages in data and quote was dropped → nothing to record
    await h.flush();
    expect(
      h.logs.map(
        (r) => (r['payload_summary'] as { send: { quote: string } }).send.quote,
      ),
    ).toEqual(['kept', 'dropped']);
  });
});

describe('a plain text send is byte-identical to before', () => {
  it('no quote_of → one push, no quoteToken key, no lookup, no updateOne, no `send` in the summary… except the ladder tag', async () => {
    const h = build();
    await h.svc.sendChatReply(String(roomId), undefined, { text: 'hi' }, SUPER);
    expect(h.calls).toEqual([
      {
        kind: 'push',
        token: 'unit-test-token',
        to: 'Uabc',
        messages: [{ type: 'text', text: 'hi' }],
        timeoutMs: 5000,
      },
    ]);
    expect(h.chatMessageModel.findOne).not.toHaveBeenCalled();
    expect(h.updates).toEqual([]);
  });
});

describe('sticker + quote under reply-reuse', () => {
  it('live token → reply carries the sticker WITH the quote; the inbound row is stamped', async () => {
    const h = build({
      strategy: 'reuse',
      quotedRow: {
        _id: quotedId,
        quote_token: 'qt-cust',
        provider_msg_id: '625',
      },
    });
    // findOne without `_id` = the candidate lookup → give it a live token
    h.chatMessageModel.findOne.mockImplementation(
      (q: Record<string, unknown>) => {
        const chain = {
          sort: () => chain,
          select: () => chain,
          lean: () =>
            Promise.resolve(
              '_id' in q
                ? {
                    _id: quotedId,
                    quote_token: 'qt-cust',
                    provider_msg_id: '625',
                  }
                : { _id: quotedId, reply_token: 'rt-live' },
            ),
        };
        return chain;
      },
    );
    await h.svc.sendChatSticker(
      String(roomId),
      undefined,
      { packageId: '446', stickerId: '1988', quote_of: String(quotedId) },
      SUPER,
    );
    expect(h.calls[0]).toMatchObject({
      kind: 'reply',
      replyToken: 'rt-live',
      messages: [
        {
          type: 'sticker',
          packageId: '446',
          stickerId: '1988',
          quoteToken: 'qt-cust',
        },
      ],
    });
    expect(h.updates).toContainEqual({
      q: { _id: String(quotedId) },
      u: { $set: { reply_token_used_at: expect.any(Date) } },
    });
  });
});
