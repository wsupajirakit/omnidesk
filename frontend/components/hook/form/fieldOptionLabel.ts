/**
 * ==== [FEAT-20260903-FALLBACKLABEL] what to SHOW for a server-sent option =====
 *
 * WHY THIS EXISTS. `GET /api/field-options/:key` was built so a value registered
 * on the back end shows up here with no release on this side. That was only half
 * true: the control appeared by itself, but its NAME did not. `i18n/index.tsx`
 * resolves a missing key to the KEY ITSELF, so a newly registered vendor would be
 * offered to an operator as the literal string
 * `field_options.slip_provider.slipguard`.
 *
 * The server now sends `fallback_label` — a proper noun, what the value already
 * IS — for the entries it can add on its own. This picks between the two.
 *
 * 🔴 ORDER MATTERS AND IT IS NOT NEGOTIABLE: a translation shipped here ALWAYS
 * wins. The fallback exists to cover a value this build has never heard of, not
 * to override the wording this side owns. Flip the order and every carefully
 * translated label is silently replaced by the server's bare name.
 *
 * ⚠️ HOW "no translation" IS DETECTED: `t()` returns the key unchanged when it
 * knows nothing about it (`i18n/index.tsx` — `current || fallback || key`). That
 * is the only signal available, so it is the one used. If `t()` ever starts
 * returning something else for a miss (empty string, undefined), this comparison
 * silently stops firing and every unknown value shows its raw key again — the
 * test file pins exactly this behaviour so that change cannot pass quietly.
 *
 * revert: delete this file and render `t(o.label_key)` directly at the call site.
 */

/** The parts of a server option this needs — deliberately not the whole type. */
export interface LabelledOption {
  label_key: string;
  fallback_label?: string;
}

/**
 * @param t the translator from `useTranslation()`, passed in rather than
 * imported so this stays a pure function a test can drive with a fake.
 * @returns the translated label, else the server's plain name, else the key —
 * so something readable is always shown and the choice is never blank.
 */
export const fieldOptionLabel = (
  option: LabelledOption,
  t: (key: string) => string,
): string => {
  const translated = t(option.label_key);
  // a real translation always wins — see the note above on why the order is fixed
  if (translated && translated !== option.label_key) return translated;
  return option.fallback_label ?? option.label_key;
};
