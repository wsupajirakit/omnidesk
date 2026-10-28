/**
 * ==== [FEAT-20260903-FIELDOPTIONS] ask the server once, from any form =========
 *
 * A tiny hook around `fieldOptionsService.get`, so more than one form can offer
 * the same server-owned list without either of them growing its own copy of the
 * fetch, the failure handling, or — the part that matters — its own idea of what
 * the valid values are.
 *
 * 🔴 IT FAILS TOWARD "OFFER NOTHING". On a rejected request the options are empty
 * and `choiceCount` is 0, which every caller renders as "do not show the control".
 * The alternative — showing a control with a partial or stale list — lets an
 * operator pick a value the server cannot act on, which is the whole failure this
 * endpoint was built to remove. ล้มไปทางไม่เสนออะไร ไม่ใช่ทางเสนอของใช้ไม่ได้
 *
 * ⚠️ `choiceCount` EXCLUDES the default option and comes from the SERVER. Counting
 * `options.length` here instead would mean this side has to know which entry is
 * the fallback — the one piece of knowledge the endpoint keeps on one side.
 *
 * ⚠️ NOT CACHED, deliberately: one small request when a form opens. A cache would
 * keep a newly registered value invisible until a reload, reintroducing exactly
 * the staleness this endpoint exists to remove.
 * [FEAT-20261027-TANSTACK] Now a TanStack query with `QUERY_EXCEPTIONS.noCache`
 * (gcTime 0): still one fresh request per open, nothing kept once no form shows
 * it, and any status other than success reads as "offer nothing" — so a failed
 * refetch can never fall back to a previous list.
 *
 * ⚠️ `enabled` is for forms that must not fetch until they are open. Passing
 * `false` leaves the empty state, so nothing renders — the same as a failure.
 *
 * revert: delete this file; the one caller inlines the fetch again.
 */
import { useAppQuery, QUERY_EXCEPTIONS } from '../query';
import { fieldOptionsService, type FieldOption } from './fieldOptionsService';
import { hookKeys } from './queries/hookKeys';

export interface UseFieldOptions {
  options: FieldOption[];
  /** how many options are a REAL choice — the default excluded, per the server */
  choiceCount: number;
}

const OFFER_NOTHING: UseFieldOptions = { options: [], choiceCount: 0 };

export const useFieldOptions = (
  key: string,
  enabled = true,
): UseFieldOptions => {
  const q = useAppQuery({
    queryKey: hookKeys.fieldOptions(key),
    queryFn: () => fieldOptionsService.get(key),
    enabled,
    ...QUERY_EXCEPTIONS.noCache,
  });
  // see the header: offer nothing rather than something unusable
  if (q.status !== 'success') return OFFER_NOTHING;
  return { options: q.data.options, choiceCount: q.data.choice_count };
};
