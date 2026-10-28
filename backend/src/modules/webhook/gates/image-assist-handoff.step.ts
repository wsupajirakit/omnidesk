/**
 * legacy:3736-3745 — the `[[[assist]]]` hand-off on the image path.
 *
 * `rawAnswer` is `image_answer_text`, the OA's canned reply to media, so this fires when an
 * OPERATOR has put the marker in that string. No model is involved in producing it.
 *
 * ⚠️⚠️ [FIX-20260817-QRNOTIMAGE] A QR SLIP IS NOT "AN IMAGE". Owner rule, 17/08: no QR ⇒
 * answer with `image_answer_text` exactly as before; QR detected ⇒ that text is not this
 * flow's to use. The REPLY already obeyed it — the flex-sent exit below skips the image
 * answer once a slip card goes out — but the hand-off did NOT: the gate used to be
 * `isNormalMedia || isSuccessfulQr`, so a slip that VERIFIED still read the marker out of
 * `image_answer_text` and opened a case for a card whose own "เปิดเคสให้แอดมินอัตโนมัติ" was
 * unticked.
 *
 * WHY IT MATTERED — two ticket mechanisms collided. `openPaymentTicketIfIdle` can only act
 * while the room is IDLE, so assist claiming it first locked out the half that carries the
 * CARD's reason into `direct_ticket_detail`. Live count on 17/08: 162 tickets, only 11 with
 * `direct_ticket: true`.
 *
 * ⚠️ legacy does NOT pass `telegramNotiType` or `incomingMsgType` at this site, so both take
 * their defaults — "all" and "text". The consequence is real and is legacy's: an OA set to
 * notify on images only will NOT be filtered out here. Copied as found.
 */

import { isPaymentFlexCard } from '../slip-flex/slip-flex.handler';

import type { LadderStep, StepVerdict } from './ladder.types';

export const imageAssistHandOffStep: LadderStep = {
  id: 'image-assist-hand-off',
  describe:
    'hand off to an operator when the OA`s media reply carries the assist marker',
  enabled: true,
  mustFollow: ['slip-flex-send'],
  orderNote:
    'it must know whether the flex branch decided this image is a QR slip — a verified ' +
    'slip must not read the marker out of image_answer_text (webhook.service.ts:3788)',
  reads: ['media', 'msgContent', 'customerMsgId', 'hook'],

  /* `isNormalMedia = !isQrCodeSlip` — a non-slip image always notifies, unchanged from an
     OA with slip checking off. */
  when: (ctx) => !ctx.media.isQrCodeSlip,

  run: async (ctx, deps): Promise<StepVerdict> => {
    await deps.runAssist({
      userText: ctx.msgContent,
      rawAnswer: ctx.media.rawImageAnswer,
      // `skipAI: false` matches legacy — this path passes it explicitly.
      skipAI: false,
      // [FIX-20260808-SLIPFLOW] legacy:3768 — the real value on the slip path.
      slipError:
        (ctx.slip.verifyResult as { error?: unknown } | null)?.error ?? null,
      chatMsgId: ctx.customerMsgId,
      /* [FIX-20260808-SLIPFLOW] legacy:3771-3777 — true only when the chosen card is one
         of the hook's five payment cards. */
      isPaymentFlex: isPaymentFlexCard(ctx.media.flexDoc, ctx.hook),
    });
    return 'continue';
  },
};
