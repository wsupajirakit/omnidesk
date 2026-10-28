/**
 * [FEAT-20260831-MENUMAINTAG] The reference-tag spelling of a stored menu card.
 * ===========================================================================
 * WHY IT IS HERE AND NOT IN `modules/menu`. That module is deliberately
 * ISOLATED: `menu-isolation-census.spec.ts` keeps a named list of the only files
 * allowed to import it, and says in its own words that anything else "would be a
 * permanent coupling with no off switch" — the module must stay deletable in one
 * command. The flex page (content) and the reply reader (webhook) both need this
 * spelling, and neither is on that list, so the constant lives on neutral ground
 * where both can read it and the menu module's isolation is untouched.
 * โมดูล menu ต้องยังลบทิ้งได้ในคำสั่งเดียว — จึงไม่เอาไปผูกเพิ่ม.
 *
 * ⚠️ UNDERSCORES, and one prefix per sub-type. The scenario marker
 * `[[[menu-primary]]]` uses HYPHENS and names a menu DEFINITION; a card tag names
 * ONE stored card. The two readers must never match each other's text, which is
 * why nothing here is spelled as a bare `menu`.
 *
 * ⚠️ The COUNTER behind each series lives with the minter
 * (`content/flex-messages.service.ts`); only the spelling belongs here.
 *
 * revert: delete this file, the `FLEX_TAG_CONFIG` entries that read it, and the
 *         reply reader that matches it.
 */

export const MENU_CARD_TAG_PREFIX = {
  main: 'menu_main_',
  sub: 'menu_sub_',
} as const;

export type MenuCardTagSubType = keyof typeof MENU_CARD_TAG_PREFIX;
