/**
 * The two admin buttons — one shared body, two entry conditions.
 *
 * ⚠️ THE TWO FEATURE TAGS ARE ON THE DOORS THEMSELVES, one each, in that order, and NOT
 * together in this header. `admin-direct-ticket.spec.ts` slices its source from the plain
 * door's tag to the withdraw door's tag; putting both on one line here collapsed that
 * slice to thirty characters and reddened four cases. The tags mark the seats.
 *
 * ⚠️ BOTH DOORS LIVE IN ONE FILE ON PURPOSE, against the usual one-file-per-step rule.
 * `admin-direct-ticket.spec.ts` slices its source from the plain door's tag to the
 * withdraw door's tag and guards twelve rules over that slice; splitting them across two
 * files would break a fence that was written after a live defect. They are also genuinely
 * one thing — the spine's own note calls them *"one body, two doors"*.
 *
 * ⚠️⚠️ ORDER IS LOAD-BEARING INSIDE THE SHARED BODY: reply first, open the case second.
 * `claimRoomAndOpenCase` sets `assist_status: true`, which is the switch that mutes the
 * bot. Opening first would make the acknowledgement a bot message inside a room an
 * operator already holds. That order lives in `ticket/open-admin-case.ts`, next to the
 * code that keeps it.
 *
 * 🔴 [FEAT-20260902-ADMINPOSTBACK] BUTTON PRESS ONLY — the word test is gone. These used
 * to fire on the SENTENCE, so a customer typing the same words opened a case. The buttons
 * now mint POSTBACKS and the doors match the payload. `event.type === 'postback'` is part
 * of the test, not decoration: `msgContent` holds the payload for a postback and the typed
 * text for a message, so payload-equality alone would reopen the hole.
 *
 * 🔴 [FIX-20260902-WITHDRAWFALLTHROUGH] The withdraw door CALLS the shared body; it does
 * not hope to fall into it. The plain door sits above and tests a different constant, and
 * control only moves down — so before this fix a withdraw tap with no matching notice fell
 * past both doors to the AI and got the main menu. Reproduced live 02/09: two taps, two
 * menu cards, no case.
 *
 * ⚠️ WHY THE DOORS SIT HERE and not at the postback seats further up: a case needs
 * `inboundRoom._id`, and `existingUser`/`profileData` — which the withdraw lane needs — are
 * not loaded up there either. An unclaimed postback arrives here with all of them
 * populated, so this position costs no plumbing at all.
 */

import { payLinkFromPostback } from '@/common/utils/paylink-tag';
/* [FEAT-20260831-ADMINVIAWITHDRAW] the copy the two buttons post, and the lane slice the
   withdraw door may consider. Both keep their existing homes — this file imports them, it
   does not re-declare them. */
import {
  CONTACT_ADMIN_MESSAGE,
  CONTACT_ADMIN_WITHDRAW_MESSAGE,
} from '@/modules/payment';
import { WITHDRAW_CASE_ORDER } from '../notice-runtime';

import type { LadderStep, StepVerdict } from './ladder.types';

/**
 * [FEAT-20260831-ADMINDIRECT] the plain admin button — a case, every time.
 *
 * DOOR 1 — the plain contact button. Consumes the payload either way: it is unmistakably
 * ours, and letting it walk on would put a machine string through the rest of the pipeline
 * for no possible benefit.
 */
export const adminDoorDirectStep: LadderStep = {
  id: 'admin-door-direct',
  describe: 'the plain contact-admin button — acknowledge, then open the case',
  enabled: true,
  reads: ['event', 'inboundRoom', 'userId', 'hook', 'creds', 'logContext'],

  /* The payload test is written out at BOTH doors rather than shared in a helper above
     them. It is two lines and it is the whole rule — `admin-direct-ticket.spec.ts` slices
     from this door's tag to the next one and checks it here, and a reader asking "what
     opens this door" should not have to scroll past the answer. */
  when: (ctx) =>
    payLinkFromPostback(
      ctx.event.type === 'postback' ? ctx.event.postback?.data : null,
    ) === 'contact_admin',

  run: async (_ctx, deps): Promise<StepVerdict> => {
    await deps.openAdminCase(CONTACT_ADMIN_MESSAGE);
    return 'done';
  },
};

/**
 * [FEAT-20260831-ADMINVIAWITHDRAW] the withdraw-side admin button.
 *
 * DOOR 2 — the withdraw-side button. Screens the WITHDRAW notice lane first; the first
 * case that fires sends its card and ends the request. Nothing fires ⇒ the customer
 * reaches an admin through the very same body door 1 uses.
 *
 * ⚠️ THE LANE NEEDS A WORD AND A POSTBACK CARRIES NONE. Cases C and D short-circuit on
 * `ctx.withdrawWord`, which `notice-context.ts` derives from the text passed IN — so
 * handing them the raw payload would make every withdraw case false and this door would
 * always skip to the admin body: wired-looking, never firing. The door passes the copy
 * constant, which is exactly the sentence the lane was written to read.
 *
 * ⚠️ `noticeTextEventAllowed` is DELIBERATELY NOT consulted. That knob answers "may a RAW
 * event reach the text screens", and this is not a raw event — it is an explicit,
 * single-payload invocation supplying its own text.
 */
export const adminDoorWithdrawStep: LadderStep = {
  id: 'admin-door-withdraw',
  describe:
    'the withdraw admin button — screen the withdraw notices, else open the case',
  enabled: true,
  mustFollow: ['admin-door-direct'],
  orderNote:
    'the two doors read the same payload field and only one may consume it; the plain ' +
    'door has always been first (webhook.service.ts:3579)',
  reads: [
    'event',
    'hook',
    'existingUser',
    'userId',
    'creds',
    'profileData',
    'logContext',
    'skipBotProcessing',
    'inboundRoom',
  ],

  when: (ctx) =>
    payLinkFromPostback(
      ctx.event.type === 'postback' ? ctx.event.postback?.data : null,
    ) === 'contact_admin_via_withdraw',

  run: async (ctx, deps): Promise<StepVerdict> => {
    const noticed = await deps.tryNoticeGuard({
      cases: WITHDRAW_CASE_ORDER,
      eventKind: 'text',
      hook: ctx.hook,
      member: ctx.existingUser,
      userId: ctx.userId ?? '',
      replyToken: ctx.event.replyToken ?? '',
      eventId: ctx.event.eventId,
      profileData: ctx.profileData,
      logContext: ctx.logContext,
      // the sentence the lane was written to read — see the ⚠️ above.
      text: CONTACT_ADMIN_WITHDRAW_MESSAGE,
      assisted: ctx.skipBotProcessing,
    });
    // A card was sent ⇒ that IS the answer, stop. Nothing fired ⇒ admin.
    if (!noticed) await deps.openAdminCase(CONTACT_ADMIN_WITHDRAW_MESSAGE);
    return 'done';
  },
};
