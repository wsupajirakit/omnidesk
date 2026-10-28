/**
 * [TEST-20260814-SITERULESCACHE] The cache policy — who gets cached, for how long.
 *
 * The load-bearing cases are the NEGATIVE ones: profile / link / topup must
 * answer exactly what they answered before this feature existed, or a cached
 * balance reaches a customer. Those are pinned first and hardest.
 * เคสสำคัญคือเส้นอื่นต้องไม่เปลี่ยน ไม่ใช่แค่ site rules ทำงาน.
 */

import {
  SITE_RULES_DEFAULT_TTL_SEC,
  isSiteRulesEndpoint,
  resolveCacheTtlSec,
  shouldUseCache,
} from '@/modules/external';

/** The four endpoints of the live tool `Shop-API v1 (ของจริง)`, read from the DB
 *  on 2026-08-13. Every `cache_ttl_sec` really is null, and SITE_RULES really
 *  does carry an empty role — that pair is why this feature needs a key check. */
const LIVE_ENDPOINTS = [
  { key: 'CUSTOMER_PROFILE', role: 'profile', cache_ttl_sec: null },
  { key: 'CUSTOMER_LINK', role: 'link', cache_ttl_sec: null },
  { key: 'SITE_RULES', role: '', cache_ttl_sec: null },
  { key: 'PAY_TOPUP', role: 'pay_topup', cache_ttl_sec: null },
];

describe('[SITE RULES CACHE] every OTHER endpoint keeps firing live', () => {
  it('⭐ profile is never cached — a stale balance is worse than any call', () => {
    const profile = LIVE_ENDPOINTS[0]!;
    expect(isSiteRulesEndpoint(profile)).toBe(false);
    expect(resolveCacheTtlSec(profile)).toBe(0);
    expect(shouldUseCache(profile)).toBe(false);
  });

  it('link / topup / walletpay are untouched too', () => {
    for (const ep of [
      LIVE_ENDPOINTS[1]!,
      LIVE_ENDPOINTS[3]!,
      { key: 'PAY_WALLETPAY', role: 'pay_walletpay', cache_ttl_sec: null },
      { key: 'LOGIN', role: 'login', cache_ttl_sec: null },
      { key: 'REFRESH', role: 'refresh', cache_ttl_sec: null },
      { key: 'CUSTOMER_UNLINK', role: 'unlink', cache_ttl_sec: null },
    ]) {
      expect(shouldUseCache(ep)).toBe(false);
    }
  });

  it('⭐ the old rule still holds for everyone: a configured TTL is honoured', () => {
    // Rule 1 outranks the site-rules fallback, so an operator value keeps its
    // pre-existing meaning on ANY endpoint — this change adds, never redefines.
    expect(
      resolveCacheTtlSec({ key: 'CUSTOMER_PROFILE', cache_ttl_sec: 60 }),
    ).toBe(60);
    expect(shouldUseCache({ key: 'CUSTOMER_PROFILE', cache_ttl_sec: 60 })).toBe(
      true,
    );
  });
});

describe('[SITE RULES CACHE] site rules are identified both ways', () => {
  it('⭐ by KEY when the role is empty — the live production shape', () => {
    // If this ever regresses to a role-only check the feature becomes dead code
    // and nobody would notice, because "no cache" looks exactly like today.
    const siteRules = LIVE_ENDPOINTS[2]!;
    expect(siteRules.role).toBe(''); // guard: the fixture still models reality
    expect(isSiteRulesEndpoint(siteRules)).toBe(true);
    expect(shouldUseCache(siteRules)).toBe(true);
  });

  it('by ROLE, for tools authored with roles', () => {
    expect(isSiteRulesEndpoint({ key: 'ANYTHING', role: 'site_rules' })).toBe(
      true,
    );
  });

  it('key spellings the service already tolerates', () => {
    for (const key of ['SITE_RULES', 'siteRules', 'site-rule', 'Site_Rule']) {
      expect(isSiteRulesEndpoint({ key, role: '' })).toBe(true);
    }
  });

  it('a role with stray whitespace still counts', () => {
    expect(isSiteRulesEndpoint({ key: 'X', role: ' site_rules ' })).toBe(true);
  });
});

describe('[SITE RULES CACHE] the 30-second fallback', () => {
  it('⭐ applies when cache_ttl_sec is null — which is EVERY live row today', () => {
    expect(resolveCacheTtlSec(LIVE_ENDPOINTS[2])).toBe(
      SITE_RULES_DEFAULT_TTL_SEC,
    );
    // [FIX-20260821-SITERULESTTL] 1800 -> 30. Site rules now decide which
    // maintenance card the customer receives, so a 30-minute snapshot could
    // announce a shutdown that was already lifted. revert: back to 1800.
    expect(SITE_RULES_DEFAULT_TTL_SEC).toBe(30);
  });

  it('applies for undefined / 0 / negative / non-numeric too', () => {
    // `custom-tool-normalize.ts` drops the field on save, so "absent" is the
    // normal state, not an edge case.
    for (const cache_ttl_sec of [
      undefined,
      0,
      -1,
      NaN,
      'abc' as unknown as number,
    ]) {
      expect(resolveCacheTtlSec({ key: 'SITE_RULES', cache_ttl_sec })).toBe(
        SITE_RULES_DEFAULT_TTL_SEC,
      );
    }
  });

  it('a configured TTL on site rules wins over the fallback', () => {
    expect(resolveCacheTtlSec({ key: 'SITE_RULES', cache_ttl_sec: 90 })).toBe(
      90,
    );
  });
});

describe('[SITE RULES CACHE] never throws — junk in, live-fetch out', () => {
  it('null / undefined / empty object answer "no cache" instead of throwing', () => {
    for (const ep of [null, undefined, {}]) {
      expect(() => shouldUseCache(ep as never)).not.toThrow();
      expect(shouldUseCache(ep as never)).toBe(false);
    }
  });

  it('non-string key or role does not throw', () => {
    const junk = {
      key: 42 as unknown as string,
      role: {} as unknown as string,
    };
    expect(() => isSiteRulesEndpoint(junk)).not.toThrow();
    expect(isSiteRulesEndpoint(junk)).toBe(false);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * [TEST-20260814-SITERULESCACHE] single-flight — one fetch per cold cache
 *
 * The point of these cases is the count: N callers must produce ONE upstream
 * call. The failure modes that matter are a stampede (N calls) and a hang
 * (a follower waiting forever) — both are pinned below.
 * ──────────────────────────────────────────────────────────────────────────── */

import { runSingleFlight } from '@/modules/external';

/** In-memory stand-in for the Redis client, honouring NX like the real one. */
function fakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    get: (k: string) => Promise.resolve(store.get(k) ?? null),
    /* Mirrors the real ioredis call shape `set(key, val, 'PX', ttl, 'NX')`.
       The mode arg is honoured rather than ignored, so a caller that forgets
       NX would not silently pass here. */
    set: (k: string, v: string, _px?: string, _ttl?: number, nx?: string) => {
      if (nx === 'NX' && store.has(k)) return Promise.resolve(null);
      store.set(k, v);
      return Promise.resolve('OK');
    },
    del: (k: string) => {
      store.delete(k);
      return Promise.resolve(1);
    },
  };
}

describe('[SITE RULES SINGLE-FLIGHT] N callers, one upstream call', () => {
  it('⭐ five simultaneous callers fetch ONCE and all get the same value', async () => {
    const redis = fakeRedis();
    let cached: string | null = null;
    let upstreamCalls = 0;

    const call = () =>
      runSingleFlight<string>({
        redis,
        cacheKey: 'custool:shared:t1:SITE_RULES:web1',
        readCache: () => Promise.resolve(cached),
        fetchFn: async () => {
          upstreamCalls += 1;
          await new Promise((r) => setTimeout(r, 40)); // leader is slow
          cached = 'RULES';
          return 'RULES';
        },
      });

    const results = await Promise.all([call(), call(), call(), call(), call()]);

    expect(upstreamCalls).toBe(1); // ⭐ the whole point
    expect(results).toEqual(['RULES', 'RULES', 'RULES', 'RULES', 'RULES']);
  });

  it('the lock is released, so the next cold cache can fetch again', async () => {
    const redis = fakeRedis();
    let calls = 0;
    const once = () =>
      runSingleFlight<string>({
        redis,
        cacheKey: 'k',
        readCache: () => Promise.resolve(null),
        fetchFn: () => {
          calls += 1;
          return Promise.resolve('v');
        },
      });

    await once();
    await once();
    expect(calls).toBe(2);
    expect(redis.store.size).toBe(0); // nothing left holding the key
  });
});

describe('[SITE RULES SINGLE-FLIGHT] never throws, never hangs', () => {
  it('no redis at all ⇒ fetches directly (today’s behaviour)', async () => {
    let calls = 0;
    const out = await runSingleFlight<string>({
      redis: null,
      cacheKey: 'k',
      readCache: () => Promise.resolve(null),
      fetchFn: () => {
        calls += 1;
        return Promise.resolve('live');
      },
    });
    expect(out).toBe('live');
    expect(calls).toBe(1);
  });

  it('⭐ redis.set throwing does not fail the request', async () => {
    const broken = {
      get: () => Promise.reject(new Error('down')),
      set: () => Promise.reject(new Error('down')),
      del: () => Promise.reject(new Error('down')),
    };
    await expect(
      runSingleFlight<string>({
        redis: broken,
        cacheKey: 'k',
        readCache: () => Promise.resolve(null),
        fetchFn: () => Promise.resolve('live'),
      }),
    ).resolves.toBe('live');
  });

  it('⭐ a leader that dies without writing does not hang the follower', async () => {
    const redis = fakeRedis();
    // Someone else holds the lock and will never release or write.
    await redis.set('k:lock', '1', 'PX', 20_000, 'NX');

    let calls = 0;
    const started = Date.now();
    const out = await runSingleFlight<string>({
      redis,
      cacheKey: 'k',
      readCache: () => Promise.resolve(null), // leader never wrote
      fetchFn: () => {
        calls += 1;
        return Promise.resolve('self');
      },
    });

    expect(out).toBe('self'); // fetched it itself rather than waiting forever
    expect(calls).toBe(1);
    expect(Date.now() - started).toBeLessThan(9000); // bounded wait
  }, 15000);

  it('the leader releasing after a THROWN fetch still frees the lock', async () => {
    const redis = fakeRedis();
    await expect(
      runSingleFlight<string>({
        redis,
        cacheKey: 'k',
        readCache: () => Promise.resolve(null),
        fetchFn: () => Promise.reject(new Error('upstream 500')),
      }),
    ).rejects.toThrow('upstream 500'); // propagates exactly as before
    expect(redis.store.size).toBe(0); // ...but the lock is gone
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * [TEST-20260814-SITERULESCACHE] THE WIRING — does the service actually use it?
 *
 * ⚠️ WHY THIS BLOCK EXISTS. The policy and single-flight specs above are green
 * and prove nothing about production: mutation-testing the two wiring points in
 * `custom-tool.service.ts` (forcing the gate to `false`, restoring the old
 * `Number(ep.cache_ttl_sec) || 0` TTL) left all 1,749 tests passing. Nothing
 * drove `_fetchWithCache` at all, so the feature could have been dead on
 * arrival and the suite would have said "green".
 * เทสยูนิตเขียวไม่ได้แปลว่าโค้ดถูกเสียบ — ต้องขับ service จริง
 * ──────────────────────────────────────────────────────────────────────────── */

import { Types } from 'mongoose';

import { CustomToolService } from '@/modules/external';

/** Redis stand-in with the four calls `_fetchWithCache` + single-flight make. */
function wiringRedis() {
  const store = new Map<string, string>();
  const client = {
    get: (k: string) => Promise.resolve(store.get(k) ?? null),
    set: (k: string, v: string) => {
      if (store.has(k)) return Promise.resolve(null);
      store.set(k, v);
      return Promise.resolve('OK');
    },
    setex: (k: string, ttl: number, v: string) => {
      // The real Redis rejects a zero/negative TTL — mirror that, because
      // getting it wrong is exactly the bug the TTL rewrite had to avoid.
      if (!Number.isFinite(ttl) || ttl <= 0) {
        return Promise.reject(new Error(`ERR invalid expire time: ${ttl}`));
      }
      store.set(k, v);
      return Promise.resolve('OK');
    },
    del: (k: string) => {
      store.delete(k);
      return Promise.resolve(1);
    },
    /* The circuit breaker and login-cooldown paths also reach for Redis. They
       are not what these cases test, but leaving them unstubbed makes the
       service take its error branch, where `_cbFailure(...).catch()` runs on an
       undefined return and throws — a failure that looks like the cache but is
       not. stub ให้ครบ ไม่งั้นพังคนละที่กับที่เทส */
    incr: () => Promise.resolve(1),
    expire: () => Promise.resolve(1),
    ttl: () => Promise.resolve(-1),
  };
  return { store, client };
}

function buildService(redisClient: unknown) {
  /* ⚠️ `persist` MUST return a promise. `getCombinedData` writes a WebhookLog row
     per endpoint as fire-and-forget — `this.wlog.persist({...}).catch(...)` — so a
     bare `jest.fn()` returns undefined and the `.catch()` throws "Cannot read
     properties of undefined". That failure surfaces with a stack pointing deep
     inside the HTTP error branch, which looks like a cache bug and is not one.
     Cost a while to track down. stub ต้องคืน promise ไม่งั้นพังคนละที่
     [FEAT-20260827-WLOGONEDOOR] `persist` replaced `create` here: the service now
     takes the webhook_logs door instead of the raw model. */
  const noop = {
    persist: jest.fn(() => Promise.resolve({})),
    create: jest.fn(() => Promise.resolve({})),
    findOne: jest.fn(() => ({
      lean: () => ({ exec: () => Promise.resolve(null) }),
    })),
    findById: jest.fn(() => ({ lean: () => Promise.resolve(null) })),
    updateOne: jest.fn(() => ({ exec: () => Promise.resolve({}) })),
  };
  return new CustomToolService(
    noop as never,
    noop as never,
    noop as never,
    noop as never,
    { safeDecrypt: () => '' } as never,
    { getClient: () => redisClient } as never,
    /* [FIX-20260905-GLOBALNS] the environment segment the constructor derives */
    { wsEnv: 'dev' } as never,
    { uri: 'mongodb://127.0.0.1:27017/testdb' },
  );
}

const TOOL = { _id: new Types.ObjectId(), name: 'Shop-API v1' } as never;

describe('[SITE RULES WIRING] the service really consults the policy', () => {
  it('⭐ SITE_RULES with cache_ttl_sec=null is fetched ONCE, then served cached', async () => {
    // Mutation guard: forcing `useCache=false` or reverting the TTL line makes
    // this fail — verified by doing both.
    const { client } = wiringRedis();
    const svc = buildService(client);
    let upstream = 0;
    jest.spyOn(svc, '_request').mockImplementation(() => {
      upstream += 1;
      return Promise.resolve({
        success: true,
        status: 200,
        data: { rules: 1 },
      });
    });

    const ep = { key: 'SITE_RULES', role: '', cache_ttl_sec: null } as never;
    const first = await svc._fetchWithCache(
      TOOL,
      ep,
      'u1',
      { web_code: 'w1' },
      null,
    );
    const second = await svc._fetchWithCache(
      TOOL,
      ep,
      'u2',
      { web_code: 'w1' },
      null,
    );

    expect(upstream).toBe(1); // ⭐ the second member reused the first one's fetch
    expect(first._cache).toBe('miss');
    expect(second._cache).toBe('hit');
  });

  it('⭐ a DIFFERENT member on the same hook shares the entry (per hook, not per member)', async () => {
    const { store, client } = wiringRedis();
    const svc = buildService(client);
    jest.spyOn(svc, '_request').mockResolvedValue({
      success: true,
      status: 200,
      data: { rules: 1 },
    });

    const ep = { key: 'SITE_RULES', role: '', cache_ttl_sec: null } as never;
    await svc._fetchWithCache(TOOL, ep, 'member-A', { web_code: 'w1' }, null);
    const keys = Array.from(store.keys()).filter((k) => !k.endsWith(':lock'));

    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain('member-A'); // no user id in the key
  });

  it('⭐ profile is STILL fetched every time — the untouched path', async () => {
    const { client } = wiringRedis();
    const svc = buildService(client);
    let upstream = 0;
    jest.spyOn(svc, '_request').mockImplementation(() => {
      upstream += 1;
      return Promise.resolve({ success: true, status: 200, data: { bal: 1 } });
    });

    const ep = {
      key: 'CUSTOMER_PROFILE',
      role: 'profile',
      cache_ttl_sec: null,
    } as never;
    await svc._fetchWithCache(TOOL, ep, 'u1', { web_code: 'w1' }, null);
    await svc._fetchWithCache(TOOL, ep, 'u1', { web_code: 'w1' }, null);

    expect(upstream).toBe(2); // a cached balance would be a real incident
  });

  it('⭐ a non-cached endpoint never calls setex — no "invalid expire time"', async () => {
    /* Regression: `_fetchWithCache` is public, so a caller can reach it with an
       endpoint the gate would have refused. Without the `ttl > 0` guard the
       write path runs `setex(key, 0, …)`, which real Redis rejects — a wasted
       round trip plus a misleading "cache write error" log line. */
    const { client } = wiringRedis();
    const setex = jest.spyOn(client, 'setex');
    const svc = buildService(client);
    jest.spyOn(svc, '_request').mockResolvedValue({
      success: true,
      status: 200,
      data: { bal: 1 },
    });

    const ep = {
      key: 'CUSTOMER_PROFILE',
      role: 'profile',
      cache_ttl_sec: null,
    } as never;
    const out = await svc._fetchWithCache(
      TOOL,
      ep,
      'u1',
      { web_code: 'w1' },
      null,
    );

    expect(setex).not.toHaveBeenCalled(); // ⭐ guard held
    expect(out.success).toBe(true); // and the caller still got its answer
  });

  it('a failed upstream is not cached — the next caller retries', async () => {
    const { client } = wiringRedis();
    const svc = buildService(client);
    let upstream = 0;
    jest.spyOn(svc, '_request').mockImplementation(() => {
      upstream += 1;
      return Promise.resolve({ success: false, status: 500, data: null });
    });

    const ep = { key: 'SITE_RULES', role: '', cache_ttl_sec: null } as never;
    await svc._fetchWithCache(TOOL, ep, 'u1', { web_code: 'w1' }, null);
    await svc._fetchWithCache(TOOL, ep, 'u2', { web_code: 'w1' }, null);

    expect(upstream).toBe(2);
  });
});

describe('[SITE RULES WIRING] a cache HIT still refreshes what the FE reads', () => {
  /* ⚠️ The "ข้อมูลเว็บ" card reads `hook.raw_site_rules_data` from MONGO, not from
     Redis. If a cache hit skipped that write, the card would freeze at whatever
     the last real fetch produced while the cache kept answering — and the owner's
     rule that an admin "must not feel any difference" would quietly break.
     Verified against the built code + a real Redis before pinning it here.
     cache HIT ต้องยังอัปเดตคอลัมน์ที่การ์ดอ่าน ไม่งั้นการ์ดค้าง */
  it('⭐ hook.raw_site_rules_data is written on a HIT as well as a MISS', async () => {
    const { client } = wiringRedis();
    const writes: unknown[] = [];
    const hookModel = {
      updateOne: (_f: unknown, u: unknown) => {
        writes.push(u);
        return { exec: () => Promise.resolve({}) };
      },
      findById: () => ({ lean: () => Promise.resolve(null) }),
    };
    const noop = {
      // [FEAT-20260827-WLOGONEDOOR] see the note in buildService above.
      persist: jest.fn(() => Promise.resolve({})),
      create: jest.fn(() => Promise.resolve({})),
      findOne: jest.fn(() => ({
        lean: () => ({ exec: () => Promise.resolve(null) }),
      })),
      findById: jest.fn(() => ({ lean: () => Promise.resolve(null) })),
      updateOne: jest.fn(() => ({ exec: () => Promise.resolve({}) })),
    };
    const svc = new CustomToolService(
      noop as never,
      hookModel as never,
      noop as never,
      noop as never,
      { safeDecrypt: () => '' } as never,
      { getClient: () => client } as never,
      /* [FIX-20260905-GLOBALNS] the environment segment the constructor derives */
      { wsEnv: 'dev' } as never,
      { uri: 'mongodb://127.0.0.1:27017/testdb' },
    );
    jest.spyOn(svc, '_request').mockResolvedValue({
      success: true,
      status: 200,
      data: { rules: 'v1' },
    });
    jest.spyOn(svc, 'getToken').mockResolvedValue(null);
    jest.spyOn(svc, 'getToolForHook').mockResolvedValue({
      _id: new Types.ObjectId(),
      name: 't',
      endpoints: [
        {
          key: 'SITE_RULES',
          role: '',
          cache_ttl_sec: null,
          status: true,
          method: 'GET',
        },
      ],
    } as never);

    const hook = {
      _id: 'h1',
      custom_tool_status: true,
      custom_tool_id: 'x',
    } as never;
    await svc.getCombinedData('m1', hook); // MISS
    const afterMiss = writes.length;
    await svc.getCombinedData('m2', hook); // HIT

    expect(afterMiss).toBe(1);
    expect(writes.length).toBe(2); // ⭐ the HIT wrote too
    expect(JSON.stringify(writes[1])).toContain('raw_site_rules_data');
    expect(JSON.stringify(writes[1])).toContain('site_rules_updated_at');
  });
});

describe('[SITE RULES WIRING] driven through getCombinedData — the real entry', () => {
  /* ⚠️ The `useCache` gate lives inside `getCombinedData`, so a test that calls
     `_fetchWithCache` directly (above) cannot see it: forcing the gate to
     `false` left those cases green. This block drives the method the webhook
     actually calls. ต้องขับทางที่ของจริงเดิน ไม่งั้น mutation ไม่แดง */

  const toolWithSiteRules = {
    _id: new Types.ObjectId(),
    name: 'Shop-API v1',
    endpoints: [
      {
        key: 'SITE_RULES',
        role: '',
        cache_ttl_sec: null,
        status: true,
        method: 'GET',
      },
    ],
  } as never;

  it('⭐ the GATE is consulted: a second call reuses the cached site rules', async () => {
    const { client } = wiringRedis();
    const svc = buildService(client);
    let upstream = 0;
    jest.spyOn(svc, '_request').mockImplementation(() => {
      upstream += 1;
      return Promise.resolve({
        success: true,
        status: 200,
        data: { rules: 1 },
      });
    });
    jest.spyOn(svc, 'getToken').mockResolvedValue(null);
    jest.spyOn(svc, 'getToolForHook').mockResolvedValue(toolWithSiteRules);

    const hook = { custom_tool_status: true, custom_tool_id: 'x' } as never;
    await svc.getCombinedData('member-A', hook);
    await svc.getCombinedData('member-B', hook);

    // Gate open ⇒ one upstream call shared by both members.
    // Gate forced shut ⇒ this reads 2 and the case fails.
    expect(upstream).toBe(1);
  });

  it('⭐ SINGLE-FLIGHT holds: concurrent callers still produce one call', async () => {
    const { client } = wiringRedis();
    const svc = buildService(client);
    let upstream = 0;
    jest.spyOn(svc, '_request').mockImplementation(async () => {
      upstream += 1;
      await new Promise((r) => setTimeout(r, 60)); // slow enough to overlap
      return { success: true, status: 200, data: { rules: 1 } };
    });
    jest.spyOn(svc, 'getToken').mockResolvedValue(null);
    jest.spyOn(svc, 'getToolForHook').mockResolvedValue(toolWithSiteRules);

    const hook = { custom_tool_status: true, custom_tool_id: 'x' } as never;
    await Promise.all([
      svc.getCombinedData('m1', hook),
      svc.getCombinedData('m2', hook),
      svc.getCombinedData('m3', hook),
      svc.getCombinedData('m4', hook),
    ]);

    // Without the fan-in guard each of the four fires its own call.
    expect(upstream).toBe(1);
  });
});
