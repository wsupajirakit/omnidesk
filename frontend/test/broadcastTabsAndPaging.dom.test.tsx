/**
 * [FEAT-20260824-BCASTTABS] + [FEAT-20260824-TABLEPAGER] + [FEAT-20260824-BCASTENABLED]
 * The Broadcasts page, driven through the real component tree.
 * ===========================================================================
 * Three things the owner asked for on 24/08, all of them page behaviour rather
 * than a pure function, so they are exercised on a real render:
 *
 *  1. "ทำแท็บ ประวัติ ข้าง บอร์ดแคสแล้วสลับ" — the campaign list and the send log
 *     used to STACK, and the log started below the fold. Tabs, one at a time.
 *  2. "page gnation / per page ทั้งสอง table" — the per-page size must actually
 *     REACH the request as `limit`, on both tables. A selector that changes a
 *     state nobody sends is the same bug in a nicer shape. เลือกแล้วต้องถึง API.
 *  3. "สถานะ คือเปิด ปิด ใช้งาน ไม่ใช่ส่งแล้ว" — the สถานะ column answers "armed?",
 *     and the lifecycle it replaced is still on screen, just in its own column.
 *
 * The services and the modals are mocked; everything under test — the page, the
 * shared pager, the tabs, the badge — is the real thing.
 * ⚠️ `components/campaign` is mocked on purpose: this page only needs the modal
 * to exist, and stubbing it keeps this file independent of that folder.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react';

const listBroadcasts = vi.fn();
const getLogsWithFilters = vi.fn();

vi.mock('../services/messaging', () => ({
  broadcastService: {
    listBroadcasts: (...a: unknown[]) => listBroadcasts(...a),
    createBroadcast: vi.fn(),
    updateBroadcast: vi.fn(),
    deleteBroadcast: vi.fn(),
  },
}));

vi.mock('../services/hook', () => ({
  webhookService: { getAllHooks: () => Promise.resolve([]) },
  webhookLogService: { getLogsWithFilters: (...a: unknown[]) => getLogsWithFilters(...a) },
}));

vi.mock('../components/campaign', () => ({ BroadcastFormModal: () => null }));
vi.mock('../components/modals', () => ({
  ConfirmModal: () => null,
  AlertModal: () => null,
  WebhookLogDetailModal: () => null,
}));

import { Broadcasts } from '../pages/messaging/Broadcasts';

/** A campaign row. `schedule` is left OUT unless a case names it. */
const row = (over: Record<string, unknown> = {}) => ({
  id: 'b1',
  name: 'promo',
  hook_ids: [],
  target: {},
  message: { type: 'text', text: 'hi' },
  status: 'draft',
  ...over,
});

beforeEach(() => {
  listBroadcasts.mockReset();
  getLogsWithFilters.mockReset();
  listBroadcasts.mockResolvedValue({ data: [row()], pagination: { total: 1, total_pages: 1 } });
  getLogsWithFilters.mockResolvedValue({ data: [], pagination: { total: 0, total_pages: 1 } });
});

/* ⚠️ FLIPPED 25/08/2026 — this helper used to ALSO wait for `getLogsWithFilters`
   on mount, and that wait is what every case in this file hung on today.
   It was not wrong when it was written: the page really did fetch both tables
   at mount. [FEAT-20260824-BCASTLAZY] retired that on the owner's instruction
   ("auto fetch ทำดีๆ กัน history log บวม" + "lazy load") — the log table is behind
   a tab, so someone who only came to read the campaign list should not pay for
   a log query they never open.
   ⇒ the old expectation is SUPERSEDED, not relaxed: mount-time log fetching is
   now pinned as something that must NOT happen (see the [BCASTLAZY] cases at the
   bottom of this file), and every case that genuinely needs the log opens the tab
   through `openHistory` first. ห้ามลบเคส — พลิกพร้อมเหตุผล. */
/** Render and wait for the LIST's first fetch. The log is lazy — see `openHistory`. */
const draw = async () => {
  const v = render(<Broadcasts />);
  await waitFor(() => expect(listBroadcasts).toHaveBeenCalled());
  return v;
};

/** Open ประวัติ and wait for the log's FIRST fetch — the one the tab click triggers. */
const openHistory = async (v: ReturnType<typeof render>) => {
  await act(async () => { fireEvent.click(v.getByTestId('broadcast-tab-history')); });
  await waitFor(() => expect(getLogsWithFilters).toHaveBeenCalled());
};

/** The options passed to the most recent call of a mocked service. */
const lastArgs = (fn: typeof listBroadcasts) =>
  fn.mock.calls[fn.mock.calls.length - 1]![0] as Record<string, unknown>;

describe('[BCASTTABS] the two tables no longer stack', () => {
  it('🔴 the list is the landing tab and the log is NOT on screen with it', async () => {
    const v = await draw();
    expect(v.queryByTestId('broadcast-list-panel')).not.toBeNull();
    expect(v.queryByTestId('broadcast-history-panel')).toBeNull();
  });

  it('🔴 clicking ประวัติ swaps which table is mounted — it does not add a second one', async () => {
    const v = await draw();
    await act(async () => { fireEvent.click(v.getByTestId('broadcast-tab-history')); });
    expect(v.queryByTestId('broadcast-history-panel')).not.toBeNull();
    expect(v.queryByTestId('broadcast-list-panel')).toBeNull();
  });

  it('and back again', async () => {
    const v = await draw();
    await act(async () => { fireEvent.click(v.getByTestId('broadcast-tab-history')); });
    await act(async () => { fireEvent.click(v.getByTestId('broadcast-tab-broadcasts')); });
    expect(v.queryByTestId('broadcast-list-panel')).not.toBeNull();
    expect(v.queryByTestId('broadcast-history-panel')).toBeNull();
  });

  it('the active tab is marked for assistive tech, not only by colour', async () => {
    const v = await draw();
    expect(v.getByTestId('broadcast-tab-broadcasts').getAttribute('aria-selected')).toBe('true');
    expect(v.getByTestId('broadcast-tab-history').getAttribute('aria-selected')).toBe('false');
  });

  it('the list-only filters leave with the list — they filter nothing on ประวัติ', async () => {
    const v = await draw();
    expect(v.queryByTestId('broadcast-list-filters')).not.toBeNull();
    await act(async () => { fireEvent.click(v.getByTestId('broadcast-tab-history')); });
    expect(v.queryByTestId('broadcast-list-filters')).toBeNull();
  });

  it('🔴 a typed search survives a round trip through the ประวัติ tab', async () => {
    /* The markup unmounts, the STATE does not. Losing what an admin typed on a
       tab click would be a new bug traded for the old one. */
    const v = await draw();
    const input = v.getByPlaceholderText('broadcast.search_placeholder') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'promo' } });
    await act(async () => { fireEvent.click(v.getByTestId('broadcast-tab-history')); });
    await act(async () => { fireEvent.click(v.getByTestId('broadcast-tab-broadcasts')); });
    expect((v.getByPlaceholderText('broadcast.search_placeholder') as HTMLInputElement).value)
      .toBe('promo');
  });
});

describe('[TABLEPAGER] per-page reaches the request on BOTH tables', () => {
  it('🔴 the list asks for 10 by default, and 50 once 50 is picked', async () => {
    const v = await draw();
    expect(lastArgs(listBroadcasts).limit).toBe(10);
    await act(async () => {
      fireEvent.change(v.getByTestId('broadcast-pager-per-page'), { target: { value: '50' } });
    });
    await waitFor(() => expect(lastArgs(listBroadcasts).limit).toBe(50));
  });

  it('🔴 changing the size resets to page 1 — page 9 of 100-per-page is past the end', async () => {
    /* Without the reset the server answers an out-of-range page with nothing,
       and the table reads as "no campaigns". เปลี่ยนจำนวนต่อหน้า ต้องกลับหน้า 1. */
    listBroadcasts.mockResolvedValue({ data: [row()], pagination: { total: 95, total_pages: 10 } });
    const v = await draw();
    await act(async () => { fireEvent.click(v.getByTestId('broadcast-pager-next')); });
    await waitFor(() => expect(lastArgs(listBroadcasts).page).toBe(2));
    await act(async () => {
      fireEvent.change(v.getByTestId('broadcast-pager-per-page'), { target: { value: '100' } });
    });
    await waitFor(() => expect(lastArgs(listBroadcasts).limit).toBe(100));
    expect(lastArgs(listBroadcasts).page).toBe(1);
  });

  it('🔴 the log table has its own per-page, and it reaches ITS request', async () => {
    const v = await draw();
    // the log's default size is only observable once the tab has asked for it
    await openHistory(v);
    expect(lastArgs(getLogsWithFilters).limit).toBe(10);
    await act(async () => {
      fireEvent.change(v.getByTestId('broadcast-log-pager-per-page'), { target: { value: '25' } });
    });
    await waitFor(() => expect(lastArgs(getLogsWithFilters).limit).toBe(25));
    expect(lastArgs(getLogsWithFilters).page).toBe(1);
  });

  it('the two sizes are independent — the log keeps 10 when the list moves to 50', async () => {
    const v = await draw();
    /* Open ประวัติ once and come back, so the log HAS asked for something and the
       comparison is between two real requests rather than against a mock that
       was never called. */
    await openHistory(v);
    await act(async () => { fireEvent.click(v.getByTestId('broadcast-tab-broadcasts')); });
    await act(async () => {
      fireEvent.change(v.getByTestId('broadcast-pager-per-page'), { target: { value: '50' } });
    });
    await waitFor(() => expect(lastArgs(listBroadcasts).limit).toBe(50));
    expect(lastArgs(getLogsWithFilters).limit).toBe(10);
  });

  it('the log filter still reaches the request untouched', async () => {
    /* The pager swap must not disturb what the log table was already asking for. */
    const v = await draw();
    await openHistory(v);
    expect(lastArgs(getLogsWithFilters).channel).toBe('line_api');
    expect(lastArgs(getLogsWithFilters).action_type).toBe('send_broadcast');
  });
});

describe('[BCASTENABLED] the สถานะ column says เปิด/ปิด', () => {
  const cell = (v: ReturnType<typeof render>, id: string) => v.getByTestId(id);

  it('🔴 a schedule with enabled:false renders ปิดใช้งาน', async () => {
    listBroadcasts.mockResolvedValue({
      data: [row({ schedule: { mode: 'interval', enabled: false } })],
      pagination: { total: 1, total_pages: 1 },
    });
    const v = await draw();
    await waitFor(() => expect(v.queryByTestId('enabled-b1')).not.toBeNull());
    expect(cell(v, 'enabled-b1').getAttribute('data-enable-state')).toBe('off');
    expect(cell(v, 'enabled-b1').textContent).toBe('ปิดใช้งาน');
  });

  it('🔴 enabled:null renders เปิดใช้งาน — the outage shape, on the real row', async () => {
    /* Mongo stores null for a declared-but-unset field. Painting those rows as
       ปิด is what took live campaigns down. null = เปิด. */
    listBroadcasts.mockResolvedValue({
      data: [row({ schedule: { mode: 'interval', enabled: null } })],
      pagination: { total: 1, total_pages: 1 },
    });
    const v = await draw();
    await waitFor(() => expect(v.queryByTestId('enabled-b1')).not.toBeNull());
    expect(cell(v, 'enabled-b1').getAttribute('data-enable-state')).toBe('on');
    expect(cell(v, 'enabled-b1').textContent).toBe('เปิดใช้งาน');
  });

  it('🔴 a row with NO schedule is neither เปิด nor ปิด', async () => {
    /* It is a one-off campaign — nobody switched anything off. */
    const v = await draw();
    await waitFor(() => expect(v.queryByTestId('enabled-b1')).not.toBeNull());
    expect(cell(v, 'enabled-b1').getAttribute('data-enable-state')).toBe('one_off');
    expect(cell(v, 'enabled-b1').textContent).not.toContain('ปิด');
    expect(cell(v, 'enabled-b1').textContent).not.toContain('เปิด');
  });

  it('🔴 the lifecycle is still on screen, in its own column — not deleted', async () => {
    /* Owner wanted สถานะ to stop meaning "ส่งแล้ว", not to lose the fact that a
       campaign is still ฉบับร่าง. ย้ายที่ ไม่ใช่ลบทิ้ง. */
    listBroadcasts.mockResolvedValue({
      data: [row({ status: 'sent', schedule: { enabled: true } })],
      pagination: { total: 1, total_pages: 1 },
    });
    const v = await draw();
    await waitFor(() => expect(v.queryByTestId('lifecycle-b1')).not.toBeNull());
    expect(cell(v, 'lifecycle-b1').textContent).toBe('broadcast.status_sent');
    expect(cell(v, 'enabled-b1').textContent).toBe('เปิดใช้งาน');
  });

  it('the existing created-by cell keeps its testid — nothing was traded away', async () => {
    const v = await draw();
    await waitFor(() => expect(v.queryByTestId('created-by-b1')).not.toBeNull());
  });
});

/* [PERF-20260825-LAZYLOG] The log table is not fetched until it is on screen.
 * ===========================================================================
 * Owner: "auto fetch ทำดีๆ กัน history log บวม" + "lazy load".
 *
 * ⚠️ WHY THESE LIVE HERE AND NOT IN `broadcastPolling.test.ts`. That file tests
 * the pure predicate and was green through a real defect: the predicate said
 * "load once opened", the page called it with a latch that never unlatched, and
 * `activeTab` sat in the effect's dependencies — so coming BACK to the campaign
 * list fired a log query for a table that is not even mounted. A pure test
 * cannot see WHAT the caller passes. These cases count the actual calls.
 */
describe('[BCASTLAZY] the log query follows what is on screen', () => {
  it('⭐⭐ mount does not touch the log at all — the list is the landing tab', async () => {
    await draw();
    expect(getLogsWithFilters).not.toHaveBeenCalled();
  });

  it('⭐⭐ opening ประวัติ is what loads it, exactly once', async () => {
    const v = await draw();
    await openHistory(v);
    expect(getLogsWithFilters.mock.calls.length).toBe(1);
  });

  it('⭐⭐ going BACK to the list does not fire another log query', async () => {
    /* The defect this file exists to catch. The log table unmounts on the way
       back, so a query issued here is paid for and thrown away. */
    const v = await draw();
    await openHistory(v);
    await act(async () => { fireEvent.click(v.getByTestId('broadcast-tab-broadcasts')); });
    expect(getLogsWithFilters.mock.calls.length).toBe(1);
  });

  it('a second deliberate visit DOES refresh it — lazy, not frozen', async () => {
    /* Lazy must not turn into stale: someone who opens ประวัติ again is asking
       to see the current state of the sends. */
    const v = await draw();
    await openHistory(v);
    await act(async () => { fireEvent.click(v.getByTestId('broadcast-tab-broadcasts')); });
    await act(async () => { fireEvent.click(v.getByTestId('broadcast-tab-history')); });
    await waitFor(() => expect(getLogsWithFilters.mock.calls.length).toBe(2));
  });

  it('⭐ the campaign list still loads on mount — lazy applies to the log only', async () => {
    await draw();
    expect(listBroadcasts).toHaveBeenCalled();
  });
});
