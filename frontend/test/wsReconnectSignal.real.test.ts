/* [PERF-20260822-TKTIDSFETCH] พิสูจน์สัญญาณ reconnect กับ **WebSocket จริง**
 *
 * ## ทำไมมีไฟล์นี้ทั้งที่มี wsReconnectSignal.value.test.ts อยู่แล้ว
 * ไฟล์นั้นใช้ `FakeWS` — คลาสปลอมที่เราสั่ง `onopen()` / `onclose()` เอง
 * มันพิสูจน์ได้แค่ว่า "ถ้า lifecycle ถูกเรียกตามลำดับนี้ โค้ดจะทำอะไร"
 * **ไม่ได้พิสูจน์ว่า WebSocket จริงเรียก lifecycle ตามลำดับนั้น**
 *
 * ไฟล์นี้เปิดเซิร์ฟเวอร์ `ws` จริงบนพอร์ตจริง ให้ hook ต่อด้วย WebSocket จริง
 * แล้ว **ตัดการเชื่อมต่อจากฝั่งเซิร์ฟเวอร์จริง ๆ** (terminate) เพื่อดูว่า
 *   ① ต่อครั้งแรก → ต้องไม่มี `ws:reconnected`
 *   ② สายขาด → hook ต่อกลับเอง → ต้องมี `ws:reconnected` พอดี 1 ครั้ง
 *   ③ ข้อความจริงที่ส่งหลังต่อกลับ ยังส่งถึงผู้ฟังเหมือนเดิม (realtime ไม่พัง)
 *
 * ⚠️ ใช้ `ws` จาก repo `omnidesk-ws` (เซิร์ฟเวอร์ตัวจริงของระบบ) — FE ไม่มี dependency
 *    นี้และไม่ควรมี เทสนี้จึงหาแบบ **relative จากตำแหน่งไฟล์นี้** ไม่ฝัง path ของ
 *    เครื่องใครลงโค้ด · หาไม่เจอ = skip พร้อมบอกเหตุผล ไม่ใช่ผ่านแบบเงียบ ๆ
 *
 * ## สิ่งเดียวที่เป็นของปลอมในเทสนี้ — บอกให้ชัด
 * `VITE_WS_URL` ถูกฝังเป็น **ค่าคงที่ตอน build** ด้วย `define` ใน vitest.config
 * (`wss://ws.test.local/live`) ⇒ `vi.stubEnv` เปลี่ยนไม่ได้ และเราจะไม่แก้ config
 * นั้นเพราะมันกระทบเทสตัวอื่น เทสนี้จึงห่อ `globalThis.WebSocket` ด้วยคลาสบาง ๆ
 * ที่ **เปลี่ยนแค่ปลายทาง** แล้วเรียก WebSocket ตัวจริงต่อ
 *
 * ⇒ handshake · เฟรมจริง · การขาดจากฝั่งเซิร์ฟเวอร์ · backoff · การต่อกลับ
 *   **เป็นของจริงทั้งหมด** มีแค่ "ที่อยู่" เท่านั้นที่ถูกเปลี่ยนทาง
 *   ต่างจาก FakeWS ที่ lifecycle ทั้งหมดเป็นของที่เราสั่งเอง
 *
 * ใช้ client ของ `ws` แทน WebSocket ของ node เพราะ undici ยิง `Event` ของ node
 * เข้า jsdom แล้วชนกัน (ERR_INVALID_ARG_TYPE) — `ws` คือไลบรารีตัวเดียวกับที่
 * omnidesk-ws ใช้เป็นเซิร์ฟเวอร์จริง จึงเป็นการต่อจริงด้วย implementation จริง
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createRequire } from 'node:module';

vi.mock('../services/admin/authService', () => ({
  mintWsTicket: () => Promise.resolve('ticket-real'),
}));

const require_ = createRequire(import.meta.url);

/**
 * หา `ws` โดยไม่ผูกกับเครื่องใครทั้งสิ้น
 *
 * FE ไม่มี `ws` เป็น dependency และไม่ควรมี — มันเป็นของฝั่งเซิร์ฟเวอร์
 * เทสนี้จึงยืมของจริงจาก repo `omnidesk-ws` ที่วางเป็นพี่น้องกับ repo นี้
 *
 * ⚠️ ห้ามฝัง path เต็มของเครื่องลงในโค้ดเด็ดขาด — ไล่ขึ้นจากตำแหน่งไฟล์นี้แทน
 *    หาไม่เจอ = skip พร้อมบอกเหตุผล ไม่ใช่ผ่านแบบเงียบ ๆ
 */
function loadWs(): { WebSocketServer: unknown; WsClient: unknown } | null {
  for (const rel of [
    'ws', // ถ้าวันหนึ่ง FE มีเอง
    '../../omnidesk-ws/node_modules/ws',
    '../../../omnidesk-ws/node_modules/ws',
  ]) {
    try {
      const mod = require_(rel) as Record<string, unknown>;
      if (mod.WebSocketServer)
        return { WebSocketServer: mod.WebSocketServer, WsClient: mod.WebSocket ?? mod };
    } catch {
      /* ลองตัวถัดไป */
    }
  }
  return null;
}

const ws = loadWs();
const WebSocketServer: any = ws?.WebSocketServer ?? null;
const WsClient: any = ws?.WsClient ?? null;
if (!WebSocketServer) {
  console.warn(
    '[wsReconnectSignal.real] ไม่พบแพ็กเกจ `ws` (คาดว่าอยู่ที่ repo omnidesk-ws ข้าง ๆ) — ข้ามเทสนี้ ไม่ได้ทดสอบอะไร',
  );
}

const describeIfWs = WebSocketServer ? describe : describe.skip;

let server: any;
let port = 0;
const sockets: any[] = [];

beforeAll(async () => {
  if (!WebSocketServer) return;
  server = new WebSocketServer({ port: 0 });
  await new Promise<void>((r) => server.once('listening', () => r()));
  port = server.address().port;
  server.on('connection', (sock: any) => sockets.push(sock));
});

afterAll(async () => {
  if (server) await new Promise<void>((r) => server.close(() => r()));
});

const realWS = globalThis.WebSocket;
beforeEach(() => {
  sockets.length = 0;
  vi.resetModules();
});
afterEach(() => {
  (globalThis as never as { WebSocket: unknown }).WebSocket = realWS;
  vi.restoreAllMocks();
});

/**
 * WebSocket ตัวจริง ต่างแค่ปลายทาง
 *
 * hook ต่อไปที่ `wss://ws.test.local/live?ticket=…` ซึ่งฝังมาตอน build
 * ตัวนี้เปลี่ยน host/scheme ให้ชี้เซิร์ฟเวอร์ `ws` จริงที่เพิ่งเปิด แล้วปล่อยให้
 * WebSocket ของ node ทำงานเองทุกอย่าง — ไม่มี lifecycle ไหนถูกจำลอง
 */
function redirectWebSocketTo(realPort: number): void {
  // ใช้ client ของ `ws` (ไลบรารีเดียวกับที่ omnidesk-ws ใช้เป็นเซิร์ฟเวอร์จริง)
  // ไม่ใช้ WebSocket ของ node เพราะ undici ยิง `Event` ของ node เข้า jsdom
  // แล้วชนกัน (ERR_INVALID_ARG_TYPE) ทำให้ onclose ไม่ทำงาน — นั่นเป็นข้อจำกัด
  // ของสภาพแวดล้อมเทส ไม่ใช่ของโค้ดที่กำลังพิสูจน์
  const Base = WsClient as unknown as {
    new (u: string, p?: unknown): Record<string, unknown>;
  };
  class RedirectingWS extends Base {
    constructor(url: string, protocols?: unknown) {
      const u = new URL(url);
      u.protocol = 'ws:';
      u.host = `127.0.0.1:${realPort}`;
      super(u.toString(), protocols);
    }
  }
  (globalThis as never as { WebSocket: unknown }).WebSocket = RedirectingWS;
}

/** รอจนเงื่อนไขเป็นจริง หรือหมดเวลา — ไม่ใช้ fake timer เพราะ socket จริงต้องใช้เวลาจริง */
/**
 * ⚠️ เทสนี้รอ **backoff จริง** ของ hook (เริ่ม ~1s + jitter) ไม่ใช่ fake timer
 * เพราะทั้งเรื่องคือการพิสูจน์ของจริง ⇒ ใต้โหลดหนัก (รันทั้งชุดพร้อมกัน) มันช้าลงได้
 * งบเวลาจึงต้องกว้างกว่าที่ "ควรใช้" มาก ไม่งั้นจะกลายเป็นเทส flaky ซึ่งแย่กว่าไม่มี
 */
async function until(fn: () => boolean, ms = 20000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

describeIfWs('⭐ สัญญาณ reconnect กับ WebSocket จริง (ไม่ใช่ FakeWS)', () => {
  it('ต่อจริงได้ · ครั้งแรกไม่มีสัญญาณ · ตัดสายจริงแล้วต่อกลับ → มีสัญญาณ 1 ครั้ง · ข้อความยังถึง', async () => {
    redirectWebSocketTo(port);
    const { useTicketWS } = await import('../services/chat/useTicketWS');

    const seen: string[] = [];
    const { unmount } = renderHook(() =>
      useTicketWS((e) => { seen.push(e.type); }),
    );

    // ① ต่อจริงสำเร็จ
    expect(await until(() => sockets.length === 1)).toBe(true);
    await new Promise((r) => setTimeout(r, 150));
    expect(seen).not.toContain('ws:reconnected');

    // ② ตัดสายจากฝั่งเซิร์ฟเวอร์จริง — ไม่ใช่เรียก onclose เอง
    sockets[0].terminate();

    // hook ต้องต่อกลับเอง (backoff จริง เริ่ม ~1s + jitter)
    expect(await until(() => sockets.length === 2, 45000)).toBe(true);
    expect(await until(() => seen.includes('ws:reconnected'), 20000)).toBe(true);
    expect(seen.filter((t) => t === 'ws:reconnected')).toHaveLength(1);

    // ③ realtime ยังทำงาน — ข้อความจริงหลังต่อกลับต้องถึงผู้ฟัง
    sockets[1].send(JSON.stringify({ type: 'ticket:new', data: { _id: 'x' }, ts: 1 }));
    expect(await until(() => seen.includes('ticket:new'))).toBe(true);

    unmount();
  }, 90000);
});
