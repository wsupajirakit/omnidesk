/**
 * [FEAT-20261020-TICKETSTACK] Ticket stacking on the REAL page (TicketChat),
 * same rig as test/ticketChatBadgeCounts.dom.test.tsx (service boundary mocked,
 * WS fan-out faked).
 *
 * What must hold (owner, 20/10):
 *   - same customer + same OA ⇒ one stack, front card = newest, count pill = size
 *   - fold / unfold; unfolded shows every older card in full
 *   - the tab numbers do NOT change — stacking is drawing only
 *   - realtime still lands: a new ticket joins its stack and the tab count moves
 *   - flag OFF (the default) ⇒ the list is exactly the old list
 *   - ปิดเคส: split by OA too, and its case list folds
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent, within } from '@testing-library/react';

if (!('ResizeObserver' in globalThis)) {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (!window.matchMedia) {
  (window as any).matchMedia = () => ({
    matches: false, media: '', onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    dispatchEvent: () => false,
  });
}

const rig = vi.hoisted(() => ({
  wsHandlers: new Set<{ current: (e: { type: string; data: Record<string, unknown> }) => void }>(),
  server: { active: [] as any[], completed: [] as any[] },
  prefs: null as null | Record<string, unknown>,
}));

vi.mock('../services/chat', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../services/chat');
  const listBy = async (_scopeId: string, params: Record<string, unknown>) => {
    if (params?.job_status === 2) {
      return { success: true, data: rig.server.completed, pagination: { total: rig.server.completed.length, has_more: false } };
    }
    if (Array.isArray((params as any)?.ids)) {
      const ids = new Set(((params as any).ids as unknown[]).map(String));
      return { success: true, data: rig.server.active.filter((r) => ids.has(String(r._id))) };
    }
    return {
      success: true,
      data: rig.server.active,
      tab_counts: {
        mine: rig.server.active.filter((r) => Number(r.job_status) === 1 && r.admin_user_id === 'admin1').length,
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
        return () => { rig.wsHandlers.delete(wrapper); };
      }, []);
    },
    ticketService: {
      ...(actual as any).ticketService,
      listTicketsByGroup: listBy,
      listTicketsByHook: listBy,
      getNoCaseRooms: async () => [],
      getTicketMetaBatchRaw: async () => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ metas: {} }) }),
      getTicketMetaByGroup: async () => ({ waiting: 0 }),
    },
    chatService: { ...(actual as any).chatService, listRooms: async () => [], popularTags: async () => ({ data: [] }) },
    assignHistoryService: { createAssignHistory: async () => ({ success: true }), getAssignHistories: async () => ({ data: [] }) },
    dictLookup: (s: string) => s,
    loadTranslationDict: () => Promise.resolve(),
    subscribeDict: () => () => {},
  };
});

vi.mock('../services/hook', () => ({
  webhookService: {
    getAllHooks: async () => [
      { _id: 'h1', line_oa_name: 'OA หนึ่ง', group: 'g1' },
      { _id: 'h2', line_oa_name: 'OA สอง', group: 'g1' },
    ],
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
    user: { id: 'admin1', username: 'admin1', display_name: 'แอดมินหนึ่ง', preferences: rig.prefs },
    token: 't', permissions: [], allowed_hooks: null,
  }),
}));

import { I18nProvider } from '../i18n';
import { TicketChat } from '../pages/chat/TicketChat';

/** One row as the list API returns it: `line_user_id` = member _id. */
function row(id: string, member: string, oa: string, openedHour: number, over: Record<string, unknown> = {}) {
  const at = `2026-10-20T${String(openedHour).padStart(2, '0')}:00:00Z`;
  return {
    _id: id,
    line_oa_hook_id: oa,
    line_user_id: member,
    job_status: 0,
    line_user_data: { _id: member, full_name: `ลูกค้า-${member}` },
    customer_tags: [],
    need_detail: `สรุป-${id}`,
    created_at: at,
    updated_at: at,
    ...over,
  };
}

/** mA has 4 waiting on h1 (w4 newest) + 1 waiting on h2; mB has 1 on h1. waiting = 6. */
function fixture() {
  rig.server.active = [
    row('w1', 'mA', 'h1', 1),
    row('w2', 'mA', 'h1', 2),
    row('w3', 'mA', 'h1', 3),
    row('w4', 'mA', 'h1', 4),
    row('v1', 'mA', 'h2', 5),
    row('b1', 'mB', 'h1', 0),
  ];
  rig.server.completed = [
    row('e1', 'mA', 'h1', 1, { job_status: 2, resolved_at: '2026-10-20T06:00:00Z' }),
    row('e2', 'mA', 'h1', 2, { job_status: 2, resolved_at: '2026-10-20T07:00:00Z' }),
    row('e3', 'mA', 'h2', 3, { job_status: 2, resolved_at: '2026-10-20T08:00:00Z' }),
  ];
}

const mount = () => render(<I18nProvider><TicketChat /></I18nProvider>);
const emitWs = (event: { type: string; data: Record<string, unknown> }) =>
  act(() => { Array.from(rig.wsHandlers).forEach((h) => h.current(event)); });
const tabButton = (label: string) => {
  const btn = screen.getAllByRole('button').find((b) => (b.textContent ?? '').trim().startsWith(label));
  if (!btn) throw new Error(`tab "${label}" not found`);
  return btn as HTMLElement;
};
const countOf = (label: string) => tabButton(label).querySelector('span')?.textContent?.trim() ?? '';
const cards = () => document.querySelectorAll('[data-chat-card]');
const stacks = () => document.querySelectorAll('[data-ticket-stack]');
const stackOn = () => localStorage.setItem('TC_TICKET_STACK', 'true');

beforeEach(() => {
  rig.wsHandlers.clear();
  rig.server.active = [];
  rig.server.completed = [];
  rig.prefs = null;
  localStorage.clear();
});

describe('[TICKETSTACK] flag ON — one stack per customer per OA', () => {
  it('⭐ 4 tickets of one customer on one OA → one stack, front = newest, pill = 4; tab number unchanged', async () => {
    stackOn();
    fixture();
    mount();
    await waitFor(() => expect(countOf('รอรับเคส')).toBe('6'));
    await waitFor(() => expect(stacks()).toHaveLength(1));
    const stack = stacks()[0] as HTMLElement;
    expect(within(stack).getByText('4')).toHaveAttribute('data-ticket-stack-count');
    // folded: w4 (newest) is the only card of the stack on screen
    expect(stack.querySelectorAll('[data-chat-card]')).toHaveLength(1);
    expect(within(stack).getByText('สรุป-w4')).toBeInTheDocument();
    // the same customer on OA สอง and the other customer stay separate cards
    expect(cards()).toHaveLength(3);
    expect(screen.getByText('สรุป-v1')).toBeInTheDocument();
    expect(screen.getByText('สรุป-b1')).toBeInTheDocument();
  });

  it('⭐ unfold shows every older card in full, newest → oldest; fold hides them again', async () => {
    stackOn();
    fixture();
    mount();
    await waitFor(() => expect(stacks()).toHaveLength(1));
    const toggle = document.querySelector('[data-ticket-stack-toggle]') as HTMLElement;
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const stackCards = [...(stacks()[0] as HTMLElement).querySelectorAll('[data-chat-card]')];
    expect(stackCards.map((c) => c.textContent?.match(/สรุป-(w\d)/)?.[1])).toEqual(['w4', 'w3', 'w2', 'w1']);
    expect(cards()).toHaveLength(6);
    expect(countOf('รอรับเคส')).toBe('6');

    fireEvent.click(toggle);
    expect(cards()).toHaveLength(3);
  });

  it('the toggle does not open the chat (the card under it does)', async () => {
    stackOn();
    fixture();
    mount();
    await waitFor(() => expect(stacks()).toHaveLength(1));
    fireEvent.click(document.querySelector('[data-ticket-stack-toggle]') as HTMLElement);
    expect(document.querySelector('.tc-card-selected')).toBeNull();
  });

  it('⭐ realtime: a new ticket for the same customer joins the stack in front; the tab count moves as before', async () => {
    stackOn();
    fixture();
    mount();
    await waitFor(() => expect(stacks()).toHaveLength(1));
    rig.server.active = [...rig.server.active, row('w5', 'mA', 'h1', 9)];
    emitWs({ type: 'ticket:new', data: { _id: 'w5', hook_id: 'h1', job_status: 0 } });
    await waitFor(() => expect(countOf('รอรับเคส')).toBe('7'), { timeout: 4000 });
    await waitFor(() => expect(within(stacks()[0] as HTMLElement).getByText('5')).toBeInTheDocument(), { timeout: 4000 });
    expect(within(stacks()[0] as HTMLElement).getByText('สรุป-w5')).toBeInTheDocument();
    expect(cards()).toHaveLength(3);
  });

  it('ปิดเคส: split by OA, the case list folds to the latest case, the tab number unchanged', async () => {
    stackOn();
    fixture();
    mount();
    await waitFor(() => expect(countOf('ปิดเคส')).toBe('3'));
    fireEvent.click(tabButton('ปิดเคส'));
    await waitFor(() => expect(screen.getByText('ปิดเคส 2 รอบ')).toBeInTheDocument());
    expect(screen.getByText('ปิดเคส 1 รอบ')).toBeInTheDocument(); // OA สอง is its own card
    expect(cards()).toHaveLength(2);
    expect(screen.getAllByText('ดูแชท')).toHaveLength(2); // folded: latest case of each card
    fireEvent.click(document.querySelector('[data-ticket-stack-toggle]') as HTMLElement);
    expect(screen.getAllByText('ดูแชท')).toHaveLength(3);
    expect(countOf('ปิดเคส')).toBe('3');
  });
  it('ปิดเคส: a pinned customer stays on top even after the card is split by OA', async () => {
    stackOn();
    fixture();
    // mB closed most recently ⇒ would be first; mA is pinned (pins are per customer: uid_<member>)
    rig.server.completed.push(row('eB', 'mB', 'h1', 4, { job_status: 2, resolved_at: '2026-10-20T09:00:00Z' }));
    rig.prefs = { pinned_rooms: ['uid_mA'] };
    mount();
    fireEvent.click(await waitFor(() => tabButton('ปิดเคส')));
    await waitFor(() => expect(cards()).toHaveLength(3));
    const order = [...cards()].map((c) => c.textContent?.match(/ลูกค้า-(m[AB])/)?.[1]);
    expect(order).toEqual(['mA', 'mA', 'mB']);
  });
  it('บอทดูแล is left alone — it already shows one card per customer, never a stack', async () => {
    stackOn();
    // mB: two closed cases on h1, room back in bot mode, nothing open ⇒ a บอทดูแล row
    rig.server.completed = [
      row('k1', 'mB', 'h1', 1, { job_status: 2, assist_status: false, resolved_at: '2026-10-20T06:00:00Z' }),
      row('k2', 'mB', 'h1', 2, { job_status: 2, assist_status: false, resolved_at: '2026-10-20T07:00:00Z' }),
    ];
    mount();
    await waitFor(() => expect(countOf('บอทดูแล')).toBe('1'));
    fireEvent.click(tabButton('บอทดูแล'));
    await waitFor(() => expect(cards()).toHaveLength(1));
    expect(stacks()).toHaveLength(0);
  });
});

describe('[TICKETSTACK] flag OFF (default) — the old list, exactly', () => {
  it('⭐ no stack, no toggle, every ticket its own card, same numbers', async () => {
    fixture();
    mount();
    await waitFor(() => expect(countOf('รอรับเคส')).toBe('6'));
    await waitFor(() => expect(cards()).toHaveLength(6));
    expect(stacks()).toHaveLength(0);
    expect(document.querySelector('[data-ticket-stack-toggle]')).toBeNull();
  });

  it('ปิดเคส keeps grouping by customer only (one card, 3 rounds, all cases shown)', async () => {
    fixture();
    mount();
    await waitFor(() => expect(countOf('ปิดเคส')).toBe('3'));
    fireEvent.click(tabButton('ปิดเคส'));
    await waitFor(() => expect(screen.getByText('ปิดเคส 3 รอบ')).toBeInTheDocument());
    expect(cards()).toHaveLength(1);
    expect(screen.getAllByText('ดูแชท')).toHaveLength(3);
  });

  it("explicit TC_TICKET_STACK='false' wins over everything", async () => {
    localStorage.setItem('TC_TICKET_STACK', 'false');
    fixture();
    mount();
    await waitFor(() => expect(cards()).toHaveLength(6));
    expect(stacks()).toHaveLength(0);
  });
});
