/**
 * [CHAR-20260905-TICKETCHATREALTIME] CHARACTERIZATION — how a websocket event
 * changes what an operator SEES on `pages/chat/TicketChat.tsx` (7,109 lines as
 * of this file's writing), pinned on the UNCHANGED code before the owner's
 * planned 40% cut. `dev-local §6.3` forbids moving anything out of a file
 * without a characterization test green on the code as it stands today; the
 * owner's extra constraint for this cut is that realtime updates, the badge
 * counts and the notifications must not move — this file is the realtime leg
 * of that gate.
 *
 * 🔗 Sibling suites: `test/ticketChatBadgeCounts.dom.test.tsx` (the tab
 *    numbers), `test/ticketChatNotice.dom.test.tsx` (the new-case highlight).
 *    All three mount the SAME page with the SAME kind of rig; only the fixture
 *    tickets and the assertions differ.
 *
 * ## How the wire is faked
 * `TicketChat` subscribes with `useTicketWS(handleWsEvent)` from the barrel
 * `services/chat` (real file: `services/chat/useTicketWS.ts`), which normally
 * mints a ticket and opens a real `WebSocket`. That transport is replaced here
 * with a tiny stand-in that keeps the REAL fan-out contract (every subscriber
 * gets every event, in order — see `emit()` in the real file): each
 * `useTicketWS(cb)` call registers `cb` in a shared `Set`, and the test's
 * `emitWs()` walks that set exactly the way the real module's `emit()` does.
 * Nothing about `handleWsEvent` itself is touched or driven around; the test
 * calls the SAME callback the real socket would have called.
 *
 * The ticket list/detail HTTP surface (`ticketService`, `chatService`,
 * `assignHistoryService`) is replaced by a tiny in-memory "server" — see the
 * fixture rig below — mocked at the service boundary the way
 * `test/personalPanelCards.dom.test.tsx` and `test/broadcastFormVisible.dom.test.tsx`
 * do. No ticket is ever opened/selected in this suite (see "NOT PINNED" at the
 * bottom of the file for what that scopes out) — every assertion here is about
 * the LIST and the TAB BAR, which is where realtime is actually visible without
 * opening a conversation.
 *
 * 🔴 THESE DESCRIBE, THEY DO NOT JUDGE. Two of the four scenarios below pin a
 *    gap on purpose (see TEST 2 and TEST 4) rather than "fixing" it — a
 *    characterization test that improves what it finds is not a baseline.
 *
 * revert: delete this file (the realtime leg of the pre-cut gate is gone).
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';

/* jsdom has neither of these. TicketChat's group-slider width effect builds a
   real `ResizeObserver` unconditionally, and its `wide`-breakpoint effect
   reaches for `window.matchMedia` (guarded, but stubbing it keeps that effect
   behaving like a real browser instead of silently no-op-ing). Same stub shape
   already used by test/HookFormModal.value.test.tsx, test/AssignHistory.filters.test.tsx
   and others in this repo — not invented for this file. */
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

/**
 * Shared mutable rig, built with `vi.hoisted` because `vi.mock` factories
 * below are hoisted above this file's own top-level code by vitest — a plain
 * `const` here would be `undefined` inside them at the time they are defined.
 *
 *  - `wsHandlers`: every live `useTicketWS(cb)` subscriber in the render tree
 *    (TicketChat's own `handleWsEvent`, and nobody else's — see the "not
 *    pinned" note about ChatRoomView never mounting in this suite).
 *  - `server`: the fake backend's current ticket pool. Tests mutate
 *    `server.active` / `server.completed` directly (never reassign the `rig`
 *    object itself, or the mocks below lose the reference).
 */
const rig = vi.hoisted(() => ({
  wsHandlers: new Set<{ current: (e: { type: string; data: Record<string, unknown> }) => void }>(),
  server: { active: [] as any[], completed: [] as any[] },
}));

vi.mock('../services/chat', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../services/chat');

  /** One handler for both "which ticket list" calls the page makes, keyed off
   *  the SAME two shapes `services/chat/ticketService.ts` (`closedListParams`)
   *  actually sends: `job_status: 2` (a NUMBER) is the ปิดเคส tab; `'0,1'` (a
   *  STRING) is everything else (fetchActive, the debounced badge-count ping,
   *  and `usePartialTicketFetch`'s by-id refetch all share that string). */
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
    /* Replaces the real WS transport (ticket mint + `new WebSocket`) with the
       fan-out described in the file header. `React.useRef`/`useEffect` here
       are the SAME primitives the real hook uses to always call the LATEST
       closure without re-subscribing on every render. */
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
    /* Not part of this suite (no panel is ever opened) but harmless real
       exports otherwise; the two below ARE overridden because
       personalPanelCards.dom.test.tsx already proved TicketChat's `useI18n`
       chain trips over the real translationDictService in jsdom. */
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
  /* `isSuperRole()` (services/admin/visibleGroups.ts) reads `auth.role.name` —
     a TOP-LEVEL field, not `auth.user.role` — so this shape must match it
     exactly or the group/hook visibility filters silently drop the fixture. */
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

/** One ticket row, defaulted to a waiting/unclaimed case on hook `h1`. */
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

/** Every registered `useTicketWS` subscriber gets the event — mirrors the real
 *  module's `emit()`. Wrapped in `act` because the handlers call React state
 *  setters directly, outside any Testing Library event helper. */
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

beforeEach(() => {
  rig.wsHandlers.clear();
  rig.server.active = [];
  rig.server.completed = [];
  localStorage.clear();
});

describe('[TICKETCHAT-REALTIME] the list a person sees, driven by the WS wire', () => {
  it('⭐ mounts and draws real rows — proves the suite is not green over an empty DOM', async () => {
    rig.server.active = [mkTicket({ _id: 'w1', line_user_id: 'Uaaa1', name: 'ลูกค้าเอ', job_status: 0 })];
    mount();
    await waitFor(() => expect(screen.getByText(/ลูกค้าเอ/)).toBeInTheDocument());
    expect(countOf('รอรับเคส')).toBe('1');
  });

  it('a new ticket arriving is fetched by id and appears in the waiting list', async () => {
    rig.server.active = [mkTicket({ _id: 'w1', line_user_id: 'Uaaa1', name: 'ลูกค้าเอ', job_status: 0 })];
    mount();
    /* Under paging's default rig, `mine`/`waiting`/`active` are the server's
       `tab_counts`, not `activeTickets.length` — settle BOTH the number and
       the row before touching anything, or a later assertion can race a fetch
       that is still resolving underneath a count that already looks right. */
    await waitFor(() => expect(countOf('รอรับเคส')).toBe('1'));
    await waitFor(() => expect(screen.getByText(/ลูกค้าเอ/)).toBeInTheDocument());

    /* The BE has already stored the new ticket by the time its WS event
       reaches the client — `ticket:new` carries only `_id`/`hook_id`, and the
       page fetches the full row by id (`usePartialTicketFetch`, 600ms
       debounce). Simulate that by adding it to the fake server FIRST. */
    rig.server.active.push(
      mkTicket({ _id: 'new1', line_user_id: 'Unew1', name: 'ลูกค้าใหม่มาก', job_status: 0 }),
    );
    emitWs({ type: 'ticket:new', data: { _id: 'new1', hook_id: 'h1', job_status: 0 } });

    await waitFor(() => expect(screen.getByText(/ลูกค้าใหม่มาก/)).toBeInTheDocument(), { timeout: 3000 });
    /* The count is a SECOND, independently-debounced round-trip
       (`scheduleCountsRefresh`, 1500ms) fired from inside the partial-fetch's
       `setActiveTickets` wrapper — it can lag the row by a second or more. */
    await waitFor(() => expect(countOf('รอรับเคส')).toBe('2'), { timeout: 4000 });
  });

  it('⭐ [AS-IS] claimed by someone else moves the tab instantly but the claimer’s name is stale', async () => {
    /* pages/chat/TicketChat.tsx, the `ticket:updated` branch of `handleWsEvent`:
       a row already in the list is patched with ONLY `job_status` + `category`
       — never `admin_user_data`. The code says so directly ([FIX-20260823-CLAIMCAS]):
       "แถวในลิสต์ถูก patch ด้วย job_status + category เท่านั้น ⇒ admin_user_data ค้าง".
       That patch is corrected only if this ticket is the one CURRENTLY OPEN
       (`schedulePartialFetch` keyed on `selectedTicketIdRef`) — which nothing in
       this suite ever is. So a card can show job_status "กำลังคุย" while still
       reading "ว่าง" for who holds it. Pinned as today's behaviour, not fixed. */
    rig.server.active = [mkTicket({ _id: 'w1', line_user_id: 'Uaaa1', name: 'ลูกค้าบี', job_status: 0 })];
    mount();
    await waitFor(() => expect(countOf('รอรับเคส')).toBe('1'));
    await waitFor(() => expect(screen.getByText(/ลูกค้าบี/)).toBeInTheDocument());
    expect(screen.getByText('ว่าง')).toBeInTheDocument();
    expect(countOf('กำลังคุย')).toBe('0');

    /* Someone else claims it. The fake server is DELIBERATELY left UNCHANGED
       (still job_status 0) — on purpose, not an oversight: this is what
       ISOLATES the assertion below to the CLIENT-SIDE in-place patch. If the
       row only appeared to move because of a later network refetch (e.g. the
       debounced `scheduleCountsRefresh`), that refetch would read the
       fake server's UNCHANGED data and the row would NOT move — so the
       row moving proves the synchronous client patch specifically, not a
       same-looking side effect from a different code path. (An earlier draft
       of this test also updated the fake server here, which let a mutation
       that deletes the client-side `job_status` patch stay GREEN — caught by
       mutation-testing this suite, see the task's mutation table.) */
    emitWs({ type: 'ticket:updated', data: { _id: 'w1', hook_id: 'h1', job_status: 1, category: null } });

    /* Synchronous, deliberately NOT a `waitFor`: `setActiveTickets` inside
       `handleWsEvent`'s `ticket:updated` branch applies inside `emitWs`'s
       `act()` with no `await` in between, so by the time `emitWs` returns the
       patch has already committed — waiting here would only hide a real
       failure behind a timeout instead of failing immediately. */
    fireEvent.click(tabButton('กำลังคุย'));
    expect(screen.getByText(/ลูกค้าบี/)).toBeInTheDocument();
    /* The pin: still "ว่าง" — job_status moved, the claimer's name did not. */
    expect(screen.getByText('ว่าง')).toBeInTheDocument();
    fireEvent.click(tabButton('รอรับเคส'));
    expect(screen.queryByText(/ลูกค้าบี/)).not.toBeInTheDocument();
  });

  it('a ticket closing moves it from the open tabs into ปิดเคส, live', async () => {
    rig.server.active = [
      mkTicket({
        _id: 'a1',
        line_user_id: 'Uccc3',
        name: 'ลูกค้าซี',
        job_status: 1,
        admin_user_id: 'admin1',
        admin_user_data: { display_name: 'แอดมินหนึ่ง' },
      }),
    ];
    mount();
    await waitFor(() => expect(countOf('ส่วนตัว')).toBe('1'));
    expect(countOf('ปิดเคส')).toBe('0');
    /* Confirm the ROW itself (not just the server-count badge) has settled
       into `activeTickets` before mutating it further — see the file's first
       failed draft: a count can read correctly one render before the array
       backing it does. */
    fireEvent.click(tabButton('ส่วนตัว'));
    await waitFor(() => expect(screen.getByText(/ลูกค้าซี/)).toBeInTheDocument());

    rig.server.active = [];
    rig.server.completed = [{ ...mkTicket({ _id: 'a1', line_user_id: 'Uccc3', name: 'ลูกค้าซี' }), job_status: 2 }];
    emitWs({ type: 'ticket:updated', data: { _id: 'a1', hook_id: 'h1', job_status: 2, category: null } });

    /* `ended` is computed straight from `completedTickets`/`completedTotal`
       (never `serverTabCounts`), so it settles WITH the event — this
       `waitFor` resolves almost immediately. `mine`/`active`, by contrast,
       read `serverTabCounts`, and the close branch only requests a fresh copy
       via the SAME 1500ms-debounced `scheduleCountsRefresh` as the new-ticket
       case above — the row disappears from the DOM (`data-chat-card`) well
       before the badge agrees; both are pinned here. */
    await waitFor(() => expect(countOf('ปิดเคส')).toBe('1'));
    expect(screen.queryByText(/ลูกค้าซี/)).not.toBeInTheDocument();
    await waitFor(() => expect(countOf('ส่วนตัว')).toBe('0'), { timeout: 3000 });
    expect(countOf('กำลังคุย')).toBe('0');

    fireEvent.click(tabButton('ปิดเคส'));
    /* The closed-tab card repeats the name (title + "OA: ... • name" line) —
       `getAllByText` on purpose, not a stricter query. */
    await waitFor(() => expect(screen.getAllByText(/ลูกค้าซี/).length).toBeGreaterThan(0));
  });

  /* [FIX-20261019-CLOSELIVE] The case above passed only SOME of the time (19/10: 2–3 runs in 5, on the
     unchanged code too). Root cause, proven with a temporary trace: the handler read `found` right after
     `setActiveTickets(updater)`, but React runs an updater eagerly ONLY when nothing else is queued — with
     another update pending it defers the updater to the next render, so `found` was still false, the row
     left the open tabs and never reached ปิดเคส (the fallback partial fetch asks job_status 0,1 only).
     This case makes the race DETERMINISTIC: two events in one batch — the first queues an update, the
     second closes a case. Red on every run before the fix, never flaky. */
  it('⭐ a close that lands while another update is still queued still moves the case into ปิดเคส', async () => {
    rig.server.active = [
      mkTicket({ _id: 'a1', line_user_id: 'Uccc3', name: 'ลูกค้าซี', job_status: 1, admin_user_id: 'admin1',
        admin_user_data: { display_name: 'แอดมินหนึ่ง' } }),
      mkTicket({ _id: 'b1', line_user_id: 'Ubbb2', name: 'ลูกค้าบี', job_status: 0 }),
    ];
    mount();
    await waitFor(() => expect(countOf('ส่วนตัว')).toBe('1'));
    fireEvent.click(tabButton('ส่วนตัว'));
    await waitFor(() => expect(screen.getByText(/ลูกค้าซี/)).toBeInTheDocument());
    expect(countOf('ปิดเคส')).toBe('0');

    rig.server.active = [];
    act(() => {
      Array.from(rig.wsHandlers).forEach((h) => {
        h.current({ type: 'ticket:updated', data: { _id: 'b1', hook_id: 'h1', job_status: 1, category: null } });
        h.current({ type: 'ticket:updated', data: { _id: 'a1', hook_id: 'h1', job_status: 2, category: null } });
      });
    });

    await waitFor(() => expect(countOf('ปิดเคส')).toBe('1'));
    expect(screen.queryByText(/ลูกค้าซี/)).not.toBeInTheDocument();
  });

  it('⭐ [AS-IS] reconnecting refreshes the open tabs but not ปิดเคส — a case closed while disconnected keeps counting there until the tab is opened', async () => {
    /* handleWsEvent's `ws:reconnected` branch is exactly one line:
       `fetchActive(true)`. It does not also call `fetchCompleted()`, so the
       ปิดเคส tab's number is whatever it already had, even though the ticket
       that just vanished from the active list was, server-side, actually
       closed. Pinned as-is; a 40% cut must not "fix" this silently. */
    rig.server.active = [mkTicket({ _id: 'a1', line_user_id: 'Uccc3', name: 'ลูกค้าซี', job_status: 1 })];
    rig.server.completed = [];
    mount();
    await waitFor(() => expect(countOf('กำลังคุย')).toBe('1'));
    /* job_status 1 never shows under the default "รอรับเคส" tab — open the
       tab it actually lives on before treating its absence as meaningful. */
    fireEvent.click(tabButton('กำลังคุย'));
    await waitFor(() => expect(screen.getByText(/ลูกค้าซี/)).toBeInTheDocument());
    expect(countOf('ปิดเคส')).toBe('0');

    /* The server closed the case while this tab was disconnected. */
    rig.server.active = [];
    rig.server.completed = [{ ...mkTicket({ _id: 'a1', line_user_id: 'Uccc3', name: 'ลูกค้าซี' }), job_status: 2 }];
    emitWs({ type: 'ws:reconnected', data: {} });

    await waitFor(() => expect(screen.queryByText(/ลูกค้าซี/)).not.toBeInTheDocument());
    await waitFor(() => expect(countOf('กำลังคุย')).toBe('0'));
    /* The pin: ปิดเคส did NOT pick up the server's new count from this event. */
    expect(countOf('ปิดเคส')).toBe('0');
  });
});

/**
 * ## NOT PINNED — read this before relying on this suite as complete cover
 *
 * - **Opening a ticket.** Every scenario above keeps `selectedTicket === null`
 *   on purpose, to avoid mounting `ChatRoomView` / `PersonalPanel(Narrow)` /
 *   `ProfileHeader` (their own service surface — `strikeService`,
 *   `followStampService`, `resolveRoom`, a second `chatService.listRooms`
 *   with real room shapes — is a materially bigger rig). That means the
 *   "claim conflict" race warning (`raceWarnMsg`, TicketChat.tsx around
 *   `handleExecuteClaim` / `executeAction`, ~line 1109/1201/3024) and the
 *   partial-fetch-of-the-OPEN-ticket correction path
 *   (`schedulePartialFetch(id)` guarded by `id === selectedTicketIdRef.current`)
 *   are NOT exercised here. A cut that changes what happens once a ticket is
 *   open is invisible to this suite.
 * - **`message:new`** (a live chat bubble arriving) is not pinned. It drives
 *   `unreadByRoom` (the yellow per-card badge) and, for the currently OPEN
 *   room, `ChatRoomView`'s own append path — both need a rendered chat pane.
 * - **`customer:profile_updated`** (re-dispatched as `tc:customer-profile-updated`)
 *   is not pinned; it only matters to the personal-data panel, already covered
 *   from a different angle by `test/personalPanelCards.dom.test.tsx`.
 * - **Group-tab / status-tab highlight visuals** triggered by these same events
 *   are pinned separately and in more depth in `test/ticketChatNotice.dom.test.tsx`.
 * - **Server-paged fetching** (`TC_ACTIVE_PAGING` walking more than one page,
 *   `loadMoreActive`) is not exercised — every fixture here fits on page 1.
 */
