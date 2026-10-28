/**
 * [FEAT-20261014-CALLBACKCONTRACT] The slip callback's `contact_number` — the CONTRACT number.
 *
 * Two sources, in this order, then the old fallback — nothing typed per vendor:
 *   1. legacy's literal key `Path : api/line/v1/installment_current.php` → `data.contract`
 *      (`contract_number`, then `code`) — legacy:2074-2101 verbatim, so every hook on the
 *      legacy external-API line sends exactly what it sent before;
 *   2. ONLY when the active provider declares `slipCallbackContract: 'profile_code'`: the
 *      code the hook's custom tool resolved through its own `profile_map.code` (the value
 *      the turn already carries as `contractCode`). A custom-tool hook keys its profile by
 *      endpoint key, so (1) never matches there and the shop used to get `'n/a'`.
 *   3. otherwise `'n/a'`, as before.
 *
 * Why (2) is opt-in per provider: on shop-api the same `profile_map.code` is a MEMBER id
 * (`Demo Shop-API (v3)`, local DB 14/10), and sending it would change what an shop-api shop
 * receives. Absent declaration = byte-identical to before.
 *
 * Pure. revert: inline the legacy expression back into `buildCallbackPayload` and delete
 * this file + `contractCode` on `SlipCallbackInput` and the two step call sites.
 */
import type { SlipCallbackContractSource } from '@/modules/customer-provider';

/** The legacy line's literal key — that string IS the key in the stored response object. */
const LEGACY_INSTALLMENT_KEY = 'Path : api/line/v1/installment_current.php';

/** `'N/A'` is the profile extractor's "not found" sentinel, never a contract number. */
const isResolvedCode = (v: unknown): v is string =>
  typeof v === 'string' && v.trim() !== '' && v.trim() !== 'N/A';

export function callbackContractNumber(input: {
  profileData: unknown;
  contractCode: unknown;
  source: SlipCallbackContractSource;
}): unknown {
  const installmentInfo = (
    input.profileData as
      | Record<
          string,
          { data?: { contract?: Record<string, unknown> } } | undefined
        >
      | null
      | undefined
  )?.[LEGACY_INSTALLMENT_KEY]?.data?.contract;
  return (
    installmentInfo?.['contract_number'] ||
    installmentInfo?.['code'] ||
    (input.source === 'profile_code' && isResolvedCode(input.contractCode)
      ? input.contractCode
      : undefined) ||
    'n/a'
  );
}
