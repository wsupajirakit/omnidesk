/**
 * ==== [FEAT-20260903-FIELDOPTIONS] slip's own answer to "what may I be set to?"
 *
 * This file belongs to the SLIP module because only the slip module knows what a
 * provider name means. The central options pipe (`modules/options/`) holds one
 * line pointing at this function and no knowledge of vendors at all — slip is one
 * SUB-ENTRY of that pipe, not its subject.
 *
 * 🔴 BUILT FROM THE LIVE REGISTRY, NEVER FROM A LIST TYPED HERE. `SLIP_PROVIDERS`
 * is the only thing that can actually resolve a name at verification time, so it
 * is the only honest source for what may be offered. A hand-written list would be
 * a second copy of it, and the failure that follows is already recorded in this
 * codebase: a dashboard offers a vendor the back end has not registered, the
 * operator picks it, it saves, the runtime ignores it, and nothing anywhere says
 * the choice had no effect.
 *
 * ⚠️ VENDORS THAT ARE DOCUMENTED BUT NOT REGISTERED ARE NOT REPORTED. A client
 * can do nothing useful with "coming later" except render a choice that does
 * nothing. The day one is registered it appears here on its own, with no client
 * release — that is the property that keeps the two sides from drifting.
 *
 * revert: delete this file and its line in `modules/options/field-options.registry.ts`.
 */
import { SLIP_PROVIDERS } from './index';
import { siteSlipProviders } from './site-providers';

import type { SlipProvider } from './slip-provider.port';

/**
 * The i18n namespace clients look labels up under. Exported so a spec can assert
 * the contract without repeating the string, and so the FE has one thing to
 * mirror rather than a pattern to reconstruct.
 */
export const SLIP_PROVIDER_LABEL_NS = 'field_options.slip_provider';

/**
 * The options a hook's `slip_provider` may be set to, in display order.
 *
 * 🔴 THE EMPTY VALUE IS FIRST AND IT IS A REAL, SUPPORTED STATE — not "unset and
 * therefore broken". Every hook in existence holds `''`; `''`, absent and an
 * unregistered name all resolve to the default provider. Offering it as a first
 * class choice is what lets an operator RETURN to that state after picking a
 * vendor, and it is why an environment that sets nothing keeps working.
 *
 * ⚠️ Names are sorted so the order does not depend on registry insertion order —
 * a list whose order changes when someone reorders an unrelated map is a diff
 * nobody can explain.
 */
export const slipProviderOptions = (): {
  value: string;
  label_key: string;
  fallback_label?: string;
  is_default?: boolean;
}[] => [
  {
    value: '',
    label_key: `${SLIP_PROVIDER_LABEL_NS}.default`,
    /* [FEAT-20260903-FALLBACKLABEL] NO `fallback_label` here, on purpose. This
       entry is part of the contract that ships WITH a client — a client that
       renders this list at all was released knowing about it, so it has the
       translation. A fallback would be a sentence, and a sentence from the
       server cannot be re-worded or translated without a back-end release. The
       vendor entries below are the ones the server can add on its own, so they
       are the ones that carry a name. ตัวที่ ship มาพร้อม client ไม่ต้องมี fallback */
    is_default: true,
  },
  /* [FEAT-20261016-SLIPGUARDLOAN] + the active site's own (loan: slipguard) — `{}` on shop-api */
  ...Object.entries({ ...SLIP_PROVIDERS, ...siteSlipProviders() })
    .map(([name, provider]: [string, SlipProvider]) => ({
      // the REGISTRY key is what `resolveSlipProvider` matches on, so it is what
      // must be stored — `provider.name` is the provider's own idea of itself and
      // the two are only equal by convention.
      value: name,
      label_key: `${SLIP_PROVIDER_LABEL_NS}.${provider.name}`,
      /* A proper noun, not a translation: it is what the vendor calls itself.
         Derived from the SAME source as `label_key` so the two cannot disagree
         about which provider they describe — a client showing "Swiftcheck" under a
         key built from another name would be worse than showing the raw key. */
      fallback_label: provider.name,
    }))
    .sort((a, b) => a.value.localeCompare(b.value)),
];
