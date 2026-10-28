/**
 * [FEAT-20261016-CUSTCACHE] Per-customer answer cache — the read/fetch/write around ONE
 * endpoint call. The rules of what is kept: `customer-cache.policy.ts`.
 *
 * Two modes, chosen by the CALLER of `getCombinedData` (never by this file):
 *   · `use`     — the webhook prefetch (a customer's message): a kept answer is returned
 *                 without calling the partner; otherwise call, then keep per policy.
 *   · `refresh` — an admin asked for fresh data (Refresh button / chat opened): ALWAYS call,
 *                 then keep per policy — so the bot sees what the admin just saw.
 * A transient failure in `refresh` leaves the kept answer alone (it is still the last truth).
 *
 * 🔴 FAIL-OPEN. No Redis, a read error, a write error or an unreadable entry = the live call,
 *    exactly as with no cache. The cache can make a message cheaper, never make it fail.
 * ⚠️ What is kept is the partner's answer (names, phones, contract — the same data the old
 *    system kept in Redis for 12 h). It lives only in Redis, under the env namespace.
 */
import type { CustomerDataCachePolicy } from '@/modules/customer-provider';

import {
  customerAnswerTtlSec,
  type CacheableAnswer,
} from './customer-cache.policy';

export type CustomerCacheMode = 'use' | 'refresh';

/** The two Redis calls the cache needs (ioredis shape). */
export interface CustomerCacheRedis {
  get(key: string): Promise<string | null>;
  setex(key: string, seconds: number, value: string): Promise<unknown>;
}

export async function fetchThroughCustomerCache<
  R extends CacheableAnswer,
>(input: {
  mode: CustomerCacheMode;
  policy: CustomerDataCachePolicy;
  /** null = Redis unavailable ⇒ live call, nothing kept */
  redis: CustomerCacheRedis | null;
  key: string;
  isProfile: boolean;
  /** the live call — the same one the endpoint makes with no cache */
  fetch: () => Promise<R>;
  /** label for log lines (the endpoint key) — never the customer's data */
  label: string;
  log: (msg: string) => void;
}): Promise<{ result: R; fromCache: boolean }> {
  const { redis, key, label, log } = input;

  if (input.mode === 'use' && redis) {
    try {
      const raw = await redis.get(key);
      if (raw) {
        const parsed = JSON.parse(raw) as { result?: R } | null;
        if (parsed && parsed.result) {
          log(`[CUSTOM TOOL] [${label}] customer cache HIT`);
          return { result: parsed.result, fromCache: true };
        }
      }
    } catch (e: unknown) {
      log(
        `[CUSTOM TOOL] [${label}] customer cache read error: ${(e as Error).message}`,
      );
    }
  }

  const result = await input.fetch();
  const ttl = customerAnswerTtlSec(input.policy, input.isProfile, result);
  if (ttl > 0 && redis) {
    try {
      await redis.setex(
        key,
        ttl,
        JSON.stringify({ cached_at: new Date().toISOString(), result }),
      );
      log(`[CUSTOM TOOL] [${label}] customer cache SET (ttl=${ttl}s)`);
    } catch (e: unknown) {
      log(
        `[CUSTOM TOOL] [${label}] customer cache write error: ${(e as Error).message}`,
      );
    }
  }
  return { result, fromCache: false };
}
