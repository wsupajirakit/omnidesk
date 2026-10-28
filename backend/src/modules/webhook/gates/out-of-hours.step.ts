/**
 * [PROG-20260905-LADDER] The switched-off OA — legacy:3859-3913.
 *
 * The body has lived in `hook-reply/out-of-hours-reply.handler.ts` since SP7. What moves
 * here is the GUARD, the POSITION and the `return` — the three things that were still only
 * expressible as line 4097 of a 3,486-line method.
 *
 * ⚠️ ITS POSITION IS THE FEATURE, and it is an EFFECT constraint that no tool can see: it
 * sits DELIBERATELY AFTER the non-text branch, because a switched-off OA must still answer
 * an image with `image_answer_text`. Moving it up silences that reply, and nothing about
 * the data flow would object. That is why `mustFollow` names the branch instead of leaving
 * the rule in a comment. ปิดอยู่ก็ยังตอบรูปด้วยข้อความรูปเหมือนเดิม
 */

import { replyOutOfHours } from '../hook-reply/out-of-hours-reply.handler';
import { asString } from '../logging/coerce-mask.util';
import { resolveStatusOffReply } from '../webhook-routing';
import { sentMessageIds } from '@/infra/line';

import type { LadderStep, StepVerdict } from './ladder.types';

export const outOfHoursStep: LadderStep = {
  id: 'out-of-hours',
  describe: 'hook.status === 0 — answer with the OA-off line, or stay silent',
  enabled: true,
  mustFollow: ['non-text-branch'],
  orderNote:
    'a switched-off OA still answers an image with image_answer_text, so this gate ' +
    'must stay below the non-text branch (webhook.service.ts:4094)',

  when: (ctx) => ctx.hook?.['status'] === 0,
  reads: [
    'hook',
    'event',
    'userId',
    'creds',
    'logContext',
    'lineReplyEndpoint',
  ],

  /* The return type is written out because an `async` arrow widens `'done'` to `string`
     and the assignment to `LadderStep` then fails — annotate rather than cast. */
  run: async (ctx, deps): Promise<StepVerdict> => {
    await replyOutOfHours(
      {
        replyToken: ctx.event.replyToken,
        eventType: ctx.event.type,
        eventId: ctx.event.eventId,
        userId: ctx.userId,
        hookId: asString(ctx.hook?.['_id']),
        channelType: ctx.hook?.['channel_type'] as string | undefined,
        channelId: ctx.creds.channelId,
        logContext: ctx.logContext,
        endpoint: ctx.lineReplyEndpoint,
      },
      {
        // Called only after the reply-token guard, exactly as before.
        resolveReply: () => resolveStatusOffReply(ctx.hook),
        log: deps.log,
        error: deps.error,
        sendTextReply: deps.sendTextReply,
        emitWlog: deps.emitWlog,
        logBotMessage: (row) => deps.logBotMessage(row, '[OUTOFHOURS]'),
        sentMessageIds: (response) => ({
          ...sentMessageIds(response),
        }),
      },
    );
    return 'done';
  },
};
