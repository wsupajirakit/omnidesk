/**
 * [FEAT-20260822-NOTICERUNTIME] Case C — withdraw words inside the off-service
 * window: text event · withdraw notice ON · withdraw word · in window.
 * Sends the withdraw OFF-TIME card, stamps notice_withdraw_at.
 * revert: delete this file + its line in cases/index.ts.
 */
import { NOTICE_WITHDRAW_AT_KEY } from '../notice.keys';
import type { NoticeCase } from './notice-case.types';

export const CASE_C: NoticeCase = {
  caseId: 'C',
  cardField: 'notice_withdraw_offtime_flex_id',
  stampKey: NOTICE_WITHDRAW_AT_KEY,
  when: (ctx) =>
    /* [FEAT-20260823-NOTICECHECKFLAGS] wrap-flag FIRST, so `&&`
       short-circuit makes "off = the original conditions are not even
       read" literally true. `!== false` because absent means ON (a row
       that predates the column behaves exactly as before). The original
       predicate below is byte-unchanged. ปิด = ไม่อ่าน · เงื่อนไขเดิมห้ามแตะ */
    ctx.withdrawTimeCheckOn !== false &&
    ctx.eventKind === 'text' &&
    ctx.withdrawOn &&
    ctx.withdrawWord &&
    ctx.inWindow &&
    /* [FEAT-20260829-STATUSFIRST] mirror of case A's clause — see there. */
    !(ctx.withdrawSiteStatusFirst && !ctx.withdrawOff),
};
