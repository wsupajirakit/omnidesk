import { FIELD_TAB, SENSITIVE_FIELD, fieldsForTabs } from '@/modules/hooks';

/**
 * [FEAT-20260810-CLONEPAIR] the payment/walletpay bindings must clone AS PAIRS.
 *
 * WHY THIS MATTERS: each binding is a flag + an id. Clone them apart and an OA
 * arrives with `walletpay_tool_status: true` and `walletpay_tool_id: null` — a switch
 * that reads ON while the runner finds no tool — or worse, an id pointing at a
 * host that OA never meant to use. The pairing is what makes a clone either
 * carry the whole binding or none of it. ต้องไปด้วยกันเสมอ ห้ามแยกครึ่ง.
 *
 * The guarantee is structural: both halves sit on the SAME clone tab, and tabs
 * are ticked as a unit, so a half-tick is impossible. `SENSITIVE_FIELD` is
 * opt-in PER FIELD, which is exactly why these must NOT be listed there.
 */

const PAIRS: Array<[string, string]> = [
  ['payment_tool_status', 'payment_tool_id'],
  ['walletpay_tool_status', 'walletpay_tool_id'],
  ['slip_require_profile', 'slip_require_profile_text'],
];

describe('[CLONEPAIR] every binding pair travels together', () => {
  it.each(PAIRS)('%s and %s share one clone tab', (flag, id) => {
    expect(FIELD_TAB[flag]).toBeDefined();
    expect(FIELD_TAB[id]).toBeDefined();
    // Same tab ⇒ ticked together ⇒ cannot be split.
    expect(FIELD_TAB[flag]).toBe(FIELD_TAB[id]);
  });

  it.each(PAIRS)('%s / %s are NOT opt-in-per-field', (flag, id) => {
    // SENSITIVE_FIELD is ticked one field at a time. Listing either half there
    // would reintroduce the half-bound OA this pairing prevents.
    expect(SENSITIVE_FIELD[flag]).toBeFalsy();
    expect(SENSITIVE_FIELD[id]).toBeFalsy();
  });

  it('⭐ selecting the tab yields BOTH halves of every pair', () => {
    // The real contract: cloneHookSettings copies exactly what fieldsForTabs
    // returns, so this is what an operator actually gets.
    for (const [flag, id] of PAIRS) {
      const fields = fieldsForTabs([FIELD_TAB[flag]!]);
      expect(fields).toContain(flag);
      expect(fields).toContain(id);
    }
  });

  it('payment and walletpay bindings ride the same tab as each other', () => {
    // Not required for correctness, but recorded: an operator cloning the
    // External API tab gets the whole payment wiring in one action, which is
    // what makes a cloned OA usable rather than half-configured.
    expect(FIELD_TAB['payment_tool_id']).toBe(FIELD_TAB['walletpay_tool_id']);
  });
});
