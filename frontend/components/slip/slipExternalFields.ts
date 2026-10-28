/**
 * [FIX-20261014-SLIPDETAILNEST] The customer/contract rows of the slip-detail modal, read from
 * whichever level the `external_data` carries them.
 *
 * Two shapes reach the modal: the list's light copy (`customer` / `contract` at the top, built
 * from the member) and the detail's RAW partner profile body, where the loan partner nests them
 * under `.data`. Reading only the top made every row blank once the detail arrived. An shop-api body
 * has `customer` at neither level, so for shop-api nothing changes.
 *
 * revert: put the four `externalData?.customer?.…` / `contract?.…` reads back in
 * `SlipDetailModal.tsx` and delete this file.
 */
type Block = { customer?: Record<string, unknown>; contract?: Record<string, unknown> };

const asText = (v: unknown): string | undefined =>
  v === null || v === undefined || v === '' ? undefined : String(v);

export function slipCustomerRows(externalData: unknown): {
  name?: string;
  number?: string;
  contract?: string;
  tel?: string;
} {
  const top = (externalData ?? {}) as Block & { data?: Block };
  const customer = top.customer ?? top.data?.customer;
  const contract = top.contract ?? top.data?.contract;
  return {
    name: asText(customer?.['customer_name']),
    number: asText(customer?.['customer_number']),
    contract: asText(contract?.['contract_number']),
    tel: asText(customer?.['customer_tel']),
  };
}
