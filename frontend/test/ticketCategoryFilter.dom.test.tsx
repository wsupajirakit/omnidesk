/**
 * [FEAT-20261019-CATFILTER] The ticket-category filter on the live Ticket page follows the provider.
 * ===========================================================================
 * Owner 19/10/2026: a category filter beside "ป้ายทั้งหมด" · 4 categories · loan only, decided in
 * one place for every future provider · list display and search must not break · shop-api has no
 * category search, loan has.
 *
 * Single source of truth (re-verified 19/10): the provider's declared ticket categories — BE
 * `customer-provider/features/active-provider.ts` `providerTicketCategories()` → route
 * `GET /api/customer-provider/ticket-categories` → FE `useProviderTicketCategories()` (null on
 * shop-api). The dropdown already existed, wired, behind `<div className="hidden">`
 * ([FIX-20260801-FILTERSWAP]); it now shows only when that list exists.
 * Completeness: the open tabs already switch to a full fetch when a category is chosen
 * (`activeListParams`); the closed tab pages 100 at a time, so it now does the same.
 *
 * Rig = `ticketChatBadgeCounts.dom.test.tsx`'s (the real page; only the service boundary mocked).
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
  calls: [] as Record<string, unknown>[],
  cats: null as string[] | null,
}));

vi.mock('../services/chat', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../services/chat');

  const listBy = async (_scopeId: string, params: Record<string, unknown>) => {
    rig.calls.push({ ...params });
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

/* the provider's declared ticket categories — loan: the 4 values · shop-api: null */
vi.mock('../services/chat/providerTicketCategories', () => ({
  fetchProviderTicketCategories: () => Promise.resolve(rig.cats),
  resetProviderTicketCategories: () => {},
}));
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

const LOAN = ['Collection', 'IT', 'Payment', 'Other'];
const categoryTrigger = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('button')).find((b) => b.getAttribute('title') === 'หมวดทั้งหมด') as HTMLElement | undefined;
const isShown = (el: HTMLElement | undefined) => !!el && !el.closest('.hidden');
const closedCalls = () => rig.calls.filter((p) => p['job_status'] === 2);

function loanRows() {
  rig.server.active = [
    mkTicket({ _id: 'c1', line_user_id: 'Uc1', name: 'ลูกค้าทวงถาม', job_status: 0, category: 'Collection' }),
    mkTicket({ _id: 'i1', line_user_id: 'Ui1', name: 'ลูกค้าอุปกรณ์', job_status: 0, category: 'IT' }),
  ];
  rig.server.completed = [
    { ...mkTicket({ _id: 'e1', line_user_id: 'Ue1', name: 'ลูกค้าปิดทวงถาม', category: 'Collection' }), job_status: 2 },
  ];
}

beforeEach(() => {
  rig.wsHandlers.clear();
  rig.server.active = [];
  rig.server.completed = [];
  rig.calls = [];
  rig.cats = null;
  localStorage.clear();
});

describe('[CATFILTER] BEFORE / PIN — shop-api (no declared categories): nothing changes', () => {
  it('⭐ the category filter is not shown; OA and tag filters are', async () => {
    loanRows();
    const { container } = mount();
    await waitFor(() => expect(screen.getByText(/ลูกค้าทวงถาม/)).toBeInTheDocument());
    expect(isShown(categoryTrigger(container))).toBe(false);
    expect(screen.getByTitle('OA ทั้งหมด')).toBeInTheDocument();
  });
  it('⭐ the closed tab still asks page by page (cursor, 100), as before', async () => {
    loanRows();
    mount();
    await waitFor(() => expect(closedCalls().length).toBeGreaterThan(0));
    expect(closedCalls()[0]).toMatchObject({ job_status: 2, limit: 100, cursor: '' });
  });
});

describe('[CATFILTER] TARGET — loan (4 declared categories)', () => {
  it('⭐ the filter is shown, beside the tag filter, with the 4 categories', async () => {
    rig.cats = LOAN;
    loanRows();
    const { container } = mount();
    await waitFor(() => expect(isShown(categoryTrigger(container))).toBe(true));
    fireEvent.click(categoryTrigger(container)!);
    for (const label of ['ทวงถาม', 'อุปกรณ์', 'ชำระค่างวด', 'อื่นๆ']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });
  it('⭐ choosing ทวงถาม keeps only Collection rows, and the closed tab reloads in full', async () => {
    rig.cats = LOAN;
    loanRows();
    const { container } = mount();
    await waitFor(() => expect(screen.getByText(/ลูกค้าอุปกรณ์/)).toBeInTheDocument());
    await waitFor(() => expect(isShown(categoryTrigger(container))).toBe(true));
    fireEvent.click(categoryTrigger(container)!);
    const option = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'ทวงถาม')!;
    fireEvent.click(option);
    await waitFor(() => expect(screen.queryByText(/ลูกค้าอุปกรณ์/)).toBeNull());
    expect(screen.getByText(/ลูกค้าทวงถาม/)).toBeInTheDocument();
    await waitFor(() => expect(closedCalls().some((p) => p['limit'] === 'all')).toBe(true));
    const full = closedCalls().find((p) => p['limit'] === 'all')!;
    expect(full).not.toHaveProperty('cursor');
  });
});
