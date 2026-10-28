/**
 * [FEAT-20260831-MENUMAINTAG] The three-bracket marker form, spelled once.
 * ===========================================================================
 * `[[[flex_m00001]]]` is how this product names a card inside an AI answer or a
 * value slot. Until now the brackets were written by hand in three places — the
 * table cell, the copy handler and (not at all) the carousel — so the same card
 * read one way in the list, another in the carousel, and the clipboard could
 * disagree with both. เจ้าของแจ้ง 31/08: "carousel แสดงผลผิด".
 *
 * ⚠️ THREE brackets, not two. `[[ ... ]]` is the dynamic-tag family, a different
 * system entirely (`FlexMessageList.tsx` says so in its own note). Mixing them
 * produces a string that looks right and resolves to nothing.
 *
 * ⚠️ A SLUG IS NOT A MARKER. `flex_slug` is operator-typed free text that goes
 * inside a postback payload (`menu:v1:open:<slug>`); wrapping it in brackets
 * produces exactly the misleading string this file exists to stop. Use
 * `isFlexMarkerValue` to tell them apart rather than guessing from the tab.
 *
 * revert: delete this file and inline the brackets again at each call site.
 */

/** Minted reference tags: `flex_m…`, `flex_pc…`, `menu_main_…`, `menu_sub_…`. */
const MARKER_VALUE = /^(?:flex_m|flex_pc|menu_main_|menu_sub_)\d+$/;

/** Already-wrapped values pass through untouched — no double brackets. */
const ALREADY_WRAPPED = /^\[\[\[.*\]\]\]$/;

/** `flex_m00001` → `[[[flex_m00001]]]`. Empty in, empty out — never bare brackets. */
export function flexMarker(tag: string | null | undefined): string {
  const value = String(tag ?? '').trim();
  if (!value) return '';
  if (ALREADY_WRAPPED.test(value)) return value;
  return `[[[${value}]]]`;
}

/**
 * Is this value a minted reference tag (⇒ show and copy it wrapped), or a slug
 * (⇒ show and copy it raw)?
 */
export function isFlexMarkerValue(value: string | null | undefined): boolean {
  return MARKER_VALUE.test(String(value ?? '').trim());
}
