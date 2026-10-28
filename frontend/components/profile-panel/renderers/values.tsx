/**
 * [FEAT-20260905-CUSTPROV PART 7] Turning an `unknown` off the wire into
 * something a customer's card can show.
 *
 * 📖 PLAN: `omnidesk-api/todo/task/05092026/todo3_05092026_profile_panel_module.md`
 *          PART 7 §40 — "TypeScript stops checking card content", so every rule
 *          here is a RUNTIME rule and each one names the screen it protects.
 *
 * ## 🔴 AN OBJECT MUST NEVER REACH THE SCREEN
 * `String({})` is `[object Object]`, and a `view` is data: nothing stops a
 * provider from putting an object where a leaf belongs. The producer solved this
 * on its own side (`build-view.ts`'s `asText`, narrowed BY TYPE rather than
 * suppressed) and this is the same rule on the receiving side, because the
 * receiving side is the one the customer looks at. Objects, arrays, functions
 * and symbols become "nothing", which draws the grey dash the panel already uses
 * everywhere for an absent value. ของที่ไม่ใช่ค่าเดี่ยว = ถือว่าไม่มี ไม่ใช่พิมพ์ออกจอ
 *
 * ## 🔴 WHY `xpText` DOES NOT FORMAT MONEY, AND `xpAmt` STILL EXISTS
 * `xpAmt` forces 2 decimals — right for `เครดิตคงเหลือ`, wrong for
 * `แนะนำเพื่อนแล้ว` (a COUNT: the producer emits `rfFriends ?? 0`, and "3.00
 * friends" is a bug). The wire carries no money marker, so:
 *   · plain `kv`/list values → thousands separators, decimals ONLY if the value
 *     has them. `3` stays `3`; `1234.56` becomes `1,234.56`.
 *   · a `target` pair (progress) and an `amount_rows` amount → `xpAmt`, because
 *     those two ARE money on today's screen and the existing cards format them
 *     that way. Measured against the card, not chosen.
 * REJECTED: run every number through `xpAmt`. Fewer branches, and it prints
 * "3.00 friends" — a made-up precision on a real customer's card.
 *
 * ## 🔴 THE DATE HEURISTIC IS SCOPED, NOT GLOBAL
 * A products row's `value` is an epoch and a coin row's `value` is an amount — same
 * field, same type, two meanings, and today's card calls `xpDT` on one of them.
 * So `xpMaybeDT` exists, and it is used ONLY for `ListItem.value` /
 * `.secondary`. It is deliberately NOT used for `kv` values: a lifetime deposit
 * total can plausibly cross the threshold, and a balance rendered as a date is a
 * far worse failure than an epoch rendered as a number.
 * REJECTED (better, not available here): a `format: 'datetime' | 'amount'` field
 * on `ListItem`. That is a change to the contract in the BE repo, which this
 * lane does not own. The day it lands, delete `xpMaybeDT` and read the field —
 * the heuristic has no other caller. ฮิวริสติกนี้อยู่ชั่วคราว รอ field จริงจาก BE
 *
 * revert: delete this file; each renderer inlines its own formatting again.
 */
import React from 'react';
import { xpDT } from '../shared/formatters';

/** The grey dash the panel draws for an absent value (`PromotionCard.tsx:56`). */
export const DASH = <span className="text-gray-400">-</span>;

/**
 * A leaf value as display text, or `null` when there is nothing to show.
 * `null` (not `''`) so callers can tell "absent" from "the empty string".
 */
export const xpText = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.trim() ? v : null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null; // NaN/Infinity on a card is worse than a dash
    /* Separators always; decimals only when the value actually has them. */
    return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'boolean') return String(v);
  return null; // object / array / function / symbol — see the header
};

/**
 * `true` when a value is far more likely to be a timestamp than a quantity.
 *
 * Thresholds, and why they are these numbers:
 *   · `>= 1e9` — epoch SECONDS of this era are ~1.78e9. `xpDT` already splits
 *     seconds from milliseconds at 1e12, so anything above 1e9 lands correctly
 *     whichever unit it is. Below it, a list value is a quantity.
 *   · an ISO-ish string (`2026-09-05…`) — unambiguous.
 *   · an all-digit string of 10+ characters — an epoch that arrived as text.
 */
export const isDateish = (v: unknown): boolean => {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 1e9;
  if (typeof v !== 'string') return false;
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return true;
  return /^\d{10,}$/.test(v);
};

/** List-slot text: a timestamp becomes a date, everything else is `xpText`. */
export const xpMaybeDT = (v: unknown): string | null => {
  if (isDateish(v)) {
    const shown = xpDT(v);
    return shown && shown !== '-' ? shown : null;
  }
  return xpText(v);
};

/** Text, or the grey dash. The one place the dash rule lives. */
export const Value: React.FC<{ value: unknown }> = ({ value }) => {
  const text = xpText(value);
  return <>{text ?? DASH}</>;
};

/**
 * An image path off the wire → something `<img src>` can load.
 *
 * ⚠️ MOVED-RULE, NOT A NEW ONE (`RecentProductsCard.tsx:68`): some upstream rows
 * omit the scheme, and a bare `cdn.example/x.png` in `src` resolves against the
 * dashboard's own origin and 404s. The producer deliberately sends the RAW path
 * and leaves this here (`build-view.ts`, the ⚠️ on `image`) because it is
 * display logic that belongs beside the `onError` fallback.
 */
export const xpImageUrl = (raw: unknown): string | undefined => {
  const s = xpText(raw);
  if (!s) return undefined;
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
};
