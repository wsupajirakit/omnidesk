/**
 * [FIX-20260817-DIRECTBADGECLOSED] The orange ⚠ on the avatar belongs to an
 * OPEN case only — closing the case must take it away.
 *
 * WHAT IT IS: `[FEAT-20260810-DIRECTTICKET]` puts an orange badge on the avatar
 * in the ticket-support left panel when the system opened the case itself
 * (`direct_ticket: true`) instead of the customer asking for a human. It means
 * "nobody asked for me, look at this" — a call to action.
 *
 * THE BUG (owner, 17/08 — "ถ้ากดปิดเคส caution สีส้มที่ avatar จะต้องหายไป"):
 * the badge only tested `direct_ticket === true`, and that flag stays on the
 * row forever. Verified against the live API, not the source: `GET
 * /api/tickets/hook/:id?job_status=2` returns closed rows carrying
 * `direct_ticket: true`, and the list query has no projection that could strip
 * it. So the badge survived in the ปิดเคส and บอทดูแล tabs permanently — and it
 * also appeared the instant a case was closed, because the optimistic patch
 * spreads the old ticket into `completedTickets` (`TicketChat.tsx:1728`).
 * A closed case is not a call to action, so the badge is noise there.
 *
 * WHY A SEPARATE FILE: `TicketChat.tsx` is ~3k lines and cannot be rendered in
 * vitest, so a predicate living inline is untestable — the same reason
 * `ticketTagFilterOptions.ts` sits next door.
 *
 * ปิดเคสแล้ว = ไม่ต้องเตือนอีก · ป้ายอยู่เพื่อเรียกให้คนมาดู ไม่ใช่เพื่อบอกประวัติ.
 * (ประวัติยังอยู่ครบในแชท — เส้น divider variant `direct_ticket` ที่
 * `ChatRoomView.tsx:149` ไม่ถูกแตะ เพราะนั่นคือบันทึกเหตุการณ์ ไม่ใช่ป้ายเตือน)
 *
 * revert: inline `ticket.direct_ticket === true` back at the call site and
 * delete this file + its spec. The badge returns on closed cases.
 */

/** `2` = จบงานแล้ว (`TicketEntry.job_status`, services/chat/ticketService.ts:10). */
const JOB_STATUS_CLOSED = 2;

/**
 * Only the two fields that decide it, so a caller can pass a `TicketEntry`, the
 * optimistic patch object, or a bot-tab snapshot without a cast.
 */
export interface DirectTicketBadgeInput {
  direct_ticket?: unknown;
  job_status?: unknown;
}

/**
 * True when the avatar should carry the orange caution.
 *
 * `direct_ticket` is compared to `true` (not truthy) exactly as before — the
 * field is absent on older rows, and `undefined` must not light the badge.
 * `job_status` goes through `Number` because it arrives as a number from the
 * API and from the optimistic patch, but a legacy row can carry it as a string;
 * a row with no `job_status` at all keeps today's behaviour (badge shown),
 * since "unknown state" is not "closed".
 */
export function shouldShowDirectTicketBadge(
  ticket: DirectTicketBadgeInput | null | undefined,
): boolean {
  if (!ticket || ticket.direct_ticket !== true) return false;
  return Number(ticket.job_status) !== JOB_STATUS_CLOSED;
}
