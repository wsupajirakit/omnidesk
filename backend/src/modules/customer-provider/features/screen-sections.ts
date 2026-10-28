/**
 * ==== [FEAT-20261018-SCREENSECTIONS] Which dashboard sections a provider hides — one table ====
 *
 * WHAT: every section of the dashboard that a provider may hide, keyed by a stable id the FE
 *       asks about, mapped to the WORLD it belongs to. The answer reaches the screen through
 *       `GET /api/customer-provider/features` → `data.hidden`; the FE only draws.
 *
 * WHY:  owner 18/10/2026 — "ถ้าเป็น loan ซ่อนหัวข้อ Customer Link ด้วย และต้องสามารถแก้ไขเงื่อนไขนี้
 *       หรือกำหนดได้ว่า api xxxx อะไรให้ซ่อนได้อีก รวมทั้งของที่ซ่อนไปแล้ว". Before this the FE hid two
 *       sections by asking for a world, so "which section follows which world" lived in the FE.
 *
 * HOW A SECTION IS HIDDEN — either is enough:
 *   1. its world is silenced by the provider (`features: { register: false }` hides every
 *      `register` section at once — Customer Link has nothing to do without registration);
 *   2. the provider names it in `hiddenScreenSections` (hide it while the world stays on).
 *
 * TO CHANGE IT:
 *   · hide one more section on a site → add its id to that provider's `hiddenScreenSections`;
 *   · a new hideable section → add a row here (world, or `null` = hidden only when named),
 *     then make the FE component ask `useProviderSectionHidden('<id>')`;
 *   · show a section again → remove the name / turn the world back on.
 * shop-api declares nothing ⇒ `[]` ⇒ every section shown, as before.
 *
 * revert: delete this file, the `hiddenScreenSections` port field, the bound value in
 * `active-provider.ts` and `hidden` in `CustomerProviderController.features`.
 */
import type { ProviderFeature, ProviderFeatureSet } from './provider-features';

export const SCREEN_SECTIONS = {
  /* OA form → AI tab → Training Doc → "การช่วยตอบข้อมูล API": send Site Rules to the AI + its guide */
  'hook-form.site-rules': 'siteRules',
  /* same step: the customer-helper card picker (the card invites the customer to connect data) */
  'hook-form.customer-helper-card': 'register',
  /* OA form → External API tab: the Customer Link (ลงทะเบียนผ่านแชท) card */
  'hook-form.customer-link': 'register',
  /* [FEAT-20261018-CLOSEFOLLOW] the close-case dialog's follow-up sections (owner 18/10: "loan ไม่มี
     ไม่ว่าจะติดตามฝากหรือถอน ก็ไม่มี สมัครก็ไม่มี"). Registration = the abandon/registration CHASE
     (`followUp`); deposit / withdraw are the stamps a sent notice card writes (`notice`). A hidden
     section is a plain close — the dialog sends no answer for it. */
  'ticket-close.follow-registration': 'followUp',
  'ticket-close.follow-deposit': 'notice',
  'ticket-close.follow-withdraw': 'notice',
} as const satisfies Readonly<Record<string, ProviderFeature | null>>;

export type ScreenSection = keyof typeof SCREEN_SECTIONS;

/** The sections hidden for a provider, in table order: silenced world OR named by the provider. */
export function resolveHiddenScreenSections(
  worlds: ProviderFeatureSet,
  named: readonly ScreenSection[] | undefined,
): ScreenSection[] {
  const own = new Set<string>(named ?? []);
  return (Object.keys(SCREEN_SECTIONS) as ScreenSection[]).filter((s) => {
    const world: ProviderFeature | null = SCREEN_SECTIONS[s];
    return (world !== null && !worlds[world]) || own.has(s);
  });
}
