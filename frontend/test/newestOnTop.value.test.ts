/**
 * [FEAT-20260819-NEWESTTOP] "ใหม่สุดต้องขึ้นบนเสมอ" for ส่วนตัว / รอรับเคส / กำลังคุย.
 * ===========================================================================
 * ⚠️ WHICH PAGE — read this before touching either file, they are NOT the same
 * screen and this has already cost a full round of work:
 *
 *   route             component                    what it is
 *   ----------------  ---------------------------  ------------------------------
 *   /ticket-support   pages/chat/TicketChat.tsx    THE LIVE PAGE (3-column chat)
 *   /legacy-ticket    pages/chat/TicketSupport.tsx the old DataTable, still reachable
 *
 * The route named `/ticket-support` does NOT render `TicketSupport.tsx`. This
 * suite is about the LIVE page.
 *
 * Two separate defects had to be fixed together:
 *   1. those three tabs rendered `visibleTickets` with NO sort at all — the order
 *      was whatever the BE returned (there is a comment in the source saying so);
 *   2. a message never touches the ticket row, so even a sorted list could not
 *      react to a customer writing.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { markMessageAt, activityAt, unreadFor, customerEventKey } from '../services/chat';

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('the ordering rule itself', () => {
  /* [FIX-20260819-OAKEY] the key is OA-scoped now: one customer can hold rooms on
     several OAs, and the bare LINE id raised the wrong conversation. */
  const HOOK = 'hookA';
  const ticket = (over: any = {}) => ({
    _id: 't1', line_oa_hook_id: HOOK, line_user_data: { line_user_id: 'U1' }, ...over,
  });

  it('a live message raises a row above an older one', () => {
    const older = new Date('2026-08-19T10:00:00Z').getTime();
    const clock = markMessageAt({}, customerEventKey(HOOK, 'U1'), new Date('2026-08-19T12:00:00Z').getTime());
    expect(activityAt(older, unreadFor(clock, ticket() as never))).toBeGreaterThan(older);
  });

  it('a row nobody wrote to keeps its own time — no reordering out of nowhere', () => {
    const own = new Date('2026-08-19T10:00:00Z').getTime();
    expect(activityAt(own, unreadFor({}, ticket() as never))).toBe(own);
  });

  it('an out-of-order event can never push a card DOWN', () => {
    const own = new Date('2026-08-19T12:00:00Z').getTime();
    const stale = markMessageAt({}, customerEventKey(HOOK, 'U1'), new Date('2026-08-19T09:00:00Z').getTime());
    expect(activityAt(own, unreadFor(stale, ticket() as never))).toBe(own);
  });
});

describe('the LIVE page is wired to it', () => {
  const page = src('pages/chat/TicketChat.tsx');

  it('the three tabs now have a sort — they had none', () => {
    expect(page).toContain('const newestFirst = (a: TicketEntry, b: TicketEntry) => activityOf(b) - activityOf(a);');
    expect(page).toContain('byPinnedFirst<TicketEntry>(pinnedRooms, getTicketUserKey)(newestFirst)');
  });

  it('the order reacts to a message, not just to a ticket change', () => {
    expect(page).toContain('return activityAt(own, unreadFor(lastMsgAt, tk as never));');
    expect(page).toContain('}, [visibleTickets, pinnedRooms, lastMsgAt]);');
  });

  it('every inbound message stamps the clock — including the open room', () => {
    expect(page).toContain("if (senderType === 'customer') {");
    expect(page).toContain('for (const k of stampKeys) next = markMessageAt(next, k, at);');
  });

  it('pinned rooms still win — pinning behaviour is untouched', () => {
    expect(page).toContain('byPinnedFirst<TicketEntry>(pinnedRooms, getTicketUserKey)');
  });

  it('the file says out loud which page it is', () => {
    expect(page).toContain('THIS FILE IS THE LIVE PAGE');
  });
});
