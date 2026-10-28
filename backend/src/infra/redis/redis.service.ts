import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import Redis from 'ioredis';

import { redisConfig } from '@/config/app.config';

/**
 * Shared Redis connection (caches, rate limiting, realtime publishing).
 *
 * Two behaviours are deliberate and load-bearing:
 *
 * 1. `warmup()` is called during bootstrap so the TCP handshake + AUTH + SELECT
 *    happen before the port opens. Without it the first caller after a deploy
 *    pays that cost — and login was always the victim, because rate limiting
 *    talks to Redis before the handler runs.
 * 2. Connecting never throws into the caller. Redis is a availability aid here,
 *    not a source of truth: if it is down, callers fail open (see RateLimit)
 *    rather than taking the whole API with them.
 */
@Injectable()
export class RedisService implements OnApplicationShutdown {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  constructor(
    @Inject(redisConfig.KEY)
    private readonly config: ConfigType<typeof redisConfig>,
  ) {
    this.client = new Redis({
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.password,
      // Logical DB isolation: a shared Redis host can serve prod (0) and dev (1)
      // without caches bleeding across environments.
      db: config.db,
      connectTimeout: config.connectTimeoutMs,
      // Commands issued before the socket is ready queue instead of throwing,
      // which keeps a cold start from failing requests outright.
      enableOfflineQueue: true,
      lazyConnect: true,
      maxRetriesPerRequest: 2,
    });

    this.client.on('error', (error: Error) => {
      this.logger.error(`Redis client error: ${error.message}`);
    });
  }

  /** Raw client for callers that need commands not wrapped here. */
  getClient(): Redis {
    return this.client;
  }

  /**
   * Opens the connection ahead of first use. Safe to call more than once —
   * ioredis ignores connect() on an already-connecting/ready client.
   */
  async warmup(): Promise<void> {
    if (this.client.status === 'ready' || this.client.status === 'connecting')
      return;

    await this.client.connect();
    this.logger.log(
      `Connected to ${this.config.host}:${this.config.port} db=${this.config.db}`,
    );
  }

  /**
   * Atomic counter with a TTL applied on first increment — the primitive behind
   * every fixed-window rate limit in the service.
   *
   * Returns the current count, or `null` when Redis is unreachable so callers
   * can decide their own fallback (they all fail open today).
   */
  async incrementWithTtl(
    key: string,
    ttlSeconds: number,
  ): Promise<number | null> {
    try {
      const count = await this.client.incr(key);
      // Only the first hit sets the expiry; later hits must not extend the
      // window, or a steady stream of requests would keep it alive forever.
      if (count === 1) await this.client.expire(key, ttlSeconds);
      return count;
    } catch (error) {
      this.logger.error(
        `incrementWithTtl failed for ${key}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * [FEAT-20260821-RATELADDER] Reads a counter without touching it. Returns 0
   * for a missing key and `null` when Redis is unreachable — the same fail-open
   * contract as `incrementWithTtl`, so a caller can tell "no strikes" from
   * "could not ask".
   */
  async getCount(key: string): Promise<number | null> {
    try {
      const raw = await this.client.get(key);
      return raw === null ? 0 : Number(raw) || 0;
    } catch (error) {
      this.logger.error(
        `getCount failed for ${key}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /** Publishes to a channel. Never throws — realtime is best-effort. */
  async publish(channel: string, payload: string): Promise<boolean> {
    try {
      await this.client.publish(channel, payload);
      return true;
    } catch (error) {
      this.logger.error(
        `publish to ${channel} failed: ${(error as Error).message}`,
      );
      return false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    try {
      await this.client.quit();
      this.logger.log('Redis connection closed');
    } catch {
      this.client.disconnect();
    }
  }
}
