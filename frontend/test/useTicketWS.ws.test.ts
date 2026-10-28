/* [FEAT-20260808-WSTEST] Characterization tests for the live-chat WebSocket transport
 * (`services/chat/useTicketWS.ts`) — the shared contract EVERY reconciliation consumer flows
 * through (App.tsx, TicketChat, TicketSupport, ChatRoomView, Contact all branch on `e.type` and
 * read `e.data`). These lock in the CURRENT behavior so a future regression in the transport —
 * which would silently break ticket-count / message reconciliation on all consumers — fails a test
 * instead of production. Purely additive: no product code changed, no runtime behavior altered.
 *
 * [FEAT-20260808-HTTPONLY-FE] RE-FROZEN to the ticket handshake. (a) WHAT: the transport now mints
 * a single-use WS ticket (POST /api/auth/ws-ticket, cookie-credentialed) and connects with
 * `?ticket=<t>&env=` INSTEAD of `?token=<jwt>&env=`. (b) WHY: the JWT moved into an HttpOnly cookie
 * JS cannot read, so it can no longer be placed in the WS URL; the ticket is the JS-readable,
 * short-lived, single-use stand-in omnidesk-ws validates. (c) REVERT: mock `../services/authStorage`'s
 * `getStoredAuth` again (token gate), and re-assert the `?token=<jwt>&env=` URL. This is a
 * DELIBERATE, re-frozen transport change — NOT a silent regression: every reconciliation assertion
 * below (verbatim forwarding, ordering, malformed-drop, latest-callback, 4001→no-reconnect,
 * backoff, cleanup) is kept byte-identical to prove the ticket path reconciles to the SAME final
 * state as the old token path. Only the handshake credential changed.
 *
 * Env note: WS_URL/WS_ENV are captured as module-level consts from import.meta.env at eval time.
 * vitest snapshots import.meta.env per imported module and `.env.*` is gitignored, so the values are
 * injected CI-reliably via a TEST-ONLY `define` in vitest.config.ts (VITE_WS_URL='wss://ws.test.local/live',
 * VITE_WS_ENV='test'). That is why the socket connects here. The complementary "no WS_URL → poll, do not
 * open a socket" guard is the app's production default (VITE_WS_URL unset) and is not per-test toggleable
 * under this harness; the early-return is instead exercised here via the mint-fails (credential) gate.
 *
 * Scope note (why not render TicketChat/TicketSupport here): the reconciliation math itself lives as
 * inline functional `setState` updaters inside the 4,200-line page components under the owner's frozen
 * "ไม่แตะสูตร query / การนับ" guard. It is not isolable without the owner-gated extraction, and
 * full-page render tests of those files (huge mock surface, WS + router + i18n) would be flaky and would
 * NOT actually exercise the count formula. So this suite pins the transport CONTRACT at the boundary the
 * consumers depend on. Extending to page-level reconciliation tests is deferred until the extraction is
 * approved — see to_dashboard_upgrade_v2.md F4 / §6.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// [FEAT-20260808-HTTPONLY-FE] Control the ticket the transport mints on each (re)connect. Closure
// over a module-scope var so the mock survives vi.resetModules() (factory re-runs, re-reads these).
// `mockTicket = null` simulates a mint FAILURE (the new credential gate — was: no stored token).
// revert: mock '../services/authStorage' getStoredAuth returning { token } instead.
let mockTicket: string | null = 'ticket-abc';
vi.mock('../services/admin/authService', () => ({
  mintWsTicket: () =>
    mockTicket === null
      ? Promise.reject(new Error('mint failed'))
      : Promise.resolve(mockTicket),
}));

// Controllable fake WebSocket — captures every constructed instance and lets a test drive the
// open/message/close lifecycle deterministically (jsdom's WebSocket would attempt a real connect).
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

// URL/env values injected by the TEST-ONLY define in vitest.config.ts (kept in sync here).
const WS_BASE = 'wss://ws.test.local/live';
const WS_ENV = 'test';

async function loadHook() {
  const mod = await import('../services/chat/useTicketWS');
  return mod.useTicketWS;
}

// [FEAT-20260808-HTTPONLY-FE] connect() now awaits mintWsTicket() before constructing the socket,
// so the socket appears a microtask (or two) after render — flush the microtask queue to settle it.
// Under fake timers this drains only pending microtasks (the mint promise), never wall-clock time.
async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  FakeWS.instances = [];
  mockTicket = 'ticket-abc';
  (globalThis as any).WebSocket = FakeWS;
  vi.resetModules();
});

afterEach(() => {
  (globalThis as any).WebSocket = originalWS;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useTicketWS — transport contract every reconciliation consumer depends on', () => {
  it('credential gate: if minting the ticket fails it opens NO socket (no valid credential)', async () => {
    mockTicket = null; // mint rejects → connect must not construct a socket
    const useTicketWS = await loadHook();
    renderHook(() => useTicketWS(vi.fn()));
    await flushMicrotasks();
    expect(FakeWS.instances).toHaveLength(0);
  });

  it('mints a ticket then connects once with it URL-encoded and the configured env in the query', async () => {
    mockTicket = 'a b/c'; // chars that MUST be percent-encoded
    const useTicketWS = await loadHook();
    renderHook(() => useTicketWS(vi.fn()));
    await flushMicrotasks();
    expect(FakeWS.instances).toHaveLength(1);
    expect(FakeWS.instances[0].url).toBe(`${WS_BASE}?ticket=a%20b%2Fc&env=${WS_ENV}`);
  });

  it('forwards a well-formed event VERBATIM (type + data) — the reconciliation contract', async () => {
    const onEvent = vi.fn();
    const useTicketWS = await loadHook();
    renderHook(() => useTicketWS(onEvent));
    await flushMicrotasks();
    const ws = FakeWS.instances[0];
    ws.onopen?.();
    // shapes the consumers actually branch on (App/TicketChat/TicketSupport/ChatRoomView)
    const evt = { type: 'ticket:new', data: { id: 't1', hook_id: 'h1', status: 0 }, ts: 123 };
    ws.onmessage?.({ data: JSON.stringify(evt) });
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(evt); // deep-equal: nothing mangled in transit
  });

  it('forwards message:new / ticket:updated payloads unchanged (multi-event ordering preserved)', async () => {
    const onEvent = vi.fn();
    const useTicketWS = await loadHook();
    renderHook(() => useTicketWS(onEvent));
    await flushMicrotasks();
    const ws = FakeWS.instances[0];
    ws.onopen?.();
    const e1 = { type: 'message:new', data: { room_id: 'r1', text: 'hi' }, ts: 1 };
    const e2 = { type: 'ticket:updated', data: { id: 't1', status: 2 }, ts: 2 };
    ws.onmessage?.({ data: JSON.stringify(e1) });
    ws.onmessage?.({ data: JSON.stringify(e2) });
    expect(onEvent.mock.calls.map((c) => c[0])).toEqual([e1, e2]);
  });

  it('drops a malformed frame silently (no throw, consumer not called)', async () => {
    const onEvent = vi.fn();
    const useTicketWS = await loadHook();
    renderHook(() => useTicketWS(onEvent));
    await flushMicrotasks();
    const ws = FakeWS.instances[0];
    ws.onopen?.();
    expect(() => ws.onmessage?.({ data: '{ not json' })).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('dispatches to the LATEST callback after a rerender (no stale-closure — fresh state wins)', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const useTicketWS = await loadHook();
    const { rerender } = renderHook(({ cb }) => useTicketWS(cb), { initialProps: { cb: first } });
    await flushMicrotasks();
    const ws = FakeWS.instances[0];
    ws.onopen?.();
    rerender({ cb: second });
    ws.onmessage?.({ data: JSON.stringify({ type: 'ticket:new', data: {}, ts: 9 }) });
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('does NOT reconnect on close code 4001 (auth reject — must not hammer the gateway)', async () => {
    vi.useFakeTimers();
    const useTicketWS = await loadHook();
    renderHook(() => useTicketWS(vi.fn()));
    await flushMicrotasks();
    const ws = FakeWS.instances[0];
    ws.onclose?.({ code: 4001 });
    vi.runOnlyPendingTimers();
    await flushMicrotasks();
    expect(FakeWS.instances).toHaveLength(1); // no new socket
  });

  it('DOES reconnect (backoff) on an abnormal close code', async () => {
    vi.useFakeTimers();
    const useTicketWS = await loadHook();
    renderHook(() => useTicketWS(vi.fn()));
    await flushMicrotasks();
    const ws = FakeWS.instances[0];
    ws.onclose?.({ code: 1006 }); // abnormal close → schedule reconnect
    // attempt 0: capped delay = 1000ms, minus up-to-50% jitter → fires by 1000ms
    vi.advanceTimersByTime(1000);
    // [FEAT-20260808-HTTPONLY-FE] the scheduled reconnect now awaits a fresh mint before the
    // socket appears — drain that microtask after the timer fires.
    await flushMicrotasks();
    expect(FakeWS.instances.length).toBeGreaterThanOrEqual(2);
  });

  it('cleanup on unmount closes the socket and cancels any pending reconnect', async () => {
    vi.useFakeTimers();
    const useTicketWS = await loadHook();
    const { unmount } = renderHook(() => useTicketWS(vi.fn()));
    await flushMicrotasks();
    const ws = FakeWS.instances[0];
    unmount();
    expect(ws.closed).toBe(true);
    // a late close event after teardown must NOT resurrect the connection (destroyed guard)
    ws.onclose?.({ code: 1006 });
    vi.runOnlyPendingTimers();
    await flushMicrotasks();
    expect(FakeWS.instances).toHaveLength(1);
  });
});
