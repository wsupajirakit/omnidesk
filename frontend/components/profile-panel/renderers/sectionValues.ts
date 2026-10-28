/**
 * [FEAT-20260905-CUSTPROV] The hand-built cards read `view.sections` BY KEY.
 *
 * 📖 PLAN: `omnidesk-api/todo/task/05092026/todo3_05092026_profile_panel_module.md`
 *          PART 7 §36 (the fixed envelope) · §37 (the closed set) · §38 (the
 *          BE owns the mapping) · §40 (the honest cost of 100% dynamic)
 * 📖 CONTRACT: `omnidesk-api/src/modules/customer-provider/providers/engine/view.types.ts`
 *          — `Keyed` explains why a key and not a label, and why not a position.
 *
 * ## WHAT THIS IS
 * One reader. It answers "what value does the provider put in the `finCredit`
 * slot of the `finance.deposits` section" — and nothing else. Every hand-built
 * card on this panel used to answer that itself, out of the raw vendor blob:
 *
 *     const finCredit = finance?.credit_balance ?? xpBal('credit');
 *     const cbPending = bonus?.cashback?.pending ?? bonus?.pending_cashback;
 *
 * ## WHY IT EXISTS — the whole point of PART 7, stated as a cost
 * Every `??` chain like the two above is a VENDOR'S FIELD NAME compiled into the
 * dashboard. While they are here, a vendor whose credit lives at
 * `wallet.main.amount` instead of `finance.credit_balance` needs a FRONT-END
 * RELEASE — even though nothing about the screen changed and nothing about the
 * vendor is new. The back end already resolves every one of those values from
 * that vendor's own paths (`field-paths.ts`, `row-paths.ts`, `derive-fields.ts`)
 * and ships the answers in `view.sections`. This file is how the cards read them,
 * so that adding a provider stays a back-end-only change.
 * ชื่อฟิลด์ของเจ้าไหนต้องไม่เหลืออยู่บน FE
 *
 * ## 🔴 BY KEY. NEVER BY LABEL, NEVER BY POSITION.
 * A label is a display string: translate `เครดิตคงเหลือ`, or let a vendor rename
 * it, and a card matching on it silently draws a dash. A position is an accident
 * of what the vendor sent: omit one row and every lookup below it reads the wrong
 * number, with nothing to say so. The key is the PORT's vocabulary — the same
 * `finCredit` for every provider, because it names the slot rather than the
 * field. That is what makes the table swappable.
 *
 * ## 🔴 THERE IS NO FALLBACK TO THE OLD INLINE CHAINS, AND THAT IS DELIBERATE
 * A fallback would be the same rule written in two places, and two copies of one
 * rule drift — the FE half would keep working just well enough that nobody would
 * notice the BE half had stopped being exercised, until a vendor whose names
 * differ arrived and got the FE's answer instead of its own. So: no `view` ⇒
 * every lookup answers `undefined` / `[]` and the cards draw their empty states.
 * That is not a degraded mode invented here — it is exactly how this panel
 * already behaves in the seconds before the profile request lands.
 * ไม่มี view = การ์ดขึ้นสถานะว่าง · ไม่ใช่ไปเดาจากก้อนดิบ
 *
 * REJECTED — reading these values off `data` when `view` is missing. It reads as
 * caution and buys nothing: the same envelope carries both, so a response with
 * `data` and no `view` is a back end that predates the key, and the only two
 * places that can happen (an old cached body, a provider mid-deploy) both want
 * the honest empty card rather than a card filled from a vendor's field names
 * that this build guessed at.
 *
 * ## What is NOT here
 * The point round ROUND COUNT. It needs the site-rules `spend_amount`, a different
 * payload on a different route, so `pointRounds(acCoinBal, pointRoundSpendAmount(srShop))`
 * stays on the panel; only `acCoinBal`'s SOURCE moved. ห้ามแอบยัดรอบสะสมแต้มเข้ามา
 *
 * revert: delete this file, then restore the `[FEAT-20260801-SHOPAPIV1FIELDS]`
 *         value block in `ProfilePanel.tsx` and the vendor-field reads inside
 *         `cards/{PromotionCard,RecentProductsCard,BonusCard}.tsx` from
 *         `git show ce8fcaa:components/profile-panel/…`.
 */
import type { AmountRow, CustomerView, KvRow, ListItem, Section } from './types';

/**
 * One `key: value` row of a per-product table, with its prefix stripped.
 *
 * The โปรโมชั่น card draws activity volume and outstanding as two separate tables and a
 * vendor may use the same product key in both, so the producer prefixes them
 * (`activity_volume:slot`, `outstanding:slot`). `key` here is what the card prints —
 * `slot` — and `value` / `target` are the pair the colour rule compares.
 */
export interface KeyedRow {
  readonly key: string;
  readonly value: unknown;
  readonly target: unknown;
}

/**
 * A value on its way into JSX.
 *
 * ⚠️ `unknown` cannot be rendered by React, and `String(x)` is worse than not
 * rendering: an absent number would print the word "undefined" on a customer's
 * card, and an object would print `[object Object]`. Only the two primitives
 * that have a meaningful text form pass; everything else becomes `''`, which is
 * what React already draws for `undefined` today.
 */
export const cell = (v: unknown): string | number =>
  typeof v === 'number' || typeof v === 'string' ? v : '';

/** Every lookup the eight hand-built cards need. Bound to one profile answer. */
export interface PanelValues {
  /** The section, or `undefined` when this provider did not send it. */
  readonly section: (id: string) => Section | undefined;
  /** One keyed row's value. `undefined` ⇒ the card draws its own dash. */
  readonly value: (id: string, key: string) => unknown;
  /** The same row's TARGET — the `done / required` pair travels as a pair. */
  readonly target: (id: string, key: string) => unknown;
  /** The row's label, already composed by the producer. `''` when absent. */
  readonly label: (id: string, key: string) => string;
  /** The row's trailing note, e.g. `(87%)`. `''` ⇒ nothing is drawn. */
  readonly suffix: (id: string, key: string) => string;
  /** A header chip that is a SWITCH: `ok` = on. Absent or any other tone = off. */
  readonly switchOn: (id: string, key: string) => boolean;
  /** Rows whose key starts with `prefix`, in the order the provider sent them. */
  readonly keyed: (id: string, prefix: string) => KeyedRow[];
  /** A `list` section's items. Never `undefined` — a card maps over this. */
  readonly items: (id: string) => ListItem[];
  /** An `amount_rows` section's history. Never `undefined`, same reason. */
  readonly amountRows: (id: string) => AmountRow[];
}

/** `''` for anything that is not a real string — a blank label draws blank. */
const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * Bind the reader to one profile answer.
 *
 * ⚠️ EVERY ACCESSOR TOLERATES A MISSING EVERYTHING. `view` arrives from the
 * network as untrusted JSON and the panel renders before it lands, so a reader
 * that assumed `sections` was an array would crash a customer's panel on the
 * first render and on any provider bug. Missing ⇒ the empty answer, never a
 * throw and never a guess.
 *
 * ⚠️ `items` / `amountRows` hand back a COPY. The wire arrays are `readonly` and
 * shared with `<ProfilePanelView>`; several call sites `.sort()` or `.filter()`,
 * and `sort` mutates in place. A copy costs one allocation per render and
 * removes the whole class of "one card reorders another card's data".
 */
export const readPanelValues = (
  view: CustomerView | null | undefined,
): PanelValues => {
  const sections: readonly Section[] = Array.isArray(view?.sections)
    ? view.sections
    : [];

  const section = (id: string): Section | undefined =>
    sections.find((s) => s?.id === id);

  /* 🔴 `find`, not `rows[n]`. See the header: a provider that omits one row must
     cost that ROW, not every row after it. */
  const row = (id: string, key: string): KvRow | undefined =>
    section(id)?.rows?.find((r) => r?.key === key);

  return {
    section,
    value: (id, key) => row(id, key)?.value,
    target: (id, key) => row(id, key)?.target,
    label: (id, key) => text(row(id, key)?.label),
    suffix: (id, key) => text(row(id, key)?.suffix),

    /* `tone === 'ok'` is the ONE reading of "switched on". The producer sends
       `ok` for a switch that is on and `off` for one that is off; anything else
       — an absent chip, an absent section, a tone this build does not know — is
       NOT a promise that the switch is on, and a customer's deposits showing as
       enabled when nobody said so is the wrong way to be wrong. */
    switchOn: (id, key) =>
      section(id)?.badge?.find((c) => c?.key === key)?.tone === 'ok',

    keyed: (id, prefix) =>
      (section(id)?.rows ?? [])
        .filter((r) => typeof r?.key === 'string' && r.key.startsWith(prefix))
        .map((r) => ({
          key: (r.key as string).slice(prefix.length),
          value: r.value,
          target: r.target,
        })),

    items: (id) => [...(section(id)?.items ?? [])],
    amountRows: (id) => [...(section(id)?.amountRows ?? [])],
  };
};
