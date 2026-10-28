/**
 * [FEAT-20260822-NOTICERUNTIME] Case F — a QR slip arrives while EITHER side
 * is off-service: image event · deposit notice ON with scope 'slip' (D15) ·
 * jsQR found a QR · the site-rule verdict for the side NOTICE_SLIP_SIDE names
 * (shipped: deposit only — the spec's หรือ is one policy flip away).
 * Sends the ALL DISABLE card, stamps notice_payment_at, and the caller skips
 * Swiftcheck and payment for this event only. Runs after case E (time-first).
 * 🔴 THIS CASE CANNOT FIRE ON AN OA WHOSE `qr_prescan_mode` IS ABSENT (D14).
 * `qrFound` comes from the jsQR prescan, and `resolveQrPrescanMode` answers
 * `'off'` for a hook row that has no such column — the schema default `'skip'`
 * (added 15/08) is NOT applied to rows written before it, and lean reads do not
 * fill it in. Those OAs report `reason: 'not_run'`, so no slip case here can
 * ever match, even though D6 forces the operator to bind the two `all` cards
 * before scope 'slip' can be saved. Known and accepted (D14); it is written
 * here because nothing else in this folder says it out loud.
 * OA เก่าที่ไม่มีค่า qr_prescan_mode = เส้นสลิปเงียบทั้งเส้น.
 * revert: delete this file + its line in cases/index.ts.
 */
import { NOTICE_PAYMENT_AT_KEY } from '../notice.keys';
import { NOTICE_SLIP_SIDE } from '../notice-policy';
import type { NoticeCase } from './notice-case.types';

export const CASE_F: NoticeCase = {
  caseId: 'F',
  cardField: 'notice_all_disable_flex_id',
  stampKey: NOTICE_PAYMENT_AT_KEY,
  when: (ctx) =>
    /* [FEAT-20260823-NOTICECHECKFLAGS] the slip cases ride the DEPOSIT
       flags (owner plan D2): E is the slip mirror of A so it takes the
       sitestatus flag; wrap-flag FIRST, `!== false` = absent is ON, original
       predicate byte-unchanged below. เส้นสลิปตามสวิตช์ฝั่งฝาก */
    ctx.depositSiteStatusCheckOn !== false &&
    ctx.eventKind === 'image' &&
    ctx.depositOn &&
    ctx.depositScope === 'slip' &&
    ctx.qrFound &&
    /* [FIX-20260822-NOTICEPOLICY] which side counts is a policy, not a
       condition buried here — see notice-policy.ts NOTICE_SLIP_SIDE. Shipped
       'deposit': a withdraw-only outage must not swallow a deposit slip and
       leave real money uncredited. 'either' restores the spec's original OR. */
    (NOTICE_SLIP_SIDE === 'either'
      ? ctx.depositOff || ctx.withdrawOff
      : ctx.depositOff),
};
