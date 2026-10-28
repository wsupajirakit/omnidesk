/* [PERF-20260822-TKTIDSFETCH] ทุกทางตกกลับของ partial fetch ต้องไปถึง full refetch
 *
 * เทสนี้มีเพราะตอนตรรกะยังฝังใน TicketChat.tsx ไม่มีอะไรจับได้ถ้าใครลบ
 * `scheduleRefetch()` ใน catch ออก — ผิดแล้ว "เงียบ" คือตั๋วไม่โผล่โดยไม่มี error
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { usePartialTicketFetch } from '../services/chat/usePartialTicketFetch';
import { PARTIAL_FETCH_MAX_IDS } from '../services/chat/partialTicketMerge';

const row = (id: string, hook = 'h1') => ({ _id: id, line_oa_hook_id: hook });
type Row = ReturnType<typeof row>;
type ListFn = (id: string, params: Record<string, unknown>) => Promise<{ success?: boolean; data?: Row[] } | null | undefined>;

function harness(over: Partial<Parameters<typeof usePartialTicketFetch>[0]> = {}) {
  let state: Row[] = [row('a'), row('b')];
  const listByGroup = vi.fn<ListFn>(async () => ({ success: true, data: [row('c')] }));
  const listByHook = vi.fn<ListFn>(async () => ({ success: true, data: [row('c')] }));
  const scheduleRefetch = vi.fn();
  const setActiveTickets = vi.fn((u: (p: typeof state) => typeof state) => { state = u(state); });
  const scope = {
    activeGroupId: null, activeHookId: 'h1', withinDays: 3, search: 'สม',
    allowedHooks: new Set(['h1']), ...over,
  };
  const hook = renderHook(() =>
    usePartialTicketFetch(scope, { listByGroup, listByHook, scheduleRefetch, setActiveTickets, debounceMs: 10 }),
  );
  return { hook, listByGroup, listByHook, scheduleRefetch, setActiveTickets, get state() { return state; } };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const tick = async (ms = 20) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

describe('⭐ ทางปกติ — ส่งพารามิเตอร์เดิมครบ แล้ว merge', () => {
  it('ยิง listByHook ด้วย job_status/limit/within_days/search เดิม + ids', async () => {
    const h = harness();
    act(() => h.hook.result.current('x'));
    await tick();
    expect(h.listByHook).toHaveBeenCalledTimes(1);
    expect(h.listByHook.mock.calls[0][1]).toEqual({
      job_status: '0,1', limit: 'all', within_days: 3, search: 'สม', ids: ['x'],
    });
    expect(h.state.map((t) => t._id)).toEqual(['a', 'b', 'c']);
    expect(h.scheduleRefetch).not.toHaveBeenCalled();
  });

  it('group scope มาก่อน hook — เหมือน fetchActive', async () => {
    const h = harness({ activeGroupId: 'g1', activeHookId: 'h1' });
    act(() => h.hook.result.current('x'));
    await tick();
    expect(h.listByGroup).toHaveBeenCalledTimes(1);
    expect(h.listByHook).not.toHaveBeenCalled();
  });

  it('หลาย id ในหน้าต่างเดียว → ยิงครั้งเดียว พก id ทุกตัว ไม่ซ้ำ', async () => {
    const h = harness();
    act(() => { h.hook.result.current('x'); h.hook.result.current('y'); h.hook.result.current('x'); });
    await tick();
    expect(h.listByHook).toHaveBeenCalledTimes(1);
    expect((h.listByHook.mock.calls[0][1] as { ids: string[] }).ids).toEqual(['x', 'y']);
  });

  it('แถวที่ได้ถูกกรองสิทธิ์ก่อน merge', async () => {
    const h = harness();
    h.listByHook.mockResolvedValueOnce({ success: true, data: [row('z', 'h9')] });
    act(() => h.hook.result.current('z'));
    await tick();
    expect(h.state.map((t) => t._id)).toEqual(['a', 'b']);
  });
});

describe('⭐ ทุกทางตกกลับ → scheduleRefetch ห้ามเงียบ', () => {
  it('⓪ ไม่มี id (event ผิดรูป) → full ทันที ไม่รอ debounce', () => {
    const h = harness();
    act(() => h.hook.result.current(''));
    expect(h.scheduleRefetch).toHaveBeenCalledTimes(1);
    expect(h.listByHook).not.toHaveBeenCalled();
  });

  it('① ไม่มี scope เลย → full', async () => {
    const h = harness({ activeGroupId: null, activeHookId: null });
    act(() => h.hook.result.current('x'));
    await tick();
    expect(h.scheduleRefetch).toHaveBeenCalledTimes(1);
    expect(h.setActiveTickets).not.toHaveBeenCalled();
  });

  it('② BE ตอบ success:false → full', async () => {
    const h = harness();
    h.listByHook.mockResolvedValueOnce({ success: false });
    act(() => h.hook.result.current('x'));
    await tick();
    expect(h.scheduleRefetch).toHaveBeenCalledTimes(1);
    expect(h.setActiveTickets).not.toHaveBeenCalled();
  });

  it('② BE ตอบ null → full', async () => {
    const h = harness();
    h.listByHook.mockResolvedValueOnce(null);
    act(() => h.hook.result.current('x'));
    await tick();
    expect(h.scheduleRefetch).toHaveBeenCalledTimes(1);
  });

  it('③ โยน error → full และไม่โยนต่อ', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = harness();
    h.listByHook.mockRejectedValueOnce(new Error('network'));
    act(() => h.hook.result.current('x'));
    await tick();
    expect(h.scheduleRefetch).toHaveBeenCalledTimes(1);
    expect(h.setActiveTickets).not.toHaveBeenCalled();
  });

  it('เกินเพดาน → full และทิ้ง id ที่สะสม ไม่ยิง partial', async () => {
    const h = harness();
    act(() => { for (let i = 0; i <= PARTIAL_FETCH_MAX_IDS; i++) h.hook.result.current('id' + i); });
    expect(h.scheduleRefetch).toHaveBeenCalledTimes(1);
    await tick();
    expect(h.listByHook).not.toHaveBeenCalled();
  });
});

describe('⭐ อ่าน scope ล่าสุดตอน timer ยิง ไม่ใช่ตอน schedule', () => {
  it('สลับ search ระหว่าง debounce → ยิงด้วยค่าใหม่', async () => {
    let search = 'เก่า';
    const listByHook = vi.fn<ListFn>(async () => ({ success: true, data: [] }));
    const hook = renderHook(() =>
      usePartialTicketFetch(
        { activeGroupId: null, activeHookId: 'h1', withinDays: undefined, search, allowedHooks: null },
        { listByGroup: vi.fn<ListFn>(), listByHook, scheduleRefetch: vi.fn(), setActiveTickets: vi.fn(), debounceMs: 10 },
      ),
    );
    act(() => hook.result.current('x'));
    search = 'ใหม่';
    hook.rerender();
    await tick();
    expect((listByHook.mock.calls[0][1] as { search: string }).search).toBe('ใหม่');
  });
});

describe('⭐ unmount ระหว่าง debounce → ไม่ยิงค้าง', () => {
  it('timer ถูกล้าง', async () => {
    const h = harness();
    act(() => h.hook.result.current('x'));
    h.hook.unmount();
    await tick();
    expect(h.listByHook).not.toHaveBeenCalled();
  });
});
