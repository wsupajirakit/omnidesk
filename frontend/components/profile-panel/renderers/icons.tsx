/**
 * [FEAT-20260905-CUSTPROV PART 7] Card chrome — the lucide icon in a card title.
 *
 * 📖 PLAN: `omnidesk-api/todo/task/05092026/todo3_05092026_profile_panel_module.md`
 *          PART 7 §39 ("adding a provider … no FE file")
 *
 * ## 🔴 THE DEFAULT MATTERS MORE THAN THE MAP
 * The map below is a COSMETIC nicety for the five cards that exist today; the
 * default is the part the design depends on. A new provider inventing a card id
 * this file has never heard of — `wallet`, `kyc`, `vip_desk` — must still render,
 * plainly but CORRECTLY, with no front-end release. That is the whole promise of
 * §39: a provider is one BE folder and one BE line, and if a missing icon could
 * break a card, this file would quietly turn every new provider into an FE
 * release. So: unknown id ⇒ `Info`, never `undefined`, never a throw.
 * ไอคอนที่ไม่รู้จัก = ใช้ตัวกลาง ไม่ใช่พัง · เจ้าใหม่ต้องขึ้นจอได้โดยไม่ต้องแก้ FE
 *
 * ## WHY A MAP AT ALL, IF THE DEFAULT CARRIES THE DESIGN
 * §30's release gate: `CUSTOMER_PROVIDER` unset must leave today's screen
 * byte-identical. Today's five cards have icons (`ProfilePanel.tsx:2230, :2421,
 * :2498`, `PromotionCard.tsx:45`, `RecentProductsCard.tsx:35`, `BonusCard.tsx:41`),
 * so dropping them to make a point would be a visible regression on the very
 * screen the gate protects. The map reproduces exactly those, and nothing else.
 *
 * ## 🔴 THIS IS NOT A PROVIDER LIST
 * The keys are SECTION and GROUP ids — vocabulary the contract already makes
 * public and stable (`Section.id` is "stable across providers so the dashboard
 * can key React on it"). No vendor name appears here, and no entry is required
 * for a provider to work, so this file cannot drift out of sync with the BE
 * registry: it holds nothing that has to agree with it.
 * REJECTED: serving the icon name from the BE (`section.icon`). It puts a lucide
 * export name in a provider's payload — a BE field whose valid values are an FE
 * package's API, which breaks the moment lucide renames an icon, and gives a
 * vendor a way to pick an alarming icon for a routine card.
 *
 * revert: delete this file; pass a fixed `<Info size={14} />` at the one call
 *         site in `ProfilePanelView.tsx`.
 */
import React from 'react';
import { Bot, CircleCheck, Info, MessageSquare, StickyNote, Tags, User as UserIcon } from 'lucide-react';

/** Every panel card uses 14px — matching the existing call sites exactly. */
const SIZE = 14;

/**
 * Group id first, then section id. Group wins because a grouped card is titled
 * by its group (see `ProfilePanelView.tsx`), so `finance.deposits` inside group
 * `finance` gets the finance icon, not a per-tab one.
 *
 * Read off the current screen:
 *   customer  → ProfilePanel.tsx:2230   promotion → PromotionCard.tsx:45
 *   products     → RecentProductsCard.tsx:35  finance   → ProfilePanel.tsx:2421
 *   bonus     → BonusCard.tsx:41        activity  → ProfilePanel.tsx:2498
 */
const ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  customer: UserIcon,
  promotion: Tags,
  products: Bot,
  finance: StickyNote,
  bonus: CircleCheck,
  activity: MessageSquare,
};

/**
 * The icon for a card, by its group id (preferred) or section id.
 *
 * 🔴 Total by construction: an id with no entry returns `Info`. There is no
 * input for which this returns nothing. See the header for why that is the
 * load-bearing part.
 */
export const iconFor = (id: string | undefined): React.ReactElement => {
  const Icon = (id ? ICONS[id] : undefined) ?? Info;
  return <Icon size={SIZE} />;
};
