/**
 * [FEAT-20261016-CUSTCACHE] One customer-cache SESSION per `getCombinedData` call — the wiring that
 * used to sit inside `custom-tool.service.ts` (moved out 16/10 so that 1,800-line file only gets
 * call-site lines: owner "ห้ามบวมไฟล์").
 *
 * `openCustomerCache` answers null — and the service then runs exactly as before this feature —
 * unless ALL of: the caller asked for a mode, a customer is named, the active provider declares a
 * policy (loan). shop-api declares none ⇒ always null ⇒ Redis is never touched.
 * The session remembers which endpoints it answered from the cache, so the service can skip the
 * audit row and the `raw_profile_data` restamp for those (rules: `customer-cache.policy.ts`).
 *
 * revert: see `../../customer-provider/features/customer-data-cache.ts`.
 */
import { providerCustomerDataCache } from '@/modules/customer-provider';

import { customerCacheKey } from './customer-cache.policy';
import {
  fetchThroughCustomerCache,
  type CustomerCacheMode,
  type CustomerCacheRedis,
} from './customer-cache.store';

/** The endpoint fields the session needs. */
interface CacheableEndpoint {
  key: string;
  is_profile?: boolean;
}

export interface CustomerCacheSession {
  /** the live call, or a kept answer standing in for it */
  fetch<R extends { success?: boolean; status?: number }>(
    ep: CacheableEndpoint,
    live: () => Promise<R>,
  ): Promise<R>;
  /** true when this endpoint's answer came from the cache in this session */
  servedFromCache(endpointKey: string): boolean;
}

export function openCustomerCache(input: {
  mode: CustomerCacheMode | undefined;
  userId: string;
  tool: { _id: unknown; updated_at?: unknown };
  envNamespace: string;
  /** the Redis client getter — a throw or null means "no cache", never an error */
  redis: () => unknown;
  log: (msg: string) => void;
}): CustomerCacheSession | null {
  const { mode } = input;
  const policy = input.userId && mode ? providerCustomerDataCache() : null;
  if (!policy || !mode) return null;

  let client: CustomerCacheRedis | null;
  try {
    client = (input.redis() as CustomerCacheRedis | null) ?? null;
  } catch {
    client = null;
  }
  const served = new Set<string>();

  return {
    async fetch(ep, live) {
      const out = await fetchThroughCustomerCache({
        mode,
        policy,
        redis: client,
        key: customerCacheKey({
          envNamespace: input.envNamespace,
          toolId: input.tool._id,
          toolUpdatedAt: input.tool.updated_at,
          endpointKey: ep.key,
          userId: input.userId,
        }),
        isProfile: ep.is_profile === true,
        fetch: live,
        label: ep.key,
        log: input.log,
      });
      if (out.fromCache) served.add(ep.key);
      return out.result;
    },
    servedFromCache: (endpointKey) => served.has(endpointKey),
  };
}
