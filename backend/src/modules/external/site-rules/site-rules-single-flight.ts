/**
 * ==== [FEAT-20260814-SITERULESCACHE] One fetch per cold cache, not N ====
 *
 * WHAT: when the cache expires, the first caller to arrive fetches and the
 * others wait for that result instead of each firing their own upstream call.
 *
 * WHY: without it the cache turns a steady trickle of calls into a burst. Ten
 * members messaging in the same second after a 30-minute cache expiry produce
 * ten simultaneous upstream calls — the classic stampede. The cache alone fixes
 * the average; this fixes the spike. cache แก้ค่าเฉลี่ย · อันนี้แก้ตอนหมดอายุพร้อมกัน
 *
 * ⚠️ ONE RULE FOR EVERYONE (owner, 2026-08-13): there is no privileged caller.
 * A member's inbound message, an admin opening the panel, an admin pressing
 * Refresh — all take the same path. The only way an upstream call happens is
 * "cache is cold AND you got here first". No force-refresh path exists; see
 * `todo/task/13082026/SITE-RULES-CACHE-PLAN_13082026.md` §3.6 for how to add
 * one later if that is ever wanted. ทุกคนกติกาเดียวกัน ไม่มีใครลัดคิว
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️⚠️ NEVER THROW, NEVER HANG — every failure means "just fetch it yourself"
 * ═══════════════════════════════════════════════════════════════════════════
 * This wrapper sits in front of a call that already worked fine without it. So
 * every unhappy path — Redis down, lock unavailable, waiting too long, a
 * follower that finds nothing — resolves to running `fetchFn()` directly, which
 * is exactly today's behaviour. The worst case this file can produce is the
 * behaviour we already have; it can never produce an error the caller did not
 * have before, and it can never leave a request waiting forever.
 * พังยังไงก็ยิงเองเหมือนเดิม ห้าม error ห้ามค้าง
 *
 * revert: delete this folder + the `runSingleFlight` call in
 *         `custom-tool.service.ts:_fetchWithCache`.
 */

import type { Logger } from '@nestjs/common';

/** Redis client surface this file needs — structural, so tests need no server. */
export interface SingleFlightRedis {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    mode: 'PX',
    ttl: number,
    condition: 'NX',
  ): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

/**
 * How long a leader may hold the lock before others stop respecting it.
 * Sized above a realistic upstream timeout so a slow-but-working fetch is not
 * overtaken, and low enough that a crashed leader is not honoured for long.
 * The lock is also deleted in `finally`, so this is the crash ceiling, not the
 * normal lifetime.
 */
const LOCK_TTL_MS = 20_000;

/** Total time a follower waits for the leader's result before fetching itself. */
const FOLLOWER_MAX_WAIT_MS = 5_000;

/** Gap between a follower's cache re-reads while it waits. */
const FOLLOWER_POLL_MS = 120;

export interface SingleFlightArgs<T> {
  redis: SingleFlightRedis | null;
  /** Cache key being filled — the lock key is derived from it. */
  cacheKey: string;
  /** Reads the cache; a follower polls this to pick up the leader's result. */
  readCache: () => Promise<T | null>;
  /** The real upstream call. Runs for the leader, or for anyone falling back. */
  fetchFn: () => Promise<T>;
  logger?: Pick<Logger, 'warn'>;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `fetchFn` under a per-key lock, or reuse whatever the leader produced.
 *
 * Returns the leader's cached value when one appears within the wait window;
 * otherwise runs `fetchFn` itself. Never rejects for a lock-related reason —
 * only `fetchFn`'s own rejection propagates, exactly as it would without this
 * wrapper.
 */
export async function runSingleFlight<T>(
  args: SingleFlightArgs<T>,
): Promise<T> {
  const { redis, cacheKey, readCache, fetchFn, logger } = args;

  // No Redis (not configured, or the client threw upstream) ⇒ today's behaviour.
  if (!redis) return await fetchFn();

  const lockKey = `${cacheKey}:lock`;
  let acquired = false;

  try {
    acquired =
      (await redis.set(lockKey, '1', 'PX', LOCK_TTL_MS, 'NX')) !== null;
  } catch (err) {
    // A lock we cannot take is not a reason to fail the request.
    logger?.warn(
      `[SITE RULES] lock unavailable, fetching directly: ${(err as Error).message}`,
    );
    return await fetchFn();
  }

  if (acquired) {
    try {
      return await fetchFn();
    } finally {
      // Release even when the fetch threw, so a failure does not block the next
      // caller for the whole LOCK_TTL_MS. Failing to release is not fatal — the
      // TTL is the backstop.
      try {
        await redis.del(lockKey);
      } catch {
        /* TTL will clear it */
      }
    }
  }

  // Follower: someone else is fetching. Poll the cache for their result.
  const deadline = Date.now() + FOLLOWER_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(FOLLOWER_POLL_MS);
    try {
      const hit = await readCache();
      if (hit !== null && hit !== undefined) return hit;
    } catch {
      // An unreadable cache mid-wait: stop waiting and fetch it ourselves.
      break;
    }
  }

  // The leader was too slow, died, or wrote nothing. Fetching ourselves costs
  // one extra upstream call; waiting longer would cost the customer a reply.
  return await fetchFn();
}
