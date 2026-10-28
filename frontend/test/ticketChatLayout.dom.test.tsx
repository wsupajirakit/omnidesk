/**
 * [REFACTOR-20261027-TCSPLIT] CHARACTERIZATION — the whole TicketChat screen as DOM.
 *
 * Pinned on the UNCHANGED page (`ckpt-before-ticketchat-split-demo-27102026`) before
 * its markup is split into `pages/chat/ticket-chat/`. Every snapshot here must stay
 * byte-identical through that split: the move is filing, not a redesign (dev-local §6.3).
 *
 * What it covers — every region that moves:
 *   top bar (normal + ticket-only portals) · gear-slot portal · date-scope popover ·
 *   filters · every status tab · both card kinds · open case (center + right column,
 *   both right tabs, collapse) · accept / claim / font / tray / quick-reply dialogs ·
 *   tag-info modal · assign-history modal · pin + unpin confirm.
 *
 * How: the same rig as test/ticketChatRealtime.dom.test.tsx (service boundary mocked,
 * WS fan-out faked). The heavy children that do NOT move (ChatRoomView, ChatInputBox,
 * ProfileHeader, PersonalPanel, OperationsPanel, QuickReplyManager) are stubs that
 * print every prop they receive — so a prop wired to the wrong variable during the
 * split turns a snapshot red even though the stubbed child renders nothing real.
 * Each function prop becomes a button, which is how this suite opens the dialogs.
 *
 * NOT covered here (owned elsewhere, and not moved): realtime / badge counts / notices
 * (ticketChatRealtime · ticketChatBadgeCounts · ticketChatNotice), the close-case
 * dialog (stays in the page).
 * revert: delete this file and its snapshot.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent, cleanup, within } from '@testing-library/react';

/* card / history times are printed in local time — pin the zone so the snapshot means the
   same thing on every machine (restored after the file, see afterAll) */
const ORIGINAL_TZ = process.env.TZ;
process.env.TZ = 'Asia/Bangkok';
afterAll(() => { process.env.TZ = ORIGINAL_TZ; });

// whole-screen mounts under a loaded parallel run: the 5s default is too tight (see `settle`)
vi.setConfig({ testTimeout: 30_000 });

if (!('ResizeObserver' in globalThis)) {
  (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}
if (!window.matchMedia) {
  (window as any).matchMedia = () => ({
    matches: false, media: '', onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    dispatchEvent: () => false,
  });
}

const rig = vi.hoisted(() => {
  /* a prop as text: ids for rows, sizes for lists, keys for other objects */
  const shown = (v: unknown): string => {
    if (v === null || v === undefined || typeof v !== 'object') return String(v);
    if (Array.isArray(v)) return `[${v.length}]`;
    const o = v as Record<string, unknown>;
    return '_id' in o ? `#${String(o._id)}` : `{${Object.keys(o).sort().join(',')}}`;
  };
  return {
    wsHandlers: new Set<{ current: (e: { type: string; data: Record<string, unknown> }) => void }>(),
    server: { active: [] as any[], completed: [] as any[] },
    histories: [] as any[],
    /* group id → meta row the batch answers with (default: none = every group count 0) */
    metas: {} as Record<string, { waiting: number }>,
    compact: false,
    /* jsdom lays nothing out (every width 0), so the group slider never draws its tabs.
       A scenario sets these to give the strip a real width; 0 = jsdom as-is. */
    layout: { client: 0, offset: 0 },
    prefs: null as null | Record<string, unknown>,
    /* arguments a stub button passes to its prop (default: none) */
    callArgs: {} as Record<string, unknown[]>,
    stub: (R: typeof import('react'), name: string) => (props: Record<string, unknown>) => {
      const keys = Object.keys(props).filter((k) => k !== 'children').sort();
      const values = keys.filter((k) => typeof props[k] !== 'function').map((k) => `${k}=${shown(props[k])}`);
      return R.createElement('div', { 'data-stub': name, 'data-props': values.join(' | ') },
        keys.filter((k) => typeof props[k] === 'function').map((k) =>
          R.createElement('button', {
            key: k, type: 'button', 'data-call': `${name}.${k}`,
            // async wrapper: a prop that rejects (the translate chip does, by design) must not
            // surface as an unhandled rejection — the call itself still happens synchronously
            onClick: () => { (async () => (props[k] as (...a: unknown[]) => unknown)(...(rig.callArgs[`${name}.${k}`] ?? [])))().catch(() => {}); },
          }, k)));
    },
  };
});

vi.mock('../services/chat', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../services/chat');
  const React = await import('react');
  const listBy = async (_scopeId: string, params: Record<string, unknown>) => {
    if (params?.job_status === 2) {
      return { success: true, data: rig.server.completed, pagination: { total: rig.server.completed.length, has_more: false } };
    }
    if (Array.isArray((params as any)?.ids)) {
      const ids = new Set(((params as any).ids as unknown[]).map(String));
      return { success: true, data: rig.server.active.filter((r) => ids.has(String(r._id))) };
    }
    const n = (f: (r: any) => boolean) => rig.server.active.filter(f).length;
    return {
      success: true,
      data: rig.server.active,
      tab_counts: {
        mine: n((r) => Number(r.job_status) === 1 && r.admin_user_id === 'admin1'),
        waiting: n((r) => Number(r.job_status) === 0),
        active: n((r) => Number(r.job_status) === 1),
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
        return () => { rig.wsHandlers.delete(wrapper); };
      }, []);
    },
    ticketService: {
      ...(actual as any).ticketService,
      listTicketsByGroup: listBy,
      listTicketsByHook: listBy,
      getNoCaseRooms: async () => [],
      getTicketMetaBatchRaw: async () => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ metas: rig.metas }) }),
      getTicketMetaByGroup: async () => ({ waiting: 0 }),
      updateTicketMinimal: async () => ({ success: true }),
      patchDetail: async () => ({ success: true }),
      patchNickname: async () => ({ success: true }),
    },
    chatService: {
      ...(actual as any).chatService,
      listRooms: async () => [],
      popularTags: async () => ({ data: [] }),
      updateAssistStatus: async () => ({ success: true }),
    },
    assignHistoryService: {
      createAssignHistory: async () => ({ success: true }),
      getAssignHistories: async () => ({ data: rig.histories }),
    },
    dictLookup: (s: string) => s,
    loadTranslationDict: () => Promise.resolve(),
    subscribeDict: () => () => {},
  };
});

vi.mock('../services/hook', () => ({
  webhookService: {
    getAllHooks: async () => [
      { _id: 'h1', line_oa_name: 'OA หนึ่ง', group: 'g1' },
      { _id: 'h2', line_oa_name: 'OA สอง', group: 'g2' },
    ],
  },
}));

vi.mock('../services/admin', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../services/admin');
  return {
    ...actual,
    groupService: { listGroups: async () => ({ data: [{ _id: 'g1', group_name: 'Group One' }, { _id: 'g2', group_name: 'Group Two' }] }) },
    userService: { listUsersForAssign: async () => ({ data: [] }) },
    configService: { listConfigs: async () => ({ data: [] }) },
  };
});

vi.mock('../services/authStorage', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('../services/authStorage')),
  getStoredAuth: () => ({
    role: { name: 'superadmin' },
    user: { id: 'admin1', username: 'admin1', display_name: 'แอดมินหนึ่ง', ...(rig.prefs ? { preferences: rig.prefs } : {}) },
    token: 't',
    permissions: [],
    allowed_hooks: null,
  }),
}));

vi.mock('../services/chat/aiTranslateService', async () => {
  const actual = await vi.importActual<Record<string, any>>('../services/chat/aiTranslateService');
  return {
    ...actual,
    aiTranslateService: { ...actual.aiTranslateService, translateMessage: async () => { throw new Error('เหลือสิทธิ์แปล 0 ครั้ง'); } },
  };
});

vi.mock('../hooks/topBarMode', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../hooks/topBarMode');
  return { ...actual, isCompactTopBar: () => rig.compact };
});

vi.mock('../components/chat', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../components/chat');
  const React = await import('react');
  return { ...actual, ChatRoomView: rig.stub(React, 'ChatRoomView'), QuickReplyManager: rig.stub(React, 'QuickReplyManager') };
});
vi.mock('../components/chat/chat-input', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../components/chat/chat-input');
  const React = await import('react');
  return { ...actual, ChatInputBox: rig.stub(React, 'ChatInputBox') };
});
vi.mock('../components/chat/ticket-detail', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../components/chat/ticket-detail');
  const React = await import('react');
  return {
    ...actual,
    ProfileHeader: rig.stub(React, 'ProfileHeader'),
    PersonalPanel: rig.stub(React, 'PersonalPanel'),
    OperationsPanel: rig.stub(React, 'OperationsPanel'),
  };
});

for (const prop of ['clientWidth', 'offsetWidth'] as const) {
  Object.defineProperty(HTMLElement.prototype, prop, {
    configurable: true,
    get() { return prop === 'clientWidth' ? rig.layout.client : rig.layout.offset; },
  });
}

import { I18nProvider } from '../i18n';
import { TicketChat } from '../pages/chat/TicketChat';
import { ACTIVE, COMPLETED } from './ticket-chat-layout/fixtures';
import { call, card, closeTopDialog, settle, shot, tab } from './ticket-chat-layout/screen';

/* every live useTicketWS subscriber gets the event — the real module's emit() */
const emitWs = (event: { type: string; data: Record<string, unknown> }) =>
  act(() => { Array.from(rig.wsHandlers).forEach((h) => h.current(event)); });
async function mount() {
  render(<I18nProvider><TicketChat /></I18nProvider>);
  await waitFor(() => expect(screen.getByText(/ลูกค้าเอ/)).toBeInTheDocument(), { timeout: 10_000 });
  await settle();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-02T10:00:00Z'));
  rig.wsHandlers.clear();
  rig.server.active = ACTIVE();
  rig.server.completed = COMPLETED();
  rig.histories = [];
  rig.metas = {};
  rig.compact = false;
  rig.layout = { client: 0, offset: 0 };
  rig.prefs = null;
  rig.callArgs = {};
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('[TC-LAYOUT] the TicketChat screen, region by region', () => {
  it('list: top bar, filters and every status tab', async () => {
    const gear = document.body.appendChild(document.createElement('div'));
    gear.id = 'tc-gear-slot';
    await mount();
    expect(shot()).toMatchSnapshot('waiting tab + gear portal');
    for (const label of ['ส่วนตัว', 'กำลังคุย', 'บอทดูแล', 'ปิดเคส']) {
      fireEvent.click(tab(label));
      if (label === 'ปิดเคส') await waitFor(() => expect(screen.getAllByText(/ลูกค้าอี/).length).toBeGreaterThan(0), { timeout: 10_000 });
      await settle();
      expect(shot()).toMatchSnapshot(`tab ${label}`);
    }
  });

  it('popovers and page dialogs reachable from the list', async () => {
    const gear = document.body.appendChild(document.createElement('div'));
    gear.id = 'tc-gear-slot';
    await mount();
    fireEvent.click(screen.getAllByLabelText(/ช่วงเวลา/)[0]);
    expect(shot()).toMatchSnapshot('date-scope popover');
    fireEvent.click(screen.getAllByLabelText(/ช่วงเวลา/)[0]);
    fireEvent.click(screen.getByTitle('เปิด ตั้งค่าอื่นๆ'));
    fireEvent.click(screen.getByText(/จัดการ Quick Reply/));
    await settle();
    expect(shot()).toMatchSnapshot('quick reply modal');
  });

  it('tag info, pin and unpin from a card', async () => {
    await mount();
    fireEvent.click(within(card('ลูกค้าเอ')).getByText('+1'));
    await settle();
    expect(shot()).toMatchSnapshot('tag info modal');
    closeTopDialog();
    const pinOf = () => within(card('ลูกค้าเอ')).getByRole('button', { pressed: false });
    fireEvent.click(pinOf());
    await settle();
    expect(shot()).toMatchSnapshot('pinned');
    fireEvent.click(within(card('ลูกค้าเอ')).getByRole('button', { pressed: true }));
    await settle();
    expect(shot()).toMatchSnapshot('unpin confirm');
  });

  it('open a waiting case: center, right column, its dialogs', async () => {
    await mount();
    fireEvent.click(card('ลูกค้าเอ'));
    await settle();
    expect(shot()).toMatchSnapshot('waiting case open');
    fireEvent.click(screen.getByText('ดำเนินการ'));
    await settle();
    expect(shot()).toMatchSnapshot('operations tab');
    call('ChatInputBox.onAccept');
    await settle();
    expect(shot()).toMatchSnapshot('accept while busy → busy-case warning');
    closeTopDialog();
    call('ChatRoomView.onOpenFontScale');
    await settle();
    expect(shot()).toMatchSnapshot('font scale modal');
  });

  it('open my case, then another admin’s case, then collapse the right column', async () => {
    await mount();
    fireEvent.click(tab('ส่วนตัว'));
    fireEvent.click(card('ลูกค้าซี'));
    await settle();
    expect(shot()).toMatchSnapshot('my case open');
    call('ChatInputBox.onOpenTraySettings');
    await settle();
    expect(shot()).toMatchSnapshot('tray mode modal');
    fireEvent.click(tab('กำลังคุย'));
    fireEvent.click(card('ลูกค้าดี'));
    await settle();
    call('ChatInputBox.onClaim');
    await settle();
    expect(shot()).toMatchSnapshot('claim confirm');
    closeTopDialog();
    fireEvent.click(screen.getAllByLabelText(/ย่อ|Collapse/)[0]);
    await settle();
    expect(shot()).toMatchSnapshot('right column collapsed');
  });

  it('closed tab: open a closed case and its assign history', async () => {
    rig.histories = [
      { _id: 'ah1', action: 'assign', admin_user_data: { display_name: 'แอดมินหนึ่ง' }, created_at: '2026-08-30T09:00:00Z' },
      { _id: 'ah2', action: 'close', admin_user_data: { display_name: 'แอดมินหนึ่ง' }, created_at: '2026-08-30T10:00:00Z' },
    ];
    await mount();
    fireEvent.click(tab('ปิดเคส'));
    await waitFor(() => expect(screen.getAllByText(/ลูกค้าอี/).length).toBeGreaterThan(0), { timeout: 10_000 });
    await settle();
    fireEvent.click(screen.getAllByText('ดูแชท')[0]);
    await settle();
    expect(shot()).toMatchSnapshot('closed case open');
    fireEvent.click(screen.getAllByText('ประวัติการดำเนินงาน')[0]);
    await waitFor(() => expect(document.querySelector('.z-\\[999\\]')).not.toBeNull(), { timeout: 10_000 });
    await settle();
    expect(shot()).toMatchSnapshot('assign history modal');
    fireEvent.click(screen.getByTitle(/เปิด\/ปิดแสดงข้อมูลลูกค้า/));
    fireEvent.click(screen.getByTitle(/MongoDB Ticket Record ID/));
    await settle();
    expect(shot()).toMatchSnapshot('assign history modal: customer rows + record id');
  });

  it('group slider: every tab inline, then too narrow → one tab + the overflow select', async () => {
    rig.layout = { client: 1000, offset: 100 };
    await mount();
    expect(shot()).toMatchSnapshot('slider: all inline');
    cleanup();
    document.body.innerHTML = '';
    rig.layout = { client: 200, offset: 100 };   // 2 tabs × 106px > 200 ⇒ 1 inline + the select
    rig.prefs = { ui: { favGroups: ['g2'] } };
    await mount();
    expect(shot()).toMatchSnapshot('slider: overflow with a faved group');
  });

  it('group slider: a new case in a hidden group lights the overflow select', async () => {
    rig.layout = { client: 200, offset: 100 };   // 2 tabs × 106px > 200 ⇒ 1 inline + the select
    rig.metas = { g2: { waiting: 1 } };
    await mount();
    emitWs({ type: 'ticket:new', data: { _id: 'n2', hook_id: 'h2', job_status: 0 } });
    await settle();
    expect(shot()).toMatchSnapshot('slider: overflow ring lit');
  });

  it('dialogs behind a click: fav confirm, setting toast, translate failure', async () => {
    rig.layout = { client: 1000, offset: 100 };
    await mount();
    const star = () => document.querySelector('[role="button"] svg.lucide-star')!.closest('[role="button"]') as HTMLElement;
    fireEvent.click(star());
    await settle();
    expect(shot()).toMatchSnapshot('fav confirm');
    closeTopDialog();
    fireEvent.click(tab('ส่วนตัว'));
    fireEvent.click(card('ลูกค้าซี'));
    await settle();
    call('ChatRoomView.onOpenFontScale');
    await settle();
    fireEvent.change(document.querySelector('input[type="range"]')!, { target: { value: '2' } });
    await settle();
    expect(shot()).toMatchSnapshot('font changed → setting toast');
    closeTopDialog();
    rig.callArgs['ChatRoomView.onTranslate'] = [{ id: 'msg1', lang: 'en' }];
    call('ChatRoomView.onTranslate');
    await waitFor(() => expect(screen.getAllByText(/เหลือสิทธิ์แปล 0 ครั้ง/).length).toBeGreaterThan(0), { timeout: 10_000 });
    await settle();
    expect(shot()).toMatchSnapshot('translate failed alert');
  });

  it('dialogs behind a cap: five favourites, twenty pins', async () => {
    rig.prefs = {
      ui: { favGroups: ['x1', 'x2', 'x3', 'x4', 'x5'] },
      pinned_rooms: Array.from({ length: 20 }, (_, i) => `pin-${i}`),
    };
    rig.layout = { client: 1000, offset: 100 };
    await mount();
    fireEvent.click(document.querySelector('[role="button"] svg.lucide-star')!.closest('[role="button"]') as HTMLElement);
    await settle();
    expect(shot()).toMatchSnapshot('fav cap warning');
    closeTopDialog();
    fireEvent.click(within(card('ลูกค้าเอ')).getByRole('button', { pressed: false }));
    await settle();
    expect(shot()).toMatchSnapshot('pin cap alert');
  });

  it('a transfer from the right column patches the open case in the list, at once', async () => {
    /* wiring, not markup: OperationsPanel's onTransferSuccess must reach the page's handler
       (it writes the ticket list). Asserted on the card synchronously — before the refetch
       that handler also fires has had a chance to answer. */
    await mount();
    fireEvent.click(card('ลูกค้าเอ'));
    await settle();
    fireEvent.click(screen.getByText('ดำเนินการ'));
    await settle();
    expect(within(card('ลูกค้าเอ')).queryByText('แอดมินเก้า')).toBeNull();
    rig.callArgs['OperationsPanel.onTransferSuccess'] = [{ id: 'admin9', username: 'a9', display_name: 'แอดมินเก้า' }];
    call('OperationsPanel.onTransferSuccess');
    expect(within(card('ลูกค้าเอ')).getByText('แอดมินเก้า')).toBeInTheDocument();
  });

  it('ticket-only layout: the bar and the status pill portal into the app header', async () => {
    rig.compact = true;
    /* no case of mine here, so this shot carries the "ready" pill (the others carry "busy") */
    rig.server.active = ACTIVE().filter((r) => r._id !== 'mine1');
    for (const id of ['tc-header-oa-slot', 'tc-header-status-slot']) {
      const slot = document.body.appendChild(document.createElement('div'));
      slot.id = id;
    }
    await mount();
    expect(shot()).toMatchSnapshot('ticket-only');
  });
});

