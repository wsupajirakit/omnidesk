/**
 * [FIX-20260909-LANGNAME] A language code turned into words, in one place.
 * ===========================================================================
 * Three surfaces show a language to an admin — the two-layer bubble's corner,
 * the picker's confirm step, and the composer's preview strip. All three had
 * been printing, or were about to print, the raw code: an admin saw `my` and
 * had to know that is Burmese, `zh-Hant` and had to know that is Traditional
 * Chinese.
 *
 * 🔴 IT LIVES HERE BECAUSE IT WAS ABOUT TO EXIST THREE TIMES. Two copies were
 *    already written before the third was needed, which is the moment a helper
 *    stops being convenience and starts being drift: a fallback changed in one
 *    copy and not the others is invisible until a language is added.
 *
 * 🔴 NO REQUEST. The obvious source is `useFieldOptions`, the hook the picker
 *    uses — and that file says of itself "NOT CACHED, deliberately", so calling
 *    it here would mean one HTTP request per translated bubble on screen. The
 *    labels are already local: the BE serves `label_key`, and every code ships
 *    with a translation under `field_options.translate_target_lang.*` in both
 *    th.json and en.json. This reads the same string the menu reads, from memory.
 *
 * ⚠️ Falls back to the CODE when a key is missing — a language added on the BE
 *    before the FE ships its label shows `my` rather than an empty space. Ugly
 *    beats blank, and it names exactly what to add.
 *
 * revert: inline it at each call site again and accept the three copies.
 */
export const TRANSLATE_LANG_OPTION_KEY = 'translate_target_lang';

export const langName = (code: string, t: (k: string) => string): string => {
  if (!code) return '';
  const key = `field_options.${TRANSLATE_LANG_OPTION_KEY}.${code}`;
  const label = t(key);
  return label && label !== key ? label : code;
};
