/**
 * [FIX-20260808-SLIPFLOW] legacy:3439-3734 — the slip flex card, and the payment run that
 * may suppress it.
 *
 * ⚠️ PAYMENT RUNS FIRST, and the order is the reason both live in one step. The card send
 * below is what may need suppressing, so the decision has to EXIST before it. Splitting
 * them into two rows would let a future reorder put the send first, and the customer would
 * get two answers to one slip.
 *
 * ⚠️ WHEN `slipVerifyResult` IS NULL — slip checking off, or a non-slip image — the handler
 * is a no-op and answers the null result, so control reaches the guard below exactly as it
 * does for a plain image on an OA with slip checking off. Nothing here is conditional on
 * the OA having opted in; the handler's own no-op is.
 *
 * ⚠️ THE GEMINI QR SEAM (legacy:3660) is `qrVision.checkIfSlipWithQrCode`, passed as
 * `checkQrCode` — the ONLY billed call this lane makes, and only on the VALIDATION_ERROR
 * sub-path. A test hands it a canned boolean and never issues a Gemini call.
 *
 * ⚠️ `duplicateFirst` — [FEAT-20260820-LOCKDUPFIRST]: already paid and locked ⇒ the
 * duplicate card answers, ahead of the recipient and clock checks. The priority chain is
 * documented in `slip-flex/slip-flex.handler.ts`, both orders side by side.
 *
 * ⚠️⚠️ THIS IS ONE HALF OF A PINNED TWIN — THE OTHER HALF IS
 * `non-text/assist-bypass.ts`, which answers the same slip when an operator is holding
 * the room. `slip-answer-twin-sites.spec.ts` requires both sites to call the same three
 * helpers with argument objects that normalise identical, because a customer doing the
 * same thing must not get a different answer depending on whether an admin happens to be
 * in the room. A one-sided edit is exactly the defect that spec exists to catch: CHANGE
 * ONE, CHANGE BOTH.
 *
 * 🔴 THIS NOTE WAS MISSING UNTIL 05/09, AND ONLY THIS SIDE WAS MISSING IT. The bypass
 * half has carried its half of the warning since SP22; this half had none, so anyone
 * arriving here — which is the ORDINARY path, and therefore the likelier place to start
 * editing — had no way to learn the twin existed until the spec went red and named a file
 * they had never opened. A cross-reference that only points one way is half a
 * cross-reference. เตือนข้างเดียว = ยังไม่ได้เตือน
 */

import type { LadderStep, StepVerdict } from './ladder.types';

export const slipFlexSendStep: LadderStep = {
  id: 'slip-flex-send',
  describe:
    'run payment for the slip, then send the OA`s slip card unless it suppressed it',
  enabled: true,
  reads: ['slip', 'media', 'hook', 'userId', 'event', 'creds', 'logContext'],
  writes: ['slip', 'media'],

  run: async (ctx, deps): Promise<StepVerdict> => {
    // [FEAT-20260808-PAYTOOL-P3] the decision must exist before the send below.
    const paySuppress = await deps.runPaymentForSlip({
      hook: ctx.hook,
      slipRecordId: ctx.slip.recordId,
      replyToken: ctx.event.replyToken ?? '',
      userId: ctx.userId,
      logContext: ctx.logContext,
      // [FEAT-20260810-PAYSTATEFLEX] the same three values handleSlipFlex gets below.
      slipVerifyResult: ctx.slip.verifyResult,
      slipCreatedAt: ctx.slip.createdAt,
      baseUrl: ctx.meta.baseUrl,
    });

    const slipFlex = await deps.handleSlipFlex({
      slipVerifyResult: ctx.slip.verifyResult,
      hook: ctx.hook,
      slipCreatedAt: ctx.slip.createdAt,
      slipRecordId: ctx.slip.recordId,
      userId: ctx.userId,
      mediaUrl: ctx.media.mediaUrl,
      // [P2] the OA's own key; the vendor rule decides the fallback.
      geminiApiKey: ctx.creds.hookAiKey || undefined,
      replyToken: ctx.event.replyToken ?? '',
      eventId: ctx.event.eventId,
      incomingType: ctx.media.incomingType,
      baseUrl: ctx.meta.baseUrl,
      logContext: ctx.logContext,
      // Payment already answered ⇒ do not also send the slip card.
      suppressSlipReply: paySuppress.suppress,
      duplicateFirst: paySuppress.lockedDuplicate,
    });

    ctx.media.isFlexSent = slipFlex.isFlexSent;
    ctx.media.flexDoc = slipFlex.flexDoc;
    ctx.media.textReplyOverride = slipFlex.textReplyOverride;
    ctx.media.isQrCodeSlip = slipFlex.isQrCodeSlip;
    ctx.media.violationDetected = slipFlex.violationDetected;
    /* legacy reassigns the same variable — the flex branch may REFINE the condition the
       verify produced, and the callback below reports whichever is final. */
    ctx.slip.condition = slipFlex.slipCondition;
    return 'continue';
  },
};
