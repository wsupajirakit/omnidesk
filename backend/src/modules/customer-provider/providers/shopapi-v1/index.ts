/**
 * ==== [FEAT-20260905-CUSTPROV] `shopapi_v1` — today's behaviour, written down =====
 *
 * This entry is not a new option. It is the CURRENT screen, expressed as data so
 * that a second option can exist beside it without either one being special.
 *
 * 🔴 IT IS ALSO THE DEFAULT, AND THAT IS THE WHOLE ACCEPTANCE TEST.
 * With `CUSTOMER_PROVIDER` unset — not in `.env`, not in `.env.local`, not in the
 * container, not in any runbook — the resolver lands here and every screen is
 * byte-identical to what it was before this module existed. If any environment
 * has to set a value to keep looking the way it looks today, the default is wrong
 * and the change is not ready. ไม่ต้องตั้งอะไรเลย ต้องเหมือนเดิมเป๊ะ
 *
 * ⚠️ EVERY VALUE BELOW IS A MEASUREMENT OF THE LIVE SYSTEM, NOT A PREFERENCE.
 * Changing one changes the product. The refs say where each was read from.
 */
import type { CustomerProvider } from '../customer-provider.port';
import { buildShopapiV1View } from './build-view';
import { deriveShopapiV1Fields } from './derive-fields';
import { SHOPAPI_V1_PATHS } from './field-paths';

export const shopapiV1Provider: CustomerProvider = {
  name: 'shopapi_v1',
  description:
    'The Shop-API profile blob as it has always been served — the default, and what an unset CUSTOMER_PROVIDER resolves to.',

  /**
   * Copied from `member-tier-key.util.ts:38-48`, which is itself a line-for-line
   * port of the dashboard's `utils/memberTier.ts`. The order is load-bearing and
   * so is the truthy gate applied by the reader: `''` / `0` / `false` fall
   * through to the next path, and finally to the `member.tier` column.
   */
  tierPaths: ['data.profile.tier', 'profile.tier', 'tier'],

  /** Both true today: the badge is on the card and the header, the filter is in
   *  the toolbar. Anything else here would be a visible change on day one. */
  showTierBadge: true,
  showTierFilter: true,

  /**
   * WHERE the values live — 17 of 26, as pure data. A vendor that differs only
   * in field names replaces this table and ships no code. See `field-paths.ts`.
   */
  paths: SHOPAPI_V1_PATHS,

  /**
   * The 9 that a path cannot express — type tests, merges, sorts, key unions.
   * See `derive-fields.ts` for why each one earns being code.
   *
   * ⚠️ The point-round count is NOT among them and cannot be: it needs the
   * site-rules payload as well as the profile, so the dashboard still owns it
   * (`activity/pointRounds.ts`). ห้ามแอบยัดรอบสะสมแต้มเข้ามา
   */
  deriveFields: deriveShopapiV1Fields,

  /**
   * Today's six cards as sections. Four of them are emitted; the customer-info
   * card is not, because its values are still read inline in the panel and are
   * not among this provider's fields. See `build-view.ts` for the full list of
   * what stays out and why.
   */
  buildView: buildShopapiV1View,
};
