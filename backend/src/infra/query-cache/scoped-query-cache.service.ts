// [FEAT-20260808-QCACHE] ScopedQueryCacheService — the reusable read-cache primitive.
//
// One small service any READ-HEAVY, NON-realtime endpoint can opt into. It caches
// a query's result in Redis, SHARED across users who have the same permission
// scope, with a per-endpoint tunable TTL. It is deliberately generic: not bespoke
// per endpoint. Removing the `.wrap(...)` call from an endpoint = the live query
// runs every time = zero behaviour change (the pluggability contract).
//
// Four behaviours, each load-bearing:
//   1. KEY = queryParams + SCOPE SIGNATURE (never userId, never query-only).
//      Same scope → shared entry; different scope → different entry (no leak).
//      Scope isolation is a SECURITY boundary — see scope-signature.ts.
//   2. STORE = Redis (the existing shared RedisService). Shared across users AND
//      across BE instances. No new connection.
//   3. SINGLE-FLIGHT = an in-process Map<key, Promise>. On a cold key, concurrent
//      callers on the same key await ONE producer run (one DB query), not N.
//      Per-instance by design — redlock is overkill/debt for a cache warm.
//   4. TTL = per-endpoint, config-driven, tunable. ttl<=0 ⇒ BYPASS: run the
//      producer live and cache nothing (identical to today).
//
// Fail-open everywhere: any Redis error degrades to a live producer call. The
// cached path is never worse than a direct query.
//
// DB-EFFECT: NO Mongo schema/write change; writes NOTHING to Mongo. It makes the
// wrapped endpoint READ Mongo LESS often (serving cached JSON) and stores only
// ephemeral, TTL'd keys in REDIS. On a Redis outage, behaviour is exactly today's
// live query. Removing this service = the live query, every time.

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import {
  mongoConfig,
  queryCacheConfig,
  realtimeConfig,
} from '@/config/app.config';
// [FIX-20260905-REDISNS] the one copy of the environment-segment rule
import { redisEnvNamespace } from '@/infra/redis/redis-namespace';
import { RedisService } from '@/infra/redis/redis.service';

import {
  computeParamsSignature,
  computeScopeSignature,
  type ScopeSet,
} from './scope-signature';

/**
 * Which page's TTL knob applies. Also the Redis key namespace segment, so each
 * page's entries are isolated (and greppable) — and a group-id scope on one page
 * can never be read under another page's key.
 */
export type CacheEndpoint = 'dashboard' | 'insight' | 'webhooklog' | 'audit';

export interface WrapOptions {
  /** Page whose TTL knob + key namespace apply. */
  endpoint: CacheEndpoint;
  /**
   * The caller's effective allowed set for THIS endpoint: `null` = super/ALL,
   * `[]` = none, `[...]` = allowed ids (hook ids for insight, group ids for the
   * log lists). Hashed into the key so scopes never share an entry.
   */
  scope: ScopeSet;
  /** The query params that select the rows. Order-independent; empties dropped. */
  params: Record<string, unknown>;
}

// Key namespace version. Bump to bust the WHOLE cache on a stored-shape change —
// a zero-debt migration: old keys age out by TTL, new reads miss and repopulate.
const KEY_VERSION = 'v1';
const KEY_PREFIX = 'qcache';

@Injectable()
export class ScopedQueryCacheService {
  private readonly logger = new Logger(ScopedQueryCacheService.name);

  /** In-process single-flight: key → the in-progress producer promise. */
  private readonly inflight = new Map<string, Promise<unknown>>();

  /**
   * [FIX-20260905-REDISNS] `<env>.<db8>` — see `infra/redis/redis-namespace.ts`.
   * Resolved ONCE at construction: both inputs come from env and cannot change
   * while the process lives, and a key builder on a read path must not re-hash
   * on every request.
   */
  private readonly envNamespace: string;

  constructor(
    private readonly redis: RedisService,
    @Inject(queryCacheConfig.KEY)
    private readonly config: ConfigType<typeof queryCacheConfig>,
    // [FIX-20260905-REDISNS] the two halves of the environment segment
    @Inject(realtimeConfig.KEY)
    realtime: ConfigType<typeof realtimeConfig>,
    @Inject(mongoConfig.KEY)
    mongo: ConfigType<typeof mongoConfig>,
  ) {
    this.envNamespace = redisEnvNamespace(realtime.wsEnv, mongo.uri);
  }

  /** Per-endpoint TTL (seconds). 0/negative ⇒ cache disabled for that page. */
  private ttlFor(endpoint: CacheEndpoint): number {
    switch (endpoint) {
      case 'dashboard':
        return this.config.ttlDashboardSeconds;
      case 'insight':
        return this.config.ttlInsightSeconds;
      case 'webhooklog':
        return this.config.ttlWebhookLogSeconds;
      case 'audit':
        return this.config.ttlAuditSeconds;
    }
  }

  /**
   * [FIX-20260905-GLOBALNS] Everything in the key EXCEPT the params signature.
   *
   * `buildKey` writes and `invalidateScope` scans, and both have to agree
   * byte for byte or the scan matches nothing and the invalidation silently does
   * NOTHING — no error, no log, just a cache that never clears. That is not
   * hypothetical: adding `envNamespace` to `buildKey` on 05/09 left the pattern
   * behind, and the two disagreed until a guard spec walked the AST and found
   * it. `invalidateScope` has no production caller yet, so nothing broke — the
   * first caller would have been the one to discover it, in production.
   *
   * One definition, two readers. เขียนกับล้างต้องอ่านสูตรเดียวกัน
   */
  private keyPrefix(endpoint: CacheEndpoint, scopeSig: string): string {
    return `${KEY_PREFIX}:${KEY_VERSION}:${this.envNamespace}:${endpoint}:${scopeSig}`;
  }

  /**
   * Full Redis key: `qcache:v1:<envNs>:<endpoint>:<scopeSig>:<paramsSig>`.
   * The scope signature sits BETWEEN the endpoint and the params so two scopes
   * with identical params land on different keys — the no-leak guarantee.
   * Exposed (not private) so tests and diagnostics can assert the exact key.
   *
   * [FIX-20260905-REDISNS] `<envNs>` was ADDED on 05/09/2026 and it is the
   * second no-leak guarantee, not decoration. The scope signature isolates one
   * CALLER from another; it does nothing about one ENVIRONMENT from another,
   * because a superadmin's scope resolves to the constant `ALL` on every
   * deployment alike. With staging and production sharing one Redis database,
   * production's broadcast history screen was served staging's rows. The segment
   * sits directly after the version so a whole environment stays greppable and
   * so bumping `KEY_VERSION` still busts everything at once.
   * ⚠️ Changing the segment's POSITION is a cache-wide bust, same as a version
   *    bump — harmless, but it costs one cold repopulate everywhere.
   */
  buildKey(
    endpoint: CacheEndpoint,
    scope: ScopeSet,
    params: Record<string, unknown>,
  ): string {
    const scopeSig = computeScopeSignature(scope);
    const paramsSig = computeParamsSignature(params);
    return `${this.keyPrefix(endpoint, scopeSig)}:${paramsSig}`;
  }

  /** TTL with ±jitterPct spread so entries created together don't all expire at once. */
  private jitteredTtl(baseSeconds: number): number {
    const pct = this.config.jitterPct;
    if (!pct || pct <= 0) return baseSeconds;
    // Symmetric jitter in [-pct%, +pct%], never below 1s.
    const span = baseSeconds * (pct / 100);
    const delta = (Math.random() * 2 - 1) * span;
    return Math.max(1, Math.round(baseSeconds + delta));
  }

  /**
   * Cache-aside wrapper.
   *
   * Returns the cached payload when fresh, else runs `producer` (the live query),
   * caches its result, and returns it. `T` must be JSON round-trippable — the
   * cached value is exactly `JSON.parse(JSON.stringify(producerResult))`, so a
   * cache HIT is byte-identical to a MISS for the same scope+params. Callers that
   * already return plain JSON (all three target endpoints do) get identity for
   * free; the only accepted deviation is latency + staleness ≤ TTL.
   *
   * Bypass (ttl<=0): the producer runs live and nothing is cached — identical to
   * not calling this method at all.
   */
  async wrap<T>(options: WrapOptions, producer: () => Promise<T>): Promise<T> {
    const ttl = this.ttlFor(options.endpoint);

    // Knob off ⇒ live query, no cache, no single-flight. Exactly today's path.
    if (!ttl || ttl <= 0) {
      return producer();
    }

    const key = this.buildKey(options.endpoint, options.scope, options.params);

    // 1) Try Redis (shared across users + instances).
    const cached = await this.readCache<T>(key);
    if (cached !== undefined) return cached;

    // 2) In-process single-flight: collapse concurrent cold-key callers onto one
    //    producer run. Correct per instance; across M instances the worst case is
    //    M redundant runs, which is fine for a cache warm (worst case = duplicate
    //    compute, never data corruption).
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;

    const run = (async (): Promise<T> => {
      const result = await producer();
      // Store a plain JSON snapshot so a later HIT === this MISS structurally.
      await this.writeCache(key, result, this.jitteredTtl(ttl));
      return result;
    })();

    this.inflight.set(key, run);
    try {
      return await run;
    } finally {
      this.inflight.delete(key);
    }
  }

  /**
   * Reads + parses a cached value. Returns `undefined` on miss OR on any Redis
   * error (fail-open — the caller then runs the live producer). `undefined` is
   * the miss sentinel because a legitimately cached value could be `null`.
   */
  private async readCache<T>(key: string): Promise<T | undefined> {
    try {
      const raw = await this.redis.getClient().get(key);
      if (raw === null) return undefined;
      return JSON.parse(raw) as T;
    } catch (error) {
      this.logger.warn(
        `readCache miss-degrade for ${key}: ${(error as Error).message}`,
      );
      return undefined;
    }
  }

  /** Write-through with EX ttl. Non-fatal: a failed write just means the next read re-runs. */
  private async writeCache(
    key: string,
    value: unknown,
    ttlSeconds: number,
  ): Promise<void> {
    try {
      await this.redis
        .getClient()
        .set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (error) {
      this.logger.warn(
        `writeCache skipped for ${key}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * OPTIONAL proactive invalidation seam — NOT wired to any write path today
   * (TTL-expiry is the v1 strategy; owner accepts bounded staleness). A write
   * that mutates a scope's data COULD call this to bust that scope's entries for
   * a page. Left unused on purpose: coupling writers to the cache namespace is
   * debt we don't take until a page proves it needs sub-TTL freshness.
   *
   * DB-EFFECT: deletes Redis keys only. Never touches Mongo.
   */
  async invalidateScope(
    endpoint: CacheEndpoint,
    scope: ScopeSet,
  ): Promise<void> {
    const scopeSig = computeScopeSignature(scope);
    const pattern = `${this.keyPrefix(endpoint, scopeSig)}:*`;
    try {
      const client = this.redis.getClient();
      const keys: string[] = [];
      // SCAN, not KEYS — KEYS blocks Redis on a large keyspace.
      let cursor = '0';
      do {
        const [next, batch] = await client.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          100,
        );
        cursor = next;
        keys.push(...batch);
      } while (cursor !== '0');
      if (keys.length > 0) await client.del(...keys);
    } catch (error) {
      this.logger.warn(
        `invalidateScope skipped for ${pattern}: ${(error as Error).message}`,
      );
    }
  }
}
