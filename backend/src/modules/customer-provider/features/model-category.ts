/**
 * [FEAT-20261015-TICKETCATADOPT] Is the assist summary's model-chosen category written to the
 * ticket? — decided by the customer provider when it declares categories.
 *
 * The summary prompt always asks the model for `Collection | IT | Other`
 * (`webhook/assist/summary-prompt.ts`). Legacy wrote that answer to the ticket only with
 * the `acme_category` config row on. Owner 14/10/2026: the loan site's categories come
 * from the customer provider, NOT that row — so without this, a loan site that never set the
 * row stored only Other / Payment and the screen's ทวงถาม / อุปกรณ์ never filled.
 *
 *   provider declares categories (loan) ⇒ adopt the answer iff it is one of them
 *                                          (anything else stays the fallback, Other)
 *   provider declares nothing (shop-api)   ⇒ `categorisationFlagOn` — the config-row rule,
 *                                          exactly as before, whatever the model said
 * A payment flex / a caller-forced category is decided before this is asked.
 *
 * revert: put `aiCategoryEnabled` back in the condition at `assist-notification.ts` and
 *         delete this file + its barrel line.
 */
import { providerTicketCategories } from './active-provider';

export function adoptsModelCategory(
  category: unknown,
  categorisationFlagOn: boolean,
): boolean {
  const declared = providerTicketCategories();
  if (declared === null) return categorisationFlagOn;
  return declared.some((c) => c === category);
}
