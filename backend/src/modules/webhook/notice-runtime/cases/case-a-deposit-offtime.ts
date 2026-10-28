/**
 * [FEAT-20260822-NOTICERUNTIME] Case A — deposit words inside the off-service
 * window (spec 13:21 line "text case A"): text event · deposit notice ON ·
 * a deposit word matched · Thai wall clock inside 23:00-02:00. Sends the
 * deposit OFF-TIME card and stamps notice_deposit_at.
 * A-D run on text events whatever the scope setting says — spec line :51.
 * revert: delete this file + its line in cases/index.ts. ถอดได้ทีละเคส.
 */
import { NOTICE_DEPOSIT_AT_KEY } from '../notice.keys';
import type { NoticeCase } from './notice-case.types';

export const CASE_A: NoticeCase = {
  caseId: 'A',
  cardField: 'notice_deposit_offtime_flex_id',
  stampKey: NOTICE_DEPOSIT_AT_KEY,
  when: (ctx) =>
    /* [FEAT-20260823-NOTICECHECKFLAGS] wrap-flag FIRST, so `&&`
       short-circuit makes "off = the original conditions are not even
       read" literally true. `!== false` because absent means ON (a row
       that predates the column behaves exactly as before). The original
       predicate below is byte-unchanged. ปิด = ไม่อ่าน · เงื่อนไขเดิมห้ามแตะ */
    ctx.depositTimeCheckOn !== false &&
    ctx.eventKind === 'text' &&
    ctx.depositOn &&
    ctx.depositWord &&
    ctx.inWindow &&
    /* [FEAT-20260829-STATUSFIRST] "ให้ความสำคัญกับสถานะก่อน" — with the switch
       ON, a deposit side that still has an account OPEN sends no night card;
       the message flows on. OFF/absent = the clause is `!(false && …)` = true,
       so the original predicate above decides exactly as before.
       ⚠️ `!ctx.depositOff` and not a new reader — "open" must mean precisely
       what case B's "closed" means, or the two cards could disagree. */
    !(ctx.depositSiteStatusFirst && !ctx.depositOff),
};
