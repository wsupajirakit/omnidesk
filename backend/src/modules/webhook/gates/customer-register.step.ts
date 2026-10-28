/**
 * legacy:3369-3385 + [FIX-20260808-CUSTREG] — the `customer-register` keyword.
 *
 * On the keyword it mints a customer-link token and replies with the register card, then
 * ends the turn. `handled === false` falls through to the normal flow, exactly as legacy
 * does — the keyword check and the handler's own verdict are two different questions.
 *
 * ⚠️ ITS POSITION: after the limiter, before the non-text branch, so the keyword is
 * counted against quota like any other message.
 *
 * ⚠️ IT STILL ANSWERS WHILE AN OPERATOR HOLDS THE ROOM — see `non-text/assist-bypass.ts`,
 * which lets this one through on purpose: only the bot can mint the link.
 */

import { isCustomerRegisterKeyword } from '../webhook-routing';

import type { LadderStep, StepVerdict } from './ladder.types';

export const customerRegisterStep: LadderStep = {
  id: 'customer-register',
  describe: 'the register keyword — mint the link token and send the card',
  enabled: true,
  mustFollow: ['follow-up'],
  orderNote:
    'after the limiter so the keyword costs quota like any other message, and before the ' +
    'non-text branch (webhook.service.ts:3695)',
  reads: ['event', 'hook'],

  when: (ctx) => isCustomerRegisterKeyword(ctx.event, ctx.hook),

  run: async (_ctx, deps): Promise<StepVerdict> =>
    (await deps.handleCustomerRegister()).handled ? 'done' : 'continue',
};
