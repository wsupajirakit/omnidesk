/**
 * [FEAT-20261020-TICKETSTACK] On/off switch for stacking one customer's tickets
 * on one OA into a single collapsible group on the ticket list.
 *
 * Default is OFF (owner, 20/10/2026). Two levers, checked in this order:
 *   1. per browser — localStorage `TC_TICKET_STACK` = 'true' | 'false'
 *      (same shape as TC_ACTIVE_PAGING / TC_WS_PATCH; reload to apply)
 *   2. per build   — `VITE_TICKET_STACK=true` (a Build Variable; anything else = off)
 *
 * Off ⇒ TicketChat never calls into this module's render path, so the list is
 * the exact list it was before the feature existed. ปิด = หน้าตาเดิมทุกอย่าง.
 *
 * revert: delete `pages/chat/ticket-stack/` and every [FEAT-20261020-TICKETSTACK]
 * line in `pages/chat/TicketChat.tsx`.
 */
export const TICKET_STACK_STORAGE_KEY = 'TC_TICKET_STACK';

/** Pure decision, so both levers are testable without a browser. */
export function resolveTicketStackFlag(buildValue: unknown, storedValue: string | null): boolean {
  if (storedValue === 'true') return true;
  if (storedValue === 'false') return false;
  return String(buildValue ?? '').trim().toLowerCase() === 'true';
}

export function isTicketStackOn(): boolean {
  const build = (import.meta as Record<string, any>).env?.VITE_TICKET_STACK;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(TICKET_STACK_STORAGE_KEY);
  } catch {
    // storage unreadable ⇒ no per-browser override ⇒ the build default applies
  }
  return resolveTicketStackFlag(build, stored);
}
