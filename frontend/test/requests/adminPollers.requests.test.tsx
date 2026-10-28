/**
 * [FEAT-20261027-TANSTACK] REQUEST COUNT — the six screens with the hand-rolled 20s poll (P4).
 * Users · Groups · SystemConfig · AuditLogs · AutoReplies · AssignHistory.
 * Real pages + real services; only `fetch` is faked. Pinned on the UNCHANGED pages first:
 * each case below must pass on the old code AND on the move to queries.
 *
 * The shared contract every one of them hand-wrote (e.g. pages/admin/Users.tsx [FIX-20260809-POLLVIS]):
 *   open → 1 list read · visible tab → 1 read per 20s · hidden tab → none ·
 *   tab becomes visible again → 1 read at once · a failed read clears the rows
 *   (and, except AuditLogs, opens the error alert) · while that alert is open → no poll.
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { render, act, cleanup, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { installFetchRecorder, httpError, setTabHidden, waitForQuiet } from './fetchRecorder';

if (!('ResizeObserver' in globalThis)) (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
if (!window.matchMedia) (window as any).matchMedia = () => ({ matches: false, media: '', onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false });

// each case mounts a real screen up to twice and waits for the network to settle —
// under a loaded parallel run that alone can pass the 5s default (seen once on SystemConfig)
vi.setConfig({ testTimeout: 15_000 });

vi.mock('../../services/authStorage', async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  const perms = ['user.manage', 'group.manage', 'config.manage', 'audit.manage', 'auto_reply.manage', 'assign_history.manage', 'hook.manage'];
  const auth = { role: { name: 'superadmin' }, user: { id: 'admin1', username: 'admin1', role: 'superadmin' }, token: 't', permissions: perms, allowed_hooks: null };
  return { ...actual, getStoredAuth: () => auth, getAuthUser: () => auth.user };
});

let failList: string | null = null;
let hold: Promise<void> | null = null;
let withRow = false;
// one row whose every likely display field carries the marker, so each screen renders it somewhere
const ROW = { _id: 'a0d00000000000000000009b', id: 'a0d00000000000000000009b', username: 'ROWMARK', display_name: 'ROWMARK',
  group_name: 'ROWMARK', key: 'ROWMARK', value: 'ROWMARK', name: 'ROWMARK', keyword: 'ROWMARK', action: 'ROWMARK',
  hook_alias: 'ROWMARK', detail: 'ROWMARK', status: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
const pageOf = () => ({ success: true, data: withRow ? [ROW] : [], pagination: { total: withRow ? 1 : 0, total_pages: 1, page: 1 } });
const rec = installFetchRecorder([
  [/^\/(api\/users|api\/groups|configs|audit\/logs|api\/auto-replies|api\/assign-histories)$/, async (path) => {
    if (hold) await hold;
    return failList === path ? httpError(500, { success: false, message: 'list exploded' }) : pageOf();
  }],
]);
afterAll(() => rec.restore());
afterEach(() => { cleanup(); failList = null; hold = null; withRow = false; setTabHidden(false); });
/** these screens DO show their loading cue on a poll tick (only the Hook list was made silent, by the owner) */
const loadingCue = (root: HTMLElement) => root.querySelector('.h-0\\.5.animate-pulse, svg.animate-spin');

import { I18nProvider } from '../../i18n';

type Screen = { name: string; list: string; load: () => Promise<React.ComponentType>; alertOnFail: boolean };
const SCREENS: Screen[] = [
  { name: 'Users', list: '/api/users', load: async () => (await import('../../pages/admin/Users')).Users, alertOnFail: true },
  { name: 'Groups', list: '/api/groups', load: async () => (await import('../../pages/admin/Groups')).Groups, alertOnFail: true },
  { name: 'SystemConfig', list: '/configs', load: async () => (await import('../../pages/admin/SystemConfig')).SystemConfig, alertOnFail: true },
  { name: 'AuditLogs', list: '/audit/logs', load: async () => (await import('../../pages/admin/AuditLogs')).AuditLogs, alertOnFail: false },
  { name: 'AutoReplies', list: '/api/auto-replies', load: async () => (await import('../../pages/messaging/AutoReplies')).AutoReplies, alertOnFail: true },
  { name: 'AssignHistory', list: '/api/assign-histories', load: async () => (await import('../../pages/handoff/AssignHistory')).AssignHistory, alertOnFail: true },
];
const ALERT_TITLES = /โหลดข้อมูลไม่สำเร็จ|โหลดไม่สำเร็จ/;

const listReads = (path: string, m: number) => rec.since(m).filter((r) => r.path === path && r.method === 'GET').length;
const advance = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms); }); await waitForQuiet(rec); };

describe.each(SCREENS)('[REQ-POLL] $name', ({ list, load, alertOnFail }) => {
  beforeAll(() => { vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }); });
  afterAll(() => { vi.useRealTimers(); });
  const mount = async () => {
    const Page = await load();
    return render(<I18nProvider><MemoryRouter><Page /></MemoryRouter></I18nProvider>);
  };

  it('open → 1 list read', async () => {
    const m = rec.mark();
    await mount();
    await waitForQuiet(rec);
    expect(listReads(list, m)).toBe(1);
  });

  it('visible tab → 1 read per 20s', async () => {
    await mount();
    await waitForQuiet(rec);
    const m = rec.mark();
    await advance(20_000);   // one tick at a time: a real read lands long before the next tick
    await advance(20_000);
    expect(listReads(list, m)).toBe(2);
  });

  it('hidden tab → no poll · visible again → 1 read at once', async () => {
    await mount();
    await waitForQuiet(rec);
    act(() => setTabHidden(true));
    let m = rec.mark();
    await advance(60_000);
    expect(listReads(list, m)).toBe(0);
    m = rec.mark();
    act(() => setTabHidden(false));
    await waitForQuiet(rec);
    expect(listReads(list, m)).toBe(1);
  });

  it('a poll tick shows the loading cue while it runs (unchanged — not silenced)', async () => {
    const view = await mount();
    await waitForQuiet(rec);
    expect(loadingCue(view.container)).toBeNull();          // idle: no cue — so the next check means something
    let release!: () => void;
    hold = new Promise<void>((r) => { release = r; });
    await act(async () => { vi.advanceTimersByTime(20_000); });
    await act(() => new Promise((r) => setTimeout(r, 100)));
    expect(rec.log.at(-1)?.path).toBe(list);
    expect(loadingCue(view.container)).not.toBeNull();
    await act(async () => { release(); });
    await waitForQuiet(rec);
  });

  it(alertOnFail ? 'a failed read opens the error alert, and no poll runs while it is open' : 'a failed read is silent and polling carries on', async () => {
    failList = list;
    await mount();
    await waitForQuiet(rec);
    if (alertOnFail) expect(screen.getAllByText(ALERT_TITLES).length).toBeGreaterThan(0);
    else expect(screen.queryByText(ALERT_TITLES)).toBeNull();
    const m = rec.mark();
    await advance(20_000);
    await advance(20_000);
    expect(listReads(list, m)).toBe(alertOnFail ? 0 : 2);
  });

  it('a failed read after a good one clears the rows', async () => {
    withRow = true;
    await mount();
    await waitForQuiet(rec);
    const shown = screen.queryAllByText(/ROWMARK/).length;
    expect(shown).toBeGreaterThan(0);
    failList = list;
    await advance(20_000);
    expect(screen.queryAllByText(/ROWMARK/).length).toBe(0);
  });

  it('coming back after a visit that ended on a failed poll does not re-open a stale alert', async () => {
    const first = await mount();
    await waitForQuiet(rec);                 // a good read first …
    failList = list;
    await advance(20_000);                   // … then a failing poll (the cache now holds data AND an error)
    first.unmount();
    failList = null;
    await mount();
    await waitForQuiet(rec);
    expect(screen.queryByText(ALERT_TITLES)).toBeNull();
  });
});
