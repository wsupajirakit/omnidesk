/**
 * [FEAT-20261014-PROVFEATURES] What the active provider changes in the BOT, bound ONCE at boot.
 *
 * The bot-facing declarations live here, and only these:
 *   · WORLDS (`providerFeatureOn`) — notice / followUp / register / payment; absent = on.
 *   · [FEAT-20261014-CALLBACKCONTRACT] where the slip callback's `contact_number` comes from
 *     (`slipCallbackContractSource`); absent = `'legacy'`, today's answer.
 *   · [FEAT-20261014-LOGREDACT] which answer fields the prefetch audit log must not store
 *     verbatim (`providerLogRedactPaths`); absent = none, today's rows.
 *   · [FEAT-20261014-BASETAGS] how the legacy `[[[name]]]` markers read on this site
 *     (`providerBaseTags`); absent = legacy's `Path : …` reading.
 *   · [FEAT-20261014-PROFILEFIRST] whether the prefetch asks the profile alone first
 *     (`providerPrefetchProfileFirst`); absent = everything at once.
 *   · [FEAT-20261014-SCREENHIDE] which answer fields a raw-answer admin screen must hide
 *     (`providerScreenHiddenPaths`); absent = none.
 *   · [FEAT-20261014-TICKETCATS] which ticket categories the site works with
 *     (`providerTicketCategories`); absent = null, today's screen and open-case list.
 *   · [FEAT-20261016-TOOLMINT] which companies the Custom Tools page can mint a tool for
 *     (`providerToolMint`); absent = null, no button.
 *   · [FEAT-20261016-CUSTCACHE] how long a customer's partner answers are cached on the
 *     webhook path (`providerCustomerDataCache`); absent = null, no cache.
 *   · [FEAT-20261016-LOGMASK80] how much of a customer's name / phone / contract the server log
 *     masks (`providerPersonalLogMaskRatio`); absent = null, printed as today.
 *   · [FEAT-20261016-SLIPGUARDLOAN] which slip providers the site adds to the global switchboard
 *     (`providerSlipProviders`); absent = none — and none while the payment world is on.
 *   · [FEAT-20261018-SCREENSECTIONS] which dashboard sections the screen hides
 *     (`providerHiddenScreenSections`) — silenced worlds' sections + the provider's own list.
 * Anything else about a provider (paths, fields, the view) is NOT exposed here — that goes
 * through `CustomerProviderService`, the one door. This file carries only what pure rule code
 * on the webhook/slip path must read and cannot be handed by injection.
 *
 * 🔴 WHY A BOUND VALUE AND NOT AN INJECTED SERVICE. The choke points are pure rule functions
 * (`decideNoticeAll`, `runFollowUpGate`, `isCustomerRegisterKeyword`, `shouldStamp`) reached
 * from `webhook.service.ts` along five different call paths, plus `SlipFlowService`, whose
 * constructor is pinned by three specs and four e2e boots (`slip-flow.service.ts`, the note
 * on `providerFor`). Injecting would mean a new constructor parameter on the webhook (its
 * last lines are quoted by `docs/menu-plug-in.patch`), a new module import (also quoted), a
 * field threaded through `TurnContext`, and lines inside `processLockedEvent`, whose size is
 * a ratchet that may only go down (`z-test/fixtures/spine-size-ratchet.json`). A value fixed
 * for the life of the process — which the provider is, by design ("Resolved ONCE, at
 * construction", `customer-provider.service.ts`) — needs none of that. It is the same shape
 * as the code constants these rules already read (`NOTICE_RESPECTS_ASSIST`,
 * `STAMP_ABANDON_ENABLED`): one value per deployment.
 *
 * 🔴 ONE WRITER. Only `CustomerProviderService` calls `bindActiveProvider`, from its
 * constructor, right after it resolves the provider. It stays the only reader of
 * `CUSTOMER_PROVIDER` (`customer-provider.spec.ts` enforces that); this file never sees env.
 *
 * 🔴 UNBOUND = TODAY. A unit test that drives a rule directly, a CLI that never boots the
 * module — all read shop-api's behaviour. A silent world or a new callback source has to be
 * bound to exist. Specs that bind one call `resetActiveProvider()` after.
 *
 * revert: see `provider-features.ts`.
 */
import type { CustomerProvider } from '../providers/customer-provider.port';

import {
  PROVIDER_FEATURES,
  resolveProviderFeatures,
  type ProviderBaseTags,
  type ProviderFeature,
  type ProviderFeatureSet,
} from './provider-features';
import type { MemberDetailRule } from './member-detail';
import type { TicketCategory } from './ticket-categories';
import type { ProviderToolMint } from './tool-mint';
import type { CustomerDataCachePolicy } from './customer-data-cache';
import {
  resolveHiddenScreenSections,
  type ScreenSection,
} from './screen-sections';

/** `'legacy'` = only legacy's `Path : …installment_current.php` key, as before. */
export type SlipCallbackContractSource = 'legacy' | 'profile_code';

const ALL_ON: ProviderFeatureSet = resolveProviderFeatures(undefined);

let worlds: ProviderFeatureSet = ALL_ON;
let callbackContract: SlipCallbackContractSource = 'legacy';
/* [FEAT-20261014-LOGREDACT] path suffixes the prefetch audit log must not store verbatim */
let logRedactPaths: readonly string[] = [];
/* [FEAT-20261014-BASETAGS] the provider's reading of the legacy `[[[name]]]` markers */
let baseTags: ProviderBaseTags = {};
/* [FEAT-20261014-PROFILEFIRST] prefetch the profile alone first, the rest only on success */
let prefetchProfileFirst = false;
/* [FEAT-20261014-SCREENHIDE] path suffixes an admin screen showing the raw answer must hide */
let screenHiddenPaths: readonly string[] = [];
/* [FEAT-20261014-TICKETCATS] the site's ticket categories — null = not declared (today) */
let ticketCategories: readonly TicketCategory[] | null = null;
/* [FEAT-20261015-MEMBERDETAIL] the panel's hand-typed customer card — null = today's card */
let memberDetail: MemberDetailRule | null = null;
/* [FEAT-20261016-TOOLMINT] the companies the Custom Tools page can mint for — null = none */
let toolMint: ProviderToolMint | null = null;
/* [FEAT-20261016-CUSTCACHE] per-customer answer cache on the webhook path — null = none */
let customerDataCache: CustomerDataCachePolicy | null = null;
/* [FEAT-20261016-LOGMASK80] share of a customer's personal values masked in stdout — null = none */
let personalLogMaskRatio: number | null = null;
/* [FEAT-20261016-SLIPGUARDLOAN] slip providers the site adds to the switchboard — [] = none */
let slipProviders: readonly string[] = [];
/* [FEAT-20261018-SCREENSECTIONS] dashboard sections hidden on this site — [] = none */
let hiddenScreenSections: readonly ScreenSection[] = [];

/** Called by `CustomerProviderService` at construction, and by specs. */
export function bindActiveProvider(
  provider: Pick<
    CustomerProvider,
    | 'features'
    | 'slipCallbackContract'
    | 'logRedactPaths'
    | 'baseTags'
    | 'prefetchProfileFirst'
    | 'screenHiddenPaths'
    | 'ticketCategories'
    | 'memberDetail'
    | 'toolMint'
    | 'customerDataCache'
    | 'personalLogMaskRatio'
    | 'slipProviders'
    | 'hiddenScreenSections'
  >,
): ProviderFeatureSet {
  worlds = resolveProviderFeatures(provider.features);
  callbackContract = provider.slipCallbackContract ?? 'legacy';
  logRedactPaths = provider.logRedactPaths ?? [];
  baseTags = provider.baseTags ?? {};
  prefetchProfileFirst = provider.prefetchProfileFirst === true;
  screenHiddenPaths = provider.screenHiddenPaths ?? [];
  ticketCategories = provider.ticketCategories ?? null;
  memberDetail = provider.memberDetail ?? null;
  toolMint = provider.toolMint ?? null;
  customerDataCache = provider.customerDataCache ?? null;
  personalLogMaskRatio = provider.personalLogMaskRatio ?? null;
  slipProviders = (provider.slipProviders ?? []).map((n) =>
    n.trim().toLowerCase(),
  );
  hiddenScreenSections = resolveHiddenScreenSections(
    worlds,
    provider.hiddenScreenSections,
  );
  return worlds;
}

/** Back to the unbound state (today's behaviour). For specs. */
export function resetActiveProvider(): void {
  worlds = ALL_ON;
  callbackContract = 'legacy';
  logRedactPaths = [];
  baseTags = {};
  prefetchProfileFirst = false;
  screenHiddenPaths = [];
  ticketCategories = null;
  memberDetail = null;
  toolMint = null;
  customerDataCache = null;
  personalLogMaskRatio = null;
  slipProviders = [];
  hiddenScreenSections = [];
}

/**
 * [FEAT-20261016-SLIPGUARDLOAN] Slip providers the site adds to the global switchboard.
 * Absent / unbound ⇒ []. 🔴 Payment world ON ⇒ [] as well: the topup leg forwards the slip
 * provider's raw reply to Shop-API, which reads Swiftcheck's envelope only — so a site-only provider
 * exists solely where that leg cannot run (loan: `payment: false`).
 */
export function providerSlipProviders(): readonly string[] {
  return worlds.payment ? [] : slipProviders;
}

/** [FEAT-20261016-LOGMASK80] stdout mask share for personal values. Absent / unbound ⇒ null (plain). */
export function providerPersonalLogMaskRatio(): number | null {
  return personalLogMaskRatio;
}

/** [FEAT-20261016-TOOLMINT] the site's mint companies + template. Absent / unbound ⇒ null (no button). */
export function providerToolMint(): ProviderToolMint | null {
  return toolMint;
}

/** [FEAT-20261016-CUSTCACHE] the per-customer answer cache policy. Absent / unbound ⇒ null (live). */
export function providerCustomerDataCache(): CustomerDataCachePolicy | null {
  return customerDataCache;
}

/** [FEAT-20261015-MEMBERDETAIL] the panel's hand-typed card rule. Absent / unbound ⇒ null (today). */
export function providerMemberDetail(): MemberDetailRule | null {
  return memberDetail;
}

/** [FEAT-20261014-TICKETCATS] the site's ticket categories. Absent / unbound ⇒ null (today). */
export function providerTicketCategories(): readonly TicketCategory[] | null {
  return ticketCategories;
}

/** [FEAT-20261014-SCREENHIDE] what a raw-answer screen must hide. Absent / unbound ⇒ nothing. */
export function providerScreenHiddenPaths(): readonly string[] {
  return screenHiddenPaths;
}

/** [FEAT-20261014-PROFILEFIRST] profile-first prefetch? Absent / unbound ⇒ no (all at once). */
export function providerPrefetchProfileFirst(): boolean {
  return prefetchProfileFirst;
}

/** [FEAT-20261014-BASETAGS] legacy marker → dynamic-tag pair. Absent / unbound ⇒ none. */
export function providerBaseTags(): ProviderBaseTags {
  return baseTags;
}

/** [FEAT-20261014-LOGREDACT] what the prefetch log must redact. Absent / unbound ⇒ nothing. */
export function providerLogRedactPaths(): readonly string[] {
  return logRedactPaths;
}

/** Does the active provider's world have this feature? Absent / unbound ⇒ yes. */
export function providerFeatureOn(feature: ProviderFeature): boolean {
  return worlds[feature];
}

/** [FEAT-20261018-SITERULESWORLD] the worlds the active provider silences, in list order —
 *  what the screen reads to hide options. Unbound / shop-api ⇒ []. */
export function providerFeaturesOff(): ProviderFeature[] {
  return PROVIDER_FEATURES.filter((f) => !worlds[f]);
}

/** [FEAT-20261018-SCREENSECTIONS] the dashboard sections this site hides, in table order —
 *  what `GET /api/customer-provider/features` hands the screen. Unbound / shop-api ⇒ []. */
export function providerHiddenScreenSections(): ScreenSection[] {
  return [...hiddenScreenSections];
}

/** Where the slip callback's `contact_number` comes from. Absent / unbound ⇒ `'legacy'`. */
export function slipCallbackContractSource(): SlipCallbackContractSource {
  return callbackContract;
}
