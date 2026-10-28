/**
 * [FEAT-20260907-UNKNOWNPROFILEREVIEW] The body of the unknown-profile review —
 * resolve the bound card, mint its buttons, send it, mirror it to the room.
 * ============================================================================
 * WHY IT IS HERE AND NOT IN THE STEP. `gates/*.step.ts` is wiring: it says WHEN
 * a thing happens and hands the turn's collaborators to the thing that does it.
 * Its sibling `unlinked-slip-refusal.handler.ts` holds the refusal body for the
 * same reason, and both are reached from steps that are almost entirely a deps
 * literal. Keeping the body here means this sequence can be tested with four
 * function stubs and no ladder at all.
 *
 * WHAT IT REPLIES TO. `unlinked-slip-decide` found that the profile lookup RAN
 * and FAILED — a 500, a timeout, a refused token, an open circuit. The sender is
 * therefore unidentified, and a slip must not be auto-checked against a customer
 * nobody can name. The answer is the card the dashboard binds to the payment
 * state `review` and labels *"auto check ไม่ได้ ต้องให้ admin ดู"*.
 *
 * 🔴 THE CARD IS NEVER NAMED IN CODE. `hook.payment_flex_ids.review`, read
 *    through `resolveStateFlex` — the same single reader `sendPaymentReply`
 *    uses, so one state cannot resolve to two cards.
 *
 * 🔴 NOT BOUND ⇒ `sent: false`, and the caller carries on exactly as before this
 *    existed. That is the whole switch, and it is the switch the dashboard
 *    already ships: bind the card to turn it on, clear it to turn it off.
 *
 * ⚠️ `mintPayLinks` IS NOT OPTIONAL. The shipped `PAYreview` card carries
 *    `{{paylink.contact_admin}}`; sending it unminted puts a raw `{{…}}` in
 *    front of a customer — the failure `S9`/`S11f` of the flow bench exist to
 *    catch, and the one this codebase has already paid for once.
 *
 * ⚠️ THERE IS NO SLIP DATA HERE, and the tag context says so. Swiftcheck never ran
 *    — that is the point of this branch — so `vData` is null and any slip
 *    `{{tag}}` on the card renders `N/A`. Inventing values would make the card
 *    describe a verification that never happened.
 *
 * revert: delete this file and the step that calls it.
 */

import { resolveStateFlex } from '@/modules/payment';

import { mintPayLinks } from '../payment-reply/payment-action-mint';

/** What LINE shows in a notification, where a card cannot render. */
export const REVIEW_ALT_TEXT =
  'ตรวจสอบรายการอัตโนมัติไม่ได้ กรุณารอแอดมินตรวจสอบ';

export interface UnknownProfileReviewArgs {
  readonly hook: Record<string, unknown> | null | undefined;
  readonly userId: string | undefined;
  readonly channelId: string | undefined;
  readonly replyToken: string | undefined;
  readonly eventId: string | undefined;
}

export interface UnknownProfileReviewDeps {
  readonly findFlexById: (
    id: string,
  ) => Promise<Record<string, unknown> | null>;
  readonly log: (msg: string) => void;
  readonly sendFlexReply: (
    replyToken: string,
    card: Record<string, unknown>,
    altText: string,
    userId: string | undefined,
  ) => Promise<{ status?: number } | undefined>;
  readonly logBotMessage: (row: Record<string, unknown>, tag: string) => void;
}

/**
 * @returns `true` when a card was sent and the turn is finished; `false` when no
 *   card is bound, which means the caller must continue as it did before.
 */
export async function replyUnknownProfileReview(
  args: UnknownProfileReviewArgs,
  deps: UnknownProfileReviewDeps,
): Promise<boolean> {
  const { hook, userId, channelId, replyToken, eventId } = args;

  const bound = await resolveStateFlex(
    {
      state: 'review',
      boundIds: hook?.['payment_flex_ids'] as
        Record<string, unknown> | null | undefined,
      tagContext: {
        vData: null,
        baseUrl: null,
        slipCreatedAt: null,
        formatThaiDateTime: () => '',
      },
    },
    { findFlexById: (id) => deps.findFlexById(id), warn: deps.log },
  );

  if (!bound) {
    deps.log(
      '[UNKNOWNPROFILE] the profile lookup failed and no `review` card is bound — ' +
        'continuing to verification, which is the behaviour that was here before',
    );
    return false;
  }

  const minted = mintPayLinks(bound.contents, {});
  /* Worth a line either way: a `card:` entry means the card itself could not
     render, anything else is a button legitimately removed. A card that arrives
     with a button missing is a question an operator asks the log and, without
     this, does not find an answer to. */
  if (minted.dropped.length) {
    deps.log(
      `[UNKNOWNPROFILE] card '${bound.cardName}' dropped: ${minted.dropped.join(', ')}`,
    );
  }
  if (bound.leftover.length) {
    deps.log(
      `[UNKNOWNPROFILE] card '${bound.cardName}' left unfilled: ${bound.leftover.join(', ')}`,
    );
  }

  const card = minted.contents as Record<string, unknown>;
  const response = await deps.sendFlexReply(
    replyToken ?? '',
    card,
    REVIEW_ALT_TEXT,
    userId,
  );

  deps.log(
    `[UNKNOWNPROFILE] slip not auto-checked for ${userId ?? '?'} — profile lookup ` +
      `failed; sent '${bound.cardName}' (status ${response?.status ?? '?'})`,
  );

  /* The room mirrors what the customer received AND why. An operator opening
     this room has to know the slip was never verified; the card does not say
     that, and `reason` is where every other refusal records the same thing. */
  deps.logBotMessage(
    {
      userId,
      senderType: 'bot',
      messageType: 'flex',
      content: '',
      hookId: hook?.['_id'],
      channelType: hook?.['channel_type'],
      channelId,
      replyToken,
      metadata: {
        event_id: eventId,
        auto_reply_type: 'payment_reply',
        reason: 'slip_review_unknown_profile',
        flex_json: card,
      },
    },
    '[UNKNOWNPROFILE]',
  );

  return true;
}
