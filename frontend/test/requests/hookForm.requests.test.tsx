/**
 * [FEAT-20261027-TANSTACK] REQUEST COUNT — the lazy reads inside the hook form (P1).
 * Real HookFormPage + HookFormModal + real services; only `fetch` is faked.
 * Every case was run green on the UNCHANGED form first (26/10), then on the move to queries.
 *
 *  groups (create form): nothing until the group picker is focused · one load per open
 *    (a second focus costs nothing) · a failed load is retried on the next focus ·
 *    reopening the form starts from an empty list and loads again
 *  handoff tab (edit form): opening it reads the targets bound to that OA
 */
import React from 'react';
import { describe, it, expect, vi, afterAll, afterEach } from 'vitest';
import { render, act, cleanup, fireEvent, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { installFetchRecorder, httpError, waitForQuiet } from './fetchRecorder';

if (!('ResizeObserver' in globalThis)) (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
if (!window.matchMedia) (window as any).matchMedia = () => ({ matches: false, media: '', onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false });

vi.mock('../../services/authStorage', async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  const auth = { role: { name: 'superadmin' }, user: { id: 'admin1', username: 'admin1', role: 'superadmin' }, token: 't', permissions: ['hook.manage'], allowed_hooks: null };
  return { ...actual, getStoredAuth: () => auth, getAuthUser: () => auth.user };
});

const ID = 'a0d00000000000000000004a';
let groupsFail = false;
const rec = installFetchRecorder([
  [/^\/api\/groups$/, () => (groupsFail ? httpError(500) : { success: true, data: [{ _id: 'g7', group_name: 'Group Seven', status: true }] })],
  [/^\/hook\/[0-9a-f]{24}$/, () => ({ success: true, data: { _id: ID, alias: 'oa-one', line_oa_name: 'OA One', status: 1, tag: [] } })],
  [/^\/api\/handoff\/targets$/, () => ({ success: true, data: [{ key: 'tg1', name: 'Target One', scope: { bindings: [] } }], pagination: {} })],
]);
afterAll(() => rec.restore());
afterEach(() => { cleanup(); groupsFail = false; });

import { I18nProvider } from '../../i18n';
import { HookFormPage } from '../../pages/hook/HookFormPage';
import { HookFormModal } from '../../components/hook';

let nav: (to: string) => void = () => {};
const NavProbe = () => { nav = useNavigate(); return null; };
const mount = (path: string) =>
  render(
    <I18nProvider>
      <MemoryRouter initialEntries={[path]}>
        <NavProbe />
        <Routes>
          <Route path="/hooks" element={<div>list</div>} />
          <Route path="/hooks/create" element={<HookFormPage mode="create" />} />
          <Route path="/hooks/edit/:id" element={<HookFormPage mode="edit" />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
const groupSelect = (root: HTMLElement) => root.querySelector('select[name="group_id"]') as HTMLSelectElement;
const groupReads = (m: number) => rec.since(m).filter((r) => r.path === '/api/groups');

describe('[REQ-HOOKFORM] the group picker loads lazily, once per open', () => {
  it('nothing on open · one load on focus · a second focus is free', async () => {
    const m = rec.mark();
    const view = mount('/hooks/create');
    await waitForQuiet(rec);
    expect(groupReads(m)).toHaveLength(0);
    act(() => { fireEvent.focus(groupSelect(view.container)); });
    await waitForQuiet(rec);
    expect(groupReads(m)).toHaveLength(1);
    expect(groupReads(m)[0].query).toContain('status=true');
    expect(screen.getByText('Group Seven')).toBeTruthy();
    act(() => { fireEvent.focus(groupSelect(view.container)); });
    await waitForQuiet(rec);
    expect(groupReads(m)).toHaveLength(1);
  });

  it('a failed load is retried on the next focus', async () => {
    groupsFail = true;
    const m = rec.mark();
    const view = mount('/hooks/create');
    await waitForQuiet(rec);
    act(() => { fireEvent.focus(groupSelect(view.container)); });
    await waitForQuiet(rec);
    expect(groupReads(m)).toHaveLength(1);
    groupsFail = false;
    act(() => { fireEvent.focus(groupSelect(view.container)); });
    await waitForQuiet(rec);
    expect(groupReads(m)).toHaveLength(2);
    expect(screen.getByText('Group Seven')).toBeTruthy();
  });

  it('reopening the form starts empty and loads again on focus', async () => {
    const view = mount('/hooks/create');
    await waitForQuiet(rec);
    act(() => { fireEvent.focus(groupSelect(view.container)); });
    await waitForQuiet(rec);
    act(() => nav('/hooks'));
    await waitForQuiet(rec);
    const m = rec.mark();
    act(() => nav('/hooks/create'));
    await waitForQuiet(rec);
    expect(screen.queryByText('Group Seven')).toBeNull();
    act(() => { fireEvent.focus(groupSelect(view.container)); });
    await waitForQuiet(rec);
    expect(groupReads(m)).toHaveLength(1);
  });
});

describe('[REQ-HOOKFORM] the modal kept mounted by the Hook list', () => {
  it('closing and reopening the same modal instance starts the group list empty again', async () => {
    const props = { onClose: () => {}, onSubmit: async () => {}, mode: 'create' as const };
    const view = render(<I18nProvider><HookFormModal isOpen {...props} /></I18nProvider>);
    await waitForQuiet(rec);
    act(() => { fireEvent.focus(groupSelect(view.container)); });
    await waitForQuiet(rec);
    expect(screen.getByText('Group Seven')).toBeTruthy();
    view.rerender(<I18nProvider><HookFormModal isOpen={false} {...props} /></I18nProvider>);
    await waitForQuiet(rec);
    const m = rec.mark();
    view.rerender(<I18nProvider><HookFormModal isOpen {...props} /></I18nProvider>);
    await waitForQuiet(rec);
    expect(screen.queryByText('Group Seven')).toBeNull();
    expect(groupReads(m)).toHaveLength(0);
    act(() => { fireEvent.focus(groupSelect(view.container)); });
    await waitForQuiet(rec);
    expect(groupReads(m)).toHaveLength(1);
  });
});

describe('[REQ-HOOKFORM] the handoff tab', () => {
  it('opening it reads the targets bound to this OA', async () => {
    mount(`/hooks/edit/${ID}`);
    await waitForQuiet(rec);
    const m = rec.mark();
    act(() => { fireEvent.click(screen.getByRole('button', { name: /Handoff/ })); });
    await waitForQuiet(rec);
    const reads = rec.since(m).filter((r) => r.path === '/api/handoff/targets');
    expect(reads).toHaveLength(1);
    expect(reads[0].query).toContain(`hook_id=${ID}`);
    expect(screen.getByText('Target One')).toBeTruthy();
  });
});
