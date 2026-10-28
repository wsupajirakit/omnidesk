import { Test, type TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { ConfigModule } from '@/config/config.module';
import { MongoModule } from '@/infra/mongo/mongo.module';
import { RedisModule } from '@/infra/redis/redis.module';
import { RedisService } from '@/infra/redis/redis.service';
import { Hook, HookCacheService, HooksModule } from '@/modules/hooks';

/**
 * Behaviour tests for the three-layer hook cache.
 *
 * These are NOT parity tests — parity for the webhook surface is proven by
 * z-test/golden/webhook.golden-spec.ts. What they prove is the thing a golden
 * diff structurally cannot see: *which layer answered*. Legacy and the port can
 * return byte-identical webhook responses while the port does a MongoDB query
 * per inbound LINE message, and only `source` distinguishes those two worlds.
 *
 * Fixtures come from real hooks the legacy backend wrote (V1) and the suite
 * refuses to run vacuously if none exist (V3).
 *
 * R10: hooks are read, cached and compared. No credential in them is ever used
 * to make an outbound call — nothing here decrypts or transmits line_secret,
 * custom_ai_key or any enc: value.
 */
describe('HookCacheService (e2e)', () => {
  let moduleRef: TestingModule;
  let cache: HookCacheService;
  let redis: RedisService;
  let hookModel: Model<Hook>;
  let alias: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, MongoModule, RedisModule, HooksModule],
    }).compile();
    await moduleRef.init();

    cache = moduleRef.get(HookCacheService);
    redis = moduleRef.get(RedisService);
    hookModel = moduleRef.get<Model<Hook>>(getModelToken(Hook.name));
    await redis.warmup();

    const sample = await hookModel
      .findOne({ alias: { $exists: true, $ne: null } })
      .lean<{ alias?: string }>()
      .exec();

    // V3 — a vacuous pass looks identical to a real one. Without a real alias
    // every assertion below would be checking an empty cache against itself.
    expect(sample?.alias).toBeTruthy();
    alias = sample!.alias!;
  });

  afterAll(async () => {
    // Leave no test keys behind in a shared Redis.
    await cache.invalidateHookCache(alias);
    await moduleRef?.close();
  });

  beforeEach(async () => {
    cache.clearLocalCache();
    await redis.getClient().del(cache.getRedisKey(alias));
  });

  it('C1 · cold cache answers from the DB and populates BOTH layers under the fingerprinted key', async () => {
    const cold = await cache.getHookByAliasWithSource(alias);
    expect(cold.source).toBe('db');
    expect(cold.hook).toBeTruthy();

    // The fingerprinted key must exist — a bare `hook:<alias>` would mean a
    // Redis shared across environments could hand this entry to a process that
    // cannot decrypt it (intermittent 401s).
    const key = cache.getRedisKey(alias);
    expect(key).toMatch(
      new RegExp(`^hook:[\\w-]+\\.[0-9a-f]{8}:${escapeRegExp(alias)}$`),
    );
    await expect(redis.getClient().exists(key)).resolves.toBe(1);

    // A bare key must NOT have been written.
    await expect(redis.getClient().exists(`hook:${alias}`)).resolves.toBe(0);

    // L2 carries a TTL close to the configured 12h backstop, not forever.
    const ttl = await redis.getClient().ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(43200);

    // And L1 was populated on the way down.
    const warm = await cache.getHookByAliasWithSource(alias);
    expect(warm.source).toBe('l1');
  });

  it('C2 · L1 hit returns source:l1; once L1 expires the same alias comes from redis', async () => {
    await cache.getHookByAliasWithSource(alias); // db, populates both
    expect((await cache.getHookByAliasWithSource(alias)).source).toBe('l1');

    // Simulate L1 TTL expiry without waiting 15s. Redis still holds the entry,
    // so the next read must be served by L2 — not by another Mongo query.
    cache.clearLocalCache();
    const afterExpiry = await cache.getHookByAliasWithSource(alias);
    expect(afterExpiry.source).toBe('redis');
  });

  it('C3 · an L1 hit and an L2 hit return structurally identical objects (_id a string in both)', async () => {
    await cache.getHookByAliasWithSource(alias); // db -> both layers
    const fromL1 = await cache.getHookByAliasWithSource(alias);
    expect(fromL1.source).toBe('l1');

    cache.clearLocalCache();
    const fromRedis = await cache.getHookByAliasWithSource(alias);
    expect(fromRedis.source).toBe('redis');

    // The defect this guards: without JSON normalisation L1 hands back Mongoose
    // ObjectIds and Dates while L2 hands back strings, so behaviour depends on
    // which layer happened to answer. TypeScript cannot catch it — both are
    // typed the same.
    expect(typeof fromL1.hook!._id).toBe('string');
    expect(typeof fromRedis.hook!._id).toBe('string');
    expect(fromL1.hook).toEqual(fromRedis.hook);
  });

  it('C4 · cacheHook with a changed previousAlias stops the OLD alias resolving', async () => {
    const oldAlias = `zz-hookcache-test-${Date.now()}`;
    const newAlias = `${oldAlias}-renamed`;

    // Seed the old alias in both layers, exactly as a pre-rename save would.
    await cache.cacheHook({ _id: 'test', alias: oldAlias, marker: 'before' });
    expect((await cache.getHookByAliasWithSource(oldAlias)).source).toBe('l1');
    await expect(
      redis.getClient().exists(cache.getRedisKey(oldAlias)),
    ).resolves.toBe(1);

    // Rename. The old key must be evicted from BOTH layers, or the old alias
    // keeps resolving to a stale hook until its 12h TTL runs out.
    await cache.cacheHook(
      { _id: 'test', alias: newAlias, marker: 'after' },
      { previousAlias: oldAlias },
    );

    await expect(
      redis.getClient().exists(cache.getRedisKey(oldAlias)),
    ).resolves.toBe(0);
    // Nothing in Mongo under that alias either, so the lookup is a clean miss.
    const resolvedOld = await cache.getHookByAliasWithSource(oldAlias);
    expect(resolvedOld.source).toBe('miss');
    expect(resolvedOld.hook).toBeNull();

    const resolvedNew = await cache.getHookByAliasWithSource(newAlias);
    expect(resolvedNew.source).toBe('l1');
    expect(resolvedNew.hook?.marker).toBe('after');

    await cache.invalidateHookCache(newAlias);
  });

  it('C5 · an invalidate message carrying our OWN instance id does NOT drop our L1', async () => {
    await cache.getHookByAliasWithSource(alias);
    expect((await cache.getHookByAliasWithSource(alias)).source).toBe('l1');

    // Our own write-through already published one of these. Dropping L1 on it
    // would throw away the value we just wrote, on every single save.
    await redis
      .getClient()
      .publish(
        cache.getInvalidateChannel(),
        JSON.stringify({ alias, sender: cache.getInstanceId() }),
      );
    await settle();
    expect((await cache.getHookByAliasWithSource(alias)).source).toBe('l1');

    // A malformed message must be ignored, never thrown.
    await redis
      .getClient()
      .publish(cache.getInvalidateChannel(), 'not-json-at-all');
    await settle();
    expect((await cache.getHookByAliasWithSource(alias)).source).toBe('l1');

    // A message from ANOTHER instance must drop it.
    await redis
      .getClient()
      .publish(
        cache.getInvalidateChannel(),
        JSON.stringify({ alias, sender: 'some-other-instance' }),
      );
    await settle();
    const afterPeer = await cache.getHookByAliasWithSource(alias);
    expect(afterPeer.source).toBe('redis'); // L1 gone, L2 intact
  });

  it('C6 · Redis unreachable still resolves from MongoDB, with no error surfaced', async () => {
    const client = redis.getClient();
    const failure = new Error('simulated redis outage');
    const spies = [
      jest.spyOn(client, 'get').mockRejectedValue(failure),
      jest.spyOn(client, 'set').mockRejectedValue(failure),
      jest.spyOn(client, 'del').mockRejectedValue(failure),
      jest.spyOn(client, 'publish').mockRejectedValue(failure),
    ];

    try {
      // Read path degrades to a plain Mongo read.
      const resolved = await cache.getHookByAliasWithSource(alias);
      expect(resolved.source).toBe('db');
      expect(resolved.hook).toBeTruthy();

      // Write path and invalidation swallow the failure rather than throwing
      // into a request.
      await expect(cache.cacheHook(resolved.hook)).resolves.toBeTruthy();
      await expect(cache.invalidateHookCache(alias)).resolves.toBeUndefined();
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  });

  it('C7 · an unknown alias is a miss, and an empty alias is a null source', async () => {
    const unknown = await cache.getHookByAliasWithSource(
      `zz-nonexistent-${Date.now()}`,
    );
    expect(unknown).toEqual({ hook: null, source: 'miss' });

    // Legacy hookService.js:148 — no alias means no lookup at all.
    expect(await cache.getHookByAliasWithSource('')).toEqual({
      hook: null,
      source: null,
    });
    expect(await cache.getHookByAlias(undefined)).toBeNull();
  });
});

/** Lets pub/sub delivery land before the next assertion. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 250));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
