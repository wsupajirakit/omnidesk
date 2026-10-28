/**
 * The scenarios level 2 can hand a message to, and how one is chosen.
 * ===========================================================================
 * ADDING ONE: write `scenario-d.ts` next to these, export it, and add a line to
 * `REGISTER_SCENARIOS`. Nothing else changes — not the helper, not the webhook,
 * except the letter it selects. เพิ่มตัวใหม่ = ไฟล์ใหม่ + หนึ่งบรรทัดที่นี่.
 *
 * REMOVING ONE: delete the file and its line. A caller still asking for it gets
 * `null` and the hand-off simply does nothing, which is the safe direction.
 *
 * ⚠️ Scenarios never import each other. The registry is the only place that
 * knows they exist as a set.
 */
export * from './scenario.types';
export * from './scenario-a.copy';
export * from './scenario-a';
export * from './scenario-b';
export * from './scenario-c';

import type { RegisterScenario } from './scenario.types';
import { SCENARIO_A } from './scenario-a';
import { SCENARIO_B } from './scenario-b';
import { SCENARIO_C } from './scenario-c';

export const REGISTER_SCENARIOS: Record<string, RegisterScenario> = {
  A: SCENARIO_A,
  B: SCENARIO_B,
  C: SCENARIO_C,
};

/** The one the webhook selects today. Changing this letter is the whole switch. */
export const ACTIVE_REGISTER_SCENARIO = 'A';

/** `null` for a letter nobody registered — never a throw on a live conversation. */
export function resolveScenario(
  name: string | null | undefined,
): RegisterScenario | null {
  const key = String(name ?? '')
    .trim()
    .toUpperCase();
  return REGISTER_SCENARIOS[key] ?? null;
}
