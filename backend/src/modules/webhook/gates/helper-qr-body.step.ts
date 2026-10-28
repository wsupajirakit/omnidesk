/**
 * [FIX-20260801-HELPEREMPTY] legacy:4648-4671 — a real bug, and the fix is this ordering.
 *
 * The model answered with nothing but `[[[customer-helper]]] [[[FOUND]]]`, the tags were
 * stripped, the text was empty, and the guard below returned before the buttons were
 * attached — **the customer got silence.** And that was the CORRECT way to use the marker:
 * once the text comes from `customer_helper_text`, the model only has to emit the tag.
 *
 * ⚠️ IT RUNS ABOVE THE EMPTY-TEXT GUARD BECAUSE THAT GUARD NEEDS IT. Pure — no await, no
 * database — so the normal path pays nothing for it.
 *
 * ⚠️ THE PUSH PATH KEEPS `finalReplyForLine`. It can attach neither buttons nor flex, so
 * substituting there would promise a button that is not there.
 */

import { providerFeatureOn } from '@/modules/customer-provider';

import { resolveCustomerHelperText } from '../hook-reply/reply-tags.util';

import type { LadderStep, StepVerdict } from './ladder.types';

export const helperQrBodyStep: LadderStep = {
  id: 'helper-qr-body',
  describe:
    'swap in the customer-helper text when the answer was only its marker',
  enabled: true,
  mustFollow: ['resolve-reply-tags'],
  mustPrecede: ['require-something-to-send'],
  orderNote:
    'the empty-text guard needs `useHelperQr`, and an answer that is only a marker ' +
    'strips to nothing — returning before the buttons is the silence this fixed ' +
    '(webhook.service.ts:4415)',
  reads: ['tags', 'replyViaPush', 'userId', 'hook', 'finalReplyForLine'],
  writes: ['useHelperQr', 'replyBodyForLine'],

  run: (ctx): StepVerdict => {
    const wantsHelper = Boolean(
      ctx.tags.wantsHelperQuickReply && !(ctx.replyViaPush && ctx.userId),
    );
    /* [FEAT-20261014-PROVFEATURES] no register world (loan_v1) ⇒ no register buttons / card /
       minted link — the helper TEXT still answers, so a marker-only reply is never silence. */
    ctx.useHelperQr = wantsHelper && providerFeatureOn('register');
    ctx.replyBodyForLine = wantsHelper
      ? resolveCustomerHelperText(ctx.hook)
      : ctx.finalReplyForLine;
    return 'continue';
  },
};
