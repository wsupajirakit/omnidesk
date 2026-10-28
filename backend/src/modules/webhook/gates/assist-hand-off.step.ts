/**
 * [PROG-20260905-LADDER] legacy:4429-4457 — the `[[[assist]]]` hand-off on the main text
 * path.
 *
 * ⚠️ `rawAnswer` IS `replyText || replyTextRaw` AND IT CARRIES THE MARKER. The stored chat
 * row keeps it too, and only what is SENT is stripped — that is legacy's arrangement at
 * `:4318-4323` vs `:4497-4500`, not an oversight. This is the value the marker test reads.
 *
 * ⚠️ AWAITED, exactly as legacy awaits it, because the send happens below. The 25s budget
 * inside `runAssistGuarded` is what stops that await from costing the customer their reply.
 *
 * ⚠️ THIS SITE PASSES NO `skipAI`, exactly as before: it takes the consumer's default. The
 * turn-level spread does not introduce one.
 */

import type { LadderStep, StepVerdict } from './ladder.types';

export const assistHandOffStep: LadderStep = {
  id: 'assist-hand-off',
  describe:
    'hand the turn to an operator when the answer carries the assist marker',
  enabled: true,
  mustFollow: ['resolve-reply-text', 'bot-chat-row'],
  orderNote:
    'rawAnswer is the RESOLVED reply falling back to the raw one, and the ticket links ' +
    'the chat row this turn already wrote (webhook.service.ts:4600)',
  reads: [
    'userText',
    'replyText',
    'replyTextRaw',
    'hook',
    'msgType',
    'customerMsgId',
  ],

  run: async (ctx, deps): Promise<StepVerdict> => {
    await deps.runAssist({
      userText: ctx.userText,
      rawAnswer: ctx.replyText || ctx.replyTextRaw,
      telegramNotiType: ctx.hook?.['telegram_noti_type'],
      incomingMsgType: ctx.msgType,
      chatMsgId: ctx.customerMsgId,
    });
    return 'continue';
  },
};
