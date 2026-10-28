// [FEAT-20260808-QCACHE] Unit proofs for the scoped query cache primitive.
//
// Covers the four load-bearing behaviours and the ONE security-critical
// property (no cross-scope leak):
//   1. cache key = params + scope signature (never userId, never query-only)
//   2. cross-scope isolation — two scopes NEVER read each other's entry
//   3. single-flight — concurrent cold-key callers run the producer ONCE
//   4. TTL bypass — ttl<=0 ⇒ producer runs live every time, nothing cached
// plus the before/after identity contract (HIT === MISS payload) and jitter.

import { type RedisService } from '@/infra/redis/redis.service';
import { ScopedQueryCacheService } from '@/infra/query-cache/scoped-query-cache.service';
import {
  computeScopeSignature,
  SCOPE_ALL,
  SCOPE_NONE,
} from '@/infra/query-cache/scope-signature';

import { FakeRedisClient, fakeRedisService } from '../lib/fake-redis';

const CONFIG = {
  ttlDashboardSeconds: 120,
  ttlInsightSeconds: 300,
  ttlWebhookLogSeconds: 30,
  ttlAuditSeconds: 30,
  jitterPct: 0, // deterministic TTL in tests unless a test opts in
};

/* [FIX-20260905-REDISNS] The environment segment is built from these two. Fixed
   values keep every key assertion below deterministic; the cross-environment
   isolation itself is proven in `redis-env-namespace.spec.ts`, not here. */
const REALTIME = { wsEnv: 'dev' } as never;
const MONGO = { uri: 'mongodb://127.0.0.1:27017/testdb' } as never;

function build(config = CONFIG): {
  service: ScopedQueryCacheService;
  redis: FakeRedisClient;
} {
  const redis = new FakeRedisClient();
  const service = new ScopedQueryCacheService(
    fakeRedisService(redis) as unknown as RedisService,
    config,
    REALTIME,
    MONGO,
  );
  return { service, redis };
}

describe('scope-signature', () => {
  it('maps null → ALL and [] → NONE (the two marker buckets)', () => {
    expect(computeScopeSignature(null)).toBe(SCOPE_ALL);
    expect(computeScopeSignature([])).toBe(SCOPE_NONE);
  });

  it('is order-independent and de-duped (same set → same signature)', () => {
    expect(computeScopeSignature(['a', 'b', 'c'])).toBe(
      computeScopeSignature(['c', 'b', 'a', 'b']),
    );
  });

  it('different sets → different signatures', () => {
    expect(computeScopeSignature(['a', 'b'])).not.toBe(
      computeScopeSignature(['a', 'c']),
    );
    // A scoped user is never confused with a super user.
    expect(computeScopeSignature(['a'])).not.toBe(SCOPE_ALL);
  });
});

describe('ScopedQueryCacheService — key composition', () => {
  it('encodes scope BETWEEN endpoint and params, versioned', () => {
    const { service } = build();
    const key = service.buildKey('insight', ['g1', 'g2'], {
      from: '2026-01-01',
    });
    /* [FIX-20260905-REDISNS] `dev.<8 hex>` was inserted after the version. The
       shape is asserted here rather than the literal namespace so this case
       keeps testing key COMPOSITION; whether two environments differ is proven
       in `redis-env-namespace.spec.ts`. */
    expect(key).toMatch(
      /^qcache:v1:dev\.[0-9a-f]{8}:insight:h[0-9a-f]{12}:[0-9a-f]{16}$/,
    );
  });

  it('same params + same scope → same key; different scope → different key', () => {
    const { service } = build();
    const params = { page: '1' };
    const a = service.buildKey('audit', ['g1'], params);
    const aAgain = service.buildKey('audit', ['g1'], params);
    const b = service.buildKey('audit', ['g2'], params);
    expect(a).toBe(aAgain); // sharing within a scope
    expect(a).not.toBe(b); // isolation across scopes
  });
});

describe('ScopedQueryCacheService.wrap — before/after identity', () => {
  it('MISS returns exactly the producer result; HIT returns the same payload', async () => {
    const { service, redis } = build();
    const payload = {
      success: true,
      data: { rows: [{ id: 1, name: 'x' }], total: 1 },
    };
    const producer = jest.fn().mockResolvedValue(payload);

    // (a) cache MISS — byte-identical to the live producer result.
    const miss = await service.wrap(
      { endpoint: 'insight', scope: ['g1'], params: { from: 'a' } },
      producer,
    );
    expect(miss).toEqual(payload);
    expect(producer).toHaveBeenCalledTimes(1);

    // (b) cache HIT — same scope+params, producer NOT called again, same payload.
    const hit = await service.wrap(
      { endpoint: 'insight', scope: ['g1'], params: { from: 'a' } },
      producer,
    );
    expect(hit).toEqual(payload); // identical output
    expect(hit).toEqual(miss);
    expect(producer).toHaveBeenCalledTimes(1); // served from Redis, no re-query
    expect(redis.countSets()).toBe(1);
  });

  it('serialises through JSON so a HIT === a MISS structurally', async () => {
    const { service } = build();
    // Dates/ObjectId-likes become strings on write; a HIT must equal what a MISS
    // returns AFTER the same JSON round-trip the HTTP layer applies to both.
    const payload = { when: new Date('2026-08-08T00:00:00.000Z'), n: 5 };
    const producer = jest.fn().mockResolvedValue(payload);
    await service.wrap(
      { endpoint: 'audit', scope: null, params: {} },
      producer,
    );
    const hit = await service.wrap(
      { endpoint: 'audit', scope: null, params: {} },
      producer,
    );
    expect(hit).toEqual(JSON.parse(JSON.stringify(payload)));
  });
});

describe('ScopedQueryCacheService.wrap — NO CROSS-SCOPE LEAK (security)', () => {
  it('never serves one scope the payload cached for another', async () => {
    const { service } = build();
    const scopeA = ['group-A'];
    const scopeB = ['group-B'];
    const params = { page: '1' }; // IDENTICAL query params on purpose

    const producerA = jest.fn().mockResolvedValue({ data: 'SECRET-FOR-A' });
    const producerB = jest.fn().mockResolvedValue({ data: 'SECRET-FOR-B' });

    // Scope A populates the cache.
    const a = await service.wrap(
      { endpoint: 'webhooklog', scope: scopeA, params },
      producerA,
    );
    expect(a).toEqual({ data: 'SECRET-FOR-A' });

    // Scope B — same endpoint, same params — MUST miss A's entry and run its own
    // producer, getting ITS data, never A's.
    const b = await service.wrap(
      { endpoint: 'webhooklog', scope: scopeB, params },
      producerB,
    );
    expect(b).toEqual({ data: 'SECRET-FOR-B' });
    expect(producerB).toHaveBeenCalledTimes(1); // B did NOT read A's cache
    expect(b).not.toEqual(a);

    // And A still reads A on a repeat (its entry untouched by B).
    const aAgain = await service.wrap(
      { endpoint: 'webhooklog', scope: scopeA, params },
      producerA,
    );
    expect(aAgain).toEqual({ data: 'SECRET-FOR-A' });
    expect(producerA).toHaveBeenCalledTimes(1); // served from cache, not re-run
  });

  it('super (null) and a scoped user get different buckets for identical params', async () => {
    const { service } = build();
    const params = { page: '1' };
    const superRes = await service.wrap(
      { endpoint: 'audit', scope: null, params },
      jest.fn().mockResolvedValue({ data: 'ALL-ROWS' }),
    );
    const scopedProducer = jest.fn().mockResolvedValue({ data: 'SCOPED-ROWS' });
    const scopedRes = await service.wrap(
      { endpoint: 'audit', scope: ['g1'], params },
      scopedProducer,
    );
    expect(superRes).toEqual({ data: 'ALL-ROWS' });
    expect(scopedRes).toEqual({ data: 'SCOPED-ROWS' });
    expect(scopedProducer).toHaveBeenCalledTimes(1);
  });
});

describe('ScopedQueryCacheService.wrap — single-flight (stampede prevention)', () => {
  it('runs the producer ONCE for concurrent cold-key callers', async () => {
    const { service } = build();
    let resolve!: (v: unknown) => void;
    const gate = new Promise((r) => (resolve = r));
    const producer = jest.fn().mockImplementation(async () => {
      await gate;
      return { data: 'once' };
    });

    // Five concurrent callers, same scope+params, before the producer resolves.
    const opts = {
      endpoint: 'insight' as const,
      scope: ['g1'],
      params: { x: 1 },
    };
    const all = Promise.all([
      service.wrap(opts, producer),
      service.wrap(opts, producer),
      service.wrap(opts, producer),
      service.wrap(opts, producer),
      service.wrap(opts, producer),
    ]);
    resolve({ data: 'once' });
    const results = await all;

    expect(producer).toHaveBeenCalledTimes(1); // coalesced onto one run
    for (const r of results) expect(r).toEqual({ data: 'once' });
  });
});

describe('ScopedQueryCacheService.wrap — TTL bypass (pluggable off-switch)', () => {
  it('ttl=0 ⇒ producer runs live every call, nothing cached (identical to today)', async () => {
    const { service, redis } = build({
      ...CONFIG,
      ttlWebhookLogSeconds: 0, // knob OFF for this page
    });
    const producer = jest.fn().mockResolvedValue({ data: 'live' });
    const opts = { endpoint: 'webhooklog' as const, scope: ['g1'], params: {} };

    const first = await service.wrap(opts, producer);
    const second = await service.wrap(opts, producer);

    expect(first).toEqual({ data: 'live' });
    expect(second).toEqual({ data: 'live' });
    expect(producer).toHaveBeenCalledTimes(2); // no caching, live every time
    expect(redis.countGets()).toBe(0); // Redis never touched when off
    expect(redis.countSets()).toBe(0);
  });

  it('the entry expires after its TTL, then the producer re-runs', async () => {
    const { service, redis } = build();
    const producer = jest
      .fn()
      .mockResolvedValueOnce({ v: 1 })
      .mockResolvedValueOnce({ v: 2 });
    const opts = { endpoint: 'webhooklog' as const, scope: ['g1'], params: {} };

    expect(await service.wrap(opts, producer)).toEqual({ v: 1 });
    redis.advance(30_000 + 1); // TTL = 30s for webhooklog
    expect(await service.wrap(opts, producer)).toEqual({ v: 2 }); // refreshed
    expect(producer).toHaveBeenCalledTimes(2);
  });
});

describe('ScopedQueryCacheService.wrap — fail-open', () => {
  it('degrades to a live producer call when Redis throws', async () => {
    const throwingClient = {
      get: jest.fn().mockRejectedValue(new Error('redis down')),
      set: jest.fn().mockRejectedValue(new Error('redis down')),
    };
    const service = new ScopedQueryCacheService(
      { getClient: () => throwingClient } as unknown as RedisService,
      CONFIG,
      REALTIME,
      MONGO,
    );
    const producer = jest.fn().mockResolvedValue({ data: 'from-db' });
    const res = await service.wrap(
      { endpoint: 'audit', scope: null, params: {} },
      producer,
    );
    expect(res).toEqual({ data: 'from-db' }); // never worse than a live read
    expect(producer).toHaveBeenCalledTimes(1);
  });
});

describe('ScopedQueryCacheService.jitter', () => {
  it('applies TTL jitter within ±pct when enabled', async () => {
    const { service, redis } = build({ ...CONFIG, jitterPct: 10 });
    const spy = jest.spyOn(redis, 'set');
    await service.wrap(
      { endpoint: 'insight', scope: null, params: {} },
      jest.fn().mockResolvedValue({ ok: 1 }),
    );
    // set(key, value, 'EX', ttl) — ttl within 300 ±10% = [270, 330].
    const ttlArg = spy.mock.calls[0]?.[3] as number;
    expect(ttlArg).toBeGreaterThanOrEqual(270);
    expect(ttlArg).toBeLessThanOrEqual(330);
  });
});
