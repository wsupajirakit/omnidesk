/**
 * [PROG-20260905-LADDER] Nothing to ask the model — the turn ends here.
 *
 * ⚠️ IT ALSO SETS `ctx.userText`, AND THAT IS WHY IT IS A STEP AND NOT JUST A GUARD. The
 * spine wrote `const userText = event.message?.text;` and then narrowed it with this very
 * guard, so every line below could treat it as a `string`. Splitting the read from the
 * guard would have forced either a cast or a second, dead guard to satisfy tsc — this way
 * the narrowing survives the move: past this step `ctx.userText` is the same non-empty
 * string, because the only other outcome is that the turn is over.
 * อ่านกับด่านต้องอยู่ด้วยกัน ไม่งั้นต้องหลอก tsc
 */

import type { LadderStep } from './ladder.types';

export const requireUserTextStep: LadderStep = {
  id: 'require-user-text',
  describe: 'read event.message.text; end the turn when there is none',
  enabled: true,
  reads: ['event'],
  writes: ['userText'],

  run: (ctx, deps) => {
    const text = ctx.event.message?.text;
    if (!text) {
      deps.log(
        `[WEBHOOK] No text content (event.type=${ctx.event.type}, msg.type=${ctx.event.message?.type}). Skipping AI reply.`,
      );
      return 'done';
    }
    ctx.userText = text;
    return 'continue';
  },
};
