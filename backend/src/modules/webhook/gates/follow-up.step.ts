/**
 * [FEAT-20260820-STICKERFOLLOWUP] The abandon flow, at its normal position.
 *
 * ⚠️ THE BODY IS A THUNK, NOT AN IMPORT, AND THAT IS NOT AN OVERSIGHT. The flow is called
 * from TWO places: here, and inside the silent-type gate — which is frozen inline because
 * a strike-plug hunk owns bytes within it. A linear ladder cannot express "also runs
 * inside that one", so the spine keeps the closure and both callers use it. The day the
 * silent-type gate becomes a step (Phase 5), this can become a plain import.
 *
 * ⚠️ ITS POSITION IS THE FEATURE. It stays BELOW the assist branch — an admin holding the
 * room silences the bot, and hoisting this above that would take the silence away — and
 * BELOW the rate limiter for text. `follow-up-boundaries.spec.ts` counts both call sites.
 */

import type { LadderStep, StepVerdict } from './ladder.types';

export const followUpStep: LadderStep = {
  id: 'follow-up',
  describe: 'run the abandon flow; it ends the turn when it answered',
  enabled: true,
  mustFollow: ['notice-text-guard'],
  orderNote:
    'after the rate ladder and the notice guard, before the register keyword and the AI ' +
    '— the owner`s spec ordering (webhook.service.ts:3690)',
  reads: [],

  run: async (_ctx, deps): Promise<StepVerdict> =>
    (await deps.runFollowUpFlow()) ? 'done' : 'continue',
};
