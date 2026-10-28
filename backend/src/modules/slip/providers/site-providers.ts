/**
 * ==== [FEAT-20261016-SLIPGUARDLOAN] slip providers ONE SITE switches on ==========
 *
 * Owner 16/10/2026: the loan site verifies with SlipGuard beside Swiftcheck; shop-api must not move.
 *
 * The switchboard (`provider-entries.ts`) is the fleet-wide answer and stays as it is — SlipGuard
 * `enabled: false` there, so shop-api cannot select it and the second-provider tripwire stays green.
 * A customer provider may name extra providers from the SAME entries (`slipProviders`, read via
 * `providerSlipProviders()`); this returns those, keyed by each provider's own `name`, so
 * `resolveSlipProvider` and `slipProviderOptions` add them to the global map.
 *
 * Why the tripwire's two conditions hold for this scope:
 *   · payment leg — `providerSlipProviders()` is `[]` wherever the payment world is on, so a site
 *     provider's envelope can never reach Shop-API (loan has `payment: false`);
 *   · clone pair — `hooks/hook-clone/slip-pair.ts` keeps a provider and its key together.
 *
 * shop-api / unbound ⇒ the declaration is absent ⇒ `{}` ⇒ every slip answer is byte-identical.
 * A name the entries do not hold is ignored (same "unknown = not a provider" rule as the switchboard).
 *
 * revert: drop `slipProviders` from `customer-provider/providers/loan-v1/index.ts` (this then
 * returns `{}` everywhere), or delete this file and its two call sites.
 */
import { providerSlipProviders } from '@/modules/customer-provider';

import {
  SLIP_PROVIDER_ENTRIES,
  type SlipProviderEntry,
} from './provider-entries';

import type { SlipProvider } from './slip-provider.port';

/** The active site's extra providers, name → implementation. `{}` unless a site declares some. */
export const siteSlipProviders = (
  entries: readonly SlipProviderEntry[] = SLIP_PROVIDER_ENTRIES,
): Record<string, SlipProvider> => {
  const wanted = providerSlipProviders();
  if (wanted.length === 0) return {};
  return Object.fromEntries(
    entries
      .filter((e) => wanted.includes(e.provider.name))
      .map((e) => [e.provider.name, e.provider]),
  );
};
