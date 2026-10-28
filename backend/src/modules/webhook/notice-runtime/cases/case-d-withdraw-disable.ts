/**
 * [FEAT-20260822-NOTICERUNTIME] Case D — withdraw words while the site rules
 * say the withdraw side is OFF: text event · withdraw notice ON · withdraw
 * word · site_rule withdraw_off. Sends the withdraw DISABLE card, stamps
 * notice_withdraw_at. Runs after case C (time-first, owner D13).
 * revert: delete this file + its line in cases/index.ts.
 */
import { NOTICE_WITHDRAW_AT_KEY } from '../notice.keys';
import type { NoticeCase } from './notice-case.types';

export const CASE_D: NoticeCase = {
  caseId: 'D',
  cardField: 'notice_withdraw_flex_id',
  stampKey: NOTICE_WITHDRAW_AT_KEY,
  when: (ctx) =>
    /* [FEAT-20260823-NOTICECHECKFLAGS] wrap-flag FIRST, so `&&`
       short-circuit makes "off = the original conditions are not even
       read" literally true. `!== false` because absent means ON (a row
       that predates the column behaves exactly as before). The original
       predicate below is byte-unchanged. ปิด = ไม่อ่าน · เงื่อนไขเดิมห้ามแตะ */
    ctx.withdrawSiteStatusCheckOn !== false &&
    ctx.eventKind === 'text' &&
    ctx.withdrawOn &&
    ctx.withdrawWord &&
    ctx.withdrawOff,
};
