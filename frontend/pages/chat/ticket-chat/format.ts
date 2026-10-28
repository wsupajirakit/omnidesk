/**
 * [REFACTOR-20261027-TCSPLIT] Two row helpers of TicketChat, moved out of the page verbatim
 * (only `export` was added): which rows count as bot-handled, and the card's clock text.
 * revert: paste both back above `export const TicketChat` and drop the import.
 */
import { translateNow } from '../../../i18n';

export function isBotModeTicket(tk: any): boolean {
  if (tk.assist_status === false) return true;
  if (tk.chat_room_data?.assist_status === false) return true;
  if (tk.chat_status === 'bot') return true;
  if (tk.assist_status !== true && tk.chat_room_data?.assist_status !== true) return true;
  return false;
}

// Absolute clock time (not "13 ชม. ago"): today → HH:MM, other days → D MMM HH:MM.
export const formatRelative = (iso?: string | null) => {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  const time = dt.toLocaleTimeString(translateNow('ticketui.time_locale', 'th-TH'), { hour: '2-digit', minute: '2-digit', hour12: false });
  // Full date with the GREGORIAN (ค.ศ.) year, then "@" before the time —
  // e.g. "23 ก.ค. 2026 @ 20:18". Force calendar 'gregory' so th-TH doesn't
  // render the Buddhist year.
  const date = dt.toLocaleDateString(translateNow('ticketui.date_locale', 'th-TH-u-ca-gregory'), { day: 'numeric', month: 'short', year: 'numeric' });
  return `${date} @ ${time}`;
};
