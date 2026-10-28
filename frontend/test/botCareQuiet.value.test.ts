/**
 * [FEAT-20260820-BOTCAREQUIET] only บอทดูแล goes quiet — every other tab keeps its chime
 * ============================================================================
 * Owner, across two days: "กลุ่มบอทดูแล ไม่ต้องมีเสียง" · "ทุกแบบที่เข้ามาใน บอทดูแล =
 * ไม่ต้องมีเสียง" · then, on hearing it still chime, "ทำไมมีเสียงในบอทดูแล" and
 * "เฉพาะบอทดูแล **ห้ามกระทบตัวอื่นเด็ดขาด** proof เทส".
 *
 * WHY THE SERVER ANSWERS. The chime fires app-wide from one websocket
 * subscription in `App.tsx` holding the event and nothing else — no ticket list,
 * no room, no tab. So the server computes the tab membership and ships it as
 * `bot_care`.
 *
 * ⚠️ THE KEY CHANGED, AND THE REASON IS THE POINT OF THIS FILE. It used to be
 * `has_open_case`, which carried only HALF the tab rule. The dashboard's own
 * definition is `botTabRows()` + `isBotModeTicket()`:
 *
 *     บอทดูแล  = no case still OPEN   AND  the room is not held by an admin
 *     ปิดเคส   = the case is closed   BUT  the admin still holds the room
 *     รอรับเคส = job_status 0    ·    กำลังคุย = job_status 1
 *
 * On `has_open_case` alone, a ปิดเคส row — closed case, admin still holding —
 * would have been silenced too. That is the "กระทบตัวอื่น" the owner forbade, so
 * the server now sends the combined fact and this file walks the tabs one by one.
 *
 * ⚠️ ONLY AN EXPLICIT `true` SILENCES. A missing key — an older server, a
 * replayed payload, a field that failed to compute — chimes. Too loud is
 * recoverable; a customer silently dropped is not. ไม่รู้ = ดังไว้ก่อน.
 */
import { describe, expect, it } from 'vitest';

import { shouldAlert } from '../services/chat/ticketAlerts';

const msg = (over: Record<string, unknown> = {}) => ({
  type: 'message:new',
  data: { sender_type: 'customer', ...over },
});

describe('⭐ บอทดูแล is silent', () => {
  it('bot_care true → no chime', () => {
    expect(shouldAlert(msg({ bot_care: true }))).toBe(false);
  });

  it('silent whatever else rides along on the event', () => {
    /* "ทุกแบบที่เข้ามาใน บอทดูแล" — orphan room, closed case, any message type. */
    for (const extra of [
      { assist_status: false },
      { assist_status: true },
      { message_type: 'sticker' },
      { message_type: 'image' },
      { hook_id: 'h1', room_id: 'r1' },
    ]) {
      expect(shouldAlert(msg({ bot_care: true, ...extra }))).toBe(false);
    }
  });
});

describe('⭐ EVERY OTHER TAB still chimes — this is the "ห้ามกระทบ" proof', () => {
  /* Each case names the tab it stands for. The server decides membership; what
     is pinned here is that the dashboard silences on `bot_care` and on nothing
     else, so no other tab can be caught by it. */

  it('⭐ ปิดเคส — case closed but the admin still holds the room', () => {
    /* THE case the previous key got wrong. The server computes bot_care=false
       here because the room is held, even though no case is open. */
    expect(shouldAlert(msg({ bot_care: false, assist_status: true }))).toBe(true);
  });

  it('⭐ รอรับเคส — a case is waiting and nobody has picked it up', () => {
    /* `[FIX-20260819-ORPHANQUIET]` silenced exactly these by keying on
       `assist_status`, which is false here too. They must stay loud: this is the
       customer most in need of a person. */
    expect(shouldAlert(msg({ bot_care: false, assist_status: false }))).toBe(true);
  });

  it('⭐ กำลังคุย — an admin is in the conversation', () => {
    expect(shouldAlert(msg({ bot_care: false, assist_status: true }))).toBe(true);
  });

  it('⭐ ส่วนตัว — a room scoped to one admin', () => {
    expect(shouldAlert(msg({ bot_care: false, is_private: true }))).toBe(true);
  });

  it('the dashboard silences on bot_care and on NOTHING else', () => {
    /* every other field the event carries must be unable to silence a row —
       that is what makes "ห้ามกระทบตัวอื่น" a property and not a hope. */
    for (const field of [
      'assist_status',
      'has_open_case',
      'job_status',
      'is_private',
      'chat_status',
    ]) {
      expect(shouldAlert(msg({ [field]: false }))).toBe(true);
      expect(shouldAlert(msg({ [field]: true }))).toBe(true);
    }
  });
});

describe('⭐ unknown is loud', () => {
  it('no key at all → chimes', () => {
    expect(shouldAlert(msg())).toBe(true);
  });

  it('null, undefined, and anything not exactly true → chimes', () => {
    for (const v of [null, undefined, 0, 1, '', 'true', 'yes', [], {}]) {
      expect(shouldAlert(msg({ bot_care: v }))).toBe(true);
    }
  });
});

describe('the rules that already existed still hold', () => {
  it('a message the admin or the bot sent never chimes, bot_care or not', () => {
    for (const sender of ['admin', 'bot']) {
      expect(shouldAlert(msg({ sender_type: sender, bot_care: false }))).toBe(false);
      expect(shouldAlert(msg({ sender_type: sender, bot_care: true }))).toBe(false);
    }
  });
});
