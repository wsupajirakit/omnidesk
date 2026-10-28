/**
 * [FEAT-20260905-CUSTPROV PART 7] The LABEL rule, in one copy.
 *
 * 📖 PLAN: `omnidesk-api/todo/task/05092026/todo3_05092026_profile_panel_module.md`
 *          PART 7 §37-§40
 *
 * ## THE RULE (contract header, `engine/view.types.ts`)
 * Prefer `labelKey` through i18n when it RESOLVES, else `label`.
 * Neither present ⇒ the thing is NOT DRAWN — a blank label is a bug that looks
 * like a design, and it is the one failure mode nobody reports because it looks
 * deliberate. ไม่มีป้าย = ไม่วาด ไม่ใช่วาดเป็นช่องว่าง
 *
 * ## 🔴 "RESOLVES" NEEDS A TEST, BECAUSE `t` NEVER FAILS
 * `i18n/index.tsx:79` — `t` falls back locale ⇒ en ⇒ **the key itself**. So a
 * missing key does not throw and does not return empty; it returns
 * `'vendor.wallet'`, which would print a dotted identifier on a customer's card.
 * The identity check below is the only way to tell "translated" from "gave up".
 * WHY IT MATTERS FOR THE WHOLE DESIGN: a NEW provider sending a `labelKey` this
 * dashboard has never heard of degrades to its `label`, with no FE release. That
 * is the same property §39 asks of the type registry, applied to labels.
 * REJECTED: reaching into the translation dictionaries to test for the key
 * directly. It reads private state of the i18n module and would have to know the
 * locale-then-en fallback order — a second copy of a rule that already exists.
 *
 * revert: delete this file; fold `resolveLabel` back into each renderer (5
 *         copies) — which is what it exists to prevent.
 */

/** The shape of `t` from `useI18n()` — see `i18n/index.tsx:17`. */
export type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** Anything on the wire that carries a label, in either form. */
interface MaybeLabelled {
  readonly labelKey?: string;
  readonly label?: string;
}

/**
 * The label to draw, or `null` when there is none.
 *
 * `null` is the caller's instruction to SKIP — never a reason to draw a
 * placeholder. Callers: `KvSection` (rows), `ListSection` (items),
 * `ProfilePanelView` (sections and tabs), `UnknownSection` (its own title).
 */
export const resolveLabel = (t: Translate, item: MaybeLabelled | null | undefined): string | null => {
  const key = item?.labelKey;
  if (typeof key === 'string' && key.trim()) {
    const hit = t(key);
    /* `hit === key` ⇒ the dictionary had nothing (see the header). Fall through
       to the literal rather than printing the key. */
    if (hit && hit !== key) return hit;
  }
  const literal = item?.label;
  if (typeof literal === 'string' && literal.trim()) return literal;
  return null;
};

/**
 * [FEAT-20261022-I18NTICKETEN] A section / kv row from a provider that sends only a Thai
 * `label` (loan_v1 does) still translates: its stable `id` / `key` names a dictionary entry
 * (`panel.section.<id>`, `panel.row.<key>`), and `resolveLabel` falls back to the literal
 * when the dictionary has none — so an unknown provider row looks exactly as before.
 * A `labelKey` the provider sent wins.
 */
export const sectionLabelSource = (s: { id?: string } & MaybeLabelled): MaybeLabelled => ({
  labelKey: s.labelKey ?? (s.id ? `panel.section.${s.id}` : undefined),
  label: s.label,
});
export const rowLabelSource = (r: { key?: string } & MaybeLabelled): MaybeLabelled => ({
  labelKey: r.labelKey ?? (r.key ? `panel.row.${r.key}` : undefined),
  label: r.label,
});

/**
 * Provider VALUES that are fixed Thai words (not data), keyed by row key → value → dictionary
 * key. loan_v1 turns the lock boolean into ล็อกอยู่ / ไม่ล็อก (`build-view.ts`); every other
 * value is data and is drawn as sent.
 */
const FIXED_VALUES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  loanLocked: { 'ล็อกอยู่': 'panel.value.locked', 'ไม่ล็อก': 'panel.value.unlocked' },
};
export const translateFixedValue = (t: Translate, rowKey: string | undefined, value: unknown): unknown => {
  const key = rowKey && typeof value === 'string' ? FIXED_VALUES[rowKey]?.[value] : undefined;
  if (!key) return value;
  const hit = t(key);
  return hit && hit !== key ? hit : value;
};

/**
 * An id with no label anywhere → something readable.
 *
 * Used ONLY for a card whose title has no other source: a `group` (the contract
 * carries no group title — see `ProfilePanelView.tsx`) and a section id shown in
 * a diagnostic. `bonus.referral` → `Bonus Referral`.
 *
 * ⚠️ NOT `xpProductLabel` from `../ProfilePanel`, which does the same string
 * transform. That helper is documented there as needed by exactly one card, and
 * that claim is the reason it did not move to `shared/` under dev-local §6.
 * Importing it from here would make the comment false in a file this lane may
 * not edit. Different input domain too: dotted ids, not product keys.
 */
export const humanId = (id: string): string =>
  String(id ?? '')
    .replace(/[._-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
