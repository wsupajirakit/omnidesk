/**
 * legacy:3766-3800 — SETTING 2, "ข้อความเมื่อไม่พบข้อมูล API". Body in
 * `hook-reply/missing-profile-data-reply.handler.ts` (helper door S2).
 *
 * ⚠️ [FEAT-20260812-QRPRESCAN] A PLAIN PHOTO ENDS AT SETTING 3. Owner, 12/08: an image with
 * no QR from an unregistered customer must END at `image_answer_text` — nothing after it
 * gets a turn. "ข้อความเมื่อไม่พบข้อมูล API" answers a customer whose QUESTION needed their
 * profile; someone who simply sent a photo asked nothing of the kind, so telling them the
 * profile lookup failed answers a question they never asked. `photoEndsAtImageAnswer` is
 * that carve-out and it is deliberately the narrowest condition that satisfies the rule:
 * only images the pre-scan CONFIDENTLY read as having no code.
 *
 * ⚠️ `!skipBotProcessing` is always true here — the assist branch returned far above — and
 * it is kept because it is what legacy wrote.
 *
 * ⚠️ Every path through the handler ends the turn, so the verdict is unconditionally
 * `'done'`. It is the TWIN of the api-error refusal and the two are deliberately NOT
 * merged: four behaviours differ, and the handler's header records each one.
 */

import type { LadderStep, StepVerdict } from './ladder.types';

export const missingProfileReplyStep: LadderStep = {
  id: 'missing-profile-reply',
  describe:
    'answer an unregistered customer with the missing-API-data line, and stop',
  enabled: true,
  mustFollow: ['slip-card-sent'],
  orderNote:
    'a sent slip card already answered the customer; this may only speak when none was ' +
    '(webhook.service.ts:3880)',
  reads: [
    'customerName',
    'skipBotProcessing',
    'slip',
    'hook',
    'userId',
    'event',
  ],

  when: (ctx) =>
    ctx.customerName === 'N/A' && !ctx.skipBotProcessing && !ctx.slip.noQrPhoto,

  run: async (_ctx, deps): Promise<StepVerdict> => {
    await deps.replyMissingProfileData();
    return 'done';
  },
};
