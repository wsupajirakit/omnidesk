/**
 * [FEAT-20260820-MSGGLOW] a new MESSAGE lights the group tab, not only a new case
 * ============================================================================
 * Owner, 2026-08-20, with a screenshot of the OA tab strip: "เวลามีข้อความใหม่
 * ในเคส ก็ให้สีส้มขึ้นด้วย ทั้งแท็บ hook list เลย + select option ด้วยต้องส้มกรอบ +
 * list ข้างในก็ส้มตัวนั้น + มี badge บน list ข้างใน" · "ทั้งหมดทั้งแท็บนะ ไม่ใช่แค่
 * select" · "แต่ select ต้องละเอียดกว่าเพื่อน" · "ห้ามกระทบ realtime ส่วนอื่น".
 *
 * WHAT ALREADY WORKED, and is deliberately NOT rebuilt here:
 *   · the card in the list      → `tc-unread-badge` + `tc-unread-text`, already
 *                                 driven by `message:new` through `unreadByRoom`
 *   · the status tabs           → `tabHasUnread`, same source
 *   · the `อื่นๆ` select ring    → derived from `groupHasNew`, so it lights the
 *                                 moment the group tab does — nothing to add
 * The ONE gap was `groupHasNew`, which only `ticket:new` ever set
 * (`TicketChat.tsx:1514` returns early for anything that is not a ticket event).
 * ของเดิมทำงานอยู่แล้ว 3 ชั้น · ขาดชั้นเดียวคือแท็บกลุ่ม.
 *
 * ⚠️ WHY `bot_care` IS EXCLUDED. The owner's words are "ข้อความใหม่ **ในเคส**".
 * A bot-care row has no open case — it is the tab the owner ordered silent
 * earlier the same day. The backend already ships that fact on the event
 * (`bot_care`), and the chime reads the same key, so the badge and the sound
 * agree by construction instead of by coincidence.
 * ไม่มีเคส = ไม่ใช่ "ในเคส" ⇒ ไม่จุด · ใช้คีย์เดียวกับเสียงเพื่อไม่ให้เพี้ยนกัน.
 *
 * ⚠️ Only a CUSTOMER message counts. An admin's own reply is not news to the
 * person who sent it, and the bot answering is not news at all — same rule the
 * unread map and the chime already apply.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ticketChatPageWithPieces } from './ticketChatSource';

import { messageLightsGroupTab } from '../services/chat/ticketAlerts';

const msg = (over: Record<string, unknown> = {}) => ({
  type: 'message:new',
  data: { sender_type: 'customer', hook_id: 'h1', room_id: 'r1', ...over },
});

describe('⭐ a customer writing into a case lights the tab', () => {
  it('customer message, case open → yes', () => {
    expect(messageLightsGroupTab(msg({ bot_care: false }))).toBe(true);
  });

  it('the key may be missing — an older server still lights it', () => {
    /* the same direction the chime takes: unknown is treated as "worth showing".
       ไม่รู้ = แสดงไว้ก่อน ดีกว่าเงียบหายไป */
    expect(messageLightsGroupTab(msg())).toBe(true);
  });
});

describe('⭐ what must NOT light it', () => {
  it('⭐ a bot-care row — no open case, and the tab the owner ordered silent', () => {
    expect(messageLightsGroupTab(msg({ bot_care: true }))).toBe(false);
  });

  it('the admin`s own reply, and the bot`s', () => {
    for (const sender of ['admin', 'bot', 'system']) {
      expect(messageLightsGroupTab(msg({ sender_type: sender }))).toBe(false);
    }
  });

  it('any event that is not a new message', () => {
    for (const type of ['ticket:new', 'ticket:updated', 'message:updated', 'ping']) {
      expect(messageLightsGroupTab({ ...msg(), type })).toBe(false);
    }
  });

  it('an event with no hook — there is no group to light', () => {
    expect(messageLightsGroupTab(msg({ hook_id: undefined }))).toBe(false);
    expect(messageLightsGroupTab(msg({ hook_id: '' }))).toBe(false);
  });

  it('junk never throws', () => {
    for (const e of [null, undefined, {}, { type: 'message:new' }, 'text', 42]) {
      expect(messageLightsGroupTab(e as never)).toBe(false);
    }
  });
});

describe('⭐ it decides ONLY this — no side effects on the other realtime rules', () => {
  it('is a pure predicate over one event', () => {
    const e = msg({ bot_care: false });
    const before = JSON.stringify(e);
    messageLightsGroupTab(e);
    messageLightsGroupTab(e);
    expect(JSON.stringify(e)).toBe(before);
  });

  it('agrees with the chime on the bot-care key, so badge and sound cannot drift', () => {
    /* both read `bot_care === true` to mean "leave this one alone". */
    const src = require('node:fs').readFileSync(
      require('node:path').join(process.cwd(), 'services/chat/ticketAlerts.ts'),
      'utf8',
    ) as string;
    expect(src.split("['bot_care'] === true").length - 1).toBe(2);
  });
});


describe('⭐ wired into the page, and only where it belongs', () => {
  // [REFACTOR-20261027-TCSPLIT] the page + the pieces its code moved into (test/ticketChatSource.ts); assertions unchanged
  const src = ticketChatPageWithPieces()
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('the message branch lights the group tab', () => {
    expect(src).toContain('messageLightsGroupTab(e)');
    expect(src).toMatch(/setGroupHasNew\(prev => \(prev\[msgGid\]/);
  });

  it('⭐ it sits INSIDE the message:new branch, before its return', () => {
    /* placed after it, the branch would already have returned and nothing would
       light; placed in the ticket branch, a message would never reach it. */
    const branch = src.indexOf("if (e.type === 'message:new')");
    const call = src.indexOf('messageLightsGroupTab(e)');
    const ticketGuard = src.indexOf("if (e.type !== 'ticket:new'");
    expect(branch).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(branch);
    expect(call).toBeLessThan(ticketGuard);
  });

  it('⭐ the ticket path is untouched — it still lights the tab its own way', () => {
    /* "ห้ามกระทบ realtime ส่วนอื่น": the new-case rule must be exactly as it was. */
    expect(src).toContain("if (e.type === 'ticket:new') {");
    /* [FIX-20260824-GROUPGLOW] 3 → 4: the fourth site is the DOWN direction —
       openTicket clears the flag when the group's last unread is read
       (groupGlowClears.value.test.ts pins it). This census exists to catch an
       accidental new LIGHTING site; a clearing site is the opposite of that.
       [FEAT-20260907-TABSEEN] 4 → 5, same reasoning again: acknowledging the last
       lit status tab clears the open group's flag. Also a DOWN direction. */
    expect(src.split('setGroupHasNew(').length - 1).toBe(5); // ticket + message + selectGroup + openTicket-clear + tabSeen-clear

    /* [FEAT-20260907-TABSEEN] …and the count alone no longer carries the meaning it
       used to, now that clearing sites outnumber lighting ones. What this guard is
       really for is "no new site LIGHTS the flag", so assert that directly: exactly
       two sites write `true`, and they are the two realtime handlers. A clearing
       site deletes a key and can never match this shape.
       นับรวมไม่พอแล้ว · ต้องนับเฉพาะจุดที่จุดไฟ */
    expect(src.split('? prev : { ...prev, [').length - 1).toBe(2);
  });

  it('⭐ the unread map and the newest-top stamp are still set by the same branch', () => {
    /* the three things that already worked must keep working — they are what
       lights the card badge, its orange text and the status tabs.
       ⚠️ COUNTED, not merely present: a first draft asserted `toContain` and a
       mutation that disabled the first of two call sites sailed straight through.
       นับจำนวน ไม่ใช่แค่ดูว่ามีสตริง · ของเดิมโดนถอดไปหนึ่งจุดแล้วเทสไม่รู้เรื่อง. */
    expect(src.split('setUnreadByRoom(').length - 1).toBe(2);
    expect(src.split('setLastMsgAt(').length - 1).toBe(1);
    expect(src.split('scheduleOrphanRefresh()').length - 1).toBe(2);
  });

  it('⭐ the NUMBER on the tab is untouched — only its colour moves', () => {
    /* Owner: "ไม่ใช่ไปเปลี่ยนตัวเลขบน badge parent นะ เพราะว่ามันคือจำนวนเคส" ·
       "ตัวเลขเหมือนเดิม ห้ามยุ่ง".
       The count comes from the ticket lists; `groupHasNew` only ever picks a
       className. If the count line ever starts reading the flag, the badge would
       start counting messages instead of cases and both numbers would stop
       meaning anything. ตัวเลข = จำนวนเคส · flag = สีเท่านั้น. */
    const countLine = src
      .split('\n')
      .find((l) => l.includes('const c = on ?'));
    expect(countLine).toBeTruthy();
    expect(countLine).toContain('activeTickets');
    expect(countLine).toContain('groupCounts');
    expect(countLine).not.toContain('groupHasNew');
    expect(countLine).not.toContain('unread');

    /* and the flag is used in a class position only, never as a value.
       ⚠️ anchored on the GROUP tab's own `hasNew` (`groupHasNew[g._id]`) — the
       status tabs declare a local `hasNew` of their own earlier in the file. */
    /* [FIX-20260829-ORANGENEEDSCOUNT] the anchor moved: the flag is now ANDed
       with the count through `showsNewGlow`. The intent of this assertion is
       unchanged — find the group tab's own `hasNew` and prove the flag reaches
       a class, never a value — so only the string it anchors on was updated. */
    const at = src.indexOf('const hasNew = showsNewGlow(!!groupHasNew[');
    expect(at).toBeGreaterThan(-1);
    /* the badge is ~60 lines below the flag, so look for it forward from there
       rather than guessing a window size. */
    const badgeAt = src.indexOf('tc-unread-badge', at);
    expect(badgeAt).toBeGreaterThan(at);
    /* through to the end of that span — the value it renders sits after the
       className block, so a short window would miss a flag rendered as text.
       (measured: a 200-char window did miss it, and a mutation walked through) */
    const spanEnd = src.indexOf('</span>', badgeAt);
    expect(spanEnd).toBeGreaterThan(badgeAt);
    const badge = src.slice(at, spanEnd + 7);
    /* the flag decides a CLASS; it must never be rendered as the value */
    expect(badge).not.toMatch(/>\s*\{\s*hasNew\s*\}/);
    expect(badge).toMatch(/hasNew\s*\n?\s*\?\s*'tc-unread-badge'/);
    /* and the value rendered really is the count */
    expect(badge).toMatch(/>\s*\{c\}\s*<\/span>/);
  });

  it('⭐ the select ring needs no code of its own — it reads groupHasNew', () => {
    /* "select ต้องละเอียดกว่าเพื่อน": the trigger gets the ring, and each option
       in the dropdown carries its own `isNew`, so the operator sees WHICH group. */
    /* [FIX-20260829-ORANGENEEDSCOUNT] same intent, new shape: the ring still
       reads `groupHasNew` and still owns no state of its own — it now asks the
       count as well, through the shared rule. */
    expect(src).toContain('overflowGroups.some(g => showsNewGlow(!!groupHasNew[g._id]');
    expect(src).toContain("tc-select-new");
    expect(src).toMatch(/isNew: showsNewGlow\(!!groupHasNew\[g\._id\]/);
  });
});
