/**
 * [PROG-20260905-LADDER] legacy:4308-4314 — what the OA actually says.
 *
 * ⚠️ NULL OUT MEANS SKIP REPLYING, WHICH IS NOT THE SAME AS REPLYING WITH `""`. An OA with
 * no `default_answer_text` is choosing silence over a canned line, and two gates further
 * down read that difference.
 *
 * ⚠️ [FIX-20260808-AIGENERROR] the error signal travels with it: a Gemini 401/429 or a
 * missing key answers with `ai_generative_error_text` instead of the not-found default.
 * Both fields come off the model's own envelope, which is why this step must follow it.
 */

import { resolveReplyText } from '../ai-reply/ai-reply.provider';

import type { LadderStep, StepVerdict } from './ladder.types';

export const resolveReplyTextStep: LadderStep = {
  id: 'resolve-reply-text',
  describe:
    'choose between the model answer, the OA default and the generative-error line',
  enabled: true,
  mustFollow: ['ask-model'],
  mustPrecede: ['bot-chat-row'],
  orderNote:
    'it reads the model envelope, and the bot row stores what it chose — not the raw ' +
    'answer (webhook.service.ts:4447)',
  reads: ['replyTextRaw', 'tagStatus', 'modelAudit', 'hook'],
  writes: ['replyText'],

  run: (ctx): StepVerdict => {
    ctx.replyText = resolveReplyText(
      {
        text: ctx.replyTextRaw ?? null,
        noData: ctx.modelAudit?.noData ?? true,
        tagStatus: ctx.tagStatus,
        http_status: ctx.modelAudit?.httpStatus,
        error_message: ctx.modelAudit?.errorMessage,
      },
      ctx.hook?.['default_answer_text'] as string | undefined,
      ctx.hook?.['ai_generative_error_text'] as string | undefined,
    );
    return 'continue';
  },
};
