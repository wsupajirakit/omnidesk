/**
 * Front door of the follow-up side effects a campaign has. Two today, both
 * multicast-only and both keyed on WHO WAS ACTUALLY REACHED — never on who was
 * merely targeted:
 *
 *   [FEAT-20260824-BCASTCLEARNOTICE] clear the bank-notice stamps of everyone
 *     the send reached. See `clear-notice-on-multicast.ts`.
 *   [FEAT-20260825-BCASTDIRECTTICKET] open a case for everyone the send
 *     reached, when the campaign asked for it. See
 *     `open-direct-ticket-on-multicast.ts`.
 *   [FEAT-20260825-MCASTABANDON] arm the follow-up gate for everyone the send
 *     reached, when the campaign asks for details and did NOT open cases itself.
 *     🔴 That flag makes the customer's next message — any message — open a
 *     case and end the flow. See `stamp-abandon-on-multicast.ts` before
 *     touching it.
 *
 * ⚠️ Both are side effects of a send that already happened, so NEITHER may
 *    throw: the message is on the customer's phone whatever these do next.
 */
export {
  clearNoticeForReached,
  MULTICAST_CLEARS_KEYS,
  type ClearNoticeInput,
  type ClearNoticeResult,
} from './clear-notice-on-multicast';

export {
  openDirectTicketsForReached,
  wantsDirectTicket,
  needTextFor,
  dividerTextFor,
  TICKET_CATEGORY,
  type OpenDirectTicketDeps,
  type OpenDirectTicketResult,
} from './open-direct-ticket-on-multicast';

export {
  stampAbandonForReached,
  shouldStamp as shouldStampAbandon,
  STAMP_ABANDON_ENABLED,
  STAMP_KEY as ABANDON_STAMP_KEY,
  TRIGGER_SOURCE_KEYS as ABANDON_TRIGGER_SOURCE_KEYS,
  type StampDecisionInput,
  type StampAbandonResult,
} from './stamp-abandon-on-multicast';
