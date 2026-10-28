/**
 * [FEAT-20261014-TICKETCATS] The active customer provider's ticket categories.
 *
 * `GET /api/customer-provider/ticket-categories` → `data.ticket_categories`:
 *   loan_v1 → ['Collection','IT','Payment','Other'] · shop-api (declares nothing) → null.
 * null — and ANY failure (older back end without the route, network, 403) — means
 * "use the screen's own set", i.e. exactly what the page did before. Caching rule (kept /
 * failures retried): `./providerAnswer.ts`.
 */
import { providerAnswer } from './providerAnswer';

const answer = providerAnswer<string[]>(
  '/api/customer-provider/ticket-categories',
  (data) => {
    const list = (data as { ticket_categories?: unknown } | null)?.ticket_categories;
    return Array.isArray(list) && list.length ? list.map(String) : null;
  },
);

export const fetchProviderTicketCategories = (): Promise<string[] | null> => answer.get();

/** Test seam: forget the answer so a spec can ask again. */
export const resetProviderTicketCategories = (): void => answer.reset();
