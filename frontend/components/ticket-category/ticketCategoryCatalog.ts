/**
 * [FEAT-20261014-TICKETCATS] The ticket categories, their Thai labels and their badge colours —
 * one table for every screen that shows or offers a category.
 *
 * WHO DECIDES WHICH ONES A SITE USES: the back end's customer provider
 * (`GET /api/customer-provider/ticket-categories`, `useProviderTicketCategories`) — NOT the
 * `acme_category` config row (owner 14/10/2026). loan_v1 answers the four below;
 * a provider that declares nothing (shop-api) answers null and every screen keeps the code path
 * it had before this file existed.
 *
 * THE VALUES are what `tickets.category` holds — the assist summary writes Collection / IT /
 * Other, a payment card locks Payment. Labels and colours are legacy legacy-console's
 * Ticket Manager, verbatim (`ticket-detail/ticketPresentation.tsx` legacy set). The aliases
 * are the older Thai spellings rows may still carry, from the same legacy matchers.
 *
 * revert: delete `components/ticket-category/` and its uses (each tagged with this id).
 */
export type TicketCategoryValue = 'Collection' | 'IT' | 'Payment' | 'Other';

interface CatalogEntry {
  labelTH: string;
  labelEN: string;
  /** stored spellings that mean this category (compared lower-cased for latin) */
  aliases: readonly string[];
  badgeClass: string;
}

const BADGE = 'px-2 py-0.5 text-xs font-semibold rounded-full border whitespace-nowrap';

export const TICKET_CATEGORY_CATALOG: Readonly<Record<TicketCategoryValue, CatalogEntry>> = {
  Collection: {
    labelTH: 'ทวงถาม', labelEN: 'Collection',
    aliases: ['collection', 'ค่างวด', 'ทวงถาม'],
    badgeClass: `${BADGE} bg-orange-100 text-orange-800 border-orange-200`,
  },
  IT: {
    labelTH: 'อุปกรณ์', labelEN: 'IT',
    aliases: ['it', 'อุปกรณ์'],
    badgeClass: `${BADGE} bg-sky-100 text-sky-800 border-sky-200`,
  },
  Payment: {
    labelTH: 'ชำระค่างวด', labelEN: 'Payment',
    aliases: ['payment', 'รับยอด', 'ชำระค่างวด', 'แจ้งฝาก'],
    badgeClass: `${BADGE} bg-emerald-100 text-emerald-800 border-emerald-200`,
  },
  Other: {
    labelTH: 'อื่นๆ', labelEN: 'Other',
    aliases: ['other', 'อื่นๆ'],
    badgeClass: `${BADGE} bg-purple-100 text-purple-800 border-purple-200`,
  },
};

const isKnown = (v: string): v is TicketCategoryValue =>
  Object.prototype.hasOwnProperty.call(TICKET_CATEGORY_CATALOG, v);

/** Keep only values this screen knows, in the provider's order. Unknown values are dropped. */
export function knownCategories(values: readonly string[]): TicketCategoryValue[] {
  return values.filter(isKnown);
}

/**
 * Which category a stored value belongs to, within the site's set. Anything the set does not
 * name — empty, an old spelling of a category the site does not use, `Loan` — is `Other`,
 * so no ticket becomes unreachable from the filter.
 */
export function ticketCategoryOf(
  raw: string | null | undefined,
  set: readonly TicketCategoryValue[],
): TicketCategoryValue {
  const s = (raw || '').trim();
  const lower = s.toLowerCase();
  for (const v of set) {
    if (TICKET_CATEGORY_CATALOG[v].aliases.some((a) => a === lower || a === s)) return v;
  }
  return 'Other';
}

export interface TicketCategoryOption {
  value: TicketCategoryValue;
  label: string;
  labelTH: string;
  labelEN: string;
  match: (cat?: string | null) => boolean;
}

/** Filter / picker options for the site's set — label + matcher, same shape the pages use. */
export function categoryOptionsFor(values: readonly string[]): TicketCategoryOption[] {
  const set = knownCategories(values);
  return set.map((v) => ({
    value: v,
    label: TICKET_CATEGORY_CATALOG[v].labelTH,
    labelTH: TICKET_CATEGORY_CATALOG[v].labelTH,
    labelEN: TICKET_CATEGORY_CATALOG[v].labelEN,
    match: (cat) => ticketCategoryOf(cat, set) === v,
  }));
}
