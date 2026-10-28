/**
 * Scenario B — ask a model for the customer's phone number and bank account.
 * ===========================================================================
 * Sends what the customer wrote to `buildMemberInfo`, which owns the prompt and
 * the parsing, and reports only WHETHER anything was found. Nothing is done with
 * the answer yet.
 *
 * Independent of the other scenarios: it imports none of them, and switching the
 * webhook away from B leaves this file unused but working.
 *
 * revert: delete this file and its line in `scenarios/index.ts`.
 */
import { buildMemberInfo } from '../build-member-info';

import type { RegisterScenario } from './scenario.types';

export const SCENARIO_B: RegisterScenario = {
  name: 'B',
  what: 'asks a model to extract phone_number and account_no as JSON',
  endsFlow: true,
  async run(input, deps) {
    if (!deps.generate) return;
    /* Handed straight through: `buildMemberInfo` has taken a list since day one
       and the hand-off now delivers one, so the day level 2 sends history this
       file does not change at all. ส่งตรง ไม่ต้องห่อ. */
    const info = await buildMemberInfo(
      { messages: input?.messages ?? [] },
      { generate: deps.generate, warn: deps.log },
    );
    if (!info.found) return;
    /* Whether, never what: the number and the account stay in chat history,
       which is the one place they belong. บันทึกว่าเจอ ไม่บันทึกค่า. */
    deps.log(
      `[REGISTER-SCENARIO-B] extracted user=${input.lineUserId} phone=${info.phoneNumber ? 'yes' : 'no'} account=${info.accountNo ? 'yes' : 'no'}`,
    );
  },
};
