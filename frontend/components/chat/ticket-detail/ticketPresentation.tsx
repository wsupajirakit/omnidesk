/**
 * ticketPresentation.tsx — the two page-level presentation helpers that BOTH
 * the ticket page and the extracted ticket-detail panels need.
 *
 * WHAT: `AVATAR_FALLBACK` and `getCategoryBadge`, moved verbatim out of
 * `pages/chat/TicketChat.tsx` (they were declared at module scope there).
 *
 * WHY: `ProfileHeader` and `OperationsPanel` moved into this folder and both
 * reach for these. Leaving the declarations on the page would have forced the
 * new files to import FROM the page while the page imports this folder's
 * barrel — a real import cycle, and `AVATAR_FALLBACK` is a `const`, so a cycle
 * could hand a leaf `undefined` at module-init time. One shared leaf module has
 * no cycle: page -> barrel -> leaf, never back.
 *
 * REJECTED ALTERNATIVE: a neutral home such as `utils/ticketPresentation.ts`,
 * which is the better long-term address for a category badge the ticket LIST
 * also draws. It is outside the file set this task was allowed to touch, so it
 * is recorded here rather than done. ครั้งหน้าย้ายไป utils ได้เลย ไม่มีอะไรผูกไว้.
 *
 * Behaviour: none. Both are pure — one string constant and one function of its
 * two arguments. Not one byte of either body changed.
 *
 * revert:
 *   1. paste both declarations back into `pages/chat/TicketChat.tsx` at module
 *      scope (they sat just above `getCategoryBadge`'s old neighbours, ~L329
 *      and ~L350 of the pre-split file);
 *   2. drop them from `./index.ts`;
 *   3. drop `AVATAR_FALLBACK` / `getCategoryBadge` from the page's import of
 *      `../../components/chat/ticket-detail` and from `./ProfileHeader` and
 *      `./OperationsPanel`;
 *   4. delete this file.
 */
import React from 'react';
import { translateNow } from '../../../i18n';
import { categoryLabelI18n } from './categoryLabelI18n';

const catLabel = (th: string) => categoryLabelI18n(th, translateNow); // [FEAT-20261022-I18NTICKETEN]

export const AVATAR_FALLBACK = 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y';

// Category badge — Thai label + colour. Mapping lifted verbatim from the ticket
// page on branch main (getCategoryBadge switch). When acme_category is
// FALSE the set is narrowed to just แจ้งฝาก / อื่นๆ (per the narrowed dropdown).
// Matching is case-insensitive so "payment"/"Payment"/"PAYMENT", "it"/"IT",
// "other"/"Other" all resolve the same.

export const getCategoryBadge = (category: string | null | undefined, acme: boolean) => {
  const raw = (category || 'Other').trim();
  const norm = raw.toLowerCase();
  const isPayment = norm === 'payment' || raw === 'รับยอด' || raw === 'แจ้งฝาก' || raw === 'ชำระค่างวด';

  // Narrowed set: only แจ้งฝาก (deposit) or อื่นๆ.
  if (!acme) {
    return isPayment
      ? <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 whitespace-nowrap">{catLabel('แจ้งฝาก')}</span>
      : <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-purple-100 text-purple-800 border border-purple-200 whitespace-nowrap">{catLabel('อื่นๆ')}</span>;
  }

  // Legacy set (acme = true) — verbatim from main.
  if (norm === 'collection' || raw === 'ค่างวด' || raw === 'ทวงถาม')
    return <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-orange-100 text-orange-800 border border-orange-200 whitespace-nowrap">{catLabel('ทวงถาม')}</span>;
  if (norm === 'it' || raw === 'อุปกรณ์')
    return <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-sky-100 text-sky-800 border border-sky-200 whitespace-nowrap">{catLabel('อุปกรณ์')}</span>;
  if (norm === 'payment' || raw === 'รับยอด')
    return <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 whitespace-nowrap">{catLabel('ชำระค่างวด')}</span>;
  if (norm === 'loan' || raw === 'สินเชื่อ')
    return <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-indigo-100 text-indigo-800 border border-indigo-200 whitespace-nowrap">{catLabel('สินเชื่อ')}</span>;
  return <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-purple-100 text-purple-800 border border-purple-200 whitespace-nowrap">{catLabel('อื่นๆ')}</span>;
};
