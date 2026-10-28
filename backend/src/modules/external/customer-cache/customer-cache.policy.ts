/**
 * [FEAT-20261016-CUSTCACHE] Per-customer answer cache — WHAT is kept and for how long. Pure.
 * ===========================================================================
 * The provider declares three numbers (`CustomerDataCachePolicy`, loan: 12 h / 30 min / 12 h);
 * this file turns one partner answer into "keep it N seconds" or "do not keep it".
 *
 *   profile endpoint (`is_profile`):
 *     · success + HTTP 200                       → found     → `foundTtlSec`
 *     · HTTP 404, or a 2xx the rules call a fail → not found → `notFoundTtlSec`
 *     · anything else (0 = timeout/network, 5xx, 401/403, 408/429, circuit open)
 *                                                → transient → NOT kept
 *   any other per-customer endpoint:
 *     · success + HTTP 200                       → `otherTtlSec`
 *     · anything else                            → NOT kept (old system: success only)
 *
 * ⚠️ The one deliberate difference from the old system (`externalApiService.js:877-883`), which
 *    kept EVERY non-success profile answer 30 min: a partner blip would show a linked customer
 *    as unlinked for half an hour. Owner's words were "ไม่เจอ 30 นาที" — not found — so only a
 *    definite answer is kept. To match the old code exactly: return `notFoundTtlSec` for every
 *    non-success profile answer in `classifyCustomerAnswer`.
 *
 * The key carries the tool's `updated_at`: editing the tool (a path, a rule, the base URL)
 * orphans every answer cached under the old config instead of serving it for 12 more hours.
 *
 * revert: see `../../customer-provider/features/customer-data-cache.ts`.
 */
import type { CustomerDataCachePolicy } from '@/modules/customer-provider';

/** The parts of a call result the policy reads. */
export interface CacheableAnswer {
  success?: boolean;
  status?: number;
}

export type CustomerAnswerKind =
  'found' | 'not_found' | 'other_ok' | 'transient';

export function classifyCustomerAnswer(
  isProfile: boolean,
  r: CacheableAnswer,
): CustomerAnswerKind {
  const status = typeof r.status === 'number' ? r.status : 0;
  if (r.success === true && status === 200) {
    return isProfile ? 'found' : 'other_ok';
  }
  if (isProfile && (status === 404 || (status >= 200 && status < 300))) {
    return 'not_found';
  }
  return 'transient';
}

/** Seconds to keep this answer; 0 = do not keep. */
export function customerAnswerTtlSec(
  policy: CustomerDataCachePolicy,
  isProfile: boolean,
  r: CacheableAnswer,
): number {
  const ttl = {
    found: policy.foundTtlSec,
    not_found: policy.notFoundTtlSec,
    other_ok: policy.otherTtlSec,
    transient: 0,
  }[classifyCustomerAnswer(isProfile, r)];
  return Number.isFinite(ttl) && ttl > 0 ? Math.floor(ttl) : 0;
}

/**
 * `custool:<env ns>:cust:<toolId>:<tool updated_at ms>:<ENDPOINT>:<lineUserId>` — the same
 * `custool:<ns>` root as the shared site-rules cache (`[FIX-20260905-GLOBALNS]`: a dumped DB
 * shares tool ids across deployments), but a different branch, and a USER in the key — the
 * shared key has none, which is exactly why per-customer answers can never go there.
 */
export function customerCacheKey(input: {
  envNamespace: string;
  toolId: unknown;
  toolUpdatedAt: unknown;
  endpointKey: string;
  userId: string;
}): string {
  const at = input.toolUpdatedAt
    ? new Date(input.toolUpdatedAt as string | number | Date).getTime()
    : 0;
  const version = Number.isFinite(at) ? at : 0;
  return `custool:${input.envNamespace}:cust:${String(input.toolId)}:${version}:${input.endpointKey.toUpperCase()}:${input.userId}`;
}
