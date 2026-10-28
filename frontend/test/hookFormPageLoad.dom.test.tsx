/**
 * [FEAT-20261027-TANSTACK] CHARACTERIZATION — how the full-page hook form loads its hook.
 * Written and run green on the UNCHANGED page first (26/10), then kept green after the
 * move to `useHookDetailQuery`. Real page + real services; only `fetch` is faked.
 *
 *  1. edit: the loading screen shows until the hook arrives, then the form renders
 *  2. a failed load shows the error screen with the server's message
 *  3. create: no hook request and no loading screen
 *  4. 🔴 re-opening the same edit shows the loading screen AGAIN — the form is never
 *     seeded from a cached copy (an editable copy must be fresh; see useHookFormQueries.ts)
 */
import React from 'react';
import { describe, it, expect, vi, afterAll, afterEach } from 'vitest';
import { render, act, cleanup, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { installFetchRecorder, httpError, waitForQuiet } from './requests/fetchRecorder';

if (!('ResizeObserver' in globalThis)) (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
if (!window.matchMedia) (window as any).matchMedia = () => ({ matches: false, media: '', onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false });

vi.mock('../services/authStorage', async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  const auth = { role: { name: 'superadmin' }, user: { id: 'admin1', username: 'admin1', role: 'superadmin' }, token: 't', permissions: ['hook.manage'], allowed_hooks: null };
  return { ...actual, getStoredAuth: () => auth, getAuthUser: () => auth.user };
});

const ID = 'a0d00000000000000000004a';
let hold: Promise<void> | null = null;
let fail = false;
const rec = installFetchRecorder([
  [/^\/hook\/[0-9a-f]{24}$/, async () => {
    if (hold) await hold;
    return fail ? httpError(500, { success: false, message: 'hook read exploded' }) : { success: true, data: { _id: ID, alias: 'oa-one', line_oa_name: 'OA One', status: 1, tag: [] } };
  }],
]);
afterAll(() => rec.restore());
afterEach(() => { cleanup(); hold = null; fail = false; });

import { I18nProvider } from '../i18n';
import { HookFormPage } from '../pages/hook/HookFormPage';

const LOADING = 'กำลังโหลดข้อมูล Webhook Channel…';
const LOAD_ERROR = 'เกิดข้อผิดพลาดในการโหลดข้อมูล';
let nav: (to: string) => void = () => {};
const NavProbe = () => { nav = useNavigate(); return null; };
const mount = (path: string) =>
  render(
    <I18nProvider>
      <MemoryRouter initialEntries={[path]}>
        <NavProbe />
        <Routes>
          <Route path="/hooks" element={<div>list</div>} />
          <Route path="/hooks/edit/:id" element={<HookFormPage mode="edit" />} />
          <Route path="/hooks/create" element={<HookFormPage mode="create" />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
const holdNext = () => { let r!: () => void; hold = new Promise<void>((x) => { r = x; }); return r; };

describe('[HOOKFORMPAGE-LOAD] loading the hook a full-page form edits', () => {
  it('edit: loading screen until the hook arrives, then the form', async () => {
    const release = holdNext();
    mount(`/hooks/edit/${ID}`);
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(screen.getByText(LOADING)).toBeTruthy();
    await act(async () => { release(); });
    await waitForQuiet(rec);
    expect(screen.queryByText(LOADING)).toBeNull();
    expect(screen.queryByText(LOAD_ERROR)).toBeNull();
    expect(rec.log.filter((r) => r.path === '/hook/:id')).toHaveLength(1);
  });

  it('a failed load shows the error screen with the server message', async () => {
    fail = true;
    mount(`/hooks/edit/${ID}`);
    await waitForQuiet(rec);
    expect(screen.getByText(LOAD_ERROR)).toBeTruthy();
    expect(screen.getByText(/hook read exploded/)).toBeTruthy();
  });

  it('create: no hook request, no loading screen', async () => {
    const m = rec.mark();
    mount('/hooks/create');
    await waitForQuiet(rec);
    expect(rec.since(m).filter((r) => r.path === '/hook/:id')).toHaveLength(0);
    expect(screen.queryByText(LOADING)).toBeNull();
  });

  it('🔴 re-opening the same edit shows the loading screen again (never seeded from cache)', async () => {
    mount(`/hooks/edit/${ID}`);
    await waitForQuiet(rec);
    act(() => nav('/hooks'));
    await waitForQuiet(rec);
    const release = holdNext();
    act(() => nav(`/hooks/edit/${ID}`));
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(screen.getByText(LOADING)).toBeTruthy();
    await act(async () => { release(); });
    await waitForQuiet(rec);
  });
});
