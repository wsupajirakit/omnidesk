/**
 * [FEAT-20260821-QUOTEREPLY] The admin console's send ladder, as a strategy the
 * module binds ONCE. Two strategies, one contract:
 *
 *   PushOnlySendStrategy   — today's behaviour. `dispatch` receives EXACTLY the
 *                            request the service built; nothing added, nothing
 *                            reordered. This is the permanent default and the
 *                            thing the owner can return to by flipping one env.
 *   ReplyReuseSendStrategy — tries the customer's reply token first (free quota),
 *                            falls back to push. Definite 4xx → next rung;
 *                            5xx/transport → STOP (delivery unknown; a second call
 *                            could deliver twice). A quoteToken rides on whichever
 *                            rung goes out; if LINE refuses it the last rung drops
 *                            the token and says so.
 *
 * The core is a stub here: these tests are about ORDER and ABSENCE of calls, not
 * the wire. ลำดับ + จำนวนครั้ง คือสิ่งที่ปัก.
 */
import { PushOnlySendStrategy, ReplyReuseSendStrategy } from '@/modules/chat';
import type { LineSendRequest, LineSendResult } from '@/infra/line';

type Script = Array<Partial<LineSendResult> & { ok: boolean }>;

function core(script: Script) {
  const calls: LineSendRequest[] = [];
  const dispatch = jest.fn((req: LineSendRequest): Promise<LineSendResult> => {
    calls.push(req);
    const next = script.shift() ?? { ok: true, status: 200 };
    return Promise.resolve({
      kind: req.kind,
      status: 200,
      attempts: 1,
      ...next,
    } as LineSendResult);
  });
  return { calls, dispatcher: { dispatch } };
}

const plan = (over: Record<string, unknown> = {}) => ({
  token: 'tok',
  to: 'Uabc',
  messages: [{ type: 'text', text: 'hi', quoteToken: 'qt-1' }],
  timeoutMs: 5000,
  ...over,
});

describe('PushOnlySendStrategy — byte-identical to today', () => {
  it('one push, the request is exactly what was handed in, and no reply is attempted', async () => {
    const { calls, dispatcher } = core([{ ok: true }]);
    const s = new PushOnlySendStrategy(dispatcher as never);
    const out = await s.send(plan(), { replyToken: 'rt-fresh', rowId: 'm1' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      kind: 'push',
      token: 'tok',
      to: 'Uabc',
      messages: [{ type: 'text', text: 'hi', quoteToken: 'qt-1' }],
      timeoutMs: 5000,
    });
    expect(out).toMatchObject({
      sentKind: 'push',
      quote: 'kept',
      replyTokenSpent: false,
    });
  });

  it('does not want a reply candidate, so the caller can skip the lookup entirely', () => {
    expect(
      new PushOnlySendStrategy(core([]).dispatcher as never)
        .wantsReplyCandidate,
    ).toBe(false);
  });

  it('push refused with a quote → one more push WITHOUT the token, result says dropped', async () => {
    const { calls, dispatcher } = core([
      { ok: false, status: 400 },
      { ok: true },
    ]);
    const out = await new PushOnlySendStrategy(dispatcher as never).send(
      plan(),
    );
    expect(calls.map((c) => c.kind)).toEqual(['push', 'push']);
    expect(JSON.stringify(calls[1]?.messages)).not.toContain('qt-1');
    expect(out).toMatchObject({ sentKind: 'push', quote: 'dropped' });
  });

  it('push refused WITHOUT a quote → no second call (nothing left to drop)', async () => {
    const { calls, dispatcher } = core([{ ok: false, status: 400 }]);
    const out = await new PushOnlySendStrategy(dispatcher as never).send(
      plan({ messages: [{ type: 'text', text: 'hi' }] }),
    );
    expect(calls).toHaveLength(1);
    expect(out.res.ok).toBe(false);
    expect(out.quote).toBe('none');
  });
});

describe('ReplyReuseSendStrategy — reply first, push second, never twice on "unknown"', () => {
  const make = (script: Script) => {
    const c = core(script);
    return { ...c, s: new ReplyReuseSendStrategy(c.dispatcher as never) };
  };

  it('wants a reply candidate', () => {
    expect(make([]).s.wantsReplyCandidate).toBe(true);
  });

  it('no candidate → behaves exactly like push-only (one push, same request)', async () => {
    const { calls, s } = make([{ ok: true }]);
    const out = await s.send(plan());
    expect(calls.map((c) => c.kind)).toEqual(['push']);
    expect(out).toMatchObject({ sentKind: 'push', replyTokenSpent: false });
  });

  it('fresh candidate + reply ok → ONE reply call, token marked spent, no push', async () => {
    const { calls, s } = make([{ ok: true }]);
    const out = await s.send(plan(), { replyToken: 'rt-1', rowId: 'm1' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      kind: 'reply',
      replyToken: 'rt-1',
      token: 'tok',
    });
    expect(calls[0]).not.toHaveProperty('to');
    expect(calls[0]?.messages).toEqual([
      { type: 'text', text: 'hi', quoteToken: 'qt-1' },
    ]);
    expect(out).toMatchObject({
      sentKind: 'reply',
      quote: 'kept',
      replyTokenSpent: true,
      spentRowId: 'm1',
    });
  });

  it('reply 400 (token dead) → push WITH the quote still attached', async () => {
    const { calls, s } = make([{ ok: false, status: 400 }, { ok: true }]);
    const out = await s.send(plan(), { replyToken: 'rt-old', rowId: 'm1' });
    expect(calls.map((c) => c.kind)).toEqual(['reply', 'push']);
    expect(calls[1]?.messages).toEqual([
      { type: 'text', text: 'hi', quoteToken: 'qt-1' },
    ]);
    expect(out).toMatchObject({
      sentKind: 'push',
      quote: 'kept',
      replyTokenSpent: false,
    });
  });

  it('reply 400 → push 400 (quote refused) → push without quote, says dropped', async () => {
    const { calls, s } = make([
      { ok: false, status: 400 },
      { ok: false, status: 400 },
      { ok: true },
    ]);
    const out = await s.send(plan(), { replyToken: 'rt-old', rowId: 'm1' });
    expect(calls.map((c) => c.kind)).toEqual(['reply', 'push', 'push']);
    expect(JSON.stringify(calls[2]?.messages)).not.toContain('qt-1');
    expect(out).toMatchObject({ sentKind: 'push', quote: 'dropped' });
  });

  it('reply 5xx → STOP. No push. Delivery is unknown and a push could duplicate', async () => {
    const { calls, s } = make([{ ok: false, status: 502 }]);
    const out = await s.send(plan(), { replyToken: 'rt-1', rowId: 'm1' });
    expect(calls.map((c) => c.kind)).toEqual(['reply']);
    expect(out.res.ok).toBe(false);
    expect(out).toMatchObject({ sentKind: 'reply', replyTokenSpent: false });
  });

  it('reply transport failure (status 0) → STOP for the same reason', async () => {
    const { calls, s } = make([{ ok: false, status: 0 }]);
    const out = await s.send(plan(), { replyToken: 'rt-1', rowId: 'm1' });
    expect(calls).toHaveLength(1);
    expect(out.res.ok).toBe(false);
  });

  it('the reply rung never carries X-Line-Retry-Key concerns: the request has no `to`', async () => {
    const { calls, s } = make([{ ok: true }]);
    await s.send(plan(), { replyToken: 'rt-1', rowId: 'm1' });
    expect(Object.keys(calls[0] ?? {}).sort()).toEqual([
      'kind',
      'messages',
      'replyToken',
      'timeoutMs',
      'token',
    ]);
  });
});
