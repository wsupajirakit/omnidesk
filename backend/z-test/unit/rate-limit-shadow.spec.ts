/**
 * [FEAT-20260826-RLSHADOW] 📖 todo/task/26082026/todo5_26082026_a5-shadow-phase-split.md (เฟส 1 ชิ้น 1.1)
 * The shadow instrument: counts EXACTLY like the real limiter, but has no
 * authority to deny anyone — its whole output is a capped would-block log line.
 * ============================================================================
 * The six structural can't-break properties, as tests (not promises):
 *   P1.1 shadow + blocked verdict → never a 429, but the hit IS counted
 *   P1.2 next() is called BEFORE consume is even invoked (fire-and-forget)
 *   P1.3 would-block lines carry every field (raw XFF included) + own brake
 *   P1.4 both-off = byte-identical — including OLD fakes that predate the
 *        shadow getter (the bypass-spec pin's fake has no such method; the
 *        middleware must optional-call, or that pin dies of a TypeError)
 *   P1.5 ENABLED=true always wins — the real deny path, counted once, no log
 *   P1.6 bypass paths are invisible to shadow — LINE never counted, never logged
 * P1.6 and P1.4 pin absences (green before implement, by design); P1.1-P1.3
 * are the red-first set — they fail until the branch exists.
 */
import { Logger } from '@nestjs/common';

import { envSchema } from '@/config/env.schema';
import { buildGlobalRateLimitMiddleware } from '@/infra/rate-limit/global-rate-limit.middleware';

type FakeSvc = Parameters<typeof buildGlobalRateLimitMiddleware>[0];

const BLOCKED = { limited: true, current: 999, limit: 300, windowSeconds: 300 };
const ALLOWED = { limited: false, current: 3, limit: 300, windowSeconds: 300 };

function fakeReq(path: string, headers: Record<string, unknown> = {}): unknown {
  return { path, headers, ip: '172.19.0.9' };
}

function fakeRes(): { status: jest.Mock; jsonBodies: unknown[] } {
  const jsonBodies: unknown[] = [];
  const status = jest.fn(() => ({
    json: (b: unknown) => {
      jsonBodies.push(b);
    },
  }));
  return { status, jsonBodies };
}

const flush = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

afterEach(() => jest.restoreAllMocks());

// ── P1.1 · shadow counts but can never answer 429 ───────────────────────────
describe('⭐ P1.1 shadow on + verdict limited → no 429, hit still counted', () => {
  it('res is untouched, next runs, and consume("global", ip) was called', async () => {
    const consume = jest.fn(() => Promise.resolve(BLOCKED));
    const fake = {
      isGlobalEnabled: () => false,
      isGlobalShadowEnabled: () => true,
      resolveClientIp: () => '203.0.113.7',
      consume,
    } as unknown as FakeSvc;
    const res = fakeRes();
    let nexted = 0;
    buildGlobalRateLimitMiddleware(fake)(
      fakeReq('/api/tickets') as never,
      res as never,
      (() => {
        nexted += 1;
      }) as never,
    );
    await flush();
    expect(nexted).toBe(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(consume).toHaveBeenCalledTimes(1);
    expect(consume).toHaveBeenCalledWith('global', '203.0.113.7');
  });
});

// ── P1.2 · the request is released before the counting starts ───────────────
describe('⭐ P1.2 next() comes first — literally, not just "eventually"', () => {
  it('call order is [next, consume], and next never waits on the promise', () => {
    const calls: string[] = [];
    const fake = {
      isGlobalEnabled: () => false,
      isGlobalShadowEnabled: () => true,
      resolveClientIp: () => '203.0.113.7',
      consume: () => {
        calls.push('consume');
        return new Promise(() => undefined); // never settles — request must not care
      },
    } as unknown as FakeSvc;
    buildGlobalRateLimitMiddleware(fake)(
      fakeReq('/api/tickets') as never,
      fakeRes() as never,
      (() => {
        calls.push('next');
      }) as never,
    );
    expect(calls).toEqual(['next', 'consume']);
  });
});

// ── P1.3 · the log: would-block only, every field, its own brake ────────────
describe('⭐ P1.3 would-block log — fields complete, cap working', () => {
  const T0 = 4_000_000_000_000; // far beyond any real clock this suite could have stored

  function shadowFake(verdict: typeof BLOCKED): FakeSvc {
    return {
      isGlobalEnabled: () => false,
      isGlobalShadowEnabled: () => true,
      resolveClientIp: () => '203.0.113.7',
      consume: () => Promise.resolve(verdict),
    } as unknown as FakeSvc;
  }

  const REQ_HEADERS = {
    'x-forwarded-for': '198.51.100.1, 172.19.0.2, 172.19.0.3',
    'cf-connecting-ip': '198.51.100.1',
  };

  it('a blocked hit logs ONE line with every field, raw XFF included', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(T0);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    buildGlobalRateLimitMiddleware(shadowFake(BLOCKED))(
      fakeReq('/api/tickets/68aabbccdd/meta', REQ_HEADERS) as never,
      fakeRes() as never,
      (() => undefined) as never,
    );
    await flush();
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = warn.mock.calls[0]![0] as string;
    expect(msg.startsWith('[RL-SHADOW] ')).toBe(true);
    const p = JSON.parse(msg.slice('[RL-SHADOW] '.length)) as Record<
      string,
      unknown
    >;
    expect(p).toEqual({
      bucket: 'global',
      ip: '203.0.113.7',
      current: 999,
      limit: 300,
      windowSeconds: 300,
      xff: '198.51.100.1, 172.19.0.2, 172.19.0.3', // ดิบทั้งเส้น — วัตถุดิบของ A9-P0
      cfIp: '198.51.100.1',
      reqIp: '172.19.0.9',
      pathHead: '/api/tickets', // สอง segment พอแยก endpoint · id อยู่ segment 3 ไม่จด
    });
  });

  it('an ALLOWED verdict logs nothing — would-block only, normal traffic = silence', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    buildGlobalRateLimitMiddleware(shadowFake(ALLOWED))(
      fakeReq('/api/tickets', REQ_HEADERS) as never,
      fakeRes() as never,
      (() => undefined) as never,
    );
    await flush();
    expect(warn).not.toHaveBeenCalled();
  });

  it('⭐ the brake: a flood inside one second logs once; next second logs again', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(T0 + 60_000);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const mw = buildGlobalRateLimitMiddleware(shadowFake(BLOCKED));
    const fire = async (): Promise<void> => {
      mw(
        fakeReq('/api/tickets', REQ_HEADERS) as never,
        fakeRes() as never,
        (() => undefined) as never,
      );
      await flush();
    };
    await fire(); // logs
    await fire(); // same ms → capped
    await fire(); // still capped
    expect(warn).toHaveBeenCalledTimes(1);
    now.mockReturnValue(T0 + 61_001); // > 1s later
    await fire(); // logs again
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

// ── P1.4 · both-off is byte-identical, even for callers born before shadow ──
describe('⭐ P1.4 both-off = the exact code path of today', () => {
  it('an OLD-STYLE fake with NO shadow getter at all: next passes, nothing else runs, no throw', () => {
    const calls: string[] = [];
    // deliberately the same shape as the bypass-spec pin's fake — predates shadow
    const fake = {
      isGlobalEnabled: () => false,
      resolveClientIp: () => {
        calls.push('resolveClientIp');
        return '1.2.3.4';
      },
      consume: () => {
        calls.push('consume');
        return Promise.resolve(ALLOWED);
      },
    } as unknown as FakeSvc;
    let nexted = 0;
    buildGlobalRateLimitMiddleware(fake)(
      fakeReq('/api/tickets') as never,
      fakeRes() as never,
      (() => {
        nexted += 1;
      }) as never,
    );
    expect(nexted).toBe(1);
    expect(calls).toEqual([]);
  });

  it('shadow getter present but false: identical — consume never called', async () => {
    const consume = jest.fn(() => Promise.resolve(ALLOWED));
    const fake = {
      isGlobalEnabled: () => false,
      isGlobalShadowEnabled: () => false,
      resolveClientIp: () => '1.2.3.4',
      consume,
    } as unknown as FakeSvc;
    let nexted = 0;
    buildGlobalRateLimitMiddleware(fake)(
      fakeReq('/api/tickets') as never,
      fakeRes() as never,
      (() => {
        nexted += 1;
      }) as never,
    );
    await flush();
    expect(nexted).toBe(1);
    expect(consume).not.toHaveBeenCalled();
  });
});

// ── P1.5 · the real limiter always outranks the instrument ──────────────────
describe('⭐ P1.5 ENABLED=true wins — real deny path, counted once, no shadow log', () => {
  it('limited → 429 body unchanged, consume called exactly once', async () => {
    const consume = jest.fn(() => Promise.resolve(BLOCKED));
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const fake = {
      isGlobalEnabled: () => true,
      isGlobalShadowEnabled: () => true, // both on — real path must own the request
      resolveClientIp: () => '203.0.113.7',
      consume,
    } as unknown as FakeSvc;
    const res = fakeRes();
    let nexted = 0;
    buildGlobalRateLimitMiddleware(fake)(
      fakeReq('/api/tickets') as never,
      res as never,
      (() => {
        nexted += 1;
      }) as never,
    );
    await flush();
    expect(nexted).toBe(0);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.jsonBodies).toEqual([{ error: 'rate limit exceeded' }]);
    expect(consume).toHaveBeenCalledTimes(1); // no double count from shadow
    expect(warn).not.toHaveBeenCalled();
  });
});

// ── P1.6 · LINE stays invisible to the instrument ───────────────────────────
describe('⭐ P1.6 bypass paths: shadow neither counts nor logs them', () => {
  it.each([
    '/webhook',
    '/demo-oa-three/webhook',
    '/api/handoff/callback/pay_topup',
  ])('%s → no consume, no log', async (path) => {
    const consume = jest.fn(() => Promise.resolve(BLOCKED));
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const fake = {
      isGlobalEnabled: () => false,
      isGlobalShadowEnabled: () => true,
      resolveClientIp: () => '203.0.113.7',
      consume,
    } as unknown as FakeSvc;
    let nexted = 0;
    buildGlobalRateLimitMiddleware(fake)(
      fakeReq(path) as never,
      fakeRes() as never,
      (() => {
        nexted += 1;
      }) as never,
    );
    await flush();
    expect(nexted).toBe(1);
    expect(consume).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});

// ── P1.7 · เครื่องมือวัดพังเอง → request ต้องไม่รู้เรื่องเลย ─────────────────
// (ตรวจซ้ำรอบ 26/08 บ่าย: คุณสมบัติข้อ 3 — try/catch เงียบ — เดิมยังไม่มีเทสตรึง)
describe('⭐ P1.7 shadow internals fail → the request never notices', () => {
  it('resolveClientIp throws SYNC → nothing escapes, next once, consume never called', () => {
    const consume = jest.fn();
    const fake = {
      isGlobalEnabled: () => false,
      isGlobalShadowEnabled: () => true,
      resolveClientIp: () => {
        throw new Error('boom');
      },
      consume,
    } as unknown as FakeSvc;
    let nexted = 0;
    expect(() =>
      buildGlobalRateLimitMiddleware(fake)(
        fakeReq('/api/tickets') as never,
        fakeRes() as never,
        (() => {
          nexted += 1;
        }) as never,
      ),
    ).not.toThrow();
    expect(nexted).toBe(1);
    expect(consume).not.toHaveBeenCalled();
  });

  it('consume throws SYNC → same silence', () => {
    const fake = {
      isGlobalEnabled: () => false,
      isGlobalShadowEnabled: () => true,
      resolveClientIp: () => '203.0.113.7',
      consume: () => {
        throw new Error('redis client gone');
      },
    } as unknown as FakeSvc;
    let nexted = 0;
    expect(() =>
      buildGlobalRateLimitMiddleware(fake)(
        fakeReq('/api/tickets') as never,
        fakeRes() as never,
        (() => {
          nexted += 1;
        }) as never,
      ),
    ).not.toThrow();
    expect(nexted).toBe(1);
  });

  it('consume REJECTS async → swallowed by the trailing catch, no log', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const fake = {
      isGlobalEnabled: () => false,
      isGlobalShadowEnabled: () => true,
      resolveClientIp: () => '203.0.113.7',
      consume: () => Promise.reject(new Error('redis down')),
    } as unknown as FakeSvc;
    let nexted = 0;
    buildGlobalRateLimitMiddleware(fake)(
      fakeReq('/api/tickets') as never,
      fakeRes() as never,
      (() => {
        nexted += 1;
      }) as never,
    );
    await flush();
    expect(nexted).toBe(1);
    expect(warn).not.toHaveBeenCalled();
  });
});

// ── schema pin · flag ใหม่ default ปิด และค่าขยะ = ปิด ──────────────────────
describe('⭐ env schema: RATE_LIMIT_GLOBAL_SHADOW ships OFF', () => {
  const shape = envSchema.shape as unknown as Record<
    string,
    { parse: (v: unknown) => unknown }
  >;
  const parse = (v: unknown): unknown =>
    shape['RATE_LIMIT_GLOBAL_SHADOW']!.parse(v);

  it('absent / empty → false (ไม่ตั้ง env = ไม่มี shadow)', () => {
    expect(parse(undefined)).toBe(false);
    expect(parse('')).toBe(false);
  });

  it('only the truthy words turn it on — garbage stays OFF', () => {
    expect(parse('true')).toBe(true);
    expect(parse('false')).toBe(false);
    expect(parse('shadow')).toBe(false); // ค่าขยะเปิดเครื่องมือวัดไม่ได้
  });
});
