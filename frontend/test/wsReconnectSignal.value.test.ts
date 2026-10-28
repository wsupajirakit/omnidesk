/* [PERF-20260822-TKTIDSFETCH] ตอนต่อ WS กลับได้ ต้องมีสัญญาณบอกผู้ฟัง
 *
 * ## ทำไมเทสนี้ถึงมี — รูที่เจอตอน dive ไม่ใช่ที่คิดไว้ก่อน
 * วันนี้ `ws.onopen` ทำแค่ `console.log` (`useTicketWS.ts:103`) ไม่มีใครรู้ว่า
 * ต่อกลับแล้ว ⇒ **event ที่หายไประหว่างเน็ตหลุด หายจริง** สิ่งที่กู้คืนให้โดยบังเอิญ
 * คือ `scheduleRefetch()` ที่โหลดลิสต์ใหม่ทั้งชุดเมื่อ event ถัดไปมาถึง
 *
 * PART C เปลี่ยน `scheduleRefetch` เป็นการดึงเฉพาะใบที่ระบุ ⇒ **ตาข่ายนั้นหายไปด้วย**
 * ตั๋วที่เกิดตอนเน็ตกระตุกจะไม่โผล่จนกว่าจะรีโหลดหน้า — พังเงียบ ไม่มี error
 *
 * เทสนี้จึงต้อง **แดงบนโค้ดวันนี้** ถ้ามันเขียวตั้งแต่แรก แปลว่าเทสไม่ได้ทดสอบอะไร
 *
 * ## ทำไมเป็น event ชนิดใหม่ ไม่ใช่ callback ใหม่
 * ผู้ฟังทั้งห้าที่ (`App` `TicketChat` `TicketSupport` `ChatRoomView` `Contact`)
 * กรองด้วย `e.type` แบบตรงตัวและ return ทิ้งทั้งหมด — ตรวจแล้วทีละไฟล์
 * ⇒ ชนิดใหม่ไม่กระทบใครที่ไม่ได้ขอ และไม่ต้องแก้ signature ของ hook
 *
 * ## ที่ห้ามพลาด
 * ต้องไม่ยิงตอนต่อ **ครั้งแรก** — ครั้งแรกมี `useEffect` โหลดลิสต์อยู่แล้ว
 * (`TicketChat.tsx:1346`) ยิงซ้ำ = โหลดสองรอบทุกครั้งที่เปิดหน้า
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('../services/admin/authService', () => ({
  mintWsTicket: () => Promise.resolve('ticket-abc'),
}));

class FakeWS {
  static instances: FakeWS[] = [];
  url: string;
  readyState = 0;
  closed = false;
  onopen: ((e?: unknown) => void) | null = null;
  onmessage: ((e: unknown) => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  onerror: ((e?: unknown) => void) | null = null;
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
  await Promise.resolve();
}

beforeEach(() => {
  FakeWS.instances = [];
  (globalThis as never as { WebSocket: unknown }).WebSocket = FakeWS;
  vi.resetModules();
});
afterEach(() => {
  (globalThis as never as { WebSocket: unknown }).WebSocket = originalWS;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('⭐ สัญญาณ reconnect — ตาข่ายที่กันตั๋วหายตอนเน็ตกระตุก', () => {
  it('ต่อครั้งแรก ต้อง NOT ยิงสัญญาณ (หน้าโหลดลิสต์เองอยู่แล้ว)', async () => {
    const onEvent = vi.fn();
    const useTicketWS = await loadHook();
    renderHook(() => useTicketWS(onEvent));
    await flushMicrotasks();
    FakeWS.instances[0].onopen?.();
    const kinds = onEvent.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(kinds).not.toContain('ws:reconnected');
  });

  it('🔴 ต่อกลับหลังหลุด ต้องยิง `ws:reconnected` ให้ผู้ฟังรู้', async () => {
    vi.useFakeTimers();
    const onEvent = vi.fn();
    const useTicketWS = await loadHook();
    renderHook(() => useTicketWS(onEvent));
    await flushMicrotasks();

    // เปิดสำเร็จ แล้วสายหลุดแบบผิดปกติ → hook ตั้งเวลาต่อใหม่
    FakeWS.instances[0].onopen?.();
    FakeWS.instances[0].onclose?.({ code: 1006 });
    await vi.advanceTimersByTimeAsync(31_000); // เกิน backoff สูงสุด
    await flushMicrotasks();

    expect(FakeWS.instances.length).toBeGreaterThan(1);
    FakeWS.instances[FakeWS.instances.length - 1].onopen?.();

    const kinds = onEvent.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(kinds).toContain('ws:reconnected');
  });

  it('ยิงครั้งเดียวต่อการต่อกลับหนึ่งครั้ง ไม่ใช่ทุก event ที่ตามมา', async () => {
    vi.useFakeTimers();
    const onEvent = vi.fn();
    const useTicketWS = await loadHook();
    renderHook(() => useTicketWS(onEvent));
    await flushMicrotasks();
    FakeWS.instances[0].onopen?.();
    FakeWS.instances[0].onclose?.({ code: 1006 });
    await vi.advanceTimersByTimeAsync(31_000);
    await flushMicrotasks();
    const last = FakeWS.instances[FakeWS.instances.length - 1];
    last.onopen?.();
    last.onmessage?.({ data: JSON.stringify({ type: 'ticket:new', data: {}, ts: 1 }) });

    const kinds = onEvent.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(kinds.filter((k) => k === 'ws:reconnected')).toHaveLength(1);
  });

  it('ปิดด้วยรหัส 4001 (auth) ไม่ต่อใหม่ จึงไม่มีสัญญาณ', async () => {
    vi.useFakeTimers();
    const onEvent = vi.fn();
    const useTicketWS = await loadHook();
    renderHook(() => useTicketWS(onEvent));
    await flushMicrotasks();
    FakeWS.instances[0].onopen?.();
    FakeWS.instances[0].onclose?.({ code: 4001 });
    await vi.advanceTimersByTimeAsync(31_000);
    await flushMicrotasks();

    expect(FakeWS.instances).toHaveLength(1);
    const kinds = onEvent.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(kinds).not.toContain('ws:reconnected');
  });
});
