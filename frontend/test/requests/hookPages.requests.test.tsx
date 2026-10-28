/**
 * [FEAT-20261027-TANSTACK] REQUEST COUNT — Hook list + Hook form (P1).
 *
 * Real WebhookList / HookFormPage and every real service; only `fetch` is
 * faked (test/requests/fetchRecorder.ts). Pins what each navigation costs.
 *
 * Numbers pinned on the UNCHANGED code (26/10, before P1): open list 6 · open
 * edit 6 · back to list 5 · same edit again 6. Owner decision (26/10, "same
 * freshness"): these must not grow. Two behaviours are changed on purpose by
 * the owner and are written red-first against the old code:
 *   · the 20s poll stops while the tab is hidden (old code kept polling)
 *   · a poll tick refreshes silently — no loading bar (old code flashed it)
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { render, act, cleanup, fireEvent, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { installFetchRecorder, setTabHidden, waitForQuiet } from './fetchRecorder';

if (!('ResizeObserver' in globalThis)) (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
if (!window.matchMedia) (window as any).matchMedia = () => ({ matches: false, media: '', onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false });

vi.mock('../../services/authStorage', async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  const auth = { role: { name: 'superadmin' }, user: { id: 'admin1', username: 'admin1', role: 'superadmin' }, token: 't', permissions: ['hook.manage'], allowed_hooks: null };
  return { ...actual, getStoredAuth: () => auth, getAuthUser: () => auth.user };
});

const HOOK = (i: number) => ({ _id: `6a${String(i).padStart(22, '0')}`, alias: `oa-${i}`, line_oa_name: `OA ${i}`, status: 1, group: 'g1', tag: [] });
let holdList: Promise<void> | null = null;
const rec = installFetchRecorder([
  [/^\/hook$/, async () => { if (holdList) await holdList; return { success: true, data: [HOOK(1), HOOK(2), HOOK(3)], pagination: { total: 3 } }; }],
  [/^\/hook\/[0-9a-f]{24}$/, () => ({ success: true, data: HOOK(1) })],
  [/^\/hook\/tags$/, () => ({ success: true, data: ['vip'] })],
]);
afterAll(() => rec.restore());
afterEach(() => { cleanup(); setTabHidden(false); holdList = null; });

import { I18nProvider } from '../../i18n';
import { WebhookList } from '../../pages/hook/WebhookList';
import { HookFormPage } from '../../pages/hook/HookFormPage';

let nav: (to: string) => void = () => {};
const NavProbe = () => { nav = useNavigate(); return null; };
const mountApp = () =>
  render(
    <I18nProvider>
      <MemoryRouter initialEntries={['/hooks']}>
        <NavProbe />
        <Routes>
          <Route path="/hooks" element={<WebhookList />} />
          <Route path="/hooks/edit/:id" element={<HookFormPage mode="edit" />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
const loadingBar = (root: HTMLElement) => root.querySelector('.h-0\\.5.animate-pulse');

describe('[REQ-HOOK] requests per navigation — must not grow', () => {
  it('list → edit → back → edit again costs 6 / 6 / 5 / 6 requests', async () => {
    let m = rec.mark();
    mountApp();
    await waitForQuiet(rec);
    expect(rec.tally(m)).toEqual({
      'GET /api/customer-provider/features': 1, 'GET /configs': 1, 'GET /api/custom-tools': 1,
      'GET /hook': 1, 'GET /api/groups': 1, 'GET /hook/tags': 1,
    });
    m = rec.mark();
    act(() => nav(`/hooks/edit/${HOOK(1)._id}`));
    await waitForQuiet(rec);
    expect(rec.tally(m)).toEqual({
      'GET /hook/:id': 1, 'GET /api/flex-messages': 1, 'GET /api/field-options/slip_provider': 1,
      'GET /configs': 1, 'GET /api/custom-tools': 1, 'GET /api/groups/g1': 1,
    });
    m = rec.mark();
    act(() => nav('/hooks'));
    await waitForQuiet(rec);
    expect(rec.tally(m)).toEqual({ 'GET /configs': 1, 'GET /api/custom-tools': 1, 'GET /hook': 1, 'GET /api/groups': 1, 'GET /hook/tags': 1 });
    m = rec.mark();
    act(() => nav(`/hooks/edit/${HOOK(1)._id}`));
    await waitForQuiet(rec);
    expect(Object.values(rec.tally(m)).reduce((a, b) => a + b, 0)).toBe(6);
  }, 30000);
});

describe('[REQ-HOOK] the 20s list poll', () => {
  beforeAll(() => { vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }); });
  afterAll(() => { vi.useRealTimers(); });

  it('a visible tab re-fetches the list once per 20s', async () => {
    mountApp();
    await waitForQuiet(rec);
    const m = rec.mark();
    await act(async () => { vi.advanceTimersByTime(20_000); });
    await waitForQuiet(rec);
    expect(rec.tally(m)).toEqual({ 'GET /hook': 1 });
  }, 30000);

  it('🔴 owner 26/10: a hidden tab does not poll', async () => {
    mountApp();
    await waitForQuiet(rec);
    act(() => setTabHidden(true));
    const m = rec.mark();
    await act(async () => { vi.advanceTimersByTime(60_000); });
    await waitForQuiet(rec);
    expect(rec.tally(m)).toEqual({});
  }, 30000);

  it('🔴 owner 26/10: a poll tick refreshes silently (no loading bar)', async () => {
    const view = mountApp();
    await waitForQuiet(rec);
    let release!: () => void;
    holdList = new Promise<void>((r) => { release = r; });
    await act(async () => { vi.advanceTimersByTime(20_000); });
    // TanStack notifies React on a macrotask — let it render before judging the screen,
    // or a page that DOES flash the bar would still pass (mutation M7 caught exactly that)
    await act(() => new Promise((r) => setTimeout(r, 100)));
    expect(rec.log.at(-1)?.path).toBe('/hook');        // the tick did fire, response still held
    expect(loadingBar(view.container)).toBeNull();     // …and nothing flashed
    await act(async () => { release(); });
    await waitForQuiet(rec);
  }, 30000);
});

describe('[REQ-HOOK] what still shows the loading bar / still pauses the poll', () => {
  beforeAll(() => { vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }); });
  afterAll(() => { vi.useRealTimers(); });

  it('no poll while a modal is open (as before)', async () => {
    mountApp();
    await waitForQuiet(rec);
    fireEvent.click(screen.getAllByTitle('ลบ')[0]);   // opens the delete confirm modal (isModalOpen)
    const m = rec.mark();
    await act(async () => { vi.advanceTimersByTime(60_000); });
    await waitForQuiet(rec);
    expect(rec.tally(m)).toEqual({});
  }, 30000);

  it('a search change shows the bar while the new page loads (as before)', async () => {
    const view = mountApp();
    await waitForQuiet(rec);
    let release!: () => void;
    holdList = new Promise<void>((r) => { release = r; });
    fireEvent.change(screen.getByPlaceholderText('ค้นหา...'), { target: { value: 'oa-2' } });
    await act(() => new Promise((r) => setTimeout(r, 450)));   // 350ms debounce → new key
    expect(rec.log.at(-1)?.query).toContain('keyword=oa-2');
    expect(loadingBar(view.container)).not.toBeNull();
    expect(screen.getByText('OA 3')).toBeTruthy();            // the previous rows stay while it loads
    await act(async () => { release(); });
    await waitForQuiet(rec);
    expect(loadingBar(view.container)).toBeNull();
  }, 30000);

  it('an operator action (delete) shows the bar while the list re-reads (as before)', async () => {
    const view = mountApp();
    await waitForQuiet(rec);
    fireEvent.click(screen.getAllByTitle('ลบ')[0]);
    fireEvent.click(screen.getByTestId('confirm-consent'));
    let release!: () => void;
    holdList = new Promise<void>((r) => { release = r; });
    const m = rec.mark();
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยัน' }));
    await act(() => new Promise((r) => setTimeout(r, 200)));
    expect(rec.since(m).map((r) => r.method)).toContain('DELETE');
    expect(loadingBar(view.container)).not.toBeNull();
    await act(async () => { release(); });
    await waitForQuiet(rec);
    expect(loadingBar(view.container)).toBeNull();
  }, 30000);
});
