/**
 * ==== [FEAT-20261014-PROVFEATURES] which webhook WORLDS a provider's site has ==========
 *
 * 📖 PLAN: `todo/task/13102026/be_todo1_13102026_wt-loanv1-13102026.md` (owner 14/10/2026:
 * "สินเชื่อ abandon/ลงทะเบียน ต้องเงียบ · อะไรก็ตามที่เงียบ มี flag เปิด ปิดสลับได้ในระดับ code")
 *
 * WHAT A FEATURE IS HERE. A whole domain of bot behaviour that only exists in some sites'
 * worlds. shop-api has all four; the installment-loan shape has none of them (its linking,
 * reminders and payments happen upstream). Before this file a loan site was silent only
 * because nobody had configured those features on its hooks — silence by omission, which
 * one well-meant hook edit undoes. Declared here, silence is a property of the provider,
 * written in code, flipped by editing one boolean in the provider's own folder.
 * เงียบเพราะประกาศไว้ ไม่ใช่เงียบเพราะลืมตั้ง
 *
 * 🔴 ABSENT = ON. A provider that declares nothing — `shopapi_v1` declares nothing — keeps every
 * feature exactly as it behaved before this file existed. Only an explicit `false` silences.
 * That is the same "absent means today" rule as `showFollowUps` and friends on the port.
 *
 * 🔴 A FEATURE IS AN AND, NEVER AN OR. Off here silences the domain whatever the hook says.
 * On here changes nothing: every per-hook switch (`notice_*_status`, `ignore_abandon_assist`,
 * `customer_link_enabled`, `payment_tool_status`…) still decides exactly as before. A provider
 * can take a world away; it can never switch one on behind an OA's back.
 *
 * HOW TO ADD ONE. Add a name to `PROVIDER_FEATURES` with its one-paragraph meaning, then put
 * ONE `providerFeatureOn('<name>')` line at the domain's single choke point, with a spec that
 * binds a provider declaring it `false` and proves the domain says nothing. Nothing else.
 *
 * revert: delete `features/`, the `features` field on the port, its declarations in
 * `providers/*\/index.ts`, the bind call in `customer-provider.service.ts`, and the
 * `providerFeatureOn` line at each choke point (each is tagged with this id).
 */

/**
 * The closed list. Each entry is one world, named once, silenced at ONE choke point.
 *
 * notice    — deposit/withdraw notice cards (cases A–F) and the follow-up stamp a sent
 *             notice writes. Choke: `decideNoticeAll` (`notice-runtime/notice-decide.ts`).
 *             Every notice door — text, the withdraw admin button, the slip lane — asks it.
 * followUp  — the abandon chase: level 1 (stamp + ask for details) and level 2 (hand off to
 *             register), plus the abandon mark a multicast writes. Choke: `runFollowUpGate`
 *             after level 0 (`follow-up/follow-up.gate.ts`) and `shouldStamp`
 *             (`broadcast-follow-up/stamp-abandon-on-multicast.ts`). 🔴 Level 0 — clearing a
 *             mark once a customer registers — keeps running: turning the chase off must not
 *             turn the cleanup off.
 * register  — every way the bot or the link routes invite/perform a registration:
 *             the `customer-register` keyword reply (choke `isCustomerRegisterKeyword`,
 *             `webhook/webhook-routing.ts` — ladder step + assist bypass), the AI marker's
 *             register buttons/card (choke `helper-qr-body.step.ts` — the helper TEXT still
 *             answers), and the customer-link routes behind `notReadyRejection` (landing
 *             profile, match, admin token, admin edit). Admin unlink stays.
 * payment   — the payment-tool leg after a slip, its resume and its [ลองใหม่] postback.
 *             Choke: `PaymentRunnerService.resolvePaymentTool`; off ⇒ the same `not_working`
 *             answer an OA with no tool bound gets, so the slip card itself still goes out.
 * siteRules — [FEAT-20261018-SITERULESWORLD] the site's own rules block (an endpoint with
 *             `role: site_rules`): fed to the AI, shown as the panel's "ข้อมูลเว็บ" card,
 *             offered on the OA form. Legacy legacy-console had none (shop-api's concept), and the
 *             loan partner has none. Chokes: the AI gate `siteRulesReachAi`
 *             (`features/site-rules-world.ts`, both prompt blocks), the prefetch filter
 *             (`external/custom-tool.service.ts` — the endpoint is never called), the panel
 *             route + Refresh (`chat/members.service.ts`), and the screen hides the OA-form
 *             option through `GET /api/customer-provider/features`. A future company that
 *             HAS site rules declares nothing and gets all of it.
 */
export const PROVIDER_FEATURES = [
  'notice',
  'followUp',
  'register',
  'payment',
  'siteRules',
] as const;

export type ProviderFeature = (typeof PROVIDER_FEATURES)[number];

/** What a provider may declare: any subset, `false` to silence. Absent = on. */
export type ProviderFeatureDeclaration = Readonly<
  Partial<Record<ProviderFeature, boolean>>
>;

/** The resolved answer — every feature named, nothing optional. */
export type ProviderFeatureSet = Readonly<Record<ProviderFeature, boolean>>;

/**
 * Resolve a declaration into the full set. Only an explicit `false` turns a feature off;
 * `undefined`, a missing key or a missing declaration all mean "as today".
 */
export function resolveProviderFeatures(
  declared: ProviderFeatureDeclaration | undefined,
): ProviderFeatureSet {
  const out = {} as Record<ProviderFeature, boolean>;
  for (const f of PROVIDER_FEATURES) out[f] = declared?.[f] !== false;
  return out;
}

/** The features a set turns off, in list order — for the boot log line. */
export function featuresOff(set: ProviderFeatureSet): ProviderFeature[] {
  return PROVIDER_FEATURES.filter((f) => !set[f]);
}

/**
 * [FEAT-20261014-BASETAGS] A provider's own reading of the legacy `[[[name]]]` markers:
 * marker name → the dynamic-tag pair (`sub_type` = endpoint key, `value` = path or formula).
 */
export type ProviderBaseTags = Readonly<
  Record<string, Readonly<{ sub_type: string; value: string }>>
>;
