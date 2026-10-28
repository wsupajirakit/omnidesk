/**
 * The unread-badge key rule, and its wiring on the page that is actually routed.
 * ===========================================================================
 * WHY THIS EXISTS — the badge mechanism on `pages/chat/TicketChat.tsx` was fully
 * built (state, +1 on message:new, clear on open, markup) and had NEVER once
 * shown a number, because the key it was written under could not be read back:
 * the write used `room_id`, the read used `chat_room_id` (absent from the list)
 * and `line_user_id` (the member ObjectId). Nothing failed, nothing logged —
 * the feature was simply invisible. These tests pin the key rule so that class
 * of silence cannot come back. เขียนคีย์หนึ่ง อ่านอีกคีย์ = เงียบสนิท ไม่มี error.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ticketChatPageWithPieces } from './ticketChatSource';
import { unreadFor, customerEventKey } from '../services/chat/ticketAlerts';

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('which key holds a card unread count', () => {
  it('matches on the OA-scoped customer key — the narrowest both sides can build', () => {
    const ticket = { line_oa_hook_id: 'hookA', line_user_data: { line_user_id: 'U1' } };
    expect(unreadFor({ [customerEventKey('hookA', 'U1')]: 3 }, ticket)).toBe(3);
  });

  it('DOES NOT leak across OAs — one customer, two conversations, one badge', () => {
    /* [FIX-20260819-OAKEY] 8 customers in the live data already hold rooms on
       more than one OA (one on three). Keyed on the bare LINE id, a message to
       OA A lit the card, the tab and the sort of their OA B conversation. */
    const onOaA = { [customerEventKey('hookA', 'U1')]: 5 };
    expect(unreadFor(onOaA, { line_oa_hook_id: 'hookA', line_user_data: { line_user_id: 'U1' } })).toBe(5);
    expect(unreadFor(onOaA, { line_oa_hook_id: 'hookB', line_user_data: { line_user_id: 'U1' } })).toBe(0);
  });

  it('a bare LINE id in the map is ignored — that key form is gone for good', () => {
    expect(unreadFor({ U1: 9 }, { line_oa_hook_id: 'hookA', line_user_data: { line_user_id: 'U1' } })).toBe(0);
  });

  it('still matches a room id when a row happens to carry one', () => {
    expect(unreadFor({ room9: 2 }, { chat_room_id: 'room9' } as any)).toBe(2);
  });

  it('does NOT confuse the member ObjectId with the LINE id', () => {
    const ticket = { line_oa_hook_id: 'hookA', line_user_id: 'a0d00000000000000000009e', line_user_data: { line_user_id: 'U1' } } as never;
    expect(unreadFor({ 'a0d00000000000000000009e': 5 }, ticket)).toBe(0);
  });

  it('answers 0 — never undefined/NaN — for a row with no ids at all', () => {
    expect(unreadFor({}, {} as any)).toBe(0);
    expect(unreadFor({ U1: 1 }, { line_user_data: null } as any)).toBe(0);
  });

  it('the page writes the same scoped key it reads', () => {
    // [REFACTOR-20261027-TCSPLIT] the page + the pieces its code moved into (test/ticketChatSource.ts); assertions unchanged
    const page = ticketChatPageWithPieces();
    expect(page).toContain("const key = customerEventKey(e.data?.hook_id, lineUserId);");
    expect(page).toContain('customerEventKey(e.data?.hook_id, e.data?.line_user_id),');
    expect(page).toContain('customerEventKey(ticket.line_oa_hook_id, ticket.line_user_data?.line_user_id),');
  });
});

describe('the routed page is wired to it', () => {
  const page = ticketChatPageWithPieces();

  it('counts a customer message under the OA-scoped key, not only the room id', () => {
    expect(page).toContain("const lineUserId = e.data?.line_user_id as string | undefined;");
    expect(page).toContain('if (lineUserId) next[key] = (prev[key] || 0) + 1;');
  });

  it('the card badge and the tab colour both go through the SAME rule', () => {
    const uses = page.match(/unreadFor\(unreadByRoom/g) ?? [];
    expect(uses.length).toBe(2);
  });

  it('opening a chat clears the key the badge actually reads', () => {
    // the OA-scoped key is what the badge reads, so it is what must be cleared
    expect(page).toContain('customerEventKey(ticket.line_oa_hook_id, ticket.line_user_data?.line_user_id),');
  });

  it('the tab shows the SAME colour class as the card badge', () => {
    expect(page).toContain("tabUnread ? 'tc-unread-badge'");
    /* [FEAT-20260907-TABSEEN] the composition moved into `tabIsLit`, which builds the
       SAME `statusHasNew || tabHasUnread` and then asks whether the operator has
       acknowledged the tab. Both inputs are still passed in by name, so this still
       fails if either source is dropped — which is what the line was pinning. */
    expect(page).toContain(
      'const tabUnread = tabIsLit(tab.key, { statusHasNew, tabHasUnread }, tabSeen);',
    );
  });

  it('the tab NUMBER is still the case count — colour changed, count untouched', () => {
    // the badge still renders `{count}`, never an unread total
    expect(page).toMatch(/tabUnread \? 'tc-unread-badge'[\s\S]{0,140}>\{count\}<\/span>/);
  });
});

/**
 * CROSS-TAB — a case the logged-in admin owns is rendered by TWO tabs at once:
 *   'ส่วนตัว' (mine)   = activeTickets, job_status 1, admin_user_id === me
 *   'กำลังคุย' (active) = activeTickets, job_status 1, ANY admin (me included)
 * Owner's rule: open that card from EITHER tab and the badge must clear on BOTH.
 *
 * That holds by construction rather than by extra code: the count lives in ONE
 * map keyed by the CUSTOMER, and both tabs render the same ticket rows through
 * the same `unreadFor` rule. Per-tab unread state would be the thing that breaks
 * it, so the test guards against that being introduced later.
 * เปิดจากแท็บไหนก็หายทั้งสองแท็บ เพราะนับที่ลูกค้า ไม่ได้นับที่แท็บ.
 */
describe('the same case in two tabs shares one badge', () => {
  const page = ticketChatPageWithPieces();
  const ticket = { line_user_id: 'member-1', line_user_data: { line_user_id: 'U1' } };

  it('a case I own is in BOTH tabs — same rows, same source array', () => {
    expect(page).toContain("base = activeTickets.filter(tk => Number(tk.job_status) === 1 && tk.admin_user_id === uid);");
    expect(page).toContain("base = activeTickets.filter(tk => Number(tk.job_status) === 1);");
  });

  it('one map answers for both tabs, so clearing it clears both', () => {
    const key = customerEventKey('hookA', 'U1');
    const counts: Record<string, number> = { [key]: 2 };
    const row = { line_oa_hook_id: 'hookA', line_user_data: { line_user_id: 'U1' } };
    expect(unreadFor(counts, row)).toBe(2);   // as rendered under 'mine'
    expect(unreadFor(counts, row)).toBe(2);   // …and under 'กำลังคุย'
    delete counts[key];                        // what opening the chat does
    expect(unreadFor(counts, row)).toBe(0);
    expect(unreadFor(counts, row)).toBe(0);
  });

  it('there is no second, per-tab unread state to fall out of step', () => {
    // Exactly one unread store — `unreadByRoom`. (`groupCounts` is the same TYPE
    // but counts CASES per group, so match on the name, not the type.) A second
    // unread store, per tab, is precisely how the two views would diverge.
    const stores = page.match(/const \[\w*[Uu]nread\w*, set\w+\] = useState/g) ?? [];
    expect(stores).toEqual(['const [unreadByRoom, setUnreadByRoom] = useState']);
  });

  it('both tab colours read the same map too', () => {
    // the memo must see the unread map; the rest of its deps grow with features
    expect(ticketChatPageWithPieces()).toMatch(/\}, \[[^\]]*unreadByRoom\]\);/);
  });
});
