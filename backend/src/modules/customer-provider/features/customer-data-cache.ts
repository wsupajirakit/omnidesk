/**
 * [FEAT-20261016-CUSTCACHE] How long the partner's answers about ONE customer are kept — a
 * provider fact. The engine that applies it: `src/modules/external/customer-cache/`.
 * ===========================================================================
 * Owner 16/10/2026: the loan site caches like the old system (legacy-console
 * `externalApiService.js:825-925`) — a found profile 12 h, a profile that is not found 30 min,
 * every other per-customer endpoint 12 h on success — for every loan OA, changed in ONE file
 * in code (`providers/loan-v1/customer-data-cache.ts`), no env.
 *
 * 🔴 ABSENT = TODAY. A provider that declares nothing (shop-api) never reads or writes this cache:
 *    every message fetches live, exactly as before.
 * ⚠️ A deliberate difference from the old system: a TRANSIENT failure (partner down, timeout,
 *    401/403, circuit open) is NOT cached. The old code cached it as "not found" for 30 min,
 *    which shows a linked customer as unlinked for half an hour after a one-second blip. Only
 *    a definite answer — 404, or a 2xx the tool's rules call a failure — counts as not found.
 *    One line to change: `customer-cache.policy.ts` `classifyCustomerAnswer`.
 * ⚠️ 0 (or a negative) for a TTL = that kind of answer is not cached.
 *
 * revert: delete this file, `customerDataCache` on the port + loan_v1, the accessor in
 *         `active-provider.ts`, and `src/modules/external/customer-cache/` + its call site.
 */
export interface CustomerDataCachePolicy {
  /** the profile endpoint answered with the customer (success, HTTP 200) */
  readonly foundTtlSec: number;
  /** the profile endpoint definitely does not know the customer (404 / rule-failed 2xx) */
  readonly notFoundTtlSec: number;
  /** any other per-customer endpoint that succeeded (HTTP 200) */
  readonly otherTtlSec: number;
}
