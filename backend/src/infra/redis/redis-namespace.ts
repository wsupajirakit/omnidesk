// [FIX-20260905-REDISNS] The environment segment every SHARED Redis key must carry.
//
// WHAT: turns `(WS_ENV, MONGODB_URI)` into one short segment — `<env>.<db8>` —
// to embed in any Redis key whose value belongs to ONE environment only.
//
// WHY IT EXISTS. Staging and production run against the SAME Redis host on the
// SAME `REDIS_DB` (confirmed by the owner, 05/09/2026). `redis.service.ts:36-38`
// promises "logical DB isolation: a shared Redis host can serve prod (0) and dev
// (1)" — the deployment does not keep that promise, so a key WITHOUT an
// environment segment is read and written by both environments at once. The
// broadcast history screen on production served staging's rows for exactly this
// reason: the caller was a superadmin, whose scope signature is the constant
// `ALL`, so both environments computed a byte-identical key.
//
// WHY BOTH HALVES, not just the env. `WS_ENV` defaults to `'dev'`
// (`env.schema.ts:429`), so two environments that never set it collide silently
// — the failure mode is invisible precisely when the variable was forgotten,
// which is the case worth defending against. The DATABASE NAME always differs
// between environments, so it disambiguates even then. Copied deliberately from
// `translation-dict-cache.service.ts:178-189`, the one place in this repo that
// already had this right; the comment there states the same rule and this file
// exists so the next caller does not have to rediscover it. ⚠️ That service
// still builds its own namespace inline — it is NOT changed here, because
// rewriting a live cache's key format is a separate, riskier job than adding a
// segment to keys that never had one.
//
// THE DIRECTION OF FAILURE IS THE POINT. A namespace that CHANGES costs one cold
// cache on deploy. A namespace that COLLIDES leaks one environment's data into
// another. Only the first one repairs itself by waiting.
//
// DB-EFFECT: pure function. No Mongo, no Redis, no I/O — string hashing only.
//
// revert: delete this file and inline the bare key back into each caller
//         (`scoped-query-cache.service.ts` buildKey, `handoff-callback.service.ts`
//         receiveCallback). Reverting re-opens the cross-environment leak.

import { createHash } from 'node:crypto';

/** Used when `WS_ENV` is missing entirely — still deterministic, still greppable. */
const ENV_FALLBACK = 'na';
/** Used when no database name can be read out of the URI. */
const DB_FALLBACK = 'nodb';

/**
 * `<env>.<8 hex of sha256(database name)>` — e.g. `dev.9f2c1ab4`.
 *
 * Kept human-readable in the first half so the Redis keyspace stays greppable
 * per environment (`--scan --pattern 'qcache:v1:prod.*'`), and hashed in the
 * second so a database name never appears in a key an operator might paste.
 *
 * The database name is the last path segment of the URI with any query string
 * removed — the same parse `translation-dict-cache.service.ts` performs. A URI
 * carrying no database name yields the host:port instead; that is not a database
 * name, but it is still stable and still differs between environments, so the
 * isolation holds. ห้ามแก้สูตรนี้เล่น ๆ — เปลี่ยนแล้วแคชเย็นทั้งระบบ
 */
export function redisEnvNamespace(
  wsEnv: string | undefined | null,
  mongoUri: string | undefined | null,
): string {
  const env =
    String(wsEnv || ENV_FALLBACK).replace(/[^\w-]/g, '') || ENV_FALLBACK;
  let db = DB_FALLBACK;
  try {
    const name = (
      String(mongoUri || '')
        .split('/')
        .pop() ?? ''
    ).split('?')[0];
    if (name) {
      db = createHash('sha256').update(name).digest('hex').slice(0, 8);
    }
  } catch {
    /* keep DB_FALLBACK — a namespace is never allowed to throw on a read path */
  }
  return `${env}.${db}`;
}
