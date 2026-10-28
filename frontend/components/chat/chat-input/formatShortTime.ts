/**
 * formatShortTime.ts — "HH:MMน." for a timestamp, or "-" when there is none.
 *
 * WHAT: moved verbatim out of `pages/chat/TicketChat.tsx`, where it was a
 * module-level helper.
 *
 * WHY it had to move: `ComposerCaseOverlay` prints "รับเคสไว้เมื่อ …" with it.
 * Leaving the declaration on the page would have made a chat-input file import
 * FROM the page while the page imports this folder's barrel — an import cycle,
 * and this folder must not have one.
 *
 * ⚠️ The page still uses it three times (ticket cards), so it is re-exported
 * from `./index.ts` and the page imports it back from there.
 *
 * REJECTED ALTERNATIVE: `utils/formatShortTime.ts`, which is the honest address
 * for a clock formatter that the ticket list also uses — a composer folder is
 * not really its home. `utils/` was outside the file set this task was allowed
 * to touch, so the better address is recorded instead of taken. ย้ายไป utils
 * ได้ทันทีเมื่อมีโอกาส — ไม่มีอะไรผูกไว้กับโฟลเดอร์นี้.
 *
 * Behaviour: none. Pure function of its one argument, body untouched.
 *
 * revert: paste it back at module scope in the page, drop the re-export in
 *   `./index.ts` and the page's import, delete this file.
 */

import { translateNow } from '../../../i18n';

export const formatShortTime = (d?: string | Date) => {
  if (!d) return '-';
  const date = new Date(d);
  if (isNaN(date.getTime())) return '-';
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  // [FEAT-20261022-I18NTICKETEN] th keeps "HH:MMน."; en shows "HH:MM"
  return translateNow('ticketui.composer.short_time', '{time}น.', { time: `${hours}:${minutes}` });
};
