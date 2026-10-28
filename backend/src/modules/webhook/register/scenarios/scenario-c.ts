/**
 * Scenario C — reserved. Does nothing yet.
 * ===========================================================================
 * Kept alongside A so the registry holds more than one empty slot and the shape
 * of "add another" is obvious. The owner expects this one may eventually NOT end
 * the webhook flow; that is the `endsFlow` field below and nothing else.
 * อนาคต C อาจไม่จบ flow — แก้ที่ field เดียวในไฟล์นี้.
 *
 * revert: delete this file and its line in `scenarios/index.ts`.
 */
import type { RegisterScenario } from './scenario.types';

export const SCENARIO_C: RegisterScenario = {
  name: 'C',
  what: 'reserved — not defined yet',
  endsFlow: true,
  run() {
    // deliberately empty
  },
};
