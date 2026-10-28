/**
 * [FEAT-20260905-CUSTPROV] Which sections this panel draws WITH ITS OWN CARDS,
 * and therefore which ones the generic renderers must draw instead.
 *
 * 📖 PLAN: `omnidesk-api/todo/task/05092026/todo3_05092026_profile_panel_module.md`
 *          (PART 7 §37-40)
 *
 * ## The split, and why it is not a compromise
 * Today's eight cards are hand-built: the products card colour-codes providers and
 * falls back to an initials block when an image 404s, the bonus card draws a
 * two-cell stat header, the finance card has coloured totals. Reproducing that
 * through generic primitives would need roughly nine section types with tone
 * and variant modifiers — the CSS of this panel re-encoded as a data language,
 * on a screen an admin reconciles money against. So the hand-built cards KEEP
 * drawing the sections they were built for, and the generic renderers draw
 * everything else.
 *
 * 🔴 THIS IS NOT A VENDOR LIST. It is a list of THIS PANEL'S OWN CARDS. The
 * distinction is the whole design: `provider-entries.ts` and `field-paths.ts`
 * live on the back end, and nothing here names `shopapi_v1` or any successor. A
 * provider that emits `promotion` gets the pretty card for free — whatever its
 * upstream calls those fields — and one that emits `wallet` gets the generic
 * card, drawn plainly and correctly, with **no front-end release**. That is the
 * property PART 7 exists to buy. เจ้าใหม่ = แก้ BE อย่างเดียว
 *
 * ## What "no consumer" means here, stated honestly
 * With `shopapi_v1` this list covers every section, so `ProfilePanelView` renders
 * nothing in production today. That is not dead code: it is the fallback path,
 * and it is exercised end to end by `test/profilePanelUnknownSections.dom.test.tsx`,
 * which feeds the panel a view from a DIFFERENT provider and asserts the cards
 * appear without a single front-end file being added. A path with a passing
 * acceptance test is a path that will work on the day it is needed; the failure
 * this design fears is discovering otherwise while onboarding a vendor.
 *
 * revert: delete this file and the `<ProfilePanelView>` mount in
 *         `ProfilePanel.tsx`. The panel goes back to drawing only its own cards
 *         and ignoring anything else the provider sends.
 */
import type { Section } from './types';

/**
 * The ids this panel has a purpose-built card for.
 *
 * ⚠️ Adding an id here HIDES that section from the generic renderer, so a card
 * must actually exist for it first. Removing one hands the section back to the
 * primitives — a visible change, never a tidy-up.
 */
export const PANEL_OWNED_SECTION_IDS: readonly string[] = [
  'promotion',
  'products',
  'finance.deposits',
  'finance.withdrawals',
  'bonus.cashback',
  'bonus.referral',
  'activity.coins',
  'activity.point_round',
];

/**
 * The sections left for `ProfilePanelView`.
 *
 * 🔴 A GROUP IS ALL-OR-NOTHING. If a provider sends `finance.deposits` (owned)
 * beside a new `finance.savings` (not owned), rendering only the second would
 * draw a second "การเงิน" card containing one lonely tab, next to the real one.
 * Whenever any member of a group is panel-owned, the whole group is treated as
 * owned and the extra tab is not drawn twice — it is a gap, and a visible gap is
 * better than a duplicate card that looks deliberate. The BE-side census is what
 * surfaces the gap; this rule is what stops it becoming a mess on screen.
 */
export const unownedSections = (
  sections: readonly Section[] | undefined | null,
): Section[] => {
  const list = sections ?? [];
  const ownedGroups = new Set(
    list
      .filter((s) => PANEL_OWNED_SECTION_IDS.includes(s.id))
      .map((s) => s.group)
      .filter((g): g is string => typeof g === 'string' && g.length > 0),
  );
  return list.filter(
    (s) =>
      !PANEL_OWNED_SECTION_IDS.includes(s.id) &&
      !(s.group && ownedGroups.has(s.group)),
  );
};
