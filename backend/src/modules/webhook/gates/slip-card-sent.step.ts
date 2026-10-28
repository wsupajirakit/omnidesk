/**
 * [FIX-20260808-SLIPFLOW] legacy:3781-3798 — a slip card went out, so fire the automated
 * callback and END THE TURN, skipping the normal AI / `image_answer_text` reply entirely.
 *
 * ⚠️ FIRE-AND-FORGET, exactly as legacy does on this path. The callback is a third-party
 * webhook the OA configured; a slow or failing one must not hold a reply the customer has
 * already been sent. Its failure is logged and nothing else.
 *
 * ⚠️ IT REPORTS `slip.condition`, which the flex branch may have REFINED after the verify
 * produced it — the callback has to describe the card that actually went out, not the
 * verdict that preceded it.
 */

import type { LadderStep, StepVerdict } from './ladder.types';

export const slipCardSentStep: LadderStep = {
  id: 'slip-card-sent',
  describe: 'a slip card was sent — fire the callback and end the turn',
  enabled: true,
  mustFollow: ['slip-flex-send', 'image-assist-hand-off'],
  orderNote:
    'it reports the card the flex branch actually sent, and the assist hand-off must ' +
    'have had its turn first (webhook.service.ts:3833)',
  reads: [
    'media',
    'slip',
    'hook',
    'userId',
    'profileForLog',
    'profileData',
    'customerName',
    'customerTel',
    'contractCode',
  ],

  when: (ctx) => ctx.media.isFlexSent,

  run: (ctx, deps): StepVerdict => {
    deps.handleSlipCallback({
      hook: ctx.hook,
      flexDoc: ctx.media.flexDoc,
      condition: ctx.slip.condition,
      slipVerifyResult: ctx.slip.verifyResult,
      profileData: ctx.profileData,
      userId: ctx.userId,
      /* [FEAT-20261019-CALLBACKLINEPROFILE] the LINE name + picture the spine already has. */
      lineProfile: ctx.profileForLog,
      customerName: ctx.customerName,
      customerTel: ctx.customerTel,
      /* [FEAT-20261014-CALLBACKCONTRACT] read only if the provider declares it a contract no. */
      contractCode: ctx.contractCode,
      storagePath: ctx.slip.storageFilePath,
      mediaUrl: ctx.media.mediaUrl,
      slipRecordId: ctx.slip.recordId,
    });
    return 'done';
  },
};
