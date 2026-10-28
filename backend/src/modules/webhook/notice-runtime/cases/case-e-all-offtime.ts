/**
 * [FEAT-20260822-NOTICERUNTIME] Case E — a QR slip arrives inside the
 * off-service window: image event · deposit notice ON with scope 'slip'
 * (D15: the slip path rides the DEPOSIT toggle, per the spec's own words
 * "เตือนระบบฝากมีผลกับ slip") · jsQR found a QR · in window. Sends the ALL
 * OFF-TIME card, stamps notice_payment_at. The caller then skips Swiftcheck and
 * payment for THIS event only — outside these conditions both run untouched
 * (owner: "มันไม่มีทางออกจาก payment flow ตลอดเวลา").
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
import type { NoticeCase } from './notice-case.types';

export const CASE_E: NoticeCase = {
  caseId: 'E',
  cardField: 'notice_all_offtime_flex_id',
  stampKey: NOTICE_PAYMENT_AT_KEY,
  when: (ctx) =>
    /* [FEAT-20260823-NOTICECHECKFLAGS] the slip cases ride the DEPOSIT
       flags (owner plan D2): E is the slip mirror of A so it takes the
       time flag; wrap-flag FIRST, `!== false` = absent is ON, original
       predicate byte-unchanged below. เส้นสลิปตามสวิตช์ฝั่งฝาก */
    ctx.depositTimeCheckOn !== false &&
    ctx.eventKind === 'image' &&
    ctx.depositOn &&
    ctx.depositScope === 'slip' &&
    ctx.qrFound &&
    ctx.inWindow &&
    /* [FEAT-20260829-STATUSFIRST] this card is the slip member of the deposit
       side's off-time family (same wrap-flag above), so the same switch governs
       it — a TEXT that flows on while an IMAGE still gets the night card would
       be the flag half-working.
       ⚠️ "off" here is F's slip expression (deposit OR withdraw off), not bare
       `depositOff` — E's silence must agree with the F card the customer would
       otherwise receive on this exact path. */
    !(ctx.depositSiteStatusFirst && !(ctx.depositOff || ctx.withdrawOff)),
};
