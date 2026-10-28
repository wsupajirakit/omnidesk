/**
 * [FEAT-20260905-CUSTPROV] Timestamp readers, shared by every provider.
 *
 * These live in the engine rather than beside one vendor because the rule they
 * encode is not a vendor's: *"upstreams send epoch seconds and epoch
 * milliseconds interchangeably, and history rows disagree about which key holds
 * the time."* The next provider will meet the same two problems, and a copy per
 * vendor is how two copies drift. helper ร่วมอยู่ที่ engine ไม่ก๊อปต่อเจ้า
 *
 * 🔴 MOVED VERBATIM from `PersonalPanel.tsx:154` (`xpTs`) and `:1766`
 * (`xpProductTs`). Byte-identical bodies, proven by the backtest in
 * `z-test/unit/customer-provider-fields.spec.ts`, not by assertion.
 *
 * revert: inline both back into the provider that needs them.
 */

/* eslint-disable @typescript-eslint/no-explicit-any --
   A history row is whatever the upstream sent; surviving that is the point. */

/**
 * A history row's timestamp, in milliseconds. `0` for anything unreadable —
 * never `NaN` and never "now", because a card sorted by NaN puts rows in an
 * order that changes between renders, and "now" silently promotes a broken row
 * to the top of the list.
 */
export const xpTs = (h: any): number => {
  const v = h?.at ?? h?.date ?? h?.created_at;
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  if (Number.isFinite(n)) return n < 1e12 ? n * 1000 : n;
  const t = +new Date(v);
  return Number.isFinite(t) ? t : 0;
};

/**
 * A PRODUCT row's timestamp — a WIDER key set than `xpTs` (`played_at` first, then
 * `updated_at`). The difference is deliberate: `[FIX-20260802-GAMEFIELDS]` chose
 * "last played" over "created", and a product row carries keys a cashback row does
 * not. Pinned by a test so a future tidy that unifies the two has to argue with
 * a red first. ต่างกันตั้งใจ ห้ามรวม
 */
export const xpProductTs = (g: any): number => {
  const v = g?.played_at ?? g?.at ?? g?.date ?? g?.updated_at ?? g?.created_at;
  const n = Number(v);
  if (Number.isFinite(n) && v !== null && v !== '')
    return n < 1e12 ? n * 1000 : n;
  const t = +new Date(v);
  return Number.isFinite(t) ? t : 0;
};
