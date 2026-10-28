/**
 * [FEAT-20260822-NOTICERUNTIME] Case B — deposit words while the site rules
 * say the deposit side is OFF: text event · deposit notice ON · deposit word ·
 * site_rule deposit_off. Sends the deposit DISABLE card, stamps
 * notice_deposit_at. Runs after case A (time-first, owner D13 — the order
 * itself lives in cases/index.ts).
 * revert: delete this file + its line in cases/index.ts.
 */
import { NOTICE_DEPOSIT_AT_KEY } from '../notice.keys';
import type { NoticeCase } from './notice-case.types';

export const CASE_B: NoticeCase = {
  caseId: 'B',
  cardField: 'notice_deposit_flex_id',
  stampKey: NOTICE_DEPOSIT_AT_KEY,
  when: (ctx) =>
    /* [FEAT-20260823-NOTICECHECKFLAGS] wrap-flag FIRST, so `&&`
       short-circuit makes "off = the original conditions are not even
       read" literally true. `!== false` because absent means ON (a row
       that predates the column behaves exactly as before). The original
       predicate below is byte-unchanged. ปิด = ไม่อ่าน · เงื่อนไขเดิมห้ามแตะ */
    ctx.depositSiteStatusCheckOn !== false &&
    ctx.eventKind === 'text' &&
    ctx.depositOn &&
    ctx.depositWord &&
    ctx.depositOff,
};
