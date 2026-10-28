/**
 * [FEAT-20261014-TICKETCATS] The ticket categories a site works with — a provider fact.
 * ===========================================================================
 * Owner 14/10/2026: "เอาแค่สี่หมวด Collection IT Payment Other" · "ต้องไม่อ่าน
 * acme_category แต่ไปอ่าน customer provider" · "ห้ามกระทบ x api".
 *
 * THE VALUES ARE NOT NEW. They are what the system already writes into `tickets.category`
 * (read 14/10, legacy legacy-console does the same):
 *   · the assist summary asks the model for `Collection | IT | Other`
 *     (`webhook/assist/summary-prompt.ts`) and stores its answer;
 *   · a payment card locks `Payment` (`webhook/assist/assist-notification.ts`).
 * Legacy's screen showed them as ทวงถาม · อุปกรณ์ · ชำระค่างวด · อื่นๆ. The Thai label is
 * the screen's business (FE `components/ticket-category/`); the BE only names the values.
 *
 * WHAT A DECLARATION CHANGES (and nothing else):
 *   · `GET /api/customer-provider/ticket-categories` answers the list, so the screen shows
 *     the site's categories instead of reading the `acme_category` config row;
 *   · `POST /api/tickets/open-from-room` accepts the list.
 * 🔴 ABSENT = TODAY. A provider that declares nothing (shop-api) answers `null` on the endpoint
 *    (the screen keeps its own path) and open-from-room accepts exactly
 *    `DEFAULT_OPEN_CASE_CATEGORIES` — the list `@IsIn` held before, same message.
 *
 * revert: delete this file, `ticketCategories` on the port + loan_v1, the accessor in
 *         `active-provider.ts`, `customer-provider.controller.ts`, and put
 *         `@IsIn(['Other', 'Payment'])` back on `OpenTicketFromRoomDto.category`.
 */

/** The closed vocabulary — the values stored in `tickets.category`, in display order. */
export const TICKET_CATEGORY_VALUES = [
  'Collection',
  'IT',
  'Payment',
  'Other',
] as const;

export type TicketCategory = (typeof TICKET_CATEGORY_VALUES)[number];

/** open-from-room for a provider that declares nothing — exactly the old `@IsIn` list. */
export const DEFAULT_OPEN_CASE_CATEGORIES: readonly TicketCategory[] = [
  'Other',
  'Payment',
];
