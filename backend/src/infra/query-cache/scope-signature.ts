// [FEAT-20260808-QCACHE] Scope signature — the SECURITY-critical half of the key.
//
// The scoped query cache is SHARED across users. Two admins with the SAME
// permission scope share one cache entry (the whole point — one DB query, many
// readers). Two admins with DIFFERENT scopes must NEVER share an entry, or the
// first admin's scoped result leaks to the second — the classic multi-tenant
// cache-leak class (OWASP Multi-Tenant). This module turns a caller's effective
// allowed set into a stable, collision-resistant signature so the key isolates
// across scopes while sharing within one.
//
// DB-EFFECT: pure function. No Mongo, no Redis, no I/O — string hashing only.

import { createHash } from 'node:crypto';

/**
 * The caller's effective visibility, as the existing scoping code already
 * expresses it:
 *   - `null`  ⇒ super / unrestricted  ⇒ a single shared `ALL` bucket.
 *   - `[]`    ⇒ no access at all       ⇒ a single `NONE` bucket.
 *   - `[...]` ⇒ the allowed id list    ⇒ a hash of the SORTED, de-duped ids.
 *
 * `ids` are whatever fully determines what the caller can see for THAT endpoint
 * — allowed hook ids for insight, group ids for the log lists. Endpoints live in
 * separate key namespaces (see the `endpoint` segment in ScopedQueryCacheService),
 * so a hook-id set and a group-id set can never collide even if their hashes
 * matched: they are read under different endpoint prefixes.
 */
export type ScopeSet = readonly string[] | null;

/** Marker buckets — kept human-readable so the Redis keyspace is greppable. */
export const SCOPE_ALL = 'ALL';
export const SCOPE_NONE = 'NONE';

/**
 * Turns a scope set into a short, stable signature.
 *
 * `null` → `ALL`, `[]` → `NONE`, otherwise `h<12-hex>` of the sorted id list.
 * Sorting makes the signature order-independent (two callers with the same set
 * in a different order share one entry); de-duping keeps an accidental repeat
 * from forging a "different" scope.
 *
 * sha1/12-hex is a signature, not a secret — collision resistance here only has
 * to beat the number of DISTINCT scope sets in use (a handful of group clusters
 * in practice), and 48 bits is astronomically more than that.
 */
export function computeScopeSignature(scope: ScopeSet): string {
  if (scope === null) return SCOPE_ALL;
  const ids = [...new Set(scope.map((id) => String(id)))].sort();
  if (ids.length === 0) return SCOPE_NONE;
  return (
    'h' + createHash('sha1').update(ids.join(',')).digest('hex').slice(0, 12)
  );
}

/**
 * Stable hash of the query parameters. Object key ORDER must not change the
 * hash — two requests with the same params in a different serialisation are the
 * same query — so keys are sorted before hashing. `undefined`/`null`/empty-string
 * values are dropped so an absent filter and an explicitly-empty filter collapse
 * to the same key (they select the same rows).
 */
export function computeParamsSignature(
  params: Record<string, unknown>,
): string {
  const normalized: Record<string, string> = {};
  for (const key of Object.keys(params).sort()) {
    const value = params[key];
    if (value === undefined || value === null || value === '') continue;
    normalized[key] = String(value);
  }
  return createHash('sha1')
    .update(JSON.stringify(normalized))
    .digest('hex')
    .slice(0, 16);
}
