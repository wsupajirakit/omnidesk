/**
 * legacy:4714-4718 — empty text and no card is nothing to send; **empty text WITH a card
 * still sends the card.**
 *
 * ⚠️ THIS TERMINAL RE-ASSISTS. It is one of the four exits legacy reaches through its
 * patched `res.send`, and the spine's `finally` covers it by construction — the ladder
 * runs inside that `finally`, so answering `'done'` here behaves exactly as the original
 * `return` did.
 */

import type { LadderStep, StepVerdict } from './ladder.types';

export const requireSomethingToSendStep: LadderStep = {
  id: 'require-something-to-send',
  describe: 'end the turn when there is neither text nor card',
  enabled: true,
  mustFollow: ['flex-pc-safe-text'],
  orderNote:
    'the flex_pc guard can blank the text, so this must ask AFTER it or a blanked ' +
    'answer would still be sent (webhook.service.ts:4506)',
  reads: ['replyBodyForLine', 'flexProfileContents'],

  run: (ctx): StepVerdict =>
    !ctx.replyBodyForLine && !ctx.flexProfileContents ? 'done' : 'continue',
};
