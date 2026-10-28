/**
 * [CHAR-20260905-TICKETCHATBADGECOUNTS] CHARACTERIZATION — the FIVE tab
 * numbers on `pages/chat/TicketChat.tsx` (ส่วนตัว / รอรับเคส / กำลังคุย /
 * ปิดเคส / บอทดูแล), pinned on the UNCHANGED code before the owner's planned
 * 40% cut. Owner's own words for this gate: "อย่าเพี้ยน ตัวเลข + เสียง + สี" —
 * this file is the ตัวเลข (numbers) leg. Sound and colour are pinned in
 * `test/ticketChatNotice.dom.test.tsx`; the list-level realtime effects are in
 * `test/ticketChatRealtime.dom.test.tsx`. All three share the same kind of rig
 * (mock the service boundary, fake the WS fan-out) — see that file's header
 * for the full rationale; this header only covers what is specific to counts.
 *
 * ## Where the number comes from — NOT one formula
 * `pages/chat/TicketChat.tsx`'s `counts` useMemo (grep `tabCounts\|counts\[` per
 * the brief) is two DIFFERENT formulas wearing one badge, selected by
 * `activePagingEnabled()` (`localStorage.TC_ACTIVE_PAGING !== 'false'`,
 * default ON):
 *   - **paging ON (default):** `mine`/`waiting`/`active` come from the
 *     server's `tab_counts` on the last list response (`serverTabCounts`) —
 *     NOT from counting `activeTickets` rows.
 *   - **paging OFF (`TC_ACTIVE_PAGING=false`, still a live kill switch):**
 *     the same three numbers are counted directly off `activeTickets`.
 *   - `ended` and `bot` are NEVER paging-dependent: `ended` reads
 *     `completedTickets`/`completedTotal` directly, `bot` reads a rows array
 *     (`services/chat/orphanRooms.ts` `botTabRows`) built from
 *     `completedTickets` + `activeTickets` + orphan rooms.
 * A cut that cannot see this split could easily "simplify" the DEFAULT path
 * into the "obvious" client-side count and pass every test that never turns
 * the kill switch on. TEST 4 below exists specifically to keep that path
 * provable too.
 *
 * 🔴 THESE DESCRIBE, THEY DO NOT JUDGE — including the fact that a badge can
 *    legitimately be sourced two different ways depending on a flag nobody on
 *    screen can see.
 *
 * revert: delete this file (the counts leg of the pre-cut gate is gone).
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';

if (!('ResizeObserver' in globalThis)) {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (!window.matchMedia) {
  (window as any).matchMedia = () => ({
    matches: false,
    media: '',
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  });
}

const rig = vi.hoisted(() => ({
  wsHandlers: new Set<{ current: (e: { type: string; data: Record<string, unknown> }) => void }>(),
  server: { active: [] as any[], completed: [] as any[] },
}));

vi.mock('../services/chat', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../services/chat');

  const listBy = async (_scopeId: string, params: Record<string, unknown>) => {
    if (params?.job_status === 2) {
      return {
        success: true,
        data: rig.server.completed,
        pagination: { total: rig.server.completed.length, has_more: false },
      };
    }
    if (Array.isArray((params as any)?.ids)) {
      const ids = new Set(((params as any).ids as unknown[]).map(String));
      return { success: true, data: rig.server.active.filter((r) => ids.has(String(r._id))) };
    }
    const uid = 'admin1';
    return {
      success: true,
      data: rig.server.active,
      tab_counts: {
        mine: rig.server.active.filter((r) => Number(r.job_status) === 1 && r.admin_user_id === uid).length,
        waiting: rig.server.active.filter((r) => Number(r.job_status) === 0).length,
        active: rig.server.active.filter((r) => Number(r.job_status) === 1).length,
      },
      pagination: { has_more: false },
    };
  };

  return {
    ...actual,
    useTicketWS: (onEvent: (e: { type: string; data: Record<string, unknown> }) => void) => {
      const ref = React.useRef(onEvent);
      ref.current = onEvent;
      React.useEffect(() => {
        const wrapper = { current: (e: { type: string; data: Record<string, unknown> }) => ref.current(e) };
        rig.wsHandlers.add(wrapper);
        return () => {
          rig.wsHandlers.delete(wrapper);
        };
      }, []);
    },
    ticketService: {
      ...(actual as any).ticketService,
      listTicketsByGroup: listBy,
      listTicketsByHook: listBy,
      getNoCaseRooms: async () => [],
      getTicketMetaBatchRaw: async () => ({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ metas: {} }),
      }),
      getTicketMetaByGroup: async () => ({ waiting: 0 }),
      updateTicketMinimal: async () => ({ success: true }),
      patchDetail: async () => ({ success: true }),
      patchNickname: async () => ({ success: true }),
      reopenTicketByAdmin: async () => ({ success: true }),
      openTicketFromRoom: async () => ({ success: true }),
    },
    chatService: {
      ...(actual as any).chatService,
      listRooms: async () => [],
      popularTags: async () => ({ data: [] }),
      sendReply: async () => ({ success: true }),
      sendImages: async () => ({ success: true }),
      sendSticker: async () => ({ success: true }),
      createInlineNote: async () => ({ success: true }),
      updateAssistStatus: async () => ({ success: true }),
    },
    assignHistoryService: {
      createAssignHistory: async () => ({ success: true }),
      getAssignHistories: async () => ({ data: [] }),
    },
    dictLookup: (s: string) => s,
    loadTranslationDict: () => Promise.resolve(),
    subscribeDict: () => () => {},
  };
});

vi.mock('../services/hook', () => ({
  webhookService: {
    getAllHooks: async () => [{ _id: 'h1', line_oa_name: 'OA หนึ่ง', group: 'g1' }],
  },
}));

vi.mock('../services/admin', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../services/admin');
  return {
    ...actual,
    groupService: { listGroups: async () => ({ data: [{ _id: 'g1', group_name: 'Group One' }] }) },
    userService: { listUsersForAssign: async () => ({ data: [] }) },
    configService: { listConfigs: async () => ({ data: [] }) },
  };
});

vi.mock('../services/authStorage', () => ({
  getStoredAuth: () => ({
    role: { name: 'superadmin' },
    user: { id: 'admin1', username: 'admin1', display_name: 'แอดมินหนึ่ง' },
    token: 't',
    permissions: [],
    allowed_hooks: null,
  }),
}));

import { I18nProvider } from '../i18n';
import { TicketChat } from '../pages/chat/TicketChat';

function mkTicket(over: Record<string, unknown> & { _id: string; line_user_id: string; name: string }) {
  const { name, ...rest } = over;
  return {
    line_oa_hook_id: 'h1',
    job_status: 0,
    line_user_data: { full_name: name },
    customer_tags: [],
    need_detail: '',
    updated_at: '2026-09-01T09:00:00Z',
    created_at: '2026-09-01T09:00:00Z',
    ...rest,
  };
}

function mount() {
  return render(
    <I18nProvider>
      <TicketChat />
    </I18nProvider>,
  );
}
function emitWs(event: { type: string; data: Record<string, unknown> }) {
  act(() => {
    Array.from(rig.wsHandlers).forEach((h) => h.current(event));
  });
}
function tabButton(label: string): HTMLElement {
  const btn = screen.getAllByRole('button').find((b) => (b.textContent ?? '').trim().startsWith(label));
  if (!btn) throw new Error(`tab "${label}" not found`);
  return btn as HTMLElement;
}
function countOf(label: string): string {
  return tabButton(label).querySelector('span')?.textContent?.trim() ?? '';
}

/** The known set of rows this suite pins against every tab.
 *  mine=1 (m1), waiting=2 (w1,w2), active=2 (m1+o1), ended=2 (e1,e2), bot=1 (e2). */
function fullFixture() {
  rig.server.active = [
    mkTicket({ _id: 'w1', line_user_id: 'Uw1', name: 'ลูกค้าเอ', job_status: 0 }),
    mkTicket({ _id: 'w2', line_user_id: 'Uw2', name: 'ลูกค้าบี', job_status: 0 }),
    mkTicket({
      _id: 'm1',
      line_user_id: 'Um1',
      name: 'ลูกค้าซี',
      job_status: 1,
      admin_user_id: 'admin1',
      admin_user_data: { display_name: 'แอดมินหนึ่ง' },
    }),
    mkTicket({
      _id: 'o1',
      line_user_id: 'Uo1',
      name: 'ลูกค้าดี',
      job_status: 1,
      admin_user_id: 'admin2',
      admin_user_data: { display_name: 'แอดมินสอง' },
    }),
  ];
  rig.server.completed = [
    { ...mkTicket({ _id: 'e1', line_user_id: 'Ue1', name: 'ลูกค้าอี' }), job_status: 2, assist_status: true },
    { ...mkTicket({ _id: 'e2', line_user_id: 'Ue2', name: 'ลูกค้าเอฟ' }), job_status: 2, assist_status: false },
  ];
}

beforeEach(() => {
  rig.wsHandlers.clear();
  rig.server.active = [];
  rig.server.completed = [];
  localStorage.clear();
});

describe('[TICKETCHAT-BADGECOUNTS] the five tab numbers, for a known set of rows', () => {
  it('⭐ mounts and draws real rows — proves the suite is not green over an empty DOM', async () => {
    fullFixture();
    mount();
    await waitFor(() => expect(countOf('รอรับเคส')).toBe('2'));
    expect(screen.getByText(/ลูกค้าเอ/)).toBeInTheDocument();
    expect(screen.getByText(/ลูกค้าบี/)).toBeInTheDocument();
  });

  it('⭐ pins all five numbers at once, under the DEFAULT server-counted (paging-on) path', async () => {
    fullFixture();
    mount();
    await waitFor(() => expect(countOf('รอรับเคส')).toBe('2'));
    expect(countOf('ส่วนตัว')).toBe('1');
    expect(countOf('กำลังคุย')).toBe('2');
    await waitFor(() => expect(countOf('ปิดเคส')).toBe('2'));
    await waitFor(() => expect(countOf('บอทดูแล')).toBe('1'));
  });

  it('the empty case: zero rows shows 0 on every tab and the empty-state text, not a blank list', async () => {
    mount();
    await waitFor(() => expect(screen.getByText('ไม่มีเคสในสถานะนี้')).toBeInTheDocument());
    expect(countOf('ส่วนตัว')).toBe('0');
    expect(countOf('รอรับเคส')).toBe('0');
    expect(countOf('กำลังคุย')).toBe('0');
    expect(countOf('ปิดเคส')).toBe('0');
    expect(countOf('บอทดูแล')).toBe('0');
  });

  it('⭐ the rows behind each tab agree with its own number — no tab shows another’s customer', async () => {
    fullFixture();
    mount();
    await waitFor(() => expect(countOf('กำลังคุย')).toBe('2'));

    fireEvent.click(tabButton('กำลังคุย'));
    await waitFor(() => expect(screen.getByText(/ลูกค้าซี/)).toBeInTheDocument());
    expect(screen.getByText(/ลูกค้าดี/)).toBeInTheDocument();

    fireEvent.click(tabButton('ส่วนตัว'));
    await waitFor(() => expect(screen.getByText(/ลูกค้าซี/)).toBeInTheDocument());
    /* mine (m1, admin1) only — o1 (admin2) must not leak into ส่วนตัว. */
    expect(screen.queryByText(/ลูกค้าดี/)).not.toBeInTheDocument();

    fireEvent.click(tabButton('บอทดูแล'));
    await waitFor(() => expect(screen.getByText(/ลูกค้าเอฟ/)).toBeInTheDocument());
    /* e1 is a plain closed case (assist_status true) — not bot-mode, must not
       appear here even though it is also in ปิดเคส. */
    expect(screen.queryByText(/ลูกค้าอี/)).not.toBeInTheDocument();

    fireEvent.click(tabButton('ปิดเคส'));
    await waitFor(() => expect(screen.getAllByText(/ลูกค้าอี/).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/ลูกค้าเอฟ/).length).toBeGreaterThan(0);
  });

  it('⭐ [cross-check] the SAME numbers survive with paging OFF (TC_ACTIVE_PAGING=false) — client-counted, not server-declared', async () => {
    /* This is a DIFFERENT formula (see file header): with the kill switch on,
       `fetchActive` drops `serverTabCounts` to null and `mine`/`waiting`/
       `active` are counted straight off `activeTickets`. Same fixture, same
       expected numbers, provably different code path. */
    localStorage.setItem('TC_ACTIVE_PAGING', 'false');
    fullFixture();
    mount();
    await waitFor(() => expect(countOf('รอรับเคส')).toBe('2'));
    expect(countOf('ส่วนตัว')).toBe('1');
    expect(countOf('กำลังคุย')).toBe('2');
    await waitFor(() => expect(countOf('ปิดเคส')).toBe('2'));
    await waitFor(() => expect(countOf('บอทดูแล')).toBe('1'));
  });

  it('a new ticket over the WS wire increments รอรับเคส — the realtime leg of this same badge', async () => {
    fullFixture();
    mount();
    await waitFor(() => expect(countOf('รอรับเคส')).toBe('2'));
    await waitFor(() => expect(screen.getByText(/ลูกค้าเอ/)).toBeInTheDocument());

    rig.server.active.push(mkTicket({ _id: 'w3', line_user_id: 'Uw3', name: 'ลูกค้าจี', job_status: 0 }));
    emitWs({ type: 'ticket:new', data: { _id: 'w3', hook_id: 'h1', job_status: 0 } });

    await waitFor(() => expect(screen.getByText(/ลูกค้าจี/)).toBeInTheDocument(), { timeout: 3000 });
    await waitFor(() => expect(countOf('รอรับเคส')).toBe('3'), { timeout: 4000 });
  });

  it('⭐ [AS-IS] reopened by ANOTHER admin refetches and the count moves; reopened by ME does not touch the badge at all', async () => {
    /* handleWsEvent's `ticket:reopened` branch, verbatim:
       `if (!evAdmin || !currentUser || evAdmin !== String(currentUser.id)) { fetchActive(true); } return;`
       — a full refetch ONLY when someone ELSE pressed reopen. When the CURRENT
       admin is the one who reopened it, the comment says why: "the presser
       already moved their card locally" — so this event does nothing, and if
       the server's badge disagrees with what is already on screen, nothing
       here will reconcile it. Both halves pinned, neither judged. */
    rig.server.active = [mkTicket({ _id: 'e1', line_user_id: 'Ue1', name: 'ลูกค้าอี', job_status: 0 })];
    rig.server.completed = [];
    mount();
    await waitFor(() => expect(countOf('รอรับเคส')).toBe('1'));

    /* Case A — reopened by someone else: the server now also shows a SECOND
       waiting ticket; a refetch must pick it up. */
    rig.server.active.push(mkTicket({ _id: 'e2', line_user_id: 'Ue2', name: 'ลูกค้าเอช', job_status: 0 }));
    emitWs({ type: 'ticket:reopened', data: { admin_user_id: 'admin2' } });
    await waitFor(() => expect(countOf('รอรับเคส')).toBe('2'), { timeout: 3000 });

    /* Case B — reopened by ME (admin1): bump the fake server again, but this
       time the event must NOT cause a refetch, so the badge must NOT move. */
    rig.server.active.push(mkTicket({ _id: 'e3', line_user_id: 'Ue3', name: 'ลูกค้าไอ', job_status: 0 }));
    emitWs({ type: 'ticket:reopened', data: { admin_user_id: 'admin1' } });
    /* No waitFor-for-change here on purpose: there is nothing to wait FOR.
       A short real-time settle is enough to prove nothing moved. */
    await new Promise((r) => setTimeout(r, 200));
    expect(countOf('รอรับเคส')).toBe('2');
  });
});

/**
 * ## NOT PINNED
 * - `groupCounts` (the per-OA/group slider tabs, `getTicketMetaBatchRaw`) is
 *   stubbed to a harmless empty response and never asserted on — this suite's
 *   fixture uses one group/one hook, so that number is never visible on
 *   screen as anything but the STATUS_TABS numbers already covered here.
 * - The paged, multi-page walk (`activePagesRef`, `loadMoreActive`) — every
 *   fixture fits on page 1, so the pagination-continuation branch of
 *   `fetchActive` is untouched.
 * - `filterTier`/`filterCategory`/`filterTag`/`filterOa`-narrowed counts
 *   (the `hasFilter` branch of `ended`, and the paging-blocked-by-category
 *   rule in `activeListParams`) — no filter is ever set in this suite.
 */
