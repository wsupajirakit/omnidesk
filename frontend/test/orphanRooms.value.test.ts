/**
 * Conversations that never became a case, surfaced in the bot-care tab.
 * ===========================================================================
 * The rule that matters is the SUBTRACTION, and it deliberately reuses
 * `getTicketUserKey` — the identity helper the tabs, counters and pinning
 * already share. These tests pin that a room and a ticket for one customer
 * really do collapse to the same key, because the day they stop doing so the
 * feature shows duplicates of every customer and nothing else fails.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { roomAsPseudoTicket, ORPHAN_FLAG, isQuietRow, avatarRingClass } from '../services/chat/orphanRooms';
import { getTicketUserKey } from '../pages/chat/ticketIdentity';
/* [REFACTOR-20260905-CUSTPROV] this reads the page PLUS the files it was split
   into. The composer and the right-hand panels moved out of TicketChat.tsx to
   components/chat/{chat-input,ticket-detail}; the code this spec pins moved
   with them, so the read follows the code. Every assertion below is unchanged
   — see test/ticketChatSource.ts for the file list and the one caveat. */
import { ticketChatSource } from './ticketChatSource';

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

/**
 * Source with comments removed. A rejected class name is often quoted in the
 * comment that explains WHY it was rejected, and a bare `not.toContain` counts
 * that as the class still being used — a false red that has already fired twice
 * in this codebase. Comments describe; only code renders.
 * คอมเมนต์อธิบายได้ ไม่นับว่ายังใช้อยู่.
 */
const codeOnly = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const room = (over: any = {}) => ({
  _id: 'room-1',
  line_user_id: 'U-line-1',
  unread_count: 0,
  last_message: { sender_type: 'customer' as const, text: 'ทักมาแล้วเงียบ', timestamp: '2026-08-18T09:00:00.000Z' },
  user_data: { id: 'm1', _id: 'm1', display_name: 'ลูกค้าเงียบ', line_user_id: 'U-line-1' },
  hook_id: 'hook-1',
  ...over,
});

describe('a room dressed as a ticket', () => {
  it('keys on the MEMBER id, exactly like a real ticket does', () => {
    const pseudo = roomAsPseudoTicket(room() as any);
    const realTicket = { _id: 't1', line_user_id: 'm1' };
    // the whole subtraction rests on these two being equal
    expect(getTicketUserKey(pseudo as any)).toBe(getTicketUserKey(realTicket as any));
  });

  it('carries a marker and an id that can never collide with a real ticket', () => {
    const pseudo = roomAsPseudoTicket(room() as any) as any;
    expect(pseudo[ORPHAN_FLAG]).toBe(true);
    expect(String(pseudo._id).startsWith('orphan:')).toBe(true);
  });

  it('lands in the completed set the bot tab reads, and says it is bot-handled', () => {
    const pseudo = roomAsPseudoTicket(room() as any) as any;
    expect(pseudo.job_status).toBe(2);
    expect(pseudo.chat_status).toBe('bot');
  });

  it('shows the last thing said, and keeps the room id so the chat can open', () => {
    const pseudo = roomAsPseudoTicket(room() as any) as any;
    expect(pseudo.need_detail).toBe('ทักมาแล้วเงียบ');
    expect(pseudo.chat_room_id).toBe('room-1');
    expect(pseudo.line_oa_hook_id).toBe('hook-1');
  });

  it('survives a room with no messages and no profile', () => {
    const pseudo = roomAsPseudoTicket({ _id: 'r2' } as any) as any;
    expect(pseudo.need_detail).toBe('');
    expect(pseudo._id).toBe('orphan:r2');
  });
});

describe('wired into the bot-care tab', () => {
  const page = ticketChatSource();

  it('subtracts with the EXISTING identity helper, not a second rule', () => {
    /* [FIX-20260820-BOTCOUNT] the subtraction MOVED into `botTabRows` in
       services/chat/orphanRooms.ts — it used to be inline here, and the tab's
       counter had a second copy of the surrounding logic that forgot the rooms
       entirely (card on screen, badge reading 0). The rule is unchanged; it just
       lives in one place now, and the page injects the page's own identity
       helper rather than the module re-implementing it.
       กฎเดิมทุกบรรทัด · ย้ายมาที่เดียว · หน้าเพจฉีด getTicketUserKey เข้าไป. */
    const mod = src('services/chat/orphanRooms.ts');
    expect(mod).toContain('[...activeTickets, ...completedTickets].map(keyOf)');
    expect(mod).toContain('!ticketedKeys.has(keyOf(row))');
    // and the page hands it the one identity rule, never a second one
    expect(page).toContain('keyOf: getTicketUserKey');
  });

  it('is fetched only while the bot tab is open — never a background poll', () => {
    /* [FIX-20260902-BOTONESOURCE] the tab-only guard is GONE, deliberately.
       While the rows were "every room for the OA" they could only be fetched on
       this tab — that payload had no business loading in the background. They are
       now the rooms the SERVER has already decided have no case, which is a small
       set by definition, so they load on every tab. That is the point: the badge
       has to be right while the operator is looking somewhere else, which is
       exactly when they rely on it. Fetching only here is what forced the badge
       to use a second formula off-tab, and that is what made one box show two
       numbers. What remains pinned is that there is still no background POLL —
       it is event-driven, on the same debounce as before. */
    expect(page).toContain('if (hookIds.length === 0) {');
    expect(page).toContain('setOrphanRooms([]);');
    /* [FIX-20260902-BOTONESOURCE] the page no longer fetches ROOMS for this tab
       at all — not every room (the 200-cap problem), and not a paged sweep of
       them either. It asks the tickets route for the rooms that have no case,
       which is the same rule the count uses. Downloading hundreds of rooms to
       keep a handful was the reason a cap existed in the first place. */
    expect(page).toContain('getNoCaseRooms(id, withinDaysParam)');
    expect(page).not.toContain('chatService.listRooms(id)');
    expect(page).not.toContain('.listAllRooms(id)');
  });

  it('reuses the rooms endpoint the page already calls, adding no new service', () => {
    const calls = page.match(/chatService\.listRooms\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);   // openTicket's, plus this one
  });

  it('the new group is ringed orange, everyone else green', () => {
    // the colours moved into `avatarRingClass` once three places needed them —
    // the card now asks for the rule instead of spelling it out
    expect(page).toContain('${avatarRingClass(tk)}');
  });

  it('the right panel no longer rings the avatar red/green', () => {
    expect(page).not.toContain("ring-emerald-400 shadow-emerald-300");
    expect(page).not.toContain("ring-red-400 shadow-red-300");
  });
});

/**
 * Opening the FIRST case for one of those rooms — a separate route from reopen,
 * because there is no earlier ticket. The wiring is what breaks silently here:
 * sending a synthesized `orphan:<roomId>` down the reopen route would 404, and
 * the operator would just see a button that does nothing.
 */
describe('the rows obey the same filters as everything else', () => {
  const page = ticketChatSource();

  it('"ever had a case" is asked WITHOUT a date window', () => {
    /* The lists this page holds are date-scoped, so a customer whose only cases
       are older than the window looked brand new — the owner caught exactly that
       (4 cases from 9 Aug, card still orange). The existence question now goes to
       its own unwindowed endpoint. */
    /* [FIX-20260902-BOTONESOURCE] `listTicketedMembers` is no longer called from
       this page. It existed because the page's ticket lists are date-scoped and
       could not answer "has this customer EVER had a case"; the server answers
       that now, inside the rows it returns. Asking again and subtracting a second
       time could only remove rooms the server had already decided to keep — and
       it subtracted across the whole GROUP, which is how the two halves came to
       differ by one room on real data. */
    expect(page).not.toContain('ticketService.listTicketedMembers(id)');
    expect(page).toContain('getNoCaseRooms(id, withinDaysParam)');
    /* [FIX-20260820-BOTCOUNT] the `uid_` prefixing moved into `botTabRows`. */
    expect(src('services/chat/orphanRooms.ts')).toContain(
      'ticketedKeys.add(`uid_${memberId}`)',
    );
    /* [FIX-20260902-BOTONESOURCE] passed as an empty literal now: the server has
       already excluded everyone who has had a case, so subtracting again here
       could only remove rooms it decided to keep. */
    expect(page).toContain('everTicketed: [],');
  });

  it('…but WHICH rows are shown follows the ⚙️ date picker, like every other row', () => {
    /* [FIX-20260820-BOTCOUNT] the window moved with the rest of the rule; the
       page still supplies the picker's value. Behaviour covered directly by
       test/botTabRows.value.test.ts with an injected clock. */
    const mod = src('services/chat/orphanRooms.ts');
    expect(mod).toContain('if (withinDays === undefined) return true;');
    expect(mod).toContain('ms >= now - withinDays * 86400000');
    expect(page).toContain('withinDays: withinDaysParam');
  });

  it('the memo recomputes when that picker changes', () => {
    /* [FIX-20260902-BOTONESOURCE] `everTicketed` left the deps with the state
       itself. The window is still what this case is really about: change the ⚙️
       and the rows must recompute. */
    expect(page).toContain('orphanRooms, withinDaysParam]');
  });

  it('⭐ botRows is DECLARED before both of its readers — TDZ guard', () => {
    /* Shipped broken once, on 2026-08-20: the memo was placed just above the
       counter but BELOW the visible-list memo that reads it, so the page threw
       `Cannot access 'botRows' before initialization` and the ticket screen went
       blank. Every unit test still passed — they read the source, not the running
       order — which is exactly why this one measures position.
       เทสผ่านหมดแต่หน้าเว็บขาว · เทสอ่านซอร์ส ไม่ได้รันจริง ⇒ ต้องวัดลำดับ. */
    const code = page
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    const decl = code.indexOf('const botRows = useMemo');
    expect(decl).toBeGreaterThan(-1);
    for (const use of ['base = botRows;', 'filterByActiveFilters(botRows)']) {
      expect(code.indexOf(use)).toBeGreaterThan(decl);
    }
  });

  it('⭐ the count and the list read the SAME rows — the reported bug', () => {
    /* A card showed in บอทดูแล while the tab's badge said 0, because the badge
       was computed from the closed cases alone and never saw the rooms. Both now
       read `botRows`; a number taken from those rows cannot disagree with them.
       ⚠️ And ONLY this tab moved — every other count still reads what it always
       did. แท็บอื่นไม่ถูกแตะ. */
    expect(page).toContain('base = botRows;');
    expect(page).toContain('filterByActiveFilters(botRows)');
    // the other tabs' counts are untouched in their FALLBACK half — flipped
    // 26/08 [FEAT-20260826-ACTIVEPAGING]: with paging ON they prefer the
    // server's tab_counts (sc), and sc is null in every state this file
    // reasons about (switch off / category filter), so the formulas below are
    // still exactly what those tabs show.
    for (const line of [
      "mine: sc ? sc.mine : filteredActive.filter(tk => Number(tk.job_status) === 1 && tk.admin_user_id === uid).length",
      'waiting: sc ? sc.waiting : filteredActive.filter(tk => Number(tk.job_status) === 0).length',
      'active: sc ? sc.active : filteredActive.filter(tk => Number(tk.job_status) === 1).length',
      'ended: endedCount',
    ]) {
      expect(page).toContain(line);
    }
  });
});

describe('the avatar ring is one rule in three places', () => {
  const page = ticketChatSource();
  /* [REFACTOR-20260905-ROOMHEADER] the chat header's avatar moved into
     `room-header/`. Reading both keeps the strongest half of this case honest:
     `inlineRings` asserts that NOBODY writes `ring-orange-400` by hand, and a
     file left out of that sum is a file free to do exactly that. */
  const view =
    src('components/chat/ChatRoomView.tsx') +
    src('components/chat/room-header/RoomHeader.tsx');

  it('orange only for a conversation that never became a case', () => {
    expect(avatarRingClass(roomAsPseudoTicket({ _id: 'r1' } as any))).toBe('ring-2 ring-orange-400');
  });

  it('green for everything else, including an unknown row', () => {
    expect(avatarRingClass({ _id: 't1' })).toBe('ring-2 ring-emerald-400');
    expect(avatarRingClass(null)).toBe('ring-2 ring-emerald-400');
  });

  it('all three avatars ask the same function — no copied class strings', () => {
    /* Owner: "กรอบสี avatar เหมือนกันทั้งสามจุด · เงื่อนไขเดียวกัน". Three copies of a
       two-branch class string is exactly how they drift apart later. */
    expect(page).toContain('${avatarRingClass(tk)}');        // the list card
    expect(page).toContain('${avatarRingClass(ticket)}');    // the right-hand panel
    expect(view).toContain('avatarRingClass({ is_orphan_room: isOrphanRow })'); // the chat header
    const inlineRings = (page + view).match(/ring-(orange|emerald)-400/g) ?? [];
    expect(inlineRings.length).toBe(0);   // nobody writes the colours by hand
  });

  it('the chat header only knows because the ticket page tells it', () => {
    expect(page).toContain('isOrphanRow={!!(selectedTicket as any)[ORPHAN_FLAG]}');
    expect(view).toContain('isOrphanRow?: boolean;');
  });
});

describe('the quiet rule reaches the bot-care tab and NOTHING else', () => {
  const page = ticketChatSource();

  it('a normal ticket is never quiet — every other tab keeps its badge', () => {
    expect(isQuietRow({ _id: 't1', line_user_id: 'm1' })).toBe(false);
    expect(isQuietRow({})).toBe(false);
    expect(isQuietRow(null)).toBe(false);
  });

  it('only a room-derived row is quiet', () => {
    expect(isQuietRow(roomAsPseudoTicket({ _id: 'r1' } as any))).toBe(true);
  });

  it('rows carrying that flag are produced in ONE place, inside the bot branch', () => {
    /* `roomAsPseudoTicket` is the only thing that sets the flag, so if it is
       called once and that call sits inside the `statusTab === 'bot'` branch,
       no other tab can ever receive a quiet row. */
    /* [FIX-20260820-BOTCOUNT] the call moved into the `botRows` memo, which is
       built above the branch so the tab's BADGE can be right while another tab
       is open. The invariant is unchanged and is now asserted where it lives:
       the flag is produced exactly once, only as `botTabRows`' `roomToRow`, and
       `botRows` is consumed only by the bot branch and that tab's count.
       ⇒ no other tab can receive a quiet row.
       ย้ายที่ แต่ยังเกิดที่เดียว และมีแค่แท็บบอทดูแลที่กิน. */
    const calls = page.match(/roomAsPseudoTicket\(/g) ?? [];
    expect(calls.length).toBe(1);
    expect(page).toContain('roomToRow: (room) => roomAsPseudoTicket(room)');

    /* `botRows` reaches exactly two consumers, both belonging to this tab.
       ⚠️ Comments are stripped first — the notes around the memo name it too, and
       counting the raw text finds those. คอมเมนต์ก็มีชื่อตัวแปร ต้องตัดก่อนนับ. */
    const code = page
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    const uses = code.match(/\bbotRows\b/g) ?? [];
    /* [FIX-20260820-BOTCOUNTSTALE] four now, not three: the fourth is the memo's
       DEPENDENCY entry, not a new consumer — the badge froze at 0 on opening the
       tab because the count read `botRows` without declaring it. A dependency
       cannot deliver a row anywhere, so the invariant this test exists for is
       unchanged, and the check below proves the extra one really is the deps
       array. ตัวที่ 4 คือ dep ไม่ใช่คนกิน ⇒ invariant เดิมยังอยู่ */
    expect(uses.length).toBe(4); // declaration, list, count, and the count's dep
    /* [FIX-20260902-BOTONESOURCE] anchored on `statusTab, botRows` now. The old
       anchor was `noCaseRooms, statusTab` — the deps of the count that no longer
       exists, because the badge stopped adding a server number on top of the rows
       and simply counts the rows. Three other memos in this file also start
       `[activeTickets, completedTickets`, so the anchor still has to be the part
       that is unique to the count's deps. */
    const depsAt = code.indexOf('statusTab, botRows');
    expect(depsAt).toBeGreaterThan(-1);
    expect(code.slice(depsAt, code.indexOf(']);', depsAt))).toMatch(/\bbotRows\b/);
    expect(page).toContain('base = botRows;');
    expect(page).toContain('filterByActiveFilters(botRows)');

    // and the list assignment really is inside the bot branch
    const botBranch = page.indexOf("} else if (statusTab === 'bot') {");
    const nextBranch = page.indexOf("} else if (statusTab === 'mine') {", botBranch);
    const listUse = page.indexOf('base = botRows;');
    expect(botBranch).toBeGreaterThan(-1);
    expect(listUse).toBeGreaterThan(botBranch);
    expect(listUse).toBeLessThan(nextBranch);
  });

  it('the sound rule is untouched — a waiting case still chimes on every tab', () => {
    const alerts = src('services/chat/ticketAlerts.ts');
    expect(alerts).toContain("return str(event.data?.['sender_type']) === 'customer';");
    // the reverted attempt must not creep back
    expect(codeOnly(alerts)).not.toContain("event.data?.['assist_status']");
  });
});

describe('the tab keeps itself fresh — rooms are created continuously', () => {
  const page = ticketChatSource();

  it('a customer writing refreshes the list, not just re-entering the tab', () => {
    /* Proven end-to-end on the stack: a brand-new customer's first message
       creates a room with no ticket (an orange row) and publishes
       `message:new sender=customer` — the only signal about such a room that
       ever reaches the dashboard, since no ticket event describes one. */
    expect(page).toContain("if (statusTab === 'bot' && senderType === 'customer') scheduleOrphanRefresh();");
  });

  it('a new ticket refreshes it too — that row must stop being orange', () => {
    expect(page).toContain("if (statusTab === 'bot' && e.type === 'ticket:new') scheduleOrphanRefresh();");
  });

  it('only while that tab is open — no other view pays for it', () => {
    const calls = page.match(/scheduleOrphanRefresh\(\);/g) ?? [];
    /* Both guard shapes count — `&&` on one line, and `if (…) call();` — because
       the abandon branch reads better as an early-return block. What matters is
       that EVERY call sits behind the bot-tab check, not how it is written. */
    const guarded = page.match(/statusTab === 'bot'[^\n]*scheduleOrphanRefresh\(\);/g) ?? [];
    expect(guarded.length).toBe(calls.length);
  });

  it('a burst collapses into one refresh', () => {
    expect(page).toContain('if (orphanTickTimer.current) return;');
    expect(page).toContain('setOrphanTick((t) => t + 1);');
  });

  it('the loader reruns on that signal', () => {
    /* [FIX-20260902-BOTONESOURCE] `statusTab` left the deps with the tab-only
       guard; `noCaseRefreshKey` and the ⚙️ window joined it. The signal this case
       exists for — the debounced WS tick — is still there, and so is the rule that
       opening or closing a case refreshes the rows. */
    expect(page).toContain('}, [activeHookId, activeGroupHookIds, orphanTick, noCaseRefreshKey, withinDaysParam]);');
  });
});

describe('opening the first case', () => {
  const page = ticketChatSource();
  const modal = src('components/chat/OpenCaseModal.tsx');
  const service = src('services/chat/ticketService.ts');

  it('the categories offered are the values the collection really holds', () => {
    // checked against live data: Other (147 rows) and Payment (40)
    expect(modal).toContain("{ value: 'Other', label: 'อื่นๆ' }");
    expect(modal).toContain("{ value: 'Payment', label: 'แจ้งฝาก' }");
  });

  it('the selected category is unmistakable — a 10% tint is not a selection', () => {
    /* The first cut used `bg-primary/10`, which on the light theme reads as
       "nothing chosen" (owner's screenshot). A filled button with white text is
       the only state that survives both themes. */
    /* `primary` is LINE GREEN app-wide and only `.tc .text-primary` is overridden
       to the theme blue — `bg-primary` is defined nowhere, so a filled button came
       out WHITE and its white label vanished. The dialog paints the theme blue
       explicitly instead, and must never reach for `bg-primary` again. */
    expect(modal).toContain("'border-blue-700 bg-blue-50 text-blue-700");
    expect(codeOnly(modal)).not.toContain('bg-primary');
    expect(codeOnly(modal)).not.toContain('bg-primary/10');
  });

  it('the confirm button is the loudest thing in the dialog', () => {
    expect(modal).toContain('bg-blue-700 hover:bg-blue-800');
    expect(modal).toContain("text-[15px] font-bold text-white");
  });

  it('an empty need is documented as becoming the default, not silently dropped', () => {
    expect(modal).toContain("export const OPEN_CASE_DEFAULT_NEED = 'เปิดเคสโดยแอดมิน';");
  });

  it('a row from a ROOM takes the new route, never the reopen one', () => {
    expect(page).toContain('(selectedTicket as any)[ORPHAN_FLAG]');
    expect(page).toContain('setOpenCaseRoom({');
    // and the reopen branch is still there for real tickets
    expect(page).toContain('setReopenConfirm(selectedTicket)');
  });

  it('the service posts to its own endpoint and omits blanks', () => {
    expect(service).toContain("/api/tickets/open-from-room");
    expect(service).toContain("...(choices?.category ? { category: choices.category } : {})");
  });

  it('a successful open drops the row from the orphan list — the card turns green', () => {
    expect(page).toContain('setOrphanRooms(prev => prev.filter(r => String(r._id) !== openCaseRoom.roomId));');
  });

  it('a refusal is shown, not swallowed', () => {
    expect(page).toContain('setOpenCaseError(');
    /* [FEAT-20261022-I18NTICKETEN] flipped 22/10: the owner asked for an English Ticket page, so the
       literal Thai now sits as the t() fallback (th.json holds the same text) */
    expect(page).toContain("title={t('ticketui.error.open_case_failed', 'เปิดเคสไม่สำเร็จ')}");
  });
});
