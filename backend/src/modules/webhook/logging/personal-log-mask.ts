/**
 * [FEAT-20261016-LOGMASK80] Mask a customer's name / phone / contract in a SERVER LOG line.
 *
 * Owner 16/10/2026: the loan site's stdout printed those three in full on every message — mask
 * them 80%. shop-api must not move ("ห้ามกระทบ x api").
 *
 * The share comes from the active customer provider (`personalLogMaskRatio`); only loan_v1
 * declares one (0.8). shop-api / unbound ⇒ null ⇒ the value comes back untouched, so those lines
 * stay byte-identical. The style is the owner's existing site-rules mask (`maskValue`): head
 * kept, the rest `*`, length kept — `0812345678` → `08********`.
 *
 * LOG ONLY: callers pass the masked copy to the logger and keep the real value for the DB.
 * `N/A` (nothing known) is left as is — starring it would hide that the lookup found nothing.
 *
 * revert: drop `personalLogMaskRatio` from `customer-provider/providers/loan-v1/index.ts`
 * (everything then prints plain), or unwrap the call sites.
 */
import { maskValue } from '@/modules/chat';
import { providerPersonalLogMaskRatio } from '@/modules/customer-provider';

export function maskPersonalForLog<T>(value: T): T | string {
  const ratio = providerPersonalLogMaskRatio();
  if (ratio === null || typeof value !== 'string' || value === 'N/A')
    return value;
  return maskValue(value, ratio) as string;
}
