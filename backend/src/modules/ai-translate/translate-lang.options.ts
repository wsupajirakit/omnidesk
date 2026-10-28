/**
 * ==== [FEAT-20260908-CHATTRANS] ai-translate's answer to "what may I be set to?"
 *
 * This file belongs to `ai-translate` because only this module knows what a
 * language code means. The central options pipe (`modules/options/`) holds ONE
 * line pointing at this function and no knowledge of languages at all — the
 * exact shape `slip-provider.options.ts` already established, where slip is one
 * SUB-ENTRY of that pipe rather than its subject.
 *
 * 🔴 NO NEW ROUTE, AND THAT IS THE DESIGN. `GET /api/field-options/
 * translate_target_lang` exists the moment the registry line lands — same
 * controller, same guard, same `{key, options, choice_count}` shape, and nothing
 * new for `scripts/route-coverage.mjs` to learn. A second endpoint answering the
 * same question would sit outside that tested guard and shape, and nothing would
 * ever turn red when the two drifted.
 *
 * 🔴 BUILT FROM `languages.ts`, NEVER FROM A LIST TYPED HERE. That registry is
 * the only thing that can actually resolve a code at translate time, so it is
 * the only honest source for what may be offered. A hand-written copy would
 * re-create the failure the options pipe exists to prevent: a client offers a
 * value, an operator picks it, it saves, the runtime refuses it, and nothing
 * anywhere reports that the choice had no effect.
 *
 * ⚠️ NO STRUCTURAL IMPORT FROM `@/modules/options`. The shape is declared here
 * instead, exactly as slip declares it, because this folder may import no
 * feature module but `@/modules/ai-vendor` — enforced, not documented, by
 * `z-test/unit/ai-translate-isolation.spec.ts`. The registry's own
 * `FieldOptionSource` type checks this function structurally when the line is
 * added, so the contract is still compiler-enforced; only the ARROW is absent.
 *
 * ⚠️ NO `is_default` ENTRY, unlike slip. `''` is a real supported state for a
 * slip provider ("use whatever the system uses") — a translation target has no
 * such state: there is no language to fall back TO, and an empty target is a
 * request with nothing to do. `choice_count` therefore equals the list length
 * here, which is correct rather than an oversight.
 *
 * revert: delete this file, `languages.ts`, and their two lines in `index.ts` +
 * `modules/options/field-options.registry.ts`.
 */
import { TRANSLATE_LANGUAGES } from './languages';

/**
 * The languages a translate target may be set to, in the registry's display
 * order (the owner's, not alphabetical — see `languages.ts`).
 *
 * 🔴 RETIRED LANGUAGES ARE OMITTED. `enabled: false` is how a language stops
 * being offered without stored rows losing their meaning, so the filter is the
 * working half of that decision; `translateLanguage()` keeps resolving the code
 * for anything already written under it.
 *
 * Pure, synchronous and cheap, as this pipe requires — it answers on a request
 * that renders a form.
 */
export const translateLanguageOptions = (): {
  value: string;
  label_key: string;
  fallback_label?: string;
  is_default?: boolean;
}[] =>
  TRANSLATE_LANGUAGES.filter((l) => l.enabled).map((l) => ({
    // the CODE is what gets stored and what travels on the wire, so it is what
    // a client must send back — never the label, never the English name.
    value: l.code,
    label_key: l.label_key,
    /* Every entry carries one: this is a list the SERVER can extend on its own,
       so a language added tomorrow must not reach an operator as a raw i18n key
       while the dashboard waits for a release. */
    fallback_label: l.fallback_label,
  }));
