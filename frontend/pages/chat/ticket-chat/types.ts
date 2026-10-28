/**
 * [REFACTOR-20261027-TCSPLIT] Types shared by the pieces of TicketChat.
 * `TFn` is the page's own `t` (from `useI18n()`), handed to each piece as a prop — derived
 * from the hook so it can never drift from the real signature.
 */
import type { useI18n } from '../../../i18n';
import type { TicketEntry } from '../../../services/chat';

export type TFn = ReturnType<typeof useI18n>['t'];
/** the page's `locale`, same derivation */
export type TLocale = ReturnType<typeof useI18n>['locale'];

/** One row of the ปิดเคส list: a customer's closed cases on one OA, newest first. Mirrors
 *  the page's `groupedEndedTickets` rows; a drift there is a type error at the call site. */
export type EndedTicketGroup = {
  key: string;
  pinKey: string;
  userId: string;
  hookId: string;
  latest: TicketEntry;
  tickets: TicketEntry[];
};
