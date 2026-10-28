/**
 * [FEAT-20260821-RATELADDER] The strike counter + the escalation, on a fake
 * Redis and a fake limiter. What is pinned is ORDER and COUNT of the calls —
 * exactly which key, which TTL, which limits reach the limiter per message.
 *
 * Owner's decisions (21/08): one strike per limited WINDOW (not per blocked
 * message); strikes reset 12 h after the first; non-text types are charged but
 * answered nothing (that part lives in the webhook, this service only reports).
 */
import {
  DEFAULT_USER_RATE_LADDER,
  UserRateLadderService,
  type UserRateLadderConfig,
} from '@/modules/webhook';

type Call = { key: string; ttl: number };

function harness(
  opts: {
    strikes?: number;
    cfg?: Partial<UserRateLadderConfig>;
    script?: number[];
    peekScript?: number[];
  } = {},
) {
  const incr: Call[] = [];
  const gets: string[] = [];
  let strikes = opts.strikes ?? 0;
  const redis = {
    getCount: jest.fn((key: string): Promise<number | null> => {
      gets.push(key);
      return Promise.resolve(strikes);
    }),
    incrementWithTtl: jest.fn((key: string, ttl: number) => {
      incr.push({ key, ttl });
      strikes += 1;
      return Promise.resolve(strikes);
    }),
  };
  const script = [...(opts.script ?? [])];
  const peekScript = [...(opts.peekScript ?? [])];
  const limiterCalls: Array<{
    bucket: string;
    id: string;
    override?: unknown;
  }> = [];
  const peekCalls: Array<{
    bucket: string;
    id: string;
    override?: unknown;
  }> = [];
  const limiter = {
    consume: jest.fn(
      (
        bucket: string,
        id: string,
        override?: { limit: number; windowSeconds: number },
      ) => {
        limiterCalls.push({ bucket, id, override });
        const limit = override?.limit ?? 3;
        const windowSeconds = override?.windowSeconds ?? 30;
        const current = script.shift() ?? 1;
        return Promise.resolve({
          limited: current > limit,
          current,
          limit,
          windowSeconds,
        });
      },
    ),
    /* [FEAT-20260824-RATEPEEK] the read-only twin. Recorded SEPARATELY from
       `consume` so a test can assert which of the two was called — the whole
       safety property is that peek never reaches the writing one. */
    peek: jest.fn(
      (
        bucket: string,
        id: string,
        override?: { limit: number; windowSeconds: number },
      ) => {
        peekCalls.push({ bucket, id, override });
        const limit = override?.limit ?? 3;
        const windowSeconds = override?.windowSeconds ?? 30;
        const current = peekScript.shift() ?? 0;
        return Promise.resolve({
          limited: current > limit,
          current,
          limit,
          windowSeconds,
        });
      },
    ),
    limitsFor: () => ({ limit: 3, windowSeconds: 30 }),
  };
  const cfg = { ...DEFAULT_USER_RATE_LADDER, ...(opts.cfg ?? {}) };
  const svc = new UserRateLadderService(
    limiter as never,
    redis as never,
    { wsEnv: 'test' } as never,
    cfg,
  );
  return { svc, incr, gets, limiterCalls, peekCalls, redis, limiter };
}

describe("level 1 — a customer with no strikes is on today's exact path", () => {
  it('consume → limiter called with NO override; no strike written while under the limit', async () => {
    const h = harness({ script: [1] });
    const v = await h.svc.consume('U1', 'text');
    expect(h.limiterCalls).toEqual([
      { bucket: 'default', id: 'U1', override: undefined },
    ]);
    expect(v).toMatchObject({
      limited: false,
      level: 1,
      strikes: 0,
      counted: true,
    });
    expect(h.incr).toEqual([]);
  });

  /* [FEAT-20260823-STRIKE2H] 12 ชม. → 2 ชม. (เจ้าของสั่ง 23/08) — ลูกค้าที่
     พลาดครั้งเดียวกลับเป็นปกติภายในสองชั่วโมง แทนที่จะติดไปเกือบทั้งวัน. */
  it('the FIRST blocked message in a window writes exactly one strike with a 2 h TTL', async () => {
    const h = harness({ script: [4, 5, 6] }); // limit 3 → 4th, 5th, 6th are blocked
    const a = await h.svc.consume('U1', 'text');
    await h.svc.consume('U1', 'text');
    await h.svc.consume('U1', 'text');
    expect(a).toMatchObject({ limited: true, level: 1, strikeAdded: true });
    expect(h.incr).toEqual([
      { key: 'ratelimit-strike:test:U1', ttl: 2 * 3600 },
    ]); // once, not three times
  });
});

describe('escalation — the NEXT window after a strike runs at the next level', () => {
  it('1 strike → level 2: limiter gets ×2 window, halved max, NO key suffix (one counter per customer)', async () => {
    const h = harness({ strikes: 1, script: [1] });
    const v = await h.svc.consume('U1', 'text');
    expect(h.limiterCalls[0]?.override).toEqual({
      limit: 2,
      windowSeconds: 60,
    });
    expect(v).toMatchObject({ level: 2, strikes: 1 });
  });
  it('2 strikes → level 3 (×3) · 3 strikes → level 4 (×6) · 7 strikes → still level 4', async () => {
    for (const [s, mult] of [
      [2, 90],
      [3, 180],
      [7, 180],
    ] as const) {
      const h = harness({ strikes: s, script: [1] });
      await h.svc.consume('U1', 'text');
      expect(
        (h.limiterCalls[0]?.override as { windowSeconds: number })
          .windowSeconds,
      ).toBe(mult);
    }
  });
  it('a strike at level 2 is counted the same way — first blocked message only', async () => {
    const h = harness({ strikes: 1, script: [3, 4] }); // level-2 limit is 2 → 3rd and 4th blocked
    const a = await h.svc.consume('U1', 'text');
    const b = await h.svc.consume('U1', 'text');
    expect(a.strikeAdded).toBe(true);
    expect(b.strikeAdded).toBe(false);
    expect(h.incr).toHaveLength(1);
  });
});

describe('the switches', () => {
  it('ladder disabled → no strike read, no strike write, limiter called plainly', async () => {
    const h = harness({ strikes: 3, cfg: { enabled: false }, script: [4] });
    const v = await h.svc.consume('U1', 'text');
    expect(h.gets).toEqual([]);
    expect(h.incr).toEqual([]);
    expect(h.limiterCalls[0]?.override).toBeUndefined();
    expect(v).toMatchObject({ limited: true, level: 1 });
  });
  it('a type switched off → not counted: no limiter call, no strike, verdict says so', async () => {
    const h = harness({
      cfg: {
        countedTypes: {
          ...DEFAULT_USER_RATE_LADDER.countedTypes,
          sticker: false,
        },
      },
    });
    const v = await h.svc.consume('U1', 'sticker');
    expect(h.limiterCalls).toEqual([]);
    expect(v).toMatchObject({ limited: false, counted: false });
  });
  it('sticker counted by default (owner: ทุก event)', async () => {
    const h = harness({ script: [1] });
    const v = await h.svc.consume('U1', 'sticker');
    expect(h.limiterCalls).toHaveLength(1);
    expect(v.counted).toBe(true);
  });
  it('Redis down for the strike read → level 1, still charged (fail open, never closed)', async () => {
    const h = harness({ script: [1] });
    h.redis.getCount.mockResolvedValueOnce(null);
    const v = await h.svc.consume('U1', 'text');
    expect(v.level).toBe(1);
    expect(h.limiterCalls).toHaveLength(1);
  });

  it('⭐ no leak after a strike: the rest of the burst stays limited on the SAME counter and adds no strike', async () => {
    // base 3/30s. Counter climbs 4 (strike #1) → 5 → 6 on the same key; from
    // message 5 the level is 2 (limit 2), and 5 > 2, 6 > 2 — blocked, not a fresh window.
    const h = harness({ script: [4, 5, 6] });
    const a = await h.svc.consume('U1', 'text');
    const b = await h.svc.consume('U1', 'text');
    const c = await h.svc.consume('U1', 'text');
    expect([a.limited, b.limited, c.limited]).toEqual([true, true, true]);
    expect([a.level, b.level, c.level]).toEqual([1, 2, 2]);
    expect(h.incr).toHaveLength(1); // strike #1 only — 5 and 6 are not `limit + 1`
    for (const call of h.limiterCalls) {
      expect(
        (call.override as { keySuffix?: string } | undefined)?.keySuffix,
      ).toBeUndefined();
    }
  });
});

/**
 * [FEAT-20260824-RATEPEEK] `peek` — the same question `consume` answers, asked
 * without charging for it.
 *
 * WHY IT HAS TO BE PROVEN, NOT ASSUMED: the webhook charges the quota in exactly
 * one place, and that block says of itself "THIS BLOCK MUST EXIST EXACTLY ONCE.
 * The check is an INCR; a second copy would charge two units per message." A
 * peek that wrote anything would be that second copy, and the symptom would be a
 * customer hitting their limit at half the messages — silently, and only in
 * production. So the first case below is the load-bearing one.
 *
 * The rest prove peek and consume cannot answer about DIFFERENT windows: same
 * bucket, same identifier, same override at every level. If those drifted, the
 * caller would skip work based on a window nobody is actually counting.
 */
describe('[RATEPEEK] peek reads the ladder without moving it', () => {
  it('⭐ (T1) NEVER writes — no INCR, no strike, and consume is not called at all', async () => {
    const h = harness({ strikes: 2, peekScript: [9] });

    const v = await h.svc.peek('U1', 'text');

    expect(v.limited).toBe(true);
    // the two writing paths, both untouched
    expect(h.incr).toEqual([]);
    expect(h.limiter.consume).not.toHaveBeenCalled();
    // and it did ask the read-only twin
    expect(h.peekCalls).toHaveLength(1);
  });

  it('(T2) level 1 asks with NO override — the same call consume makes', async () => {
    const h = harness({ peekScript: [1] });

    await h.svc.peek('U1', 'text');

    expect(h.peekCalls).toEqual([
      { bucket: 'default', id: 'U1', override: undefined },
    ]);
  });

  it('⭐ (T3) with strikes, peek asks about the SAME window consume would charge', async () => {
    // one strike ⇒ level 2 ⇒ ×2 window, halved max. Both calls must carry it.
    const a = harness({ strikes: 1, peekScript: [1] });
    await a.svc.peek('U1', 'text');

    const b = harness({ strikes: 1, script: [1] });
    await b.svc.consume('U1', 'text');

    expect(a.peekCalls[0]?.override).toEqual(b.limiterCalls[0]?.override);
    expect(a.peekCalls[0]?.override).not.toBeUndefined();
  });

  it('(T4) an uncounted message type is never "limited" and never reaches Redis', async () => {
    const h = harness({
      cfg: { countedTypes: { text: true, image: false } },
      peekScript: [99],
    });

    const v = await h.svc.peek('U1', 'image');

    expect(v.limited).toBe(false);
    expect(h.peekCalls).toEqual([]);
    expect(h.redis.getCount).not.toHaveBeenCalled();
  });

  it('(T5) ladder switched off ⇒ level 1, no override — mirrors consume exactly', async () => {
    const h = harness({ cfg: { enabled: false }, strikes: 5, peekScript: [1] });

    const v = await h.svc.peek('U1', 'text');

    expect(v.level).toBe(1);
    expect(h.peekCalls).toEqual([
      { bucket: 'default', id: 'U1', override: undefined },
    ]);
    // the strike key is not even read when the ladder is off
    expect(h.gets).toEqual([]);
  });

  it('(P1 PIN) consume still writes — the refactor did not turn the writer read-only', async () => {
    // resolveLevel was lifted out of consume; this proves consume kept its INCR.
    const h = harness({ script: [4] });

    const v = await h.svc.consume('U1', 'text');

    expect(v.limited).toBe(true);
    expect(h.limiter.consume).toHaveBeenCalledTimes(1);
    expect(h.incr).toEqual([
      { key: 'ratelimit-strike:test:U1', ttl: 2 * 3600 },
    ]);
  });
});
