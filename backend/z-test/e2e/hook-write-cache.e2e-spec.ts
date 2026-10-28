import { Test, type TestingModule } from '@nestjs/testing';

import { ConfigModule } from '@/config/config.module';
import { MongoModule } from '@/infra/mongo/mongo.module';
import { RedisModule } from '@/infra/redis/redis.module';
import { RedisService } from '@/infra/redis/redis.service';
import { HookCacheService, HooksModule } from '@/modules/hooks';

import { call, candidateBaseUrl, legacyBaseUrl } from '../lib/legacy-client';

/**
 * The point of porting these six write endpoints: the hook cache's WRITE side.
 *
 * `HookCacheService` was already ported read-only. What makes it CORRECT is
 * that every write path refreshes or evicts it — LINE calls the webhook on
 * every inbound message and the signature guard reads `line_secret` out of this
 * cache, so a missed trigger means a hook that was edited or deleted keeps
 * being served from a stale entry until the TTL runs out.
 *
 * These are NOT parity tests and are reported separately from the golden diff.
 * A golden comparison structurally cannot see them: both backends can answer
 * byte-identically while one of them never touched the cache.
 *
 * ─── how the observation works ──────────────────────────────────────────────
 * The write goes over HTTP to the RUNNING candidate — the real endpoint, not a
 * service call — and the assertion reads the L2 Redis entry directly. L2 is
 * shared between processes by design, which is what makes it observable from
 * here, and reading it proves the write-through happened IMMEDIATELY rather
 * than after a TTL expiry. The key name comes from HookCacheService itself, so
 * the test cannot pass by looking at the wrong (unfingerprinted) key.
 *
 * R10: the fixture hook is created by this test and carries no credential. No
 * value from the shared database is read, decrypted or transmitted.
 */

const username = process.env['GOLDEN_USERNAME'];
const password = process.env['GOLDEN_PASSWORD'];
const canRun = Boolean(username && password && legacyBaseUrl);
const describeIfRunnable = canRun ? describe : describe.skip;

const ALIAS = `omnidesk-s1b-cache-${Date.now()}`;

const jsonRequest = (
  method: string,
  token: string,
  body?: unknown,
): RequestInit => ({
  method,
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  },
  body: body ? JSON.stringify(body) : undefined,
});

describeIfRunnable('hook write endpoints → cache triggers (e2e)', () => {
  let moduleRef: TestingModule;
  let cache: HookCacheService;
  let redis: RedisService;
  let token: string;
  let hookId: string;

  /** The L2 entry for our alias, or null when the key is gone. */
  const readCached = async (): Promise<Record<string, unknown> | null> => {
    const raw = await redis.getClient().get(cache.getRedisKey(ALIAS));
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, MongoModule, RedisModule, HooksModule],
    }).compile();
    await moduleRef.init();

    cache = moduleRef.get(HookCacheService);
    redis = moduleRef.get(RedisService);
    await redis.warmup();

    // Minted by legacy; both services share the signing secret. Retried past
    // the per-IP login limiter (V7) rather than switching the limiter off.
    for (let attempt = 0; attempt < 5 && !token; attempt += 1) {
      const res = await call(legacyBaseUrl!, '/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cf-connecting-ip': `198.51.100.${60 + attempt}`,
        },
        body: JSON.stringify({ username, password }),
      });
      if (res.status === 200) token = (res.body as { token: string }).token;
    }
    expect(token).toBeTruthy();
  }, 60_000);

  afterAll(async () => {
    // Shared database and shared Redis — leave neither a row nor a key behind.
    if (token && hookId) {
      await call(
        candidateBaseUrl,
        `/hook/${hookId}`,
        jsonRequest('DELETE', token, {}),
      );
    }
    await cache.invalidateHookCache(ALIAS);
    await moduleRef?.close();
  });

  it('T1 · POST /hook write-throughs the new hook into the shared cache', async () => {
    // Prove the key does not already exist, or T1 could pass on a leftover.
    await redis.getClient().del(cache.getRedisKey(ALIAS));
    await expect(readCached()).resolves.toBeNull();

    const created = await call(
      candidateBaseUrl,
      '/hook',
      jsonRequest('POST', token, {
        alias: ALIAS,
        line_oa_name: 'cache trigger fixture',
      }),
    );
    expect(created.status).toBe(201);
    hookId = (created.body as { _id: string })._id;
    expect(hookId).toBeTruthy();

    // No sleep: the assertion is that this is visible immediately, not after
    // the L1 TTL (15s) or the L2 TTL.
    const cached = await readCached();
    expect(cached).toBeTruthy();
    expect(cached!['alias']).toBe(ALIAS);
    expect(cached!['_id']).toBe(hookId);
    expect(cached!['status']).toBe(0);
  }, 30_000);

  it('T2 · PATCH /hook/status refreshes the cached status immediately', async () => {
    // Clear L2 first so a pass cannot come from the entry T1 already wrote.
    await redis.getClient().del(cache.getRedisKey(ALIAS));

    const res = await call(
      candidateBaseUrl,
      '/hook/status',
      jsonRequest('PATCH', token, { id: hookId, status: 1 }),
    );
    expect(res.status).toBe(200);

    const cached = await readCached();
    expect(cached).toBeTruthy();
    expect(cached!['status']).toBe(1);
  }, 30_000);

  it('T3 · PATCH /hook/status/bulk refreshes the cached status immediately', async () => {
    await redis.getClient().del(cache.getRedisKey(ALIAS));

    const res = await call(
      candidateBaseUrl,
      '/hook/status/bulk',
      jsonRequest('PATCH', token, { ids: [hookId], status: 0 }),
    );
    expect(res.status).toBe(200);
    expect((res.body as { modified: number }).modified).toBe(1);

    const cached = await readCached();
    expect(cached).toBeTruthy();
    expect(cached!['status']).toBe(0);
  }, 30_000);

  it('T4 · PATCH /hook/settings/bulk refreshes the cached flag immediately', async () => {
    await redis.getClient().del(cache.getRedisKey(ALIAS));

    const res = await call(
      candidateBaseUrl,
      '/hook/settings/bulk',
      jsonRequest('PATCH', token, {
        ids: [hookId],
        field: 'slip_check',
        value: true,
      }),
    );
    expect(res.status).toBe(200);
    expect((res.body as { modified: number }).modified).toBe(1);

    const cached = await readCached();
    expect(cached).toBeTruthy();
    expect(cached!['slip_check']).toBe(true);
  }, 30_000);

  /**
   * The alias-change eviction the bulk handlers wire up.
   *
   * ⚠️ None of the six endpoints in this port can CHANGE an alias — that is
   * `PUT /hook/:id`, which is not ported. So the `previousAlias` they pass
   * always equals the current alias and no eviction fires in practice. This
   * case therefore drives the mechanism directly, to prove the wiring those
   * handlers depend on actually evicts: without it a renamed hook leaves the
   * old alias resolving to a stale entry, and the webhook verifies signatures
   * against a secret that no longer belongs to it.
   */
  it('T5 · a cacheHook carrying previousAlias evicts the OLD alias', async () => {
    const oldAlias = `${ALIAS}-old`;
    const newAlias = `${ALIAS}-new`;
    try {
      await cache.cacheHook({ alias: oldAlias, status: 1 });
      await expect(
        redis.getClient().exists(cache.getRedisKey(oldAlias)),
      ).resolves.toBe(1);
      // V3: the old alias really did resolve before the rename.
      await expect(cache.getHookByAlias(oldAlias)).resolves.toBeTruthy();

      await cache.cacheHook(
        { alias: newAlias, status: 1 },
        { previousAlias: oldAlias },
      );

      await expect(
        redis.getClient().exists(cache.getRedisKey(oldAlias)),
      ).resolves.toBe(0);
      // ...and it no longer resolves at all — no L1 copy left behind either.
      await expect(cache.getHookByAlias(oldAlias)).resolves.toBeNull();
      await expect(cache.getHookByAlias(newAlias)).resolves.toBeTruthy();
    } finally {
      await cache.invalidateHookCache(oldAlias);
      await cache.invalidateHookCache(newAlias);
    }
  }, 30_000);

  it('T6 · DELETE /hook/:id evicts the alias so it stops resolving', async () => {
    // Re-populate first, so the eviction has something to remove (V3).
    await cache.getHookByAlias(ALIAS);
    await expect(
      redis.getClient().exists(cache.getRedisKey(ALIAS)),
    ).resolves.toBe(1);

    const res = await call(
      candidateBaseUrl,
      `/hook/${hookId}`,
      jsonRequest('DELETE', token, {}),
    );
    expect(res.status).toBe(200);
    hookId = ''; // already gone; afterAll must not delete twice

    await expect(
      redis.getClient().exists(cache.getRedisKey(ALIAS)),
    ).resolves.toBe(0);
    await expect(cache.getHookByAlias(ALIAS)).resolves.toBeNull();
  }, 30_000);
});
