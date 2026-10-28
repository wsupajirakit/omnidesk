/**
 * [FIX-20260727-STALL] Do not answer a customer with a message they asked for 16 minutes
 * ago.
 *
 * ⚠️⚠️ AFTER THE MODEL CALL, NOT BEFORE, AND THAT IS THE POINT. It suppresses a reply that
 * has ALREADY been paid for. On 2026-07-27 a request stalled 986 seconds and then sent its
 * reply with a token minted 16 minutes earlier; LINE accepted it and DELIVERED it, so the
 * customer got a ghost message long after an admin had closed the case. Moving this above
 * the model call would change which requests are suppressed AND stop suppressing the case
 * it was written for.
 *
 * ⚠️ 120s, not 60. The worst HEALTHY budget is a 30s model call plus a 25s assist budget =
 * 55s. Doubling it means nothing healthy is ever cut.
 */

import type { LadderStep, StepVerdict } from './ladder.types';

export const stalenessGuardStep: LadderStep = {
  id: 'staleness-guard',
  describe: 'suppress a reply whose event is older than the stale limit',
  enabled: true,
  mustFollow: ['ask-model', 'require-something-to-send'],
  orderNote:
    'it suppresses a reply that was already PAID FOR — above the model call it would ' +
    'suppress a different set of requests and miss the stall it exists for ' +
    '(webhook.service.ts:4513)',
  reads: ['event', 'finalReplyForLine', 'replyStaleMs'],

  when: (ctx) =>
    Boolean(ctx.event.timestamp) &&
    Date.now() - Number(ctx.event.timestamp) > ctx.replyStaleMs,

  run: (ctx, deps): StepVerdict => {
    const ageSec = Math.round(
      (Date.now() - Number(ctx.event.timestamp)) / 1000,
    );
    deps.warn(
      `[REPLY-DEBUG] Suppressed stale reply (event ${ageSec}s old, limit ${ctx.replyStaleMs / 1000}s) ` +
        `— ไม่ส่งข้อความย้อนหลังหาลูกค้า: ${ctx.finalReplyForLine}`,
    );
    return 'done';
  },
};
