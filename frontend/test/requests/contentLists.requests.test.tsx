/**
 * [FEAT-20261027-TANSTACK] REQUEST COUNT — the content list screens (Flex Message ·
 * Object Categories · Object Images). Real pages + real services; only `fetch` is faked.
 * Pinned on the UNCHANGED pages first: each case must pass on the old code AND the new.
 *
 * Their shared contract (none of them polls):
 *   open → the list read (+ its filter reads) · no read on its own for a minute, nor when
 *   the tab comes back · the loading cue shows while a read runs · a failed read opens the
 *   error alert and KEEPS the rows already on screen.
 */
import React from 'react';
import { describe, it, expect, vi, afterAll, afterEach, beforeAll } from 'vitest';
import { render, act, cleanup, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { installFetchRecorder, httpError, setTabHidden, waitForQuiet } from './fetchRecorder';

if (!('ResizeObserver' in globalThis)) (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
if (!('IntersectionObserver' in globalThis)) (globalThis as any).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
if (!window.matchMedia) (window as any).matchMedia = () => ({ matches: false, media: '', onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false });

// each case mounts a real screen up to twice and waits for the network to settle —
// under a loaded parallel run that alone can pass the 5s default (seen once on SystemConfig)
vi.setConfig({ testTimeout: 15_000 });

vi.mock('../../services/authStorage', async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  const perms = ['flex.manage', 'object.manage', 'object_category.manage', 'object_image.manage', 'hook.manage'];
  const auth = { role: { name: 'superadmin' }, user: { id: 'admin1', username: 'admin1', role: 'superadmin' }, token: 't', permissions: perms, allowed_hooks: null };
  return { ...actual, getStoredAuth: () => auth, getAuthUser: () => auth.user };
});

const NOW = new Date().toISOString();
const ROWS: Record<string, unknown> = {
  '/api/flex-messages': { success: true, data: [{ id: 'f1', _id: 'f1', name: 'ROWMARK', flex_type: 'normal', content: {}, created_at: NOW, updated_at: NOW }], pagination: { total: 1, total_pages: 1 } },
  '/api/object-categories': { success: true, data: [{ id: 'c1', _id: 'c1', name: 'ROWMARK', created_at: NOW, updated_at: NOW }] },
  '/api/object-images': { success: true, data: [{ id: 'i1', _id: 'i1', detail: 'ROWMARK', matching_tag: [], categories: [], images: [], created_at: NOW, updated_at: NOW }] },
};
let failList: string | null = null;
let hold: Promise<void> | null = null;
const rec = installFetchRecorder([
  [/^\/api\/(flex-messages|object-categories|object-images)$/, async (path) => {
    if (hold) await hold;
    return failList === path ? httpError(500, { success: false, message: 'list exploded' }) : ROWS[path];
  }],
]);
afterAll(() => rec.restore());
afterEach(() => { cleanup(); failList = null; hold = null; setTabHidden(false); });

import { I18nProvider } from '../../i18n';

type Screen = { name: string; list: string; extra: string[]; load: () => Promise<React.ComponentType>; alert: RegExp; search: RegExp };
const SCREENS: Screen[] = [
  { name: 'FlexMessageList', list: '/api/flex-messages', extra: ['/api/groups'], load: async () => (await import('../../pages/content/FlexMessageList')).FlexMessageList, alert: /ไม่สามารถโหลดข้อมูล Flex Message ได้/, search: /ค้นหา/ },
  { name: 'ObjectCategoryList', list: '/api/object-categories', extra: [], load: async () => (await import('../../pages/content/ObjectCategoryList')).ObjectCategoryList, alert: /ข้อผิดพลาด/, search: /ค้นหา/ },
  { name: 'ObjectImageList', list: '/api/object-images', extra: ['/api/object-categories'], load: async () => (await import('../../pages/content/ObjectImageList')).ObjectImageList, alert: /ข้อผิดพลาด/, search: /ค้นหา/ },
];
const reads = (path: string, m: number) => rec.since(m).filter((r) => r.path === path && r.method === 'GET').length;
const loadingCue = (root: HTMLElement) => root.querySelector('.h-0\\.5.animate-pulse, svg.animate-spin');

describe.each(SCREENS)('[REQ-CONTENT] $name', ({ list, extra, load, alert, search }) => {
  beforeAll(() => { vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }); });
  afterAll(() => { vi.useRealTimers(); });
  const mount = async () => {
    const Page = await load();
    return render(<I18nProvider><MemoryRouter><Page /></MemoryRouter></I18nProvider>);
  };
  const typeSearch = (value: string) => {
    const box = screen.getAllByPlaceholderText(search)[0];
    fireEvent.change(box, { target: { value } });
  };

  it('open → the list read and its filter reads, once each', async () => {
    const m = rec.mark();
    await mount();
    await waitForQuiet(rec);
    expect(reads(list, m)).toBe(1);
    for (const p of extra) expect(reads(p, m)).toBe(1);
    expect(screen.getAllByText('ROWMARK').length).toBeGreaterThan(0);
  });

  it('no read on its own — not over a minute, not when the tab comes back', async () => {
    await mount();
    await waitForQuiet(rec);
    const m = rec.mark();
    await act(async () => { vi.advanceTimersByTime(60_000); });
    act(() => setTabHidden(true));
    act(() => setTabHidden(false));
    await waitForQuiet(rec);
    expect(reads(list, m)).toBe(0);
  });

  it('the loading cue shows while a read runs', async () => {
    const view = await mount();
    await waitForQuiet(rec);
    expect(loadingCue(view.container)).toBeNull();
    let release!: () => void;
    hold = new Promise<void>((r) => { release = r; });
    typeSearch('ROW');
    await act(() => new Promise((r) => setTimeout(r, 150)));
    expect(rec.log.at(-1)?.path).toBe(list);
    expect(loadingCue(view.container)).not.toBeNull();
    await act(async () => { release(); });
    await waitForQuiet(rec);
    expect(loadingCue(view.container)).toBeNull();
  });

  it('a failed read opens the error alert and keeps the rows on screen', async () => {
    await mount();
    await waitForQuiet(rec);
    expect(screen.getAllByText('ROWMARK').length).toBeGreaterThan(0);
    failList = list;
    typeSearch('ROWM');
    await waitForQuiet(rec);
    expect(screen.getAllByText(alert).length).toBeGreaterThan(0);
    expect(screen.getAllByText('ROWMARK').length).toBeGreaterThan(0);
  });
});
