/**
 * [FEAT-20261027-TANSTACK] REQUEST COUNT — Custom Tools screen (P1).
 * Real page + real services; only `fetch` is faked. Pinned on the UNCHANGED page first.
 *
 *  · open: one list page + one usage read per tool (+ the page's other reads, pinned exactly)
 *  · the refresh button re-reads list + usage, and the table shows its spinner row meanwhile
 *  · a search change re-reads with the keyword
 *  · leaving and coming back re-reads (freshness unchanged — owner 26/10)
 */
import React from 'react';
import { describe, it, expect, vi, afterAll, afterEach } from 'vitest';
import { render, act, cleanup, fireEvent, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { installFetchRecorder, waitForQuiet } from './fetchRecorder';

if (!('ResizeObserver' in globalThis)) (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
if (!window.matchMedia) (window as any).matchMedia = () => ({ matches: false, media: '', onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false });

vi.mock('../../services/authStorage', async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  const auth = { role: { name: 'superadmin' }, user: { id: 'admin1', username: 'admin1', role: 'superadmin' }, token: 't', permissions: ['custom_tools.manage'], allowed_hooks: null };
  return { ...actual, getStoredAuth: () => auth, getAuthUser: () => auth.user };
});

const T1 = 'a0d00000000000000000009c';
const T2 = 'a0d00000000000000000009d';
let holdList: Promise<void> | null = null;
const rec = installFetchRecorder([
  [/^\/api\/custom-tools$/, async () => {
    if (holdList) await holdList;
    return { success: true, data: [{ id: T1, _id: T1, name: 'Tool One', endpoints: [] }, { id: T2, _id: T2, name: 'Tool Two', endpoints: [] }], pagination: { total: 2 } };
  }],
  [/^\/api\/custom-tools\/[0-9a-f]{24}\/usage$/, () => ({ success: true, data: { count: 1, active: 1, hooks: [] } })],
]);
afterAll(() => rec.restore());
afterEach(() => { cleanup(); holdList = null; });

import { I18nProvider } from '../../i18n';
import { CustomTools } from '../../pages/hook/CustomTools';

let nav: (to: string) => void = () => {};
const NavProbe = () => { nav = useNavigate(); return null; };
const mount = () =>
  render(
    <I18nProvider>
      <MemoryRouter initialEntries={['/custom-tools']}>
        <NavProbe />
        <Routes>
          <Route path="/custom-tools" element={<CustomTools />} />
          <Route path="/elsewhere" element={<div>elsewhere</div>} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
const listAndUsage = (m: number) => {
  const t = rec.tally(m);
  return { list: t['GET /api/custom-tools'] ?? 0, usage: t['GET /api/custom-tools/:id/usage'] ?? 0 };
};
const refreshButton = (root: HTMLElement) => root.querySelector('svg.lucide-refresh-cw')!.closest('button')!;
const spinnerRow = () => screen.queryByText('กำลังโหลด…');

describe('[REQ-CUSTOMTOOLS] requests per action — must not change', () => {
  it('open: 1 list + 1 usage per tool, and the rows render', async () => {
    const m = rec.mark();
    mount();
    await waitForQuiet(rec);
    expect(listAndUsage(m)).toEqual({ list: 1, usage: 2 });
    expect(screen.getByText('Tool One')).toBeTruthy();
  });

  it('refresh: list + usage again, with the spinner row while it loads', async () => {
    const view = mount();
    await waitForQuiet(rec);
    let release!: () => void;
    holdList = new Promise<void>((r) => { release = r; });
    const m = rec.mark();
    act(() => { fireEvent.click(refreshButton(view.container)); });
    await act(() => new Promise((r) => setTimeout(r, 100)));
    expect(spinnerRow()).not.toBeNull();
    await act(async () => { release(); });
    await waitForQuiet(rec);
    expect(listAndUsage(m)).toEqual({ list: 1, usage: 2 });
    expect(spinnerRow()).toBeNull();
  });

  it('search: re-reads with the keyword', async () => {
    mount();
    await waitForQuiet(rec);
    const m = rec.mark();
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'one' } });
    await waitForQuiet(rec);
    const lists = rec.since(m).filter((r) => r.path === '/api/custom-tools');
    expect(lists.length).toBeGreaterThanOrEqual(1);
    expect(lists.at(-1)!.query).toContain('search=one');
  });

  it('leave and come back: list + usage are read again', async () => {
    mount();
    await waitForQuiet(rec);
    act(() => nav('/elsewhere'));
    await waitForQuiet(rec);
    const m = rec.mark();
    act(() => nav('/custom-tools'));
    await waitForQuiet(rec);
    expect(listAndUsage(m)).toEqual({ list: 1, usage: 2 });
  });
});
