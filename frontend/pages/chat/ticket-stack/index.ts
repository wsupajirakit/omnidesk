/**
 * [FEAT-20261020-TICKETSTACK] Ticket stacking — one customer's tickets on one OA
 * folded into a single collapsible group on the ticket list.
 *
 *   ticketStackFlag    on/off (default OFF · VITE_TICKET_STACK / localStorage TC_TICKET_STACK)
 *   ticketStackKey     "same customer + same OA" (line_oa_hook_id + member _id)
 *   groupTicketStacks  pure fold of the sorted list into stacks
 *   useStackExpand     which stacks are open, reset when the list changes
 *   TicketStack        the chrome (toggle bar, count pill, edges) around the page's own cards
 *
 * Frontend only: no API, no schema, no realtime handler is touched. Counts are
 * computed upstream from the ungrouped rows.
 */
export { TICKET_STACK_STORAGE_KEY, isTicketStackOn, resolveTicketStackFlag } from './ticketStackFlag';
export { ticketStackKey, type StackableTicket } from './ticketStackKey';
export { groupTicketStacks, type TicketStackGroup, type TicketStacks } from './groupTicketStacks';
export { useStackExpand, type StackExpand } from './useStackExpand';
export { StackToggle, TicketStack, renderTicketStackSlot } from './TicketStack';
