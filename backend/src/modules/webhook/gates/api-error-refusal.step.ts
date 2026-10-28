/**
 * [PROG-20260905-LADDER] legacy:4259-4306 — an answer that quotes a critical API tag while
 * the profile fetch failed is BLOCKED. **A number quoted from nothing is worse than no
 * number.**
 *
 * The body is `hook-reply/api-error-reply.handler.ts` (helper door S4). Every path through
 * it ends the turn, so the verdict is unconditionally `'done'` — the exit stays exactly
 * where the spine's `return` was.
 *
 * ⚠️ ITS POSITION IS THE FEATURE: it can only be asked AFTER the model has answered,
 * because the question is whether *this answer* quoted an API number. Moving it above the
 * model call would change it from "refuse this answer" to "refuse to ask", which is a
 * different product.
 */

import type { LadderStep, StepVerdict } from './ladder.types';
import { shouldBlockForApiError } from '../ai-reply/ai-reply.provider';

export const apiErrorRefusalStep: LadderStep = {
  id: 'api-error-refusal',
  describe:
    'block an answer that quotes an API number the profile fetch never returned',
  enabled: true,
  mustFollow: ['ask-model', 'api-error-trigger'],
  orderNote:
    'the question is whether THIS answer quoted an API number, so it needs both the ' +
    'failed-fetch marker and the model`s reply (webhook.service.ts:4402)',

  when: (ctx) => shouldBlockForApiError(ctx.apiErrorTrigger, ctx.replyTextRaw),
  reads: ['apiErrorTrigger', 'replyTextRaw', 'hook', 'userId', 'event'],

  run: async (ctx, deps): Promise<StepVerdict> => {
    await deps.replyApiErrorRefusal({
      hook: ctx.hook,
      userId: ctx.userId,
      replyToken: ctx.event.replyToken,
      eventId: ctx.event.eventId,
      apiMissingSource: ctx.hook?.['missing_api_data_text'] as string,
    });
    return 'done';
  },
};
