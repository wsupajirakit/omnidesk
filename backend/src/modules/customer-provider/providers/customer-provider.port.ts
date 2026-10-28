/**
 * 📖 DOC: `docs/flow/ticket-and-customer-provider-flow.md` — the flow end to end,
 * the vocabulary, and the anti-bloat rules that keep this port small. Read §5
 * before implementing it for a new vendor: most of the work is a path table,
 * not code.
 */
import type {
  ProviderBaseTags,
  ProviderFeatureDeclaration,
} from '../features/provider-features';
import type { ScreenSection } from '../features/screen-sections';
import type { MemberDetailRule } from '../features/member-detail';
import type { TicketCategory } from '../features/ticket-categories';
import type { ProviderToolMint } from '../features/tool-mint';
import type { CustomerDataCachePolicy } from '../features/customer-data-cache';

import type { PathDeclaration, Sections } from './engine/resolve-fields';
import type { CustomerView } from './engine/view.types';
import type { CustomerFields } from './shopapi-v1/derive-fields';

/**
 * ==== [FEAT-20260905-CUSTPROV] what every customer provider must supply ======
 *
 * 📖 PLAN: `todo/task/05092026/todo3_05092026_profile_panel_module.md` (PART 6)
 *
 * WHAT A "CUSTOMER PROVIDER" IS. The customer's stored profile blob has a
 * different shape per upstream site — `member.schema.ts:61-70` already says so
 * ("the raw blob has a different shape per vendor"), and
 * `member-tier-key.util.ts:38-48` already proves it by reading the tier from
 * three different paths. A provider is one named answer to "how is this site's
 * customer data read and shown".
 *
 * ── ONE DOOR IN, ONE DOOR OUT ───────────────────────────────────────────────
 * 🔴 A provider may NOT change the route, the HTTP method, the permission, the
 * scoping, the refresh cooldown, the cache, the error envelope, or the stored
 * `raw_profile_data` itself. Those are the fixed half. A provider that could
 * change them would be a second system to operate rather than a second answer.
 * ทางเข้าทางออกเหมือนกันหมด ต่างกันแค่คำตอบ
 *
 * ── HOW TO ADD PROVIDER B, C, D ─────────────────────────────────────────────
 * Write `providers/<key>/index.ts` implementing this interface, add ONE line to
 * `provider-entries.ts`, write its spec. Nothing else — no route, no controller,
 * no DTO, no front-end file, no i18n key, no migration. Shape lifted from
 * `modules/slip/providers/`, which answers the same question for slip vendors.
 *
 * revert: delete `src/modules/customer-provider/` and its line in `app.module.ts`.
 */

/**
 * Where this provider's tier lives inside the stored blob, most specific first.
 *
 * Each entry is a dot path relative to `raw_profile_data`, most specific first.
 *
 * 🔴 THE RULE IS `??` ACROSS THE PATHS, THEN ONE TRUTHY GATE AT THE END — and an
 * earlier version of this comment got it wrong, which is why it is spelled out.
 * `omnidesk-console/utils/memberTier.ts:54-58` reads
 * `raw?.data?.profile?.tier ?? raw?.profile?.tier ?? raw?.tier` and only THEN
 * asks `if (fromRaw)`. So a tier of `''` at the FIRST path stops the chain and
 * falls to the `member.tier` COLUMN — it does not continue to the second path.
 *
 * A per-path truthy loop is the natural misreading and it moves a badge: with
 * `data.profile.tier` empty and `profile.tier` populated, a loop answers the
 * second path while the dashboard answers the column, so the ticket-list FILTER
 * and the badge on the CARD disagree about one customer. That is the defect
 * `[FIX-20260810-TIERSOURCE]` exists to prevent.
 * ผู้ให้บริการเปลี่ยนได้แค่ "ที่อยู่" เปลี่ยน "กฎ" ไม่ได้
 *
 * Consumed by `modules/tickets/member-tier-key.util.ts`, and pinned against the
 * dashboard's own expression by `customer-provider-tier.spec.ts`.
 *
 * ⚠️ Declared here, read from PART 3 onward. Nothing consumes it yet — it is the
 * data that describes today's behaviour, written down where the next step will
 * look for it, not a mechanism waiting for a caller.
 */
export type TierPath = string;

export interface CustomerProvider {
  /**
   * The switch value. `CUSTOMER_PROVIDER=<name>` selects this entry, and this
   * string is what the API stamps onto its responses as `customer_provider`.
   *
   * 🔴 The registry keys itself off THIS field rather than a string typed beside
   * it — the same rule `slip/providers/provider-entries.ts` records, because a
   * key written twice is a key that can disagree with itself.
   */
  readonly name: string;

  /** One-line description, for the operator reading a log or a census. */
  readonly description: string;

  /**
   * Tier lookup, most specific first. `shopapi_v1` declares today's chain exactly.
   * Consumed from PART 3.
   */
  readonly tierPaths: readonly TierPath[];

  /**
   * Whether the tier badge appears on the ticket card and in the room header.
   * 🔴 Both sites or neither: `[FIX-20260810-TIERSOURCE]` exists because those
   * two once disagreed for a real customer. Consumed from PART 4.
   */
  readonly showTierBadge: boolean;

  /**
   * Whether the tier filter appears in the ticket list toolbar. Hiding it removes
   * a control, never a row — the options themselves are derived client-side from
   * the rows already loaded (`TicketChat.tsx:640`). Consumed from PART 4.
   */
  readonly showTierFilter: boolean;

  /**
   * [FEAT-20260907-PROVCONDS] Two §6-pattern conditions (same shape as the
   * tier switches: declared on the port, stamped on a response the screen
   * already fetches, read as absent-means-today). BOTH are OPTIONAL and
   * `shopapi_v1` declares NEITHER — so for shop-api nothing is stamped and the
   * dashboard's existing inline rules stay authoritative, byte-for-byte.
   *
   * `hasMemberData` — the provider's OWN linked-marker over the stored blob.
   * The dashboard's legacy check reads shop-api's shape (`data.profile`), which
   * is CORRECT for shop-api and meaningless for a shape like loan_v1
   * (`data.customer`). When declared, `stampedProfile` stamps the verdict as
   * `has_member_data` and the "no member data yet" box trusts it; when
   * absent, the legacy check decides exactly as today. 🔴 PURE — blob in,
   * boolean out; no fetch, no Mongo.
   */
  readonly hasMemberData?: (blob: unknown) => boolean;

  /**
   * Whether the WalletPay-results card belongs to this provider's world.
   * WalletPay is shop-api's payment leg; a loan-shape site has no such thing.
   * Absent = shown (today). Stamped as `show_walletpay_card`; the dashboard
   * reads `!== false`, so an old BE keeps today's screen.
   */
  readonly showWalletpayCard?: boolean;

  /**
   * Whether the FOLLOW-UP world exists for this provider: the follow-up card
   * in the actions tab, the ignore-abandon shield on the avatar, and the
   * follow filter on the contacts page. One switch for one domain — three
   * switches for three pixels of the same feature would be the bloat §7
   * forbids. Absent = shown (today). Stamped as `show_follow_ups` on BOTH
   * list envelopes (tickets + contacts), read `!== false`; hiding the
   * contacts follow FILTER also clears its value (§6.5 — a hidden filter
   * must let go).
   */
  readonly showFollowUps?: boolean;

  /**
   * Whether the admin "register for the customer" action exists here. That
   * button opens shop-api's customer-link landing; a loan-shape site has no
   * such flow (linking happens upstream). The "no member data yet" label
   * itself stays for everyone. Absent = shown (today). Stamped as
   * `show_register_action` on the profile envelope, read `!== false`.
   */
  readonly showRegisterAction?: boolean;

  /**
   * [FEAT-20261014-PROVFEATURES] the webhook half of the same worlds: which bot behaviours
   * (`notice` · `followUp` · `register` · `payment`) exist on this provider's site.
   * Absent = on (today); only `false` silences, and only ever as an AND over the hook's own
   * switches. Meaning, choke points and how to add one: `../features/provider-features.ts`.
   */
  readonly features?: ProviderFeatureDeclaration;

  /**
   * [FEAT-20261014-CALLBACKCONTRACT] what the slip callback reports as `contact_number` — the
   * CONTRACT number — on a custom-tool hook. Absent = today: only legacy's
   * `Path : …installment_current.php` key, so a custom-tool hook sends `'n/a'`.
   * `'profile_code'` = the code the hook's tool resolved through its own `profile_map.code`
   * (the value the PROFILE-CHECK log and the assist summary already carry). Declare it ONLY
   * where that code is a contract number — on shop-api it is a member id.
   */
  readonly slipCallbackContract?: 'profile_code';

  /**
   * [FEAT-20261014-LOGREDACT] `parent.key` suffixes whose values the custom-tool prefetch
   * audit log (`webhook_logs.raw_response`) stores as `[redacted]`. Absent = rows unchanged.
   * Log only — `raw_profile_data` is untouched. Rules: `../features/log-redact.ts`.
   */
  readonly logRedactPaths?: readonly string[];

  /**
   * [FEAT-20261014-BASETAGS] which endpoint/path each legacy `[[[name]]]` marker reads on this
   * site (old prompts use them). Absent = legacy's literal `Path : …` reading, unchanged.
   */
  readonly baseTags?: ProviderBaseTags;

  /**
   * [FEAT-20261014-PROFILEFIRST] ask the profile endpoint alone first; the per-customer
   * endpoints go only if it succeeds (site rules always go). Optional — absent = all at once.
   * Rules: `external/utils/prefetch-order.ts`.
   */
  readonly prefetchProfileFirst?: boolean;

  /**
   * [FEAT-20261014-SCREENHIDE] `parent.key` suffixes hidden as `[redacted]` where an admin
   * screen shows the partner's RAW answer (slip detail `external_data`). Absent = unchanged.
   */
  readonly screenHiddenPaths?: readonly string[];

  /**
   * [FEAT-20261018-SCREENSECTIONS] dashboard sections to hide on this site IN ADDITION to the
   * ones its silenced worlds already hide. Absent = only the world-derived ones (shop-api: none).
   * The ids and their worlds: `../features/screen-sections.ts`.
   */
  readonly hiddenScreenSections?: readonly ScreenSection[];

  /**
   * [FEAT-20261014-TICKETCATS] The ticket categories this site works with (values of
   * `tickets.category`, in screen order). Absent = today: the screen keeps its own set and
   * open-from-room accepts `Other | Payment`. See `features/ticket-categories.ts`.
   */
  readonly ticketCategories?: readonly TicketCategory[];

  /**
   * [FEAT-20261015-MEMBERDETAIL] How the panel's hand-typed customer card behaves (nickname,
   * what the third `detail` slot holds, whether a registered customer may be edited).
   * Absent = today's card. See `features/member-detail.ts`.
   */
  readonly memberDetail?: MemberDetailRule;

  /**
   * [FEAT-20261016-TOOLMINT] The partner companies the Custom Tools page can mint a tool for
   * (template + one row per company). Absent = no mint button, route answers null.
   * See `features/tool-mint.ts`.
   */
  readonly toolMint?: ProviderToolMint;

  /**
   * [FEAT-20261016-CUSTCACHE] How long one customer's partner answers are cached on the
   * webhook path. Absent = no cache, every message fetches live (today).
   * See `features/customer-data-cache.ts`.
   */
  readonly customerDataCache?: CustomerDataCachePolicy;

  /**
   * [FEAT-20261016-LOGMASK80] Share (0–1) of a customer's name / phone / contract replaced by `*`
   * in the SERVER LOG (stdout). Absent = printed as today. Log-only — stored data is untouched.
   * Applied by `webhook/logging/personal-log-mask.ts`.
   */
  readonly personalLogMaskRatio?: number;

  /**
   * [FEAT-20261016-SLIPGUARDLOAN] Slip providers THIS SITE switches on beyond the global switchboard
   * (`slip/providers/provider-entries.ts`, where they may stay `enabled: false`). Names are each
   * provider's own `name`. Absent = only the global ones (today).
   * 🔴 Honoured ONLY while this provider's `payment` world is OFF — a site-only provider's reply
   * must never reach Shop-API's topup leg (the switchboard tripwire's precondition #2). Read through
   * `providerSlipProviders()`, which enforces that.
   */
  readonly slipProviders?: readonly string[];

  /**
   * WHERE this provider's values live — the container, the sections, and one
   * path chain per value. Pure DATA, read by `providers/engine/`.
   *
   * 🔴 THIS IS THE 80%, AND IT IS THE POINT OF THE WHOLE SHAPE. Owner's design,
   * 05/09: *paths for the bulk, a function for the exceptions.* Measured on
   * `shopapi_v1` the split is 17 lookups against 9 algorithms, so a vendor that
   * differs only in field names — the common case — is added by writing a table
   * and no code at all. `customer-provider-fields.spec.ts` proves that claim by
   * registering a provider whose ONLY difference is this table, and
   * `customer-provider-engine.spec.ts` pins the reader's own rules.
   * เจ้าใหม่ที่ต่างแค่ชื่อฟิลด์ → แก้ path ไม่เขียนโค้ด
   */
  readonly paths: PathDeclaration;

  /**
   * The values a path cannot express, and the assembly of the final answer.
   *
   * 🔴 WHY A FUNCTION SURVIVES AT ALL. Nine of `shopapi_v1`'s values are not
   * lookups: two compare against different TYPES and switch on `!== undefined`,
   * one falls back to another field's length, one merges two arrays and sorts,
   * two branch on a runtime type, one copies-then-sorts, two do key-set
   * arithmetic. Expressing those as data means inventing a DSL with comparisons,
   * type tests, sorts and set operations — a language, written to avoid a
   * function. `field-options.registry.ts:25-29` rules that trade out.
   *
   * It receives the resolved sections AND the already-resolved path values, so
   * an algorithm can read a raw section (`auto_deposit` needs `!== undefined`,
   * which the engine cannot answer) and can build on a value the table produced.
   *
   * 🔴 PURE. It may not fetch, read the request, touch Mongo, or reshape what is
   * stored — otherwise a provider becomes a second data path instead of a second
   * reading of one.
   */
  deriveFields(
    sections: Sections,
    resolved: Record<string, unknown>,
  ): CustomerFields;

  /**
   * The provider's answer, arranged — `view.sections`, the ONE varying part of
   * the response envelope.
   *
   * 🔴 IT COMPOSES A CLOSED SET OF TYPES, IT DOES NOT SHIP A COMPONENT. That is
   * the whole property being bought: the dashboard knows `kv`/`chips`/`list`/
   * `amount_rows`/`empty`/`raw` and never learns a vendor name or a vendor field
   * name, so adding provider B is a back-end-only change. A provider that truly
   * needs bespoke UI has to add a type, which IS an FE release — and the count
   * of those is the honest measure of whether this design is holding.
   *
   * 🔴 PURE, like the two above. It receives the fields this provider already
   * resolved and returns a description. It may not fetch, read the request, or
   * touch Mongo.
   */
  buildView(fields: CustomerFields): CustomerView;
}
