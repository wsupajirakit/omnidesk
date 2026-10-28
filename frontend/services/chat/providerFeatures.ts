/**
 * [FEAT-20261018-SCREENSECTIONS] The dashboard sections the active customer provider hides.
 *
 * `GET /api/customer-provider/features` → `data.hidden`:
 *   loan_v1 → ['hook-form.site-rules', 'hook-form.customer-helper-card', 'hook-form.customer-link']
 *   shop-api   → [].
 * The back end decides (its one table: omnidesk-api `customer-provider/features/screen-sections.ts`
 * — a section is hidden when its world is silenced or the provider names it); this file only
 * reads the answer. null — and any failure (older back end without `hidden`, 5xx) — means
 * "nothing hidden", i.e. the screen stays exactly as it was. Caching rule: `./providerAnswer.ts`.
 *
 * (Was [FEAT-20261018-SITERULESWORLD] `data.silenced` — worlds. The screen now asks per section,
 *  so which section follows which world is no longer FE knowledge.)
 */
import { providerAnswer } from './providerAnswer';

/** The ids the BE table names — keep in step with `SCREEN_SECTIONS` there. */
export type ScreenSection =
  | 'hook-form.site-rules'
  | 'hook-form.customer-helper-card'
  | 'hook-form.customer-link'
  /* [FEAT-20261018-CLOSEFOLLOW] the close-case dialog's follow-up sections */
  | 'ticket-close.follow-registration'
  | 'ticket-close.follow-deposit'
  | 'ticket-close.follow-withdraw';

const answer = providerAnswer<string[]>(
  '/api/customer-provider/features',
  (data) => {
    const list = (data as { hidden?: unknown } | null)?.hidden;
    return Array.isArray(list) ? list.map(String) : null;
  },
);

export const fetchProviderHiddenSections = (): Promise<string[] | null> => answer.get();

/** Test seam: forget the answer so a spec can ask again. */
export const resetProviderHiddenSections = (): void => answer.reset();
