/**
 * [FIX-20260905-REDISNS] Staging and production share ONE Redis database, so a
 * shared key without an environment segment is read and written by both.
 *
 * ## The defect these cases replay
 * Production's broadcast history screen (`ประวัติ` tab → `GET /webhook/logs`)
 * served STAGING's rows. Not a browser cache — there is no service worker and no
 * client-side store on that path, and an HTTP cache is keyed by URL, so two
 * origins cannot share one entry. The shared thing was the Redis key:
 *
 *   qcache:v1:webhooklog:ALL:<paramsSig>
 *
 * `ALL` is the literal `computeScopeSignature(null)` returns for a SUPERADMIN,
 * so the scope half — the part `scoped-query-cache.service.ts` documents at
 * length as the no-leak guarantee — is a CONSTANT on every deployment. Same
 * params, same key, same Redis: whichever environment answered first owned the
 * entry for the next 30 seconds.
 *
 * ## What is asserted here, and why in this order
 * 1. the helper is stable, and separates on EITHER half;
 * 2. 🔴 it still separates when `WS_ENV` is missing on BOTH sides — that is the
 *    case worth defending, because a forgotten variable is exactly when nobody
 *    is watching (`env.schema.ts:429` defaults it to `'dev'`);
 * 3. the two callers actually USE it — a helper nothing calls proves nothing;
 * 4. the leak itself, replayed on ONE shared fake Redis: environment B must miss
 *    on an entry environment A wrote.
 *
 * ⚠️ Case 4 is the only one that would have caught the bug. The others would all
 *    have passed on the broken code with the segment merely absent.
 */

import { redisEnvNamespace } from '@/infra/redis/redis-namespace';
import { ScopedQueryCacheService } from '@/infra/query-cache/scoped-query-cache.service';
// The service is deliberately NOT on the handoff barrel, and putting it there to
// satisfy a test would widen the module's public surface for no runtime reason.
// Same exemption `handoff-reject-row-bounded.spec.ts:49` already takes.
// eslint-disable-next-line no-restricted-imports
import { HandoffCallbackService } from '@/modules/handoff/handoff-callback.service';
import { type RedisService } from '@/infra/redis/redis.service';

import { FakeRedisClient, fakeRedisService } from '../lib/fake-redis';

const TTL_ON = {
  ttlDashboardSeconds: 120,
  ttlInsightSeconds: 300,
  ttlWebhookLogSeconds: 30,
  ttlAuditSeconds: 30,
  jitterPct: 0,
};

/** The two deployments as they really are: same Redis, different database. */
const STG = { wsEnv: 'dev', uri: 'mongodb://10.0.0.5:27017/omnidesk_stg' };
const PRD = { wsEnv: 'prod', uri: 'mongodb://10.0.0.5:27017/omnidesk_prod' };

const cacheFor = (
  env: { wsEnv: string; uri: string },
  redis: FakeRedisClient,
): ScopedQueryCacheService =>
  new ScopedQueryCacheService(
    fakeRedisService(redis) as unknown as RedisService,
    TTL_ON,
    { wsEnv: env.wsEnv } as never,
    { uri: env.uri },
  );

describe('[REDISNS] the namespace helper', () => {
  it('is stable — the same inputs always give the same segment', () => {
    expect(redisEnvNamespace('prod', PRD.uri)).toBe(
      redisEnvNamespace('prod', PRD.uri),
    );
  });

  it('separates on WS_ENV alone', () => {
    expect(redisEnvNamespace('dev', PRD.uri)).not.toBe(
      redisEnvNamespace('prod', PRD.uri),
    );
  });

  it('separates on the DATABASE NAME alone', () => {
    expect(redisEnvNamespace('prod', STG.uri)).not.toBe(
      redisEnvNamespace('prod', PRD.uri),
    );
  });

  it('⭐ still separates when WS_ENV is missing on BOTH sides', () => {
    // The whole reason the database name is in here. Two deployments that both
    // forgot the variable fall back to the same string; only the second half
    // saves them. ลืมตั้ง WS_ENV ทั้งคู่ = ยังต้องแยกกันได้
    expect(redisEnvNamespace(undefined, STG.uri)).not.toBe(
      redisEnvNamespace(undefined, PRD.uri),
    );
  });

  it('never puts the database name in the key in clear text', () => {
    // Keys get pasted into tickets and chat; a hashed half keeps a deployment
    // name out of them while staying deterministic.
    expect(redisEnvNamespace('prod', PRD.uri)).not.toContain('omnidesk_prod');
    expect(redisEnvNamespace('prod', PRD.uri)).toMatch(/^prod\.[0-9a-f]{8}$/);
  });

  it('survives a blank env and a URI with no database name', () => {
    // A namespace sits on a read path and must never throw; falling back is
    // allowed, colliding by accident is not.
    expect(redisEnvNamespace('', '')).toBe('na.nodb');
    expect(redisEnvNamespace('prod', 'mongodb://a:27017?x=1')).not.toBe(
      redisEnvNamespace('prod', 'mongodb://b:27017?x=1'),
    );
  });
});

describe('[REDISNS] qcache — the key carries the environment', () => {
  it('⭐ a SUPERADMIN scope no longer collides across environments', () => {
    // scope=null ⇒ signature `ALL` on both sides. This is the exact shape the
    // owner saw on screen, so it is asserted on its own rather than folded into
    // a group-scoped case.
    const redis = new FakeRedisClient();
    const params = {
      channel: 'line_api',
      action_type: 'send_broadcast',
      page: '1',
    };

    const stgKey = cacheFor(STG, redis).buildKey('webhooklog', null, params);
    const prdKey = cacheFor(PRD, redis).buildKey('webhooklog', null, params);

    expect(stgKey).not.toBe(prdKey);
    // The scope half really is identical — proving the separation came from the
    // environment segment and not from some incidental difference.
    expect(stgKey).toContain(':ALL:');
    expect(prdKey).toContain(':ALL:');
  });

  it('a group scope separates across environments too', () => {
    const redis = new FakeRedisClient();
    expect(
      cacheFor(STG, redis).buildKey('audit', ['g1'], { page: '1' }),
    ).not.toBe(cacheFor(PRD, redis).buildKey('audit', ['g1'], { page: '1' }));
  });

  it('⭐ THE LEAK ITSELF: one shared Redis, environment B does not read A entry', async () => {
    const shared = new FakeRedisClient(); // one Redis host, one REDIS_DB
    const query = {
      endpoint: 'webhooklog',
      scope: null,
      params: { page: '1' },
    } as const;

    const stgProducer = jest.fn().mockResolvedValue({ data: ['stg-row'] });
    const prdProducer = jest.fn().mockResolvedValue({ data: ['prod-row'] });

    await cacheFor(STG, shared).wrap(query, stgProducer); // warms the entry
    const prdResult = await cacheFor(PRD, shared).wrap(query, prdProducer);

    // Before the fix this returned `{ data: ['stg-row'] }` and `prdProducer`
    // was never called — production showing staging's rows, exactly as reported.
    expect(prdProducer).toHaveBeenCalledTimes(1);
    expect(prdResult).toEqual({ data: ['prod-row'] });
  });
});

describe('[REDISNS] handoff callback limiter — the counter is per environment', () => {
  /** Only the last two constructor arguments are read by the constructor body. */
  const handoffFor = (env: {
    wsEnv: string;
    uri: string;
  }): HandoffCallbackService =>
    new HandoffCallbackService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { wsEnv: env.wsEnv } as never,
      { uri: env.uri },
    );

  it('the constructor derives a different namespace per environment', () => {
    const ns = (s: HandoffCallbackService) =>
      (s as unknown as { envNamespace: string }).envNamespace;
    expect(ns(handoffFor(STG))).not.toBe(ns(handoffFor(PRD)));
  });

  it('⭐ the rate-limit key is namespaced, not the bare target+ip', async () => {
    // `target_key` is an operator-chosen slug and staging mirrors production, so
    // the same slug on both sides is normal; `remoteIp` is the same partner. One
    // window of 600/60s was therefore shared, and a staging load test could 429
    // a real production callback. เทส stg ห้ามกินโควต้า prod
    const keys: string[] = [];
    const svc = Object.create(
      HandoffCallbackService.prototype,
    ) as HandoffCallbackService;
    Object.assign(svc, {
      envNamespace: 'prod.abcd1234',
      isRateLimitedByKey: (key: string) => {
        keys.push(key);
        return Promise.resolve(true); // stop at the limiter; nothing else matters
      },
    });

    const outcome = await (
      svc.receive.bind(svc) as (i: unknown) => Promise<{ status: number }>
    )({
      targetKey: 'partner_main',
      rawBody: Buffer.from('{}'),
      headers: {},
      query: {},
      remoteIp: '203.0.113.9',
    });

    expect(outcome.status).toBe(429); // the limiter really was the gate that ran
    expect(keys).toHaveLength(1);
    expect(keys[0]).toBe('handoff:prod.abcd1234:cb:partner_main:203.0.113.9');
    expect(keys[0]).not.toMatch(/^handoff:cb:/); // the colliding shape is gone
  });
});
