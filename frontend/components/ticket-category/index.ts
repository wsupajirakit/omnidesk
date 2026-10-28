/** [FEAT-20261014-TICKETCATS] ticket categories decided by the back end's customer provider. */
export {
  TICKET_CATEGORY_CATALOG,
  categoryOptionsFor,
  knownCategories,
  ticketCategoryOf,
} from './ticketCategoryCatalog';
export type { TicketCategoryOption, TicketCategoryValue } from './ticketCategoryCatalog';
export { TicketCategoryBadge } from './TicketCategoryBadge';
export { useProviderTicketCategories } from './useProviderTicketCategories';
