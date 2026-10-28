/* [FE] [FEAT-20260817-REOPENBYADMIN] — the card the presser sees instantly.
 *
 * The BE answers with the NEW ticket + room_id; the FE must move the card from
 * completedTickets to activeTickets itself (executeAction's optimistic patch is
 * a no-op for closed cases — it maps over active, where the card is not).
 * This builder makes that move deterministic and testable:
 *   1. the NEW _id wins (selecting the card must open the new ticket)
 *   2. job_status 1 + chat_status 'admin' + me as admin_user_data — the card
 *      must satisfy the "ส่วนตัว"/"กำลังคุย" tab predicate immediately
 *   3. closed-case leftovers are cleared (resolved_at) so nothing renders it
 *      half-closed
 *   4. the SOURCE entry is never mutated (the revert path on API failure
 *      restores the previous arrays)
 *
 * revert: delete together with pages/chat/reopenTicketCard.ts.
 */
import { describe, it, expect } from 'vitest';

import { buildReopenedTicketCard } from '../pages/chat/reopenTicketCard';

const source = () => ({
  _id: 'old-ticket',
  job_status: 2,
  chat_status: 'bot',
  admin_user_id: 'closer-admin',
  admin_user_data: { _id: 'closer-admin', display_name: 'Closer' },
  resolved_at: '2026-08-16T10:00:00.000Z',
  line_user_id: 'member-1',
  line_oa_hook_id: 'hook-1',
  line_user_data: { display_name: 'ลูกค้า A' },
  line_oa_hook_data: { line_oa_name: 'OA หนึ่ง' },
  category: 'Payment',
  need_detail: 'สลิปมีปัญหา',
});

const resp = {
  success: true,
  data: { _id: 'new-ticket', assigned_at: '2026-08-17T01:00:00.000Z' },
  room_id: 'room-1',
};

const me = {
  id: 'me-1',
  username: 'op1',
  display_name: 'Operator One',
  role: 'admin',
};

describe('buildReopenedTicketCard', () => {
  it('the new _id wins and the tab predicate fields are set for ME', () => {
    const card = buildReopenedTicketCard(source(), resp, me);
    expect(card._id).toBe('new-ticket');
    expect(card.job_status).toBe(1);
    expect(card.chat_status).toBe('admin');
    expect(card.admin_user_id).toBe('me-1');
    expect(card.admin_user_data).toMatchObject({
      _id: 'me-1',
      username: 'op1',
      display_name: 'Operator One',
    });
    expect(card.assigned_at).toBe('2026-08-17T01:00:00.000Z');
  });

  it('carries the customer/OA render data from the source card', () => {
    const card = buildReopenedTicketCard(source(), resp, me);
    expect(card.line_user_data).toEqual({ display_name: 'ลูกค้า A' });
    expect(card.line_oa_hook_data).toEqual({ line_oa_name: 'OA หนึ่ง' });
    expect(card.category).toBe('Payment');
    expect(card.line_user_id).toBe('member-1');
  });

  it('clears the closed-case leftovers', () => {
    const card = buildReopenedTicketCard(source(), resp, me);
    expect(card.resolved_at).toBeNull();
  });

  it('never mutates the source entry', () => {
    const src = source();
    const frozen = JSON.stringify(src);
    buildReopenedTicketCard(src, resp, me);
    expect(JSON.stringify(src)).toBe(frozen);
  });

  it('missing response data still yields a usable card (old id, assigned now)', () => {
    const card = buildReopenedTicketCard(source(), { success: true }, me);
    expect(card._id).toBe('old-ticket');
    expect(card.job_status).toBe(1);
    expect(typeof card.assigned_at).toBe('string');
  });

  it('no signed-in user → admin fields stay empty rather than lying', () => {
    const card = buildReopenedTicketCard(source(), resp, null);
    expect(card.admin_user_id).toBeNull();
    expect(card.admin_user_data).toBeNull();
  });
});

/* Source pins — the wiring inside files too heavy to mount. Same technique as
 * test/imagePaste.test.ts: strip comments, assert the load-bearing lines. */
import { readFileSync } from 'fs';
import { join } from 'path';
/* [REFACTOR-20260905-CUSTPROV] this reads the page PLUS the files it was split
   into. The composer and the right-hand panels moved out of TicketChat.tsx to
   components/chat/{chat-input,ticket-detail}; the code this spec pins moved
   with them, so the read follows the code. Every assertion below is unchanged
   — see test/ticketChatSource.ts for the file list and the one caveat. */
import { ticketChatSource } from './ticketChatSource';

const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const stripped = (rel: string) =>
  strip(readFileSync(join(process.cwd(), rel), 'utf8'));

describe('reopen wiring (source pins)', () => {
  const ticketChat = strip(ticketChatSource());

  it('the reopen button lives under the closedNotice capsule and is gated on onReopen', () => {
    const block = ticketChat.slice(
      ticketChat.indexOf('{closedNotice ? ('),
      ticketChat.indexOf('กดรับเคสเพื่อสนทนา'),
    );
    expect(block).toContain('onReopen && (');
    expect(block).toContain('เปิดเคส');
  });

  it('the WS gate accepts ticket:reopened and refetches for OTHER admins only', () => {
    const gate = ticketChat.slice(
      ticketChat.indexOf("if (e.type === 'ticket:reopened')"),
      ticketChat.indexOf("if (e.type !== 'ticket:new'"),
    );
    expect(gate).toContain('fetchActive(true)');
    expect(gate).toContain('admin_user_id');
    expect(gate).toContain('return;');
  });

  it("the history badge has its own reopen branch — never the catch-all 'โอนงาน'", () => {
    expect(ticketChat).toContain("h.action === 'reopen_by_admin'");
    /* [FEAT-20261022-I18NTICKETEN] flipped 22/10: the owner asked for an English Ticket page, so the
       literal Thai now sits as the t() fallback (th.json holds the same text) */
    expect(ticketChat).toContain("badgeText = t('ticketui.history.reopen_badge', 'เปิดเคส');");
  });

  it('a successful reopen refreshes the open transcript so the divider shows WITHOUT sending a message', () => {
    // [FIX-20260817-REOPENDIVIDER] the divider row is written by the BE, but
    // nothing told the open room to reload — it only appeared after the next
    // message. The reopen path must refetch the transcript itself.
    const body = ticketChat.slice(
      ticketChat.indexOf('const executeReopen'),
      ticketChat.indexOf('const executeAction'),
    );
    expect(body).toContain('chatApiRef.current?.refetch()');
  });

  it('the divider styles map reopen_by_admin to the SAME blue as accept', () => {
    const view = stripped('components/chat/ChatRoomView.tsx');
    expect(view).toContain("reopen_by_admin: 'tc-div-accept'");
  });
});
