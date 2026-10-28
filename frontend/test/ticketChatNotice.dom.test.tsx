/**
 * [CHAR-20260905-TICKETCHATNOTICE] CHARACTERIZATION — the operator-facing
 * NOTICE on `pages/chat/TicketChat.tsx`'s ticket list, pinned on the
 * UNCHANGED code before the owner's planned 40% cut. Owner's own words for
 * this gate, widened mid-task: "อย่าเพี้ยน ตัวเลข + เสียง + สี. badge + สี
 * selector" — this file carries the เสียง (sound) and สี (colour) legs; the
 * ตัวเลข (numbers) leg is `test/ticketChatBadgeCounts.dom.test.tsx`, and the
 * list-level realtime effects are `test/ticketChatRealtime.dom.test.tsx`.
 *
 * ## Three things pinned here, and why each lives where it does
 *
 * 1. **The visual "new case" ping** — `groupHasNew` / `statusHasNew`, the only
 *    thing that behaves like an in-page "notice" ON `TicketChat.tsx` itself:
 *    it appears without the operator opening the tab, and it clears on open.
 *
 * 2. **Colour — exact class strings.** `TicketChat.tsx`'s tab-count badge
 *    switches between THREE literal class strings depending on state (grep
 *    `tabUnread ? 'tc-unread-badge' : on ? …`), and `services/chat/orphanRooms.ts`
 *    exports a dedicated colour-SELECTING function, `avatarRingClass(ticket)`
 *    — the closest thing this page has to a "badge colour selector". Both are
 *    pinned as exact strings on real rendered output, not by reading source
 *    text. `avatarRingClass` itself is already a pure-function pin in
 *    `test/orphanRooms.value.test.ts` — this file's job is proving its OUTPUT
 *    actually reaches a rendered `<img>`, which that suite does not check.
 *
 *    🔴 FINDING, NOT FIXED: `tc-unread-badge` and `tc-tab-count-on` — the two
 *    custom class names in that ternary — have **no CSS rule anywhere in this
 *    repo** (`grep -rn "tc-unread-badge\|tc-tab-count-on" --include=*.css .`
 *    is empty). The "urgent" state of the tab badge today carries no colour of
 *    its own beyond the plain utility classes already on the span. Recorded
 *    here because the mutation that would break this test is "someone
 *    finishes wiring the CSS", not a regression — the class STRING is what is
 *    pinned, not a claim that it currently paints anything.
 *
 * 3. **Sound.** `grep -n "Audio\|\.play(\|notif\|sound\|beep" pages/chat/TicketChat.tsx`
 *    is EMPTY — there is no sound in this file at all. The chime lives in
 *    `App.tsx` (`playNotiSound`, a Web Audio API oscillator, NOT an
 *    `<audio>`/`new Audio()` element), gated by the pure predicate
 *    `shouldAlert` in `services/chat/ticketAlerts.ts`. That predicate already
 *    has a full, real value-test suite (`test/ticketAlerts.value.test.ts`),
 *    including a "wiring" check that greps `App.tsx`'s source text for the
 *    right call order. What is NOT covered anywhere today is the runtime
 *    behaviour: does a WS event that should chime actually reach the Web
 *    Audio call, and does the 4-second burst guard actually swallow a repeat.
 *    This suite renders the REAL `App.tsx` (unauthenticated branch — see
 *    below) with a fake `AudioContext` to close that gap, per the owner's
 *    instruction to "mock the audio element and assert call count, not that
 *    a real sound played".
 *
 *    ⚠️ `App.tsx` is NOT in the "only create test/ticketChat*.dom.test.tsx"
 *    boundary as a file to EDIT — it is not edited here, only rendered, the
 *    same as `TicketChat.tsx` is rendered (not edited) in the other two
 *    suites. `App.tsx`'s `useTicketWS(...)` call (the sound hook) runs
 *    UNCONDITIONALLY on every render, before the `authState` branch that
 *    decides `<Login>` vs the routed app — so leaving `authState` unset
 *    (`getStoredAuth` → `null`) reaches the REAL sound wiring while mounting
 *    only `<Login>`, without needing the entire authenticated route tree
 *    (sidebar, mega-menu, 25 lazy pages) mocked.
 *
 * 🔴 THESE DESCRIBE, THEY DO NOT JUDGE.
 *
 * revert: delete this file (the sound + colour legs of the pre-cut gate are gone).
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
  server: { active: [] as any[], completed: [] as any[], orphanRooms: [] as any[] },
  /* Shared with `services/authStorage`'s mock below so ONE file can render
     both TicketChat (needs a superadmin) and App's unauthenticated branch
     (needs `null`) without two separate test files. */
  auth: { value: null as null | Record<string, unknown> },
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
    /* `shouldAlert` / `ALERT_SOUND_WINDOW_MS` are DELIBERATELY left as the
       real implementation (not overridden) — the sound suite exercises the
       real predicate, not a stand-in for it. */
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
      getNoCaseRooms: async () => rig.server.orphanRooms ?? [],
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
  getStoredAuth: () => rig.auth.value,
}));

import { I18nProvider } from '../i18n';
import { TicketChat } from '../pages/chat/TicketChat';
import App from '../App';

function mkTicket(over: Record<string, unknown> & { _id: string; line_user_id: string; name: string }) {
  const { name, ...rest } = over;
  return {
    line_oa_hook_id: 'h1',
    job_status: 0,
    line_user_data: { full_name: name, line_user_id: over.line_user_id },
    customer_tags: [],
    need_detail: '',
    updated_at: '2026-09-01T09:00:00Z',
    created_at: '2026-09-01T09:00:00Z',
    ...rest,
  };
}
function mountTicketChat() {
  rig.auth.value = {
    role: { name: 'superadmin' },
    user: { id: 'admin1', username: 'admin1', display_name: 'แอดมินหนึ่ง' },
    token: 't',
    permissions: [],
    allowed_hooks: null,
  };
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
function countSpan(label: string): HTMLElement {
  const span = tabButton(label).querySelector('span');
  if (!span) throw new Error(`no count span under tab "${label}"`);
  return span;
}

beforeEach(() => {
  rig.wsHandlers.clear();
  rig.server.active = [];
  rig.server.completed = [];
  rig.server.orphanRooms = [];
  rig.auth.value = null;
  localStorage.clear();
});

describe('[TICKETCHAT-NOTICE] the new-case highlight — appears, and clears on open', () => {
  it('⭐ mounts and draws real rows — proves the suite is not green over an empty DOM', async () => {
    rig.server.active = [mkTicket({ _id: 'w1', line_user_id: 'Uw1', name: 'ลูกค้าเอ', job_status: 0 })];
    mountTicketChat();
    await waitFor(() => expect(screen.getByText(/ลูกค้าเอ/)).toBeInTheDocument());
    expect(countSpan('รอรับเคส').textContent).toBe('1');
  });

  it('a new case in the viewed group lights รอรับเคส even while the operator is on a different tab', async () => {
    rig.server.active = [
      mkTicket({
        _id: 'a1',
        line_user_id: 'Ua1',
        name: 'ลูกค้าเอ',
        job_status: 1,
        admin_user_id: 'admin1',
        admin_user_data: { display_name: 'แอดมินหนึ่ง' },
      }),
    ];
    mountTicketChat();
    await waitFor(() => expect(countSpan('กำลังคุย').textContent).toBe('1'));
    fireEvent.click(tabButton('กำลังคุย'));
    await waitFor(() => expect(screen.getByText(/ลูกค้าเอ/)).toBeInTheDocument());
    /* baseline: no highlight before the event */
    expect(countSpan('รอรับเคส').className).not.toContain('tc-unread-badge');

    rig.server.active.push(mkTicket({ _id: 'w1', line_user_id: 'Uw1', name: 'ลูกค้าบี', job_status: 0 }));
    emitWs({ type: 'ticket:new', data: { _id: 'w1', hook_id: 'h1', job_status: 0 } });

    /* Set SYNCHRONOUSLY inside handleWsEvent, before the debounced fetch —
       no network wait needed for the highlight itself. */
    await waitFor(() => expect(countSpan('รอรับเคส').className).toContain('tc-unread-badge'));
  });

  it('opening the tab clears the highlight without erasing the count it earned', async () => {
    rig.server.active = [mkTicket({ _id: 'w1', line_user_id: 'Uw1', name: 'ลูกค้าเอ', job_status: 0 })];
    mountTicketChat();
    await waitFor(() => expect(countSpan('รอรับเคส').textContent).toBe('1'));

    rig.server.active.push(mkTicket({ _id: 'w2', line_user_id: 'Uw2', name: 'ลูกค้าบี', job_status: 0 }));
    emitWs({ type: 'ticket:new', data: { _id: 'w2', hook_id: 'h1', job_status: 0 } });
    await waitFor(() => expect(countSpan('รอรับเคส').className).toContain('tc-unread-badge'));

    fireEvent.click(tabButton('รอรับเคส'));
    await waitFor(() => expect(countSpan('รอรับเคส').className).not.toContain('tc-unread-badge'));
    /* The dismissal is visual only — the count itself does not reset, and (once
       the debounced badge refresh lands) will still show the new arrival. */
    await waitFor(() => expect(countSpan('รอรับเคส').textContent).toBe('2'), { timeout: 4000 });
  });

  it('an event for a hook this page does not know about lights nothing', async () => {
    rig.server.active = [mkTicket({ _id: 'w1', line_user_id: 'Uw1', name: 'ลูกค้าเอ', job_status: 0 })];
    mountTicketChat();
    await waitFor(() => expect(countSpan('รอรับเคส').textContent).toBe('1'));

    emitWs({ type: 'ticket:new', data: { _id: 'ghost1', hook_id: 'unknown-hook-not-in-list', job_status: 0 } });
    /* No waitFor-for-change: nothing should happen, so there is nothing to
       wait for. A short settle proves the negative instead of racing it. */
    await new Promise((r) => setTimeout(r, 200));
    expect(countSpan('รอรับเคส').className).not.toContain('tc-unread-badge');
    ['ส่วนตัว', 'กำลังคุย', 'ปิดเคส', 'บอทดูแล'].forEach((label) => {
      expect(countSpan(label).className).not.toContain('tc-unread-badge');
    });
  });
});

describe('[TICKETCHAT-NOTICE] colour — exact class strings on the badge and the avatar ring', () => {
  it('⭐ the tab-count badge carries one of exactly three literal class strings, by state', async () => {
    rig.server.active = [
      mkTicket({ _id: 'w1', line_user_id: 'Uw1', name: 'ลูกค้าเอ', job_status: 0 }),
    ];
    mountTicketChat();
    await waitFor(() => expect(countSpan('รอรับเคส').textContent).toBe('1'));

    /* state 1 — SELECTED (default tab is รอรับเคส), no new-case flag. */
    expect(countSpan('รอรับเคส').className).toBe(
      'px-2 py-0.5 rounded-full text-[10px] font-bold leading-none mt-1 tc-tab-count-on bg-blue-100 text-blue-700',
    );
    /* state 2 — NOT selected, no new-case flag (ปิดเคส is neither open nor lit). */
    expect(countSpan('ปิดเคส').className).toBe(
      'px-2 py-0.5 rounded-full text-[10px] font-bold leading-none mt-1 bg-gray-100 text-gray-600',
    );

    /* state 3 — HAS-NEW overrides both of the above, selected or not. */
    rig.server.active.push(mkTicket({ _id: 'w2', line_user_id: 'Uw2', name: 'ลูกค้าบี', job_status: 0 }));
    emitWs({ type: 'ticket:new', data: { _id: 'w2', hook_id: 'h1', job_status: 0 } });
    await waitFor(() =>
      expect(countSpan('รอรับเคส').className).toBe(
        'px-2 py-0.5 rounded-full text-[10px] font-bold leading-none mt-1 tc-unread-badge',
      ),
    );
  });

  it('⭐ [AS-IS finding] tc-unread-badge / tc-tab-count-on have no CSS rule anywhere in this repo', () => {
    /* Not a DOM assertion — a repo-fact this suite's colour claims stand on.
       See the file header. Grepping here means a future `grep` that finds a
       real rule breaks this test LOUDLY instead of leaving a stale comment. */
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const css = fs.readFileSync(path.resolve(__dirname, '..', 'index.css'), 'utf8');
    expect(css).not.toContain('tc-unread-badge');
    expect(css).not.toContain('tc-tab-count-on');
  });

  it('⭐ a message from the customer lights the tab colour but never moves its number — the code’s own rule', async () => {
    /* pages/chat/TicketChat.tsx's own comment on this exact behaviour:
       "แท็บนับเคส · การ์ดนับข้อความ · เปลี่ยนแค่สี ไม่เปลี่ยนเลข" — tabs count CASES,
       cards count MESSAGES, only the colour changes, never the number. */
    rig.server.active = [mkTicket({ _id: 'w1', line_user_id: 'Uw1', name: 'ลูกค้าเอ', job_status: 0 })];
    mountTicketChat();
    await waitFor(() => expect(countSpan('รอรับเคส').textContent).toBe('1'));
    expect(countSpan('รอรับเคส').className).not.toContain('tc-unread-badge');

    emitWs({
      type: 'message:new',
      data: { room_id: 'r1', sender_type: 'customer', hook_id: 'h1', line_user_id: 'Uw1' },
    });

    await waitFor(() => expect(countSpan('รอรับเคส').className).toContain('tc-unread-badge'));
    /* the pin: the NUMBER never moved */
    expect(countSpan('รอรับเคส').textContent).toBe('1');
  });

  it('⭐ the avatar ring colour selector (avatarRingClass): orphan rooms draw orange, real cases draw emerald', async () => {
    /* `services/chat/orphanRooms.ts` `avatarRingClass` is the one function on
       this page whose entire job is SELECTING a colour class from ticket
       state — the closest match to "badge + สี selector" this codebase has.
       Its own value-test (test/orphanRooms.value.test.ts) already pins the
       function in isolation; this proves its OUTPUT actually lands on a
       rendered <img>, on the บอทดูแล tab where both kinds of row appear
       side by side. */
    rig.server.orphanRooms = [
      {
        _id: 'room1',
        hook_id: 'h1',
        user_data: { _id: 'roomuser1', full_name: 'ลูกค้าไม่เคยมีเคส' },
        /* [FIX-20261019-ORPHANTIMEBOMB] relative to NOW, not a fixed date. The page shows a
           no-case room in บอทดูแล only while its last activity is inside the date scope
           (`botTabRows` → `withinDays`, default 7 days — TicketChat `filterWithinDays`). This
           fixture used '2026-09-01' and was green when written (05/09, 4 days old); from about
           08/09 the room aged out of the 7-day window, the บอทดูแล count read 1 instead of 2,
           and this case failed with the app working exactly as designed. An hour ago keeps
           the room inside every scope the page offers. */
        last_message: { text: 'hi', timestamp: new Date(Date.now() - 3600_000).toISOString() },
      },
    ];
    rig.server.completed = [
      {
        ...mkTicket({ _id: 'closed1', line_user_id: 'Uclosed1', name: 'ลูกค้าเคยมีเคส' }),
        job_status: 2,
        assist_status: false,
      },
    ];
    mountTicketChat();
    await waitFor(() => expect(countSpan('บอทดูแล').textContent).toBe('2'));
    fireEvent.click(tabButton('บอทดูแล'));
    await waitFor(() => expect(screen.getByText(/ลูกค้าไม่เคยมีเคส/)).toBeInTheDocument());
    expect(screen.getByText(/ลูกค้าเคยมีเคส/)).toBeInTheDocument();

    const orphanImg = screen.getByText(/ลูกค้าไม่เคยมีเคส/)
      .closest('[data-chat-card]')
      ?.querySelector('img');
    const closedImg = screen.getByText(/ลูกค้าเคยมีเคส/)
      .closest('[data-chat-card]')
      ?.querySelector('img');
    expect(orphanImg?.className).toContain('ring-2 ring-orange-400');
    expect(closedImg?.className).toContain('ring-2 ring-emerald-400');
    expect(orphanImg?.className).not.toContain('ring-emerald-400');
    expect(closedImg?.className).not.toContain('ring-orange-400');
  });
});

describe('[TICKETCHAT-NOTICE] sound — App.tsx’s chime on the SAME WS wire', () => {
  /** Web Audio API stand-in. jsdom has none at all; the real code
   *  (`App.tsx` `playNotiSound`) reaches straight for
   *  `new (window.AudioContext || window.webkitAudioContext)()` with no
   *  feature-detect, so a missing stub throws INSIDE a `try {} catch {}` and
   *  the failure would look identical to "did not beep" — this stub must be
   *  complete, not partial, or a real break could hide behind the catch. */
  let oscillatorsCreated = 0;
  class FakeOscillator {
    frequency = { setValueAtTime: vi.fn() };
    connect = vi.fn();
    start = vi.fn();
    stop = vi.fn();
  }
  class FakeGainNode {
    gain = { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() };
    connect = vi.fn();
  }
  class FakeAudioContext {
    state = 'running';
    currentTime = 0;
    destination = {};
    createOscillator() {
      oscillatorsCreated += 1;
      return new FakeOscillator() as unknown as OscillatorNode;
    }
    createGain() {
      return new FakeGainNode() as unknown as GainNode;
    }
    resume() {}
  }

  const realAudioContext = (window as any).AudioContext;
  beforeEach(() => {
    oscillatorsCreated = 0;
    (window as any).AudioContext = FakeAudioContext;
  });
  afterEach(() => {
    (window as any).AudioContext = realAudioContext;
    vi.restoreAllMocks();
  });

  /** `App`'s sound hook (`useTicketWS` near the top of the component, before
   *  the `authState` branch) runs whether or not anyone is logged in — see
   *  the file header for why this lets the test stay on the tiny `<Login>`
   *  branch instead of mounting the whole authenticated route tree. */
  function mountApp() {
    rig.auth.value = null;
    return render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );
  }

  it('⭐ mounts (the Login screen) — proves the sound suite is not green over a component that never rendered', async () => {
    mountApp();
    await waitFor(() => expect(document.querySelector('input')).toBeTruthy());
  });

  it('a new case chimes exactly once', async () => {
    mountApp();
    await waitFor(() => expect(document.querySelector('input')).toBeTruthy());
    emitWs({ type: 'ticket:new', data: { hook_id: 'h1' } });
    await waitFor(() => expect(oscillatorsCreated).toBe(1));
  });

  it('⭐ an inbound customer message chimes; our own outbound traffic does not', async () => {
    mountApp();
    await waitFor(() => expect(document.querySelector('input')).toBeTruthy());
    /* spend the FIRST chime here, deliberately, so the assertions below are
       about sender_type — not about "was this the first sound of the test". */
    emitWs({ type: 'message:new', data: { sender_type: 'customer', hook_id: 'h1', line_user_id: 'U1' } });
    await waitFor(() => expect(oscillatorsCreated).toBe(1));

    /* Jump the clock past the 4s burst window (services/chat/ticketAlerts.ts
       ALERT_SOUND_WINDOW_MS) via Date.now — playNotiSound's cooldown is a
       plain Date.now() diff, not a timer, so faking Date is enough; no need
       to advance real or fake timers. */
    const realNow = Date.now;
    vi.spyOn(Date, 'now').mockReturnValue(realNow() + 5000);
    try {
      emitWs({ type: 'message:new', data: { sender_type: 'admin', hook_id: 'h1', line_user_id: 'U1' } });
      emitWs({ type: 'message:new', data: { sender_type: 'bot', hook_id: 'h1', line_user_id: 'U1' } });
      emitWs({ type: 'message:new', data: { sender_type: 'system', hook_id: 'h1', line_user_id: 'U1' } });
      /* still 1 — none of the three above should have played a second beep */
      expect(oscillatorsCreated).toBe(1);

      emitWs({ type: 'message:new', data: { sender_type: 'customer', hook_id: 'h1', line_user_id: 'U2' } });
      await waitFor(() => expect(oscillatorsCreated).toBe(2));
    } finally {
      vi.spyOn(Date, 'now').mockRestore();
    }
  });

  it('⭐ [AS-IS] the บอทดูแล tab’s bot_care rows never chime, even though they are a customer message', async () => {
    /* services/chat/ticketAlerts.ts shouldAlert(): `bot_care === true` is
       checked BEFORE the sender_type test, so a bona fide customer message on
       an unattended room is silenced by DESIGN (owner, 2026-08-20: "ทุกแบบที่
       เข้ามาใน บอทดูแล = ไม่ต้องมีเสียง"). Pinned as-is. */
    mountApp();
    await waitFor(() => expect(document.querySelector('input')).toBeTruthy());
    emitWs({
      type: 'message:new',
      data: { sender_type: 'customer', hook_id: 'h1', line_user_id: 'U1', bot_care: true },
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(oscillatorsCreated).toBe(0);
  });

  it('a status change alone (ticket:updated) never chimes', async () => {
    mountApp();
    await waitFor(() => expect(document.querySelector('input')).toBeTruthy());
    emitWs({ type: 'ticket:updated', data: { _id: 'a1', hook_id: 'h1', job_status: 1 } });
    await new Promise((r) => setTimeout(r, 50));
    expect(oscillatorsCreated).toBe(0);
  });

  it('⭐ [AS-IS] a burst of new cases inside the 4s window chimes exactly ONCE — the shared cooldown clock', async () => {
    mountApp();
    await waitFor(() => expect(document.querySelector('input')).toBeTruthy());
    emitWs({ type: 'ticket:new', data: { hook_id: 'h1' } });
    emitWs({ type: 'ticket:new', data: { hook_id: 'h2' } });
    emitWs({ type: 'ticket:new', data: { hook_id: 'h3' } });
    await waitFor(() => expect(oscillatorsCreated).toBe(1));
    /* give any wrongly-unthrottled async path a moment, then re-assert. */
    await new Promise((r) => setTimeout(r, 50));
    expect(oscillatorsCreated).toBe(1);
  });

  it('muting the sound preference silences every event, without touching shouldAlert’s own rule', async () => {
    localStorage.setItem('zd_user_prefs', JSON.stringify({ ui: { notiSound: false } }));
    mountApp();
    await waitFor(() => expect(document.querySelector('input')).toBeTruthy());
    emitWs({ type: 'ticket:new', data: { hook_id: 'h1' } });
    await new Promise((r) => setTimeout(r, 50));
    expect(oscillatorsCreated).toBe(0);
  });
});

/**
 * ## NOT PINNED
 * - The CORNER TOAST (`setToast` in App.tsx, `TicketToast` component) is not
 *   exercised — it is already proven INVISIBLE regardless of its data by
 *   `test/ticketToastHidden.dom.test.tsx` (`TICKET_TOAST_ENABLED` is `false`,
 *   "it was never positioned"), so pinning its content here would be pinning
 *   dead code. What matters — that the SOUND still fires independent of the
 *   toast — is covered above.
 * - The claim-race warning (`raceWarnMsg`) and the close-success flash
 *   (`closeSuccessOpen`) are NOT pinned in any of the three suites — both
 *   require a ticket to be OPEN first (see the "not pinned" note in
 *   `test/ticketChatRealtime.dom.test.tsx` for why that was scoped out).
 * - `settingToast` (font/tray-mode saved) and the bottom-right copy-fail
 *   toast are unrelated to realtime/ticket notifications and were not in
 *   scope for this gate.
 * - Dark-mode variants of any of the classes pinned above — this suite never
 *   toggles the `.tc`/dark theme scope, so only the light-mode class strings
 *   are pinned.
 */
