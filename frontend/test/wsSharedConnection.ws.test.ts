/* [FIX-20260810-WSSHARED] The shared-connection guarantees.
 *
 * `useTicketWS.ws.test.ts` (UNCHANGED by this fix) pins the transport contract —
 * verbatim forwarding, ordering, malformed-drop, 4001, backoff, cleanup. This file
 * pins what the fix ADDS: one socket per tab, and every subscriber still receiving
 * every event.
 *
 * The owner's requirement was "realtime เหมือนเดิมทุกอย่าง + best practice", so the
 * fan-out assertions below are the ones that matter: N hooks, 1 socket, N deliveries.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

let mockTicket: string | null = 'ticket-abc';
const mintCalls = { n: 0 };
vi.mock('../services/admin/authService', () => ({
  mintWsTicket: () => {
    mintCalls.n += 1;
    return mockTicket === null
      ? Promise.reject(new Error('mint failed'))
      : Promise.resolve(mockTicket);
  },
}));

class FakeWS {
  static instances: FakeWS[] = [];
  url: string;
  readyState = 0;
  closed = false;
  onopen: ((e?: any) => void) | null = null;
  onmessage: ((e: any) => void) | null = null;
  onclose: ((e: any) => void) | null = null;
  onerror: ((e?: any) => void) | null = null;
  constructor(url: string) { this.url = url; FakeWS.instances.push(this); }
  close() { this.closed = true; this.readyState = 3; }
}

const originalWS = globalThis.WebSocket;

async function loadHook() {
  const mod = await import('../services/chat/useTicketWS');
  return mod.useTicketWS;
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  FakeWS.instances = [];
  mockTicket = 'ticket-abc';
  mintCalls.n = 0;
  (globalThis as any).WebSocket = FakeWS;
  vi.resetModules(); // module-level connection state must not leak between tests
});

afterEach(() => {
  (globalThis as any).WebSocket = originalWS;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('[FIX-20260810-WSSHARED] one socket per tab, every subscriber still served', () => {
  it('opens ONE socket for six subscribers (was: one each)', async () => {
    const useTicketWS = await loadHook();
    // the six real call sites: App, ChatRoomView ×2, Contact, TicketSupport, TicketChat
    renderHook(() => {
      useTicketWS(vi.fn());
      useTicketWS(vi.fn());
      useTicketWS(vi.fn());
      useTicketWS(vi.fn());
      useTicketWS(vi.fn());
      useTicketWS(vi.fn());
    });
    await flushMicrotasks();
    expect(FakeWS.instances).toHaveLength(1);
  });

  it('mints ONE ticket for those six subscribers (was: six single-use tickets)', async () => {
    const useTicketWS = await loadHook();
    renderHook(() => {
      useTicketWS(vi.fn());
      useTicketWS(vi.fn());
      useTicketWS(vi.fn());
      useTicketWS(vi.fn());
      useTicketWS(vi.fn());
      useTicketWS(vi.fn());
    });
    await flushMicrotasks();
    expect(mintCalls.n).toBe(1);
  });

  it('REALTIME UNCHANGED: every subscriber receives every event, verbatim', async () => {
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();
    const useTicketWS = await loadHook();
    renderHook(() => { useTicketWS(a); useTicketWS(b); useTicketWS(c); });
    await flushMicrotasks();
    const ws = FakeWS.instances[0];
    ws.onopen?.();
    const evt = { type: 'ticket:new', data: { id: 't1', hook_id: 'h1' }, ts: 5 };
    ws.onmessage?.({ data: JSON.stringify(evt) });
    for (const fn of [a, b, c]) {
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith(evt);
    }
  });

  it('REALTIME UNCHANGED: multi-event ordering preserved for every subscriber', async () => {
    const a = vi.fn();
    const b = vi.fn();
    const useTicketWS = await loadHook();
    renderHook(() => { useTicketWS(a); useTicketWS(b); });
    await flushMicrotasks();
    const ws = FakeWS.instances[0];
    ws.onopen?.();
    const e1 = { type: 'message:new', data: { room_id: 'r1' }, ts: 1 };
    const e2 = { type: 'message:updated', data: { room_id: 'r1' }, ts: 2 };
    ws.onmessage?.({ data: JSON.stringify(e1) });
    ws.onmessage?.({ data: JSON.stringify(e2) });
    for (const fn of [a, b]) {
      expect(fn.mock.calls.map((call) => call[0])).toEqual([e1, e2]);
    }
  });

  it('a subscriber unmounting does NOT cut realtime for the others', async () => {
    // The regression this guards: last-one-out teardown must count subscribers,
    // not fire on the first unmount.
    const stay = vi.fn();
    const useTicketWS = await loadHook();
    renderHook(() => useTicketWS(stay));
    const leaving = renderHook(() => useTicketWS(vi.fn()));
    await flushMicrotasks();
    const ws = FakeWS.instances[0];
    ws.onopen?.();

    leaving.unmount();

    expect(ws.closed).toBe(false);
    ws.onmessage?.({ data: JSON.stringify({ type: 'ticket:new', data: {}, ts: 7 }) });
    expect(stay).toHaveBeenCalledTimes(1);
  });

  it('closes the socket once the LAST subscriber unmounts', async () => {
    const useTicketWS = await loadHook();
    const one = renderHook(() => useTicketWS(vi.fn()));
    const two = renderHook(() => useTicketWS(vi.fn()));
    await flushMicrotasks();
    const ws = FakeWS.instances[0];
    one.unmount();
    expect(ws.closed).toBe(false);
    two.unmount();
    expect(ws.closed).toBe(true);
  });

  it('an unsubscribed handler stops receiving events', async () => {
    const gone = vi.fn();
    const stay = vi.fn();
    const useTicketWS = await loadHook();
    renderHook(() => useTicketWS(stay));
    const leaving = renderHook(() => useTicketWS(gone));
    await flushMicrotasks();
    const ws = FakeWS.instances[0];
    leaving.unmount();
    ws.onmessage?.({ data: JSON.stringify({ type: 'ticket:new', data: {}, ts: 8 }) });
    expect(gone).not.toHaveBeenCalled();
    expect(stay).toHaveBeenCalledTimes(1);
  });

  it('remounting after a full teardown opens a fresh socket', async () => {
    // teardown flips a module-level guard; a later mount must clear it, or the
    // chat page would stay dead after everything unmounts once.
    const useTicketWS = await loadHook();
    const first = renderHook(() => useTicketWS(vi.fn()));
    await flushMicrotasks();
    first.unmount();
    expect(FakeWS.instances).toHaveLength(1);

    const again = vi.fn();
    renderHook(() => useTicketWS(again));
    await flushMicrotasks();
    expect(FakeWS.instances).toHaveLength(2);
    FakeWS.instances[1].onmessage?.({
      data: JSON.stringify({ type: 'ticket:new', data: {}, ts: 9 }),
    });
    expect(again).toHaveBeenCalledTimes(1);
  });

  it('a subscriber unmounting during dispatch does not skip the NEXT one', async () => {
    // Deleting from a live Set mid-iteration skips the entry that follows the
    // deleted one (verified: iterating ['a','b','c'] and deleting 'b' while on
    // 'a' yields a,c). The first handler here unmounts the SECOND subscriber, so
    // without the Array.from snapshot in emit() the second never fires — while
    // the third still does, which is why the assertion targets the second.
    const useTicketWS = await loadHook();
    const second = vi.fn();
    let secondHook: { unmount: () => void } | null = null;
    const first = vi.fn(() => { secondHook?.unmount(); });

    renderHook(() => useTicketWS(first as any));
    secondHook = renderHook(() => useTicketWS(second));
    await flushMicrotasks();

    const ws = FakeWS.instances[0];
    ws.onmessage?.({ data: JSON.stringify({ type: 'ticket:new', data: {}, ts: 10 }) });

    // Snapshotted before dispatch ⇒ it was still subscribed when the frame
    // arrived, so it must receive that frame even though it unmounts mid-loop.
    expect(second).toHaveBeenCalledTimes(1);
  });
});
