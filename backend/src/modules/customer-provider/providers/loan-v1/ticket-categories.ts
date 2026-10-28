/**
 * [FEAT-20261014-TICKETCATS] The loan site's ticket categories — the four legacy legacy-console
 * showed on acme's Ticket Manager (ทวงถาม · อุปกรณ์ · ชำระค่างวด · อื่นๆ).
 *
 * Edit THIS list to change what the loan site offers; the order is the order on screen.
 * Values must come from `TICKET_CATEGORY_VALUES` (features/ticket-categories.ts) — the
 * type refuses anything else, because the screen and the AI only know those.
 */
import type { TicketCategory } from '../../features/ticket-categories';

export const LOAN_V1_TICKET_CATEGORIES: readonly TicketCategory[] = [
  'Collection', // ทวงถาม — the summary model's Collection
  'IT', //         อุปกรณ์ — the summary model's IT
  'Payment', //    ชำระค่างวด — a payment card locks it
  'Other', //      อื่นๆ — everything else, and the fallback
];
