/**
 * [FEAT-20260903-TABNAMEGLOW] the group NAME glows when a message lands in กำลังคุย
 * ===========================================================================
 * Owner 03/09: a new message in a group's กำลังคุย channel lit NOTHING on the
 * parent group tab. It must tint that group's NAME in the badge's colour —
 * *"glow ที่ชื่อ ไม่ใช่ badge"*, and *"เลข badge อิงรอรับเคสไม่ใช่ข้อความ ห้ามยุ่งเลข"*.
 *
 * 🔴 WHAT MAKES THIS CASE REAL, not a restatement of the rule: the badge count
 *    `c` counts รอรับเคส (`job_status === 0`) only. A conversation already being
 *    handled is `job_status === 1` and adds nothing to it, so `showsNewGlow`
 *    stays false with an empty queue — the exact hole the owner reported.
 *    ⇒ the load-bearing case below is `hasNew=true, count=0`.
 *
 * ⚠️ These cases also guard the things that must NOT move: the badge helper's
 *    three call sites, the count formula, and the badge's own classes.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ticketChatPageWithPieces } from './ticketChatSource';
import { showsNameGlow } from '../utils/groupTabNameGlow';
import { showsNewGlow } from '../utils/groupTabGlow';

// [REFACTOR-20261027-TCSPLIT] the page + the pieces its code moved into (test/ticketChatSource.ts); assertions unchanged
const src = ticketChatPageWithPieces();
const select = readFileSync(
  join(process.cwd(), 'components/member/SearchableSelect.tsx'),
  'utf8',
);

describe('[TABNAMEGLOW] the rule itself', () => {
  it('🔴 a message with an EMPTY รอรับ queue glows the name — the reported hole', () => {
    /* This is the whole feature. The badge refuses (count 0) and until now that
       meant nothing appeared anywhere. */
    expect(showsNewGlow(true, 0)).toBe(false);   // badge stays silent…
    expect(showsNameGlow(true, 0)).toBe(true);   // …so the name speaks
  });

  it('🔴 when the badge is already orange the name does NOT glow', () => {
    /* Owner chose this explicitly: one event must not be announced twice. */
    expect(showsNewGlow(true, 3)).toBe(true);
    expect(showsNameGlow(true, 3)).toBe(false);
  });

  it('no flag ⇒ no glow, whatever the count says', () => {
    /* The count alone must never light it — a busy group is not a new one. */
    expect(showsNameGlow(false, 0)).toBe(false);
    expect(showsNameGlow(false, 9)).toBe(false);
  });

  it('untrustworthy counts still glow the name, because the badge cannot', () => {
    /* `undefined`/NaN/negative all read as "nothing to show" for the badge
       (groupTabGlow), so the name is the only signal left. */
    for (const bad of [undefined, null, Number.NaN, -3]) {
      expect(showsNewGlow(true, bad)).toBe(false);
      expect(showsNameGlow(true, bad)).toBe(true);
    }
  });

  it('the two answers are never both true for the same inputs', () => {
    /* Mutually exclusive by construction — this is what "ไม่ซ้ำซ้อน" means. */
    for (const n of [0, 1, 5, -1, Number.NaN]) {
      expect(showsNameGlow(true, n) && showsNewGlow(true, n)).toBe(false);
    }
  });
});

describe('[TABNAMEGLOW] wired where the owner asked, and nowhere else', () => {
  it('⭐⭐ the inline tab NAME carries the glow class', () => {
    expect(src).toContain("<span className={nameGlow ? 'tc-unread-text' : undefined}>{g.group_name}</span>");
  });

  it('⭐⭐ the selector: trigger label AND each option name', () => {
    /* Owner: "selectoor ต้องได้เงื่อนไขนี้ด้วย + ชื่อ select list ตัวนั้น" */
    expect(src).toContain('triggerNameGlow={overflowNameGlow}');
    expect(src).toMatch(/isNameGlow: showsNameGlow\(!!groupHasNew\[g\._id\] && g\._id !== activeGroupId/);
    expect(select).toContain("o.isNameGlow ? 'tc-unread-text' : ''");
    expect(select).toContain("triggerNameGlow ? 'tc-unread-text' : ''");
  });

  it('🔴 the BADGE was not touched — count formula and pill classes intact', () => {
    /* The owner's hard line: ห้ามยุ่งเลข badge. The count still reads
       job_status 0, and the pill still decides its colour from `hasNew`. */
    expect(src).toContain("const c = on ? activeTickets.filter(tk => Number(tk.job_status) === 0).length : (groupCounts[g._id] ?? 0);");
    expect(src).toContain("const hasNew = showsNewGlow(!!groupHasNew[g._id], c);");
    expect(select).toContain("o.isNew ? 'tc-unread-badge' : 'bg-gray-200 text-gray-600'");
  });

  it('🔴 no fourth `showsNewGlow` call slipped in', () => {
    /* `groupTabOrangeNeedsCount.value.test.ts:71` pins this to 3. Asserted here
       too so a change made for THIS feature fails in THIS file, next to the
       reason, instead of only in the older guard. */
    expect(src.split('showsNewGlow(').length - 1).toBe(3);
  });

  it('🔴 realtime was not touched — the flag is only READ here', () => {
    /* The feature adds no socket handler, no timer and no state: it reuses
       `groupHasNew`, already set by [FEAT-20260820-MSGGLOW] and cleared by
       selectGroup.
       [FEAT-20260907-TABSEEN] 4 → 5. The added site CLEARS — acknowledging the last
       lit status tab takes the open group's orange with it — so this census grew
       without the realtime path being touched. The assertion below is the one that
       actually says "realtime was not touched", and it did not move. */
    expect(src.split('setGroupHasNew(').length - 1).toBe(5);
    /* Exactly two sites write `true`, and both are the realtime handlers. This is
       the claim in this test's title; the total above is only a census. */
    expect(src.split('? prev : { ...prev, [').length - 1).toBe(2);
    expect(src).not.toContain('showsNameGlow(prev');
  });
});
