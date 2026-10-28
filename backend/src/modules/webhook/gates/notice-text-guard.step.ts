/**
 * [FEAT-20260822-NOTICERUNTIME] The notice guard for ordinary text — cases A-D.
 *
 * One call, early return. After the rate ladder, before the abandon flow and the AI, per
 * the owner's spec ordering. OFF / unconfigured / absent rows all fall through
 * byte-identical, so an OA that never configured a notice card pays nothing for this.
 *
 * ⚠️ [FEAT-20260822-NOTICEMODE] `noticeTextEventAllowed` is read HERE because this is the
 * only place that still holds the RAW event — by the time the guard sees it, a postback's
 * payload has already become text. With the shipped policy it answers true for every event
 * that reaches this point, so the call below is made exactly as before; flipping
 * `NOTICE_TEXT_EVENTS` to `'message-only'` is what makes a postback skip the word screens
 * and run its own handler instead.
 */

import { noticeTextEventAllowed } from '../notice-runtime';

import type { LadderStep, StepVerdict } from './ladder.types';

export const noticeTextGuardStep: LadderStep = {
  id: 'notice-text-guard',
  describe:
    'send a notice card (cases A-D) for ordinary text, and stop if one went out',
  enabled: true,
  mustFollow: ['admin-door-withdraw'],
  orderNote:
    'the withdraw door screens its own lane first with its own text; letting the general ' +
    'guard run before it would answer a withdrawal question with a deposit card ' +
    '(webhook.service.ts:3661)',
  reads: [
    'event',
    'hook',
    'existingUser',
    'userId',
    'profileData',
    'logContext',
    'msgContent',
    'skipBotProcessing',
  ],

  when: (ctx) =>
    noticeTextEventAllowed(ctx.event.type, ctx.event.message?.type),

  run: async (ctx, deps): Promise<StepVerdict> =>
    (await deps.tryNoticeGuard({
      eventKind: 'text',
      hook: ctx.hook,
      member: ctx.existingUser,
      userId: ctx.userId ?? '',
      replyToken: ctx.event.replyToken ?? '',
      eventId: ctx.event.eventId,
      profileData: ctx.profileData,
      logContext: ctx.logContext,
      text: ctx.msgContent,
      assisted: ctx.skipBotProcessing,
    }))
      ? 'done'
      : 'continue',
};
