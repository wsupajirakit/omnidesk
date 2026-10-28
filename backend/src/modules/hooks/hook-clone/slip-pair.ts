/**
 * ==== [FEAT-20261016-SLIPGUARDLOAN] a slip provider and its key travel together ===================
 *
 * The slip switchboard's tripwire, condition #1 (`slip-provider-hook-field.spec.ts`): the key
 * column is SHARED between providers (`slip_verify_key`, plus SlipGuard's `slip_verify_branch`), while
 * `slip_provider` rides the slip tab and the key is an opt-in tick. Split them and a real request
 * goes to one vendor carrying the other vendor's credential — a 401 nobody can explain, and a key
 * handed to a company that should never see it.
 *
 * Two doors, two rules — both in the shape the AI pair already uses:
 *   · Copy Item (`buildClonePatch`) — the form moved the provider ⇒ do not inherit the source's
 *     key / branch (`ai-pair.ts` does the same for `ai_vendor`). The admin enters the new one.
 *   · Clone tab (`cloneHookSettings`) — a target's provider would move without the key ticked ⇒
 *     HOLD the provider (and branch) for that target, clone everything else, and report it.
 *     Nothing is cleared or overwritten (owner 04/09: an unticked key is never touched).
 *
 * "Moved" compares the SITE lane: the name if the active site switches that provider on
 * (`providerSlipProviders()`, loan: slipguard), else `''` — the global default (Swiftcheck). On shop-api
 * the list is empty, every value is `''`, nothing is ever a move ⇒ both doors behave as today.
 * ⚠️ If the GLOBAL switchboard ever enables a second provider, its own tripwire goes red; extend
 * the lane to it then.
 *
 * revert: delete this file, its line in `clone-merge.ts`, its call + two result spreads in
 * `hooks.service.ts` (cloneHookSettings) and its barrel line.
 */
import { providerSlipProviders } from '@/modules/customer-provider';

/** The fields that belong to the provider a hook verifies with. */
export const SLIP_PAIR_FIELDS: readonly string[] = [
  'slip_verify_key',
  'slip_verify_branch',
];

const isBlank = (v: unknown): boolean =>
  v === undefined || v === null || v === '';

/** Which provider a stored name selects on THIS site: a site provider's name, or '' (the default). */
const siteLane = (name: unknown): string => {
  const n = typeof name === 'string' ? name.trim().toLowerCase() : '';
  return providerSlipProviders().includes(n) ? n : '';
};

/**
 * Copy Item: the pair fields NOT to inherit. A blank provider on the new row is filled from the
 * source by `buildClonePatch`, so it is not a move.
 */
export const slipPairFieldsToSkip = (
  created: Record<string, unknown>,
  source: Record<string, unknown>,
): readonly string[] => {
  const to = isBlank(created['slip_provider'])
    ? source['slip_provider']
    : created['slip_provider'];
  return siteLane(to) === siteLane(source['slip_provider'])
    ? []
    : SLIP_PAIR_FIELDS;
};

/**
 * Clone tab, per target: when `updates` would move the provider and the key was not ticked, drop
 * the provider + branch from `updates` and from `changedFields` (so the audit row matches the
 * write) and answer true — the caller reports `slip_provider_held_without_key`.
 */
export const holdSlipProviderWithoutKey = (args: {
  updates: Record<string, unknown>;
  changedFields: { field: string }[];
  target: Record<string, unknown>;
  fields: readonly string[];
}): boolean => {
  const { updates, changedFields, target, fields } = args;
  if (
    updates['slip_provider'] === undefined ||
    fields.includes('slip_verify_key')
  )
    return false;
  if (siteLane(updates['slip_provider']) === siteLane(target['slip_provider']))
    return false;
  for (const f of ['slip_provider', 'slip_verify_branch']) {
    delete updates[f];
    const at = changedFields.findIndex((c) => c.field === f);
    if (at !== -1) changedFields.splice(at, 1);
  }
  return true;
};
