/**
 * legacy:4534-4646 — the tag-based image carousel. Body in
 * `hook-reply/tagged-image-reply.handler.ts` (SP8).
 *
 * ⚠️ IT ANSWERS TRUE ONLY ON THE DELIVERED PATH, which is why the exit is conditional. A
 * true verdict skips the flex ladder, the staleness guard, the send and the post-send
 * stamps — exactly where the original `return` sat. A false verdict falls through to the
 * plain-text reply, which is what the original did by not returning.
 */

import type { LadderStep, StepVerdict } from './ladder.types';

export const taggedImageReplyStep: LadderStep = {
  id: 'tagged-image-reply',
  describe:
    'send the carousel the answer asked for, if the tag resolves to images',
  enabled: true,
  mustFollow: ['resolve-reply-tags'],
  orderNote:
    'the tag is read by the resolver BEFORE the marker strip — re-scanning the finished ' +
    'text finds nothing, which is how this branch was dead for a week ' +
    '(webhook.service.ts:4369)',
  reads: ['tags', 'hook', 'creds', 'event', 'logContext'],

  when: (ctx) => Boolean(ctx.tags.imageTag),

  run: async (ctx, deps): Promise<StepVerdict> =>
    (await deps.replyWithTaggedImages({
      matchingTag: ctx.tags.imageTag,
      hookId: ctx.hook?.['_id'],
      hookGroup: ctx.hook?.['group'],
      replyToken: ctx.event.replyToken,
      eventId: ctx.event.eventId,
      logContext: ctx.logContext,
    }))
      ? 'done'
      : 'continue',
};
