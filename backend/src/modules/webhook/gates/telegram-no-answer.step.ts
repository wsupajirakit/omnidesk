/**
 * [PROG-20260905-LADDER] legacy:4368-4427 — the Telegram "no answer found" notification.
 *
 * The body moved to `assist/telegram-no-answer-notify.ts`. What is here is the guard: the
 * notification only exists when the AI said not-found AND the hook carries Telegram
 * credentials. The step writes nothing the rest of the ladder reads, so it is one await in
 * the same slot it always occupied.
 *
 * ⚠️ IT READS THE CLOCK THE `api-error-trigger` STEP MAY HAVE RE-STAMPED. That is the
 * chain the context makes explicit: a failed profile fetch re-stamps `bangkokTime`, and
 * this summary is one of the two places an operator sees it.
 */

import type { LadderStep, StepVerdict } from './ladder.types';

export const telegramNoAnswerStep: LadderStep = {
  id: 'telegram-no-answer',
  describe:
    'page Telegram when the model found no answer and the OA configured it',
  enabled: true,
  mustFollow: ['ask-model', 'api-error-trigger'],
  orderNote:
    'it reports the model verdict and the clock the failed-fetch step may have ' +
    're-stamped (webhook.service.ts:4566)',
  reads: [
    'tagStatus',
    'creds',
    'userText',
    'replyTextRaw',
    'customerName',
    'customerTel',
    'contractCode',
    'bangkokTime',
    'logContext',
    'alias',
    'userId',
    'event',
  ],

  when: (ctx) =>
    ctx.tagStatus === 'not_found' &&
    Boolean(ctx.creds.telegramKey) &&
    Boolean(ctx.creds.telegramChatId),

  run: async (ctx, deps): Promise<StepVerdict> => {
    await deps.notifyTelegramNoAnswer({
      accessToken: ctx.creds.accessToken,
      userId: ctx.userId,
      telegramKey: ctx.creds.telegramKey,
      telegramChatId: ctx.creds.telegramChatId,
      userText: ctx.userText,
      eventId: ctx.event.eventId,
      alias: ctx.alias,
      replyTextRaw: ctx.replyTextRaw,
      customerName: ctx.customerName,
      customerTel: ctx.customerTel,
      contractCode: ctx.contractCode,
      bangkokTime: ctx.bangkokTime,
      logContext: ctx.logContext,
    });
    return 'continue';
  },
};
