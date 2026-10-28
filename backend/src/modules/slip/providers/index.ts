/**
 * ==== [FEAT-20260902-SLIPPROVIDER] the slip-provider registry ================
 *
 * The ONLY place that knows the providers exist as a set. Modelled on
 * `webhook/resolve-info/index.ts`, which states the convention this follows:
 * one entry per implementation, lookup is case-normalised, and **an unknown name
 * returns `null` rather than throwing** — this sits on a live conversation, and
 * a bad config value must not take the slip path down with it.
 *
 * ADDING ONE: write its file next to these, then add ONE line to
 * `provider-entries.ts` — the switchboard. This file never changes again.
 * [FEAT-20260903-PROVIDERSWITCH]
 *
 * ⚠️ PROVIDERS NEVER IMPORT EACH OTHER, and none of them imports the flow. A
 * provider is a leaf: request in, response out.
 *
 * ⚠️ `null` MEANS "NOT RECOGNISED", NOT "OFF". Whoever calls this must fall back
 * to the current provider — a typo in a config field must not stop slips being
 * verified.
 *
 * [FIX-20260903-REGISTRYCOMMENT] This block used to end "there is no caller yet".
 * That stopped being true when the per-call lookup landed: `SlipFlowService`
 * calls `resolveSlipProvider(hook?.slip_provider) ?? DEFAULT_SLIP_PROVIDER` on
 * every verification, so a configured name IS read today. The stale sentence is
 * corrected rather than deleted because it is the kind of note a reader trusts.
 *
 * 🔴 BEFORE ENABLING A SECOND ENTRY, READ THIS. While exactly one provider is
 * enabled, every possible value of `hook.slip_provider` — a name, `''`, a typo —
 * resolves to the same implementation, so a whole class of bugs cannot happen
 * yet. Flipping `enabled` in `provider-entries.ts` is what arms them, and two are
 * already known and written down rather than guarded speculatively:
 *   · `slip_provider` clones with the slip TAB while `slip_verify_key` is opt-in
 *     (`hook-field-tabs.ts`), so a half-ticked clone can separate a provider from
 *     its credential. The shape to copy is the existing `ai_vendor_without_key`
 *     handling in `hooks.service.ts`, which either drags the key along or CLEARS
 *     it — never leaves the previous vendor's key beside a new vendor.
 *   · a hook whose payment tool is ON forwards this provider's envelope to Shop-API
 *     (`payment-runner.service.ts` [DECISION-20260903-VERIFYFEEDSPAYMENT]).
 * `slip-provider-hook-field.spec.ts` holds a tripwire that goes RED on the second
 * entry so this list is read, not rediscovered.
 * เพิ่ม provider ตัวที่สองเมื่อไหร่ = ปลดล็อกบั๊กสองตัวนี้ทันที ต้องทำสองข้อข้างบนก่อน
 */
import {
  buildProviderRegistry,
  resolveDefaultProvider,
  SLIP_PROVIDER_ENTRIES,
} from './provider-entries';
import { siteSlipProviders } from './site-providers';

import type { SlipProvider } from './slip-provider.port';

export type {
  SlipProvider,
  SlipVerifyInput,
  SlipVerifyRequest,
  SlipVerifyResponse,
} from './slip-provider.port';
export {
  swiftcheckProvider,
  SWIFTCHECK_TIMEOUT_MS,
} from './swiftcheck/swiftcheck.provider';
export { BINARY_PLACEHOLDER, redactImageField } from './redact-image';
/* ==== [FEAT-20260903-SLIPGUARD] written, tested, and NOT REGISTERED ============
 * Exported so its spec can drive the real object; deliberately absent from
 * `SLIP_PROVIDERS` below, so nothing can select it: `resolveSlipProvider` cannot
 * return it, the options endpoint does not offer it, and `choice_count` stays 1
 * so the dashboard picker stays hidden.
 *
 * 🔴 TO SWITCH IT ON: flip `enabled` to `true` on its line in
 * `provider-entries.ts`. ONE WORD, and nothing else — no import here, no map
 * edit, no other provider touched. It is gated on the owner's condition (Shop-API
 * must confirm it reads a new vendor's envelope before a second provider is
 * enabled for a hook whose payment tool is ON, `docs/slip-spec.md` §7) and it
 * fires the tripwire in `slip-provider-hook-field.spec.ts`, which is what makes
 * the notes above get READ rather than rediscovered.
 * เปิดใช้ = แก้คำเดียวใน provider-entries.ts แต่ต้องผ่านเงื่อนไขเจ้าของก่อน */
export {
  slipguardProvider,
  SLIPGUARD_TIMEOUT_MS,
} from './slipguard/slipguard.provider';
export {
  slipGuardBangkokDate,
  slipGuardToSharedEnvelope,
  slipGuardToSharedError,
} from './slipguard/slipguard-normalise';
export {
  SLIPGUARD_ERROR_VERDICTS,
  slipGuardVerdictFor,
  type SlipGuardVerdict,
} from './slipguard/slipguard-error-codes';
/* [FEAT-20260903-CATCHSEAM] the one place a rejection is offered back to the
   provider that made the call. revert: drop this line and the file. */
export { sendWithRecovery } from './send-with-recovery';
/* [FEAT-20260903-BASEURLPERPROVIDER] the one place that answers "which host?",
   from the registry. revert: drop this line and the file. */
export { resolveBaseUrl, type SlipBaseUrlConfig } from './base-url';
/* [FEAT-20260903-PROVIDERSWITCH] the switchboard: one line per provider, one
   word to turn it on or off. revert: inline SLIP_PROVIDERS here again. */
export {
  buildProviderRegistry,
  resolveDefaultProvider,
  SLIP_PROVIDER_ENTRIES,
  type SlipProviderEntry,
} from './provider-entries';
/* [FEAT-20261016-SLIPGUARDLOAN] the providers one site adds. revert: drop this line and the file. */
export { siteSlipProviders } from './site-providers';

/**
 * Name → implementation, built from the ENABLED entries in
 * `provider-entries.ts`. That file is the switchboard: one line per provider,
 * one word to turn it on or off, and the key is each provider's own `name` so
 * the name exists in exactly one place and cannot drift from the map.
 *
 * ⚠️ NOTHING IS HAND-WRITTEN HERE ANY MORE. Adding a provider does not touch
 * this file. [FEAT-20260903-PROVIDERSWITCH]
 */
export const SLIP_PROVIDERS: Record<string, SlipProvider> =
  buildProviderRegistry(SLIP_PROVIDER_ENTRIES);

/**
 * The provider every hook uses unless it says otherwise. Absent config, an empty
 * string and an unrecognised name all end up here — see the note above on why
 * that is the safe direction.
 *
 * [FEAT-20260903-PROVIDERSWITCH] Derived from the entry marked `isDefault`
 * rather than named again here: the vendor is written once, in the switchboard,
 * and `resolveDefaultProvider` refuses a list that names none, two, or a
 * disabled one. Moving the mark is a RULE B change and
 * `slip-provider-rules.spec.ts` asserts this IS Swiftcheck by identity.
 */
export const DEFAULT_SLIP_PROVIDER: SlipProvider = resolveDefaultProvider(
  SLIP_PROVIDER_ENTRIES,
);

/**
 * @returns the named provider, or `null` when nobody registered that name.
 * Never throws. Callers that want the safe default use `?? DEFAULT_SLIP_PROVIDER`.
 */
export function resolveSlipProvider(
  name: string | null | undefined,
): SlipProvider | null {
  const key = String(name ?? '')
    .trim()
    .toLowerCase();
  /* [FEAT-20261016-SLIPGUARDLOAN] then the providers the active SITE adds (loan: slipguard) —
     `{}` on shop-api / unbound, so this line answers exactly as before there */
  return SLIP_PROVIDERS[key] ?? siteSlipProviders()[key] ?? null;
}
