/**
 * [GUARD-20261027-LEGACYTICKET] The legacy ticket page (`/legacy-ticket` → pages/chat/TicketSupport.tsx)
 * must still SHOW tickets when there are tickets.
 *
 * Owner, 27/10/2026: "หน้า legacy ticket ยังต้องแสดงผลได้อยู่นะเวลามี ticket". The page was left out
 * of the TanStack migration and the TicketChat split on purpose; this guard makes sure work around
 * it (shared services, the ticket barrels, i18n) cannot silently leave it blank.
 *
 * The page only lists groups / hooks whose `status` is on, so the fixtures carry `status: 1`.
 * Real page, service boundary mocked (same rig shape as test/ticketChatRealtime.dom.test.tsx).
 * revert: delete this file.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

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
vi.setConfig({ testTimeout: 30_000 });

const rig = vi.hoisted(() => ({ active: [] as any[], completed: [] as any[] }));

vi.mock('../services/chat', async () => {
  const actual = await vi.importActual<Record<string, any>>('../services/chat');
  const list = async (_id: string, params: Record<string, unknown>) => {
    const rows = params?.job_status === 2 || params?.job_status === '2' ? rig.completed : rig.active;
    return { success: true, data: rows, pagination: { total: rows.length, has_more: false, total_pages: 1 } };
  };
  return {
    ...actual,
    useTicketWS: () => {},
    ticketService: {
      ...actual.ticketService,
      listTicketsByGroup: list,
      listTicketsByHook: list,
      getTicketMetaByGroup: async () => ({ total: rig.active.length, last_updated: null, waiting: 0 }),
      getTicketMeta: async () => ({ total: rig.active.length, last_updated: null }),
      getTicketById: async () => null,
    },
    chatService: { ...actual.chatService, listRooms: async () => [], popularTags: async () => ({ data: [] }) },
    assignHistoryService: { createAssignHistory: async () => ({ success: true }), getAssignHistories: async () => ({ data: [] }) },
    dictLookup: (s: string) => s,
    loadTranslationDict: () => Promise.resolve(),
    subscribeDict: () => () => {},
  };
});
vi.mock('../services/hook', () => ({
  webhookService: { getAllHooks: async () => [{ _id: 'h1', line_oa_name: 'OA หนึ่ง', group: 'g1', status: 1 }] },
}));
vi.mock('../services/admin', async () => {
  const actual = await vi.importActual<Record<string, any>>('../services/admin');
  return {
    ...actual,
    groupService: { listGroups: async () => ({ data: [{ _id: 'g1', group_name: 'Group One', status: 1 }] }) },
    userService: { ...actual.userService, listUsersForAssign: async () => ({ data: [] }), listUsers: async () => ({ data: [] }) },
    configService: { listConfigs: async () => ({ data: [] }) },
    auditService: { ...actual.auditService, log: async () => ({ success: true }) },
  };
});
vi.mock('../services/authStorage', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('../services/authStorage')),
  getStoredAuth: () => ({
    role: { name: 'superadmin' },
    user: { id: 'admin1', username: 'admin1', display_name: 'แอดมินหนึ่ง' },
    token: 't', permissions: ['ticket.manage'], allowed_hooks: null,
  }),
}));

import { I18nProvider } from '../i18n';
import { TicketSupport } from '../pages/chat/TicketSupport';

const row = (o: Record<string, unknown>) => ({
  line_oa_hook_id: 'h1', job_status: 0, customer_tags: [], need_detail: '',
  created_at: '2026-10-27T08:00:00Z', updated_at: '2026-10-27T09:00:00Z', ...o,
});

beforeEach(() => {
  localStorage.clear();
  rig.active = [];
  rig.completed = [];
});

describe('[LEGACY-TICKET] the legacy ticket page still renders its tickets', () => {
  it('waiting tickets appear as rows on the default tab (รอรับงาน)', async () => {
    rig.active = [
      row({ _id: 't1', line_user_id: 'U1', line_user_data: { full_name: 'ลูกค้าเลกาซีหนึ่ง', display_name: 'L1' } }),
      row({ _id: 't2', line_user_id: 'U2', line_user_data: { full_name: 'ลูกค้าเลกาซีสอง', display_name: 'L2' } }),
    ];
    render(<I18nProvider><MemoryRouter initialEntries={['/legacy-ticket']}><TicketSupport /></MemoryRouter></I18nProvider>);
    await waitFor(() => expect(screen.getAllByText(/ลูกค้าเลกาซีหนึ่ง/).length).toBeGreaterThan(0), { timeout: 10_000 });
    expect(screen.getAllByText(/ลูกค้าเลกาซีสอง/).length).toBeGreaterThan(0);
  });

  it('accepted tickets appear on the กำลังดำเนินงาน tab (?status=accepted — the page\'s own deep link)', async () => {
    rig.active = [
      row({ _id: 't3', line_user_id: 'U3', job_status: 1, admin_user_id: 'admin1', admin_user_data: { display_name: 'แอดมินหนึ่ง' }, line_user_data: { full_name: 'ลูกค้าเลกาซีสาม', display_name: 'L3' } }),
    ];
    render(<I18nProvider><MemoryRouter initialEntries={['/legacy-ticket?status=accepted']}><TicketSupport /></MemoryRouter></I18nProvider>);
    await waitFor(() => expect(screen.getAllByText(/ลูกค้าเลกาซีสาม/).length).toBeGreaterThan(0), { timeout: 10_000 });
  });

  it('no tickets → no rows, and the page still mounts (not a crash)', async () => {
    const view = render(<I18nProvider><MemoryRouter initialEntries={['/legacy-ticket']}><TicketSupport /></MemoryRouter></I18nProvider>);
    await waitFor(() => expect(view.container.textContent?.length).toBeGreaterThan(0), { timeout: 10_000 });
    expect(screen.queryByText(/ลูกค้าเลกาซี/)).toBeNull();
  });
});
