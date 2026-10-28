import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomBytes } from 'node:crypto';
import type Redis from 'ioredis';
import { Model } from 'mongoose';

import {
  authConfig,
  hookCacheConfig,
  realtimeConfig,
} from '@/config/app.config';
import { RedisService } from '@/infra/redis/redis.service';

import { Hook } from './schemas/hook.schema';

/**
 * Hook cache — shared, self-healing. Ported 1:1 from
 * legacy-api/src/services/hook/hookService.js (209 lines).
 *
 * Layers:
 *   L1  in-process Map, short TTL   -> avoids a Redis round-trip on hot aliases
 *   L2  Redis, long TTL             -> SHARED across instances + self-heals
 *   src MongoDB                     -> source of truth
 *
 * Why this exists at all: LINE calls the webhook on **every inbound message**.
 * A direct `findOne({alias})` there is one MongoDB query per message on the
 * hottest path in the system. Legacy serves it from a 15-second in-process map.
 *
 * Why it fixes the intermittent-401 / stale-secret problem:
 *   - L2 is shared, so every instance sees the same secret (no per-instance
 *     file cache that can silently diverge).
 *   - TTL means even a missed invalidation self-corrects within the L2 TTL.
 *   - On hook save, `cacheHook` refreshes L2 and publishes an invalidate so
 *     every instance drops its L1 immediately (no waiting, no restart).
 *
 * Everything Redis-related is best-effort: if Redis is unavailable we fall back
 * to MongoDB transparently, so the webhook path is never worse than a direct DB
 * read. R10: values are cached verbatim and never masked — the LINE signature
 * guard reads `line_secret` from here, and a masked secret is not a usable key.
 */

/** A cached hook is a plain JSON object, never a Mongoose document. */
export type CachedHook = Record<string, unknown>;

/** Which layer answered. Part of the contract — the webhook controller logs it. */
export type HookCacheSource = 'l1' | 'redis' | 'db' | 'miss' | null;

export interface HookLookupResult {
  hook: CachedHook | null;
  source: HookCacheSource;
}

interface L1Entry {
  hook: CachedHook;
  expiresAt: number;
}

@Injectable()
export class HookCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(HookCacheService.name);

  /** alias -> { hook, expiresAt } */
  private readonly l1 = new Map<string, L1Entry>();

  private readonly redisKeyPrefix: string;
  private readonly invalidateChannel: string;
  private readonly redisTtlSec: number;
  private readonly l1TtlMs: number;

  /** 6 random bytes per process — lets us ignore our own pub/sub messages. */
  private readonly instanceId = randomBytes(6).toString('hex');

  private subscriber: Redis | null = null;
  private subscriberInit: Promise<void> | null = null;
  private destroyed = false;

  constructor(
    @InjectModel(Hook.name) private readonly hookModel: Model<Hook>,
    private readonly redis: RedisService,
    @Inject(hookCacheConfig.KEY)
    config: ConfigType<typeof hookCacheConfig>,
    @Inject(realtimeConfig.KEY)
    realtime: ConfigType<typeof realtimeConfig>,
    @Inject(authConfig.KEY)
    auth: ConfigType<typeof authConfig>,
  ) {
    this.redisTtlSec = config.redisTtlSeconds;
    this.l1TtlMs = config.l1TtlMs;

    const namespace = HookCacheService.cacheNamespace(
      realtime.wsEnv,
      auth.encryptionKey,
    );
    this.redisKeyPrefix = `hook:${namespace}:`;
    this.invalidateChannel = `hook:invalidate:${namespace}`;
  }

  /**
   * Namespace = environment + a fingerprint of ENCRYPTION_KEY.
   *
   * CRITICAL: on a Redis shared across environments (prod/dev/local), a bare
   * `hook:<alias>` key lets one env read a hook another env encrypted with a
   * different key — undecryptable, so intermittent 401s. Keying by the
   * ENCRYPTION_KEY fingerprint guarantees a process only reads entries it can
   * actually decrypt. WS_ENV is in there only so a human can grep the keyspace.
   *
   * Copied verbatim from hookService.js:33-41.
   */
  private static cacheNamespace(
    wsEnv: string | undefined,
    encryptionKey: string | undefined,
  ): string {
    let fingerprint = 'nokey';
    try {
      const key = encryptionKey || '';
      if (key) {
        fingerprint = createHash('sha256')
          .update(key)
          .digest('hex')
          .slice(0, 8);
      }
    } catch {
      /* fall back to nokey */
    }
    const env = String(wsEnv || 'na').replace(/[^\w-]/g, '');
    return `${env}.${fingerprint}`;
  }

  /** Exposed for tests/diagnostics — never used to build a key elsewhere. */
  getRedisKey(alias: string): string {
    return this.redisKeyPrefix + alias;
  }

  getInvalidateChannel(): string {
    return this.invalidateChannel;
  }

  getInstanceId(): string {
    return this.instanceId;
  }

  // ─────────────────────────── L1 (in-process) ───────────────────────────

  private l1Get(alias: string): CachedHook | null {
    const entry = this.l1.get(alias);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
      this.l1.delete(alias);
      return null;
    }
    return entry.hook;
  }

  private l1Set(alias: string, hook: CachedHook): void {
    if (!alias) return;
    this.l1.set(alias, { hook, expiresAt: Date.now() + this.l1TtlMs });
  }

  private l1Del(alias: string): void {
    if (alias) this.l1.delete(alias);
  }

  // ───────────────────────── L2 (Redis, shared) ──────────────────────────
  // Every method here is fail-open: a Redis outage degrades this cache to
  // plain MongoDB reads, it never errors a request.

  private async redisGet(alias: string): Promise<CachedHook | null> {
    try {
      const raw = await this.redis.getClient().get(this.redisKeyPrefix + alias);
      return raw ? (JSON.parse(raw) as CachedHook) : null;
    } catch {
      return null; // degrade to Mongo
    }
  }

  private async redisSet(hook: CachedHook): Promise<void> {
    const alias = hook?.alias;
    if (!hook || typeof alias !== 'string' || !alias) return;
    try {
      // ioredis equivalent of node-redis `setEx(key, ttl, value)`.
      await this.redis
        .getClient()
        .set(
          this.redisKeyPrefix + alias,
          JSON.stringify(hook),
          'EX',
          this.redisTtlSec,
        );
    } catch {
      /* non-fatal */
    }
  }

  private async redisDel(alias: string): Promise<void> {
    try {
      await this.redis.getClient().del(this.redisKeyPrefix + alias);
    } catch {
      /* non-fatal */
    }
  }

  private async publishInvalidate(alias: string): Promise<void> {
    // RedisService.publish already swallows its own failures.
    await this.redis.publish(
      this.invalidateChannel,
      JSON.stringify({ alias, sender: this.instanceId }),
    );
  }

  // ───────── cross-instance L1 invalidation via pub/sub (best-effort) ─────────

  /**
   * Subscribes a **duplicated** connection to the invalidate channel. A
   * subscribed ioredis client cannot run normal commands, which is why this
   * must not be the shared client.
   *
   * Init failure is logged and retryable — L1 stays bounded by its short TTL,
   * so a missing subscriber degrades rather than breaks. Fire-and-forget: safe
   * to call on every lookup, exactly as legacy does (hookService.js:149).
   */
  private ensureSubscriber(): Promise<void> {
    if (this.subscriberInit) return this.subscriberInit;
    if (this.destroyed) return Promise.resolve();

    this.subscriberInit = (async () => {
      try {
        const sub = this.redis.getClient().duplicate();
        sub.on('error', (error: Error) => {
          this.logger.error(`subscriber error: ${error.message}`);
        });
        sub.on('message', (_channel: string, message: string) => {
          this.handleInvalidateMessage(message);
        });
        await sub.subscribe(this.invalidateChannel);
        this.subscriber = sub;
        this.logger.log('cross-instance invalidation subscriber ready');
      } catch (error) {
        this.logger.error(
          `subscriber init failed (L1 still bounded by TTL): ${
            (error as Error).message
          }`,
        );
        this.subscriberInit = null; // allow a later retry
      }
    })();

    return this.subscriberInit;
  }

  /**
   * Drops L1 for an alias another instance just changed.
   * Our own messages are ignored — we already hold the fresh value, and
   * dropping it would throw away the write-through we just did.
   * Malformed messages are ignored, never thrown.
   */
  private handleInvalidateMessage(message: string): void {
    try {
      const parsed = JSON.parse(message) as {
        alias?: unknown;
        sender?: unknown;
      };
      if (parsed.sender === this.instanceId) return; // ignore our own events
      if (typeof parsed.alias === 'string' && parsed.alias) {
        this.l1Del(parsed.alias);
      }
    } catch {
      /* ignore malformed messages */
    }
  }

  // ─────────────────────────────── Public API ────────────────────────────
  // Four functions, same names and shapes as legacy — see hookService.js:204.

  /** Read path: L1 → L2 → Mongo, populating each layer on the way down. */
  async getHookByAliasWithSource(
    alias: string | undefined | null,
  ): Promise<HookLookupResult> {
    if (!alias) return { hook: null, source: null };
    void this.ensureSubscriber(); // fire-and-forget; safe to call repeatedly

    const fromL1 = this.l1Get(alias);
    if (fromL1) return { hook: fromL1, source: 'l1' };

    const fromRedis = await this.redisGet(alias);
    if (fromRedis) {
      this.l1Set(alias, fromRedis);
      return { hook: fromRedis, source: 'redis' };
    }

    const hook = await this.hookModel
      .findOne({ alias })
      .lean<CachedHook>()
      .exec();
    if (hook) {
      // Normalise so an L1 hit and an L2 hit are structurally identical —
      // see cacheHook() for why this matters.
      const plain = JSON.parse(JSON.stringify(hook)) as CachedHook;
      this.l1Set(alias, plain);
      await this.redisSet(plain);
      return { hook: plain, source: 'db' };
    }
    return { hook: null, source: 'miss' };
  }

  async getHookByAlias(
    alias: string | undefined | null,
  ): Promise<CachedHook | null> {
    const { hook } = await this.getHookByAliasWithSource(alias);
    return hook;
  }

  /**
   * Write-through. Callers pass a fresh, complete hook (created/updated doc).
   * Refreshes L2 + our L1 and tells peers to drop their L1 so edits propagate
   * immediately instead of waiting out the TTL.
   */
  async cacheHook<T extends CachedHook>(
    hook: T | null | undefined,
    options: { previousAlias?: string } = {},
  ): Promise<T | null> {
    if (!hook && !options.previousAlias) return null;
    try {
      // Alias changed? Evict the old key first, or the old alias keeps
      // resolving to a stale hook until its TTL runs out.
      if (options.previousAlias && options.previousAlias !== hook?.alias) {
        await this.invalidateHookCache(options.previousAlias);
      }
      if (hook && typeof hook.alias === 'string' && hook.alias) {
        // Normalise to a plain JSON object so the cached shape matches what a
        // Redis read returns (string _id, ISO dates). Without this, L1 hands
        // back Mongoose ObjectIds and Dates while L2 hands back strings, so
        // behaviour depends on which layer answered — and TypeScript cannot
        // catch it, because both are typed the same.
        const plain = JSON.parse(JSON.stringify(hook)) as CachedHook;
        this.l1Set(plain.alias as string, plain);
        await this.redisSet(plain);
        await this.publishInvalidate(plain.alias as string);
      }
    } catch (error) {
      this.logger.error(`cacheHook failed: ${(error as Error).message}`);
    }
    return hook ?? null;
  }

  async invalidateHookCache(alias: string | undefined | null): Promise<void> {
    if (!alias) return;
    this.l1Del(alias);
    await this.redisDel(alias);
    await this.publishInvalidate(alias);
  }

  /**
   * [FEAT-20260917-LINEQUOTA-CACHE] 5-minute cache for LINE quota summary.
   * Scoped by channel ('line') and environment namespace.
   */
  private getLineQuotaKey(hookId: string): string {
    return `hook:quota:line:${this.redisKeyPrefix}${hookId}`;
  }

  async getLineQuota(hookId: string): Promise<Record<string, unknown> | null> {
    if (!hookId) return null;
    try {
      const client = this.redis.getClient();
      const raw = await client.get(this.getLineQuotaKey(hookId));
      if (!raw) return null;
      return JSON.parse(raw) as Record<string, unknown>;
    } catch (error) {
      this.logger.warn(
        `getLineQuota cache read failed: ${(error as Error).message}`,
      );
      return null;
    }
  }

  async setLineQuota(
    hookId: string,
    quota: Record<string, unknown>,
    ttlSec = 300,
  ): Promise<void> {
    if (!hookId || !quota) return;
    try {
      const client = this.redis.getClient();
      await client.set(
        this.getLineQuotaKey(hookId),
        JSON.stringify(quota),
        'EX',
        ttlSec,
      );
    } catch (error) {
      this.logger.warn(
        `setLineQuota cache write failed: ${(error as Error).message}`,
      );
    }
  }

  /**
   * [FEAT-20260917-INSIGHTFOLLOWERS] 5-minute cache for LINE followers insight.
   * Scoped by channel ('line') and environment namespace.
   */
  private getLineFollowersKey(hookId: string): string {
    return `hook:followers:line:${this.redisKeyPrefix}${hookId}`;
  }

  async getLineFollowers(
    hookId: string,
  ): Promise<Record<string, unknown> | null> {
    if (!hookId) return null;
    try {
      const client = this.redis.getClient();
      const raw = await client.get(this.getLineFollowersKey(hookId));
      if (!raw) return null;
      return JSON.parse(raw) as Record<string, unknown>;
    } catch (error) {
      this.logger.warn(
        `getLineFollowers cache read failed: ${(error as Error).message}`,
      );
      return null;
    }
  }

  async setLineFollowers(
    hookId: string,
    data: Record<string, unknown>,
    ttlSec = 300,
  ): Promise<void> {
    if (!hookId || !data) return;
    try {
      const client = this.redis.getClient();
      await client.set(
        this.getLineFollowersKey(hookId),
        JSON.stringify(data),
        'EX',
        ttlSec,
      );
    } catch (error) {
      this.logger.warn(
        `setLineFollowers cache write failed: ${(error as Error).message}`,
      );
    }
  }

  /** Test seam: drops the whole L1 without touching Redis. */
  clearLocalCache(): void {
    this.l1.clear();
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    const sub = this.subscriber;
    this.subscriber = null;
    this.subscriberInit = null;
    if (!sub) return;
    try {
      await sub.quit();
    } catch {
      sub.disconnect();
    }
  }
}
