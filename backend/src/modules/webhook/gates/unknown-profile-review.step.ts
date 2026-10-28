/**
 * [FEAT-20260907-UNKNOWNPROFILEREVIEW] THE UNKNOWN-PROFILE REVIEW — the gate.
 * The body is in `hook-reply/unknown-profile-review.handler.ts`.
 *
 * Same shape as `unlinked-slip-refuse` beside it, and for the same reason: what
 * belongs in a step is WHEN and WITH WHAT, never the sequence itself. The
 * handler resolves the bound card, mints its buttons, sends it and mirrors it to
 * the room; none of that needs a ladder to be tested.
 *
 * ⚠️ IT ANSWERS `'continue'` WHEN NO CARD IS BOUND, and that is the switch. The
 * handler returns false in exactly that case, and the turn then proceeds to
 * verification the way it did before this feature existed. An OA that has not
 * bound a `review` card sees no change and has nothing to configure.
 *
 * ⚠️ IT RUNS AFTER THE NOTICE GUARD. `[FEAT-20260824-NOTICEFIRST]`: the off-hours
 * card speaks before any slip answer. Moving this into `IMAGE_LADDER` would put
 * the reply above the guard and undo that with nothing going red.
 *
 * ⚠️ IT IS NOT MERGED WITH `unlinked-slip-decide`, for the reason its neighbour
 * states: the decision is taken before the notice guard and the reply is sent
 * after it.
 */

import { replyUnknownProfileReview } from '../hook-reply/unknown-profile-review.handler';

import type { LadderStep, StepVerdict } from './ladder.types';

export const unknownProfileReviewStep: LadderStep = {
  id: 'unknown-profile-review',
  describe:
    'answer a slip whose sender could not be identified with the `review` card, and end the turn',
  enabled: true,
  mustFollow: ['unlinked-slip-decide'],
  orderNote:
    'it sends what the decide step computed; without that write it would review nobody, ' +
    'silently — the same coupling `unlinked-slip-refuse` has to the same step',

  when: (ctx) => ctx.slip.reviewUnknownProfile,
  reads: ['hook', 'userId', 'creds', 'event', 'slip'],

  run: async (ctx, deps): Promise<StepVerdict> => {
    const sent = await replyUnknownProfileReview(
      {
        hook: ctx.hook,
        userId: ctx.userId,
        channelId: ctx.creds.channelId,
        replyToken: ctx.event.replyToken,
        eventId: ctx.event.eventId,
      },
      {
        findFlexById: (id) => deps.findFlexById(id),
        log: deps.log,
        sendFlexReply: (replyToken, card, altText, userId) =>
          deps.sendFlexReply(replyToken, card, altText, userId),
        logBotMessage: (row, tag) => deps.logBotMessage(row, tag),
      },
    );
    return sent ? 'done' : 'continue';
  },
};
