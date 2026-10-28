/**
 * [FEAT-20260812-QRPRESCAN] "pre QR check" — do not pay to verify a picture that is not a
 * slip.
 *
 * Owner's order, 12/08, and the ORDER is the feature:
 *   image saved
 *     → [1] this pre-scan — is there a QR/barcode at all?
 *     → [2] "รับสลิปเฉพาะลูกค้าที่ผูกบัญชีแล้ว" (`slip_require_profile`)
 *     → [3] the paid slip verification
 *
 * It runs FIRST because a picture with no code is not a slip at all, so neither the account
 * check nor the paid call has anything to decide about. The provider answers
 * VALIDATION_ERROR for those images every time — confirmed on live traffic 12/08 — and the
 * flow already handles that outcome, so skipping the call changes nothing the customer sees.
 *
 * ⚠️⚠️ FAIL-OPEN: ONLY a confident "no QR" skips. Undecodable, oversized, timed out, or the
 * reader throwing all continue to the checks below — **a missed slip costs a customer their
 * money while a wasted call costs a fraction of a satang.**
 *
 * ⚠️ [FEAT-20260814-STATUSOFFQUIET] hook off ⇒ no image checks at all. A fixed
 * `skipSlipVerify: true` verdict achieves that through machinery that already exists: the
 * refusal below sees no slip, and the verify condition reads `!skipSlipVerify`. When the
 * hook is ON this takes the original call verbatim — the on-path is byte-identical
 * (owner: "hook on ห้ามแก้ไข").
 *
 * ⚠️ Default mode is `'off'` ⇒ `skipSlipVerify` is false for every existing OA and this
 * changes nothing until an operator opts in.
 */

import { imgProbe } from '../logging/img-flow-probe';

import type { LadderStep, StepVerdict } from './ladder.types';

export const qrPrescanStep: LadderStep = {
  id: 'qr-prescan',
  describe: 'read the image for a QR before anything paid or refusing happens',
  enabled: true,
  mustFollow: ['image-store'],
  orderNote:
    'it reads the stored file, so the download has to have produced one ' +
    '(webhook.service.ts:2768)',
  reads: ['hook', 'slip'],
  writes: ['slip'],

  run: async (ctx, deps): Promise<StepVerdict> => {
    const prescan =
      ctx.hook?.['status'] === 0
        ? ({
            skipSlipVerify: true,
            reason: 'not_run',
            ms: 0,
            mode: 'off',
          } as const)
        : await deps.shouldSkipSlipVerify({
            filePath: ctx.slip.storageFilePath,
            hook: ctx.hook,
          });
    ctx.slip.prescan = prescan;
    // carry the verdict past this step's scope — the non-text lane reads it much later
    ctx.slip.noQrPhoto = prescan.skipSlipVerify;
    imgProbe('qr-prescan', {
      mode: prescan.mode,
      reason: prescan.reason,
      skipSlipVerify: prescan.skipSlipVerify,
      ms: prescan.ms,
    });
    return 'continue';
  },
};
