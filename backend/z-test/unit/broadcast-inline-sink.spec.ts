/**
 * [FEAT-20260822-BCASTINLINESINK] candidate E — what actually leaves for LINE.
 * ===========================================================================
 * A fake dispatcher captures the request instead of sending it, so the wire
 * shape is asserted rather than hoped for. This is the file that would catch
 * the two mistakes that cost the most here: a `to` list riding the broadcast
 * endpoint, and a personal card addressed to a batch.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { LineSendRequest, LineSendResult } from '@/infra/line';
import {
  InlineChunkSink,
  SEND_MATRIX,
  type BroadcastChunk,
  type ChunkMessageBuilder,
  type HookTokenReader,
} from '@/modules/content';

const CARD = {
  type: 'flex' as const,
  altText: 'Broadcast message',
  contents: {},
};

function fakeDispatcher(
  answer: LineSendResult | Error = {
    ok: true,
    status: 200,
    attempts: 1,
    durationMs: 5,
  },
) {
  const sent: LineSendRequest[] = [];
  return {
    sent,
    dispatch: (req: LineSendRequest): Promise<LineSendResult> => {
      sent.push(req);
      return answer instanceof Error
        ? Promise.reject(answer)
        : Promise.resolve(answer);
    },
  };
}

const tokens = (t = 'TOKEN'): HookTokenReader => ({
  tokenFor: () => Promise.resolve(t),
});
const cards = (
  n = 1,
  imagesReplaced = 0,
  unknownTags: string[] = [],
  /** Records what the sink handed the builder — see the OA case below. */
  seen?: { chunk?: unknown; hookId?: string },
): ChunkMessageBuilder => ({
  messagesFor: (chunk, hookId) => {
    if (seen) {
      seen.chunk = chunk;
      seen.hookId = hookId;
    }
    return {
      messages: Array.from({ length: n }, () => CARD),
      imagesReplaced,
      unknownTags,
    };
  },
});

const chunk = (to: string[], index = 0): BroadcastChunk => ({ index, to });
const req = (c: BroadcastChunk) => ({
  chunk: c,
  retryKey: 'run1:h1:0',
  hookId: 'h1',
  runId: 'run1',
});

// The class only needs `dispatch`, and typing the fake as the whole Nest
// provider would drag its constructor in for no gain.
const make = (
  d: ReturnType<typeof fakeDispatcher>,
  cell: (typeof SEND_MATRIX)[keyof typeof SEND_MATRIX],
  t: HookTokenReader = tokens(),
  m: ChunkMessageBuilder = cards(),
) => new InlineChunkSink(d as never, t, m, cell);

describe('InlineChunkSink — the multicast wire', () => {
  it('sends the chunk’s ids, the token and OUR retry key', async () => {
    const d = fakeDispatcher();
    const r = await make(d, SEND_MATRIX['multicast:plain']).send(
      req(chunk(['U1', 'U2'])),
    );

    expect(d.sent).toHaveLength(1);
    expect(d.sent[0]).toMatchObject({
      kind: 'multicast',
      token: 'TOKEN',
      to: ['U1', 'U2'],
      retryKey: 'run1:h1:0',
    });
    expect(r).toMatchObject({ ok: true, status: 200, sent: 2 });
  });

  it('🔴 never lets a `to` list ride the BROADCAST endpoint', async () => {
    /* `/message/broadcast` fans out to every friend of the OA. Attaching a
       recipient list there is a different request than the plan costed, and
       LINE would reject or ignore it. ท่อ broadcast ห้ามใส่รายชื่อ. */
    const d = fakeDispatcher();
    await make(d, SEND_MATRIX['broadcast:plain']).send(req(chunk([])));

    expect(d.sent[0]?.kind).toBe('broadcast');
    expect(d.sent[0]).not.toHaveProperty('to');
  });

  it('passes the card through untouched — the builder owns its shape', async () => {
    const d = fakeDispatcher();
    await make(d, SEND_MATRIX['multicast:plain']).send(req(chunk(['U1'])));
    expect(d.sent[0]?.messages).toEqual([CARD]);
  });

  it('does not mutate the chunk it was handed', async () => {
    const d = fakeDispatcher();
    const c = chunk(['U1', 'U2']);
    await make(d, SEND_MATRIX['multicast:plain']).send(req(c));
    (d.sent[0]?.to as string[]).push('U3');
    expect(c.to).toEqual(['U1', 'U2']);
  });
});

describe('InlineChunkSink — the builder is told WHICH OA', () => {
  it('🔴 passes `hookId` through to the builder', async () => {
    /* [FEAT-20260823-BCASTOAVARS] `hook_*` and `site_rules.*` differ per OA,
       and a chunk carries only {index,to} — so this argument is the ONLY way
       the builder can know whose values to use. The sink held `req.hookId` all
       along and simply did not pass it on, which is why every variable in
       every broadcast rendered `N/A`.

       ⚠️ WRITTEN BECAUSE A MUTATION SURVIVED. Deleting the argument broke
       nothing: the builder-side tests construct the builder directly, so they
       never exercise this hand-off. A seam proven on both sides separately is
       not a proven seam. ทดสอบสองฝั่งแยกกัน ไม่ได้แปลว่าตรงต่อกันจริง. */
    const d = fakeDispatcher();
    const seen: { chunk?: unknown; hookId?: string } = {};
    await make(
      d,
      SEND_MATRIX['multicast:plain'],
      tokens(),
      cards(1, 0, [], seen),
    ).send(req(chunk(['U1'])));

    expect(seen.hookId).toBe('h1');
    expect(seen.chunk).toMatchObject({ index: 0, to: ['U1'] });
  });
});

describe('InlineChunkSink — what the render measured comes back', () => {
  it('🔴 carries imagesReplaced and unknownTags out of the render', () => {
    /* These were computed and then dropped, which made `images_replaced: 0` in
       every history row mean "never counted" — indistinguishable from "every
       picture was fine". A counter that cannot say "I don't know" lies. */
    const d = fakeDispatcher();
    return make(
      d,
      SEND_MATRIX['multicast:plain'],
      tokens(),
      cards(1, 2, ['profile.missing']),
    )
      .send(req(chunk(['U1'])))
      .then((r) => {
        expect(r.imagesReplaced).toBe(2);
        expect(r.unknownTags).toEqual(['profile.missing']);
      });
  });

  it('reports 0 replacements as 0 — measured and clean, not unmeasured', async () => {
    const d = fakeDispatcher();
    const r = await make(d, SEND_MATRIX['multicast:plain']).send(
      req(chunk(['U1'])),
    );
    expect(r.imagesReplaced).toBe(0);
    // ไม่มี tag แปลกหน้า ⇒ ไม่ต้องมี field นี้เลย (absent ≠ 0)
    expect(r).not.toHaveProperty('unknownTags');
  });
});

describe('InlineChunkSink — failure is reported, never thrown', () => {
  it('a LINE error becomes a failed chunk with its reason', async () => {
    const d = fakeDispatcher({
      ok: false,
      status: 400,
      attempts: 1,
      durationMs: 3,
      reason: 'HTTP 400 - bad body',
    });
    const r = await make(d, SEND_MATRIX['multicast:plain']).send(
      req(chunk(['U1'])),
    );
    expect(r).toMatchObject({
      ok: false,
      status: 400,
      sent: 0,
      error: 'HTTP 400 - bad body',
    });
  });

  it('a 409 counts as delivered — core already resolves it that way', async () => {
    const d = fakeDispatcher({
      ok: true,
      status: 409,
      attempts: 2,
      durationMs: 9,
    });
    const r = await make(d, SEND_MATRIX['multicast:plain']).send(
      req(chunk(['U1', 'U2'])),
    );
    expect(r.ok).toBe(true);
    expect(r.sent).toBe(2);
  });

  it('🔴 a dispatcher that REJECTS does not take the campaign down', async () => {
    const d = fakeDispatcher(new Error('socket hang up'));
    const r = await make(d, SEND_MATRIX['multicast:plain']).send(
      req(chunk(['U1'])),
    );
    expect(r).toEqual({ ok: false, sent: 0, error: 'socket hang up' });
  });

  it('a token reader that throws is a failed chunk, not a crash', async () => {
    const d = fakeDispatcher();
    const bad: HookTokenReader = {
      tokenFor: () => Promise.reject(new Error('decrypt failed')),
    };
    const r = await make(d, SEND_MATRIX['multicast:plain'], bad).send(
      req(chunk(['U1'])),
    );
    expect(r.ok).toBe(false);
    expect(r.error).toBe('decrypt failed');
    expect(d.sent).toHaveLength(0);
  });

  it('refuses to send when the builder produced no message', async () => {
    const d = fakeDispatcher();
    const r = await make(
      d,
      SEND_MATRIX['multicast:plain'],
      tokens(),
      cards(0),
    ).send(req(chunk(['U1'])));
    expect(r.ok).toBe(false);
    expect(d.sent).toHaveLength(0);
  });

  it('an empty token still reaches core, which makes no call — by design', async () => {
    // Core answers {ok:false,status:0} for an empty token. Guessing the field
    // name is the documented trap here (dev-local §4b), so the failure must be
    // legible rather than a crash.
    const d = fakeDispatcher({
      ok: false,
      status: 0,
      attempts: 0,
      durationMs: 0,
    });
    const r = await make(d, SEND_MATRIX['multicast:plain'], tokens('')).send(
      req(chunk(['U1'])),
    );
    expect(d.sent[0]?.token).toBe('');
    expect(r.ok).toBe(false);
    expect(r.status).toBe(0);
  });
});

describe('candidate E — core stayed untouched', () => {
  /**
   * ⚠️ REWRITTEN. The positive half used to be `toMatch(/LinePushDispatcher/)`
   * on the source text, which a TYPE-ONLY import satisfies — it proved the word
   * was in the file, not that anything was injected. A reviewer said so, and
   * they were right: the behavioural proof is that the sink calls `dispatch`
   * and reaches nothing else, which the cases below assert directly.
   * ข้อความมีคำนั้น ≠ มีการฉีดจริง.
   *
   * The NEGATIVE half stays a source check on purpose. "This file must not
   * mention X" is a statement about the text, and no behaviour can prove an
   * absence — a passing test only shows the path was not taken today.
   */
  it('🔴 reaches the dispatcher, and reaches nothing else', async () => {
    const calls: string[] = [];
    const spy = new Proxy(
      {
        dispatch: () =>
          Promise.resolve({
            ok: true,
            status: 200,
            attempts: 1,
            durationMs: 1,
          }),
      },
      {
        get(target, prop: string) {
          calls.push(prop);
          return (target as Record<string, unknown>)[prop];
        },
      },
    );

    await make(spy as never, SEND_MATRIX['multicast:plain']).send(
      req(chunk(['U1'])),
    );

    // Exactly one member of the collaborator was touched, and it was `dispatch`.
    expect(calls).toEqual(['dispatch']);
  });

  it('names no way around the wrapper', () => {
    const code = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        'src/modules/content/broadcast-send/sinks/inline.sink.ts',
      ),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^[^\n'"`]*\/\/.*$/gm, (l) => l.slice(0, l.indexOf('//')));

    // Binding to the service would mean coming back here when phase 4 swaps
    // the queue; the wrapper is the seam. เผื่อท่อไว้แล้ว.
    expect(code).not.toMatch(/LinePushService/);
    // The shared queue binding belongs to core, not to one caller.
    expect(code).not.toMatch(/InlineLinePushQueue|line\.module/);
  });
});
