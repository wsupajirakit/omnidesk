/**
 * [PROG-20260905-G25] AN OPERATOR IS HOLDING THE ROOM — what still happens, and what
 * stops. The body has been in `non-text/assist-bypass.ts` since SP22; this is the gate.
 *
 * ⚠️ WHERE IT SITS IS THE WHOLE FEATURE. Below the slip verify, so a customer's money is
 * still checked and filed while an admin is in the room; above the rate limiter, the
 * keyword handler, the AI and the non-text branch, so none of those speak. Move it up and
 * the slip stops being verified; move it down and the bot talks over a human.
 *
 * ⚠️ WHAT SURVIVES THE BYPASS, because "silence" is not the whole rule: the slip is still
 * verified and filed, and the register keyword still answers — only the bot can mint the
 * link, so refusing it would strand the customer with no way forward. Everything else
 * stays quiet.
 *
 * ⚠️ THE INPUT IS BUILT HERE, NOT IN `turnDeps`, AND THAT IS DELIBERATE. `reads` below is
 * what `assertDataChain` checks, so it has to name the fields this step actually consumes.
 * Building the input inside the binding would move the reads out of sight and leave the
 * declaration describing nothing — a fence checking a list that no longer matches the
 * code. The DEPS are bound once for the turn; the DATA is read here.
 * ด่านเป็นเจ้าของ "อ่านอะไร" · turnDeps เป็นเจ้าของ "คุยกับใคร"
 */

import type { LadderStep, StepVerdict } from './ladder.types';

export const assistBypassStep: LadderStep = {
  id: 'assist-bypass',
  describe:
    'an operator holds the room — file the slip, answer register, stay silent otherwise',
  enabled: true,
  mustFollow: ['unlinked-slip-refuse'],
  orderNote:
    'it forwards the slip verify result, which is produced below the refusal and above ' +
    'this gate (webhook.service.ts:2967)',

  when: (ctx) => ctx.skipBotProcessing,
  reads: [
    'hook',
    'event',
    'userId',
    'creds',
    'logContext',
    'meta',
    'skipBotProcessing',
    'slip',
    'media',
    'profileData',
    'profileForLog',
    'customerName',
    'customerTel',
    'contractCode',
  ],

  run: async (ctx, deps): Promise<StepVerdict> => {
    await deps.runAssistBypass({
      hook: ctx.hook,
      event: ctx.event,
      userId: ctx.userId,
      accessToken: ctx.creds.accessToken,
      channelId: ctx.creds.channelId,
      logContext: ctx.logContext,
      baseUrl: ctx.meta.baseUrl,
      slipVerifyResult: ctx.slip.verifyResult,
      slipRecordId: ctx.slip.recordId,
      slipCreatedAt: ctx.slip.createdAt,
      mediaUrl: ctx.media.mediaUrl,
      hookAiKey: ctx.creds.hookAiKey,
      profileData: ctx.profileData,
      /* [FEAT-20261019-CALLBACKLINEPROFILE] forwarded into the slip callback — see assist-bypass.ts */
      profileForLog: ctx.profileForLog,
      customerName: ctx.customerName,
      customerTel: ctx.customerTel,
      /* [FEAT-20261014-CALLBACKCONTRACT] forwarded into the slip callback — see assist-bypass.ts */
      contractCode: ctx.contractCode,
      slipStorageFilePath: ctx.slip.storageFilePath,
    });
    return 'done';
  },
};
