/**
 * [FEAT-20261016-CUSTCACHE] How long the loan site keeps a customer's partner answers. EDIT HERE.
 *
 * Owner 16/10/2026: like the old system — found 12 h · not found 30 min · other endpoints 12 h.
 * One place, every loan OA; shop-api declares nothing and keeps fetching live.
 * Meaning of each number and what counts as "not found": `../../features/customer-data-cache.ts`.
 * 0 = do not cache that kind of answer.
 */
import type { CustomerDataCachePolicy } from '../../features/customer-data-cache';

const HOUR = 60 * 60;
const MINUTE = 60;

export const LOAN_V1_CUSTOMER_DATA_CACHE: CustomerDataCachePolicy = {
  foundTtlSec: 12 * HOUR,
  notFoundTtlSec: 30 * MINUTE,
  otherTtlSec: 12 * HOUR,
};
