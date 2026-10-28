import { useEffect, useRef } from 'react';
// [FEAT-20260808-HTTPONLY-FE] (a) WHAT: import the credentialed ticket-mint call
// instead of reading the JWT from authStorage. (b) WHY: the JWT is now in an
// HttpOnly cookie that JS cannot read, and a cookie cannot be placed in a WS
// URL — so we mint a short-lived single-use ticket (cookie carries the auth on
// that POST) and hand THAT to omnidesk-ws. (c) REVERT: restore
// `import { getStoredAuth } from '../authStorage';` and delete this import.
import { mintWsTicket } from '../admin/authService';

const WS_URL = (import.meta as Record<string, any>).env?.VITE_WS_URL as string | undefined;
const WS_ENV = ((import.meta as Record<string, any>).env?.VITE_WS_ENV as string) || 'prod';

// [FIX-20260728-VIDEO-PENDING] เพิ่ม 'message:updated' — BE ยิง event นี้เมื่อ
// แอดมินกดปุ่ม "โหลดวิดีโอ" สำเร็จ ให้แอดมินคนอื่นที่เปิดห้องเดียวกันเห็นสด
// (ดู ChatRoomView.tsx สำหรับ handler ที่ patch ข้อความตรงจุด)
// revert: ลบ 'message:updated' ออกจาก union นี้
// [FEAT-20260730-PROFILEPUSH] เพิ่ม 'customer:profile_updated' — BE ยิงเมื่อ
// ลูกค้าผูกบัญชีสำเร็จ / แอดมินแก้ไข / แอดมินเคลียร์ข้อมูล เพื่อให้การ์ด
// "ข้อมูลลูกค้า" บนหน้า Ticket อัปเดตสดโดยไม่ต้องสลับห้องไปกลับ
// (ดู handler ใน TicketChat.tsx marker เดียวกัน)
// revert: ลบ 'customer:profile_updated' ออกจาก union นี้
// [FEAT-20260731-CONTACTS] เพิ่ม customer:tags_updated / customer:notes_updated
// BE ยิงมาเมื่อมีคนแก้ tag/note ของลูกค้า (ดู wsPublisher.publishCustomerDataEvent)
// payload: { hook_id, member_id, room_id, action, actor_name } — ไม่มี PII
// ปลายทางเอาไป re-fetch ผ่าน API ที่ตรวจสิทธิ์เอง ไม่ได้เชื่อข้อมูลจาก event ตรงๆ
// ⚠️ ประกาศไว้ใน union เพื่อให้ฝั่งที่ฟังเขียนแบบ type-safe ได้ ไม่ต้อง cast as any
// revert: ลบ 2 ชื่อนี้ออกจาก union
// customer was asked to register, never did, and wrote again. Published ONCE per
// room (atomic claim on the server), so no consumer has to de-duplicate.
// revert: remove the name from this union.
// [PERF-20260822-TKTIDSFETCH] 'ws:reconnected' — ยิงเมื่อ "ต่อกลับ" ได้ ไม่ใช่ตอนต่อครั้งแรก
// WHY: ก่อนหน้านี้ `onopen` ทำแค่ log ⇒ ไม่มีใครรู้ว่าเพิ่งขาดการเชื่อมต่อไป และ
// event ที่หายระหว่างนั้นก็หายจริง สิ่งที่กู้คืนให้โดยบังเอิญคือ full refetch ของ
// `scheduleRefetch` เมื่อ event ถัดไปมาถึง — พอเปลี่ยนไปดึงเฉพาะใบที่ระบุ
// ตาข่ายนั้นจะหายไปด้วย ผู้ฟังที่ต้องการความครบถ้วนจึงต้องรู้ว่าควรโหลดใหม่ทั้งชุด
// ⚠️ ผู้ฟังทั้งห้าที่กรองด้วย `e.type` แบบตรงตัวและ return ทิ้ง — ชนิดใหม่จึงไม่กระทบ
//    ใครที่ไม่ได้ขอ (ตรวจแล้วทีละไฟล์: App · TicketChat · TicketSupport ·
//    ChatRoomView · Contact)
// revert: ลบชื่อออกจาก union และลบ emit ใน onopen
type WSEvent = { type: 'ticket:new' | 'ticket:updated' | 'ticket:reopened' | 'message:new' | 'message:updated' | 'customer:profile_updated' | 'customer:tags_updated' | 'customer:notes_updated' | 'ws:reconnected'; data: Record<string, unknown>; ts: number };

// Reconnect backoff (ws_plan.md Phase 4c): a fixed 3s retry makes every admin
// reconnect in lockstep after a gateway blip (thundering herd). Use exponential
// backoff with jitter, capped, and reset the delay once a connection succeeds.
const WS_RECONNECT_BASE_MS = 1000;
const WS_RECONNECT_MAX_MS = 30000;

/* ==== [FIX-20260810-WSSHARED] one socket per tab, fanned out in the client ====
 *
 * WHAT: the connection now lives at module scope. Every `useTicketWS()` call
 *       subscribes to it instead of opening its own socket. The first subscriber
 *       connects; the last one to unmount tears the connection down.
 * WHY:  the hook is called from six places (App, ChatRoomView ×2, Contact,
 *       TicketSupport, TicketChat), and each call used to open a socket AND mint
 *       its own single-use ticket. Sitting on the chat page meant ~6 sockets and
 *       6 tickets per admin — every event delivered six times for five handlers
 *       to filter away. With StrictMode double-invoking effects in dev, twice
 *       that. It also meant six independent backoff timers, so one gateway blip
 *       fired six reconnect storms from a single tab.
 * ⚠️ REALTIME IS UNCHANGED — this is the whole point. Every subscriber still
 *    receives every event, verbatim and in order, because the socket fans out to
 *    all of them. No handler filtering was touched; none of the six relied on
 *    receiving an event more than once (each one filters on `e.type` and returns).
 *    The transport contract test (`test/useTicketWS.ws.test.ts`) is unmodified
 *    and still passes — that suite is the proof, not this comment.
 * ⚠️ Everything inside connect() — mint-then-open, the `?ticket=` URL, verbatim
 *    forwarding, backoff with jitter, 4001 → no reconnect, the post-await
 *    teardown re-check — is LIFTED AS-IS, not rewritten.
 * revert: move this block's state back inside the hook as refs and drop the
 *    subscribers Set (each caller reopens its own socket).
 */
const subscribers = new Set<{ current: (e: WSEvent) => void }>();
let sharedWs: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
/* [PERF-20260822-TKTIDSFETCH] เคยต่อสำเร็จมาแล้วหรือยัง — ใช้แยก "ต่อกลับ" ออกจาก
   "ต่อครั้งแรก" อยู่ที่ module scope เหมือน `sharedWs` เพราะซ็อกเก็ตมีตัวเดียวต่อแท็บ
   รีเซ็ตตอน teardown เพื่อให้แท็บที่ปิดหน้าแล้วเปิดใหม่ นับเป็นครั้งแรกอีกครั้ง */
let hadConnection = false;
let attempt = 0;
/** Guards the socket the way the per-hook `destroyed` flag used to. */
let teardown = false;

function emit(event: WSEvent): void {
  // Snapshot first: a handler may unsubscribe (unmount) mid-dispatch, and
  // mutating the live Set while iterating would skip the next subscriber.
  for (const ref of Array.from(subscribers)) ref.current(event);
}

function scheduleReconnect(): void {
  // exp backoff: base * 2^attempt, capped, ± up to 50% jitter
  const n = attempt++;
  const capped = Math.min(WS_RECONNECT_MAX_MS, WS_RECONNECT_BASE_MS * 2 ** n);
  const delay = Math.round(capped * (0.5 + Math.random() * 0.5));
  reconnectTimer = setTimeout(connect, delay);
}

async function connect(): Promise<void> {
  if (teardown) return;
  let ticket: string;
  try {
    ticket = await mintWsTicket();
  } catch {
    // Minting failed (e.g. cookie expired/network) — treat like a dropped
    // credential: back off and retry, same as an abnormal socket close. This
    // preserves the old "no token → don't connect" spirit without hammering.
    if (!teardown) scheduleReconnect();
    return;
  }
  // The await above yielded; re-check the teardown guard before touching WS.
  if (teardown) return;

  const url = `${WS_URL}?ticket=${encodeURIComponent(ticket)}&env=${WS_ENV}`;
  const ws = new WebSocket(url);
  sharedWs = ws;

  ws.onopen = () => {
    // [PERF-20260822-TKTIDSFETCH] `hadConnection` แยก "ต่อครั้งแรก" ออกจาก "ต่อกลับ"
    // ห้ามยิงตอนครั้งแรก — หน้าโหลดลิสต์เองอยู่แล้วตอน mount ยิงซ้ำ = โหลดสองรอบ
    // ทุกครั้งที่เปิดหน้า
    const isReconnect = hadConnection;
    hadConnection = true;
    attempt = 0;
    console.log('[WS] connected');
    if (isReconnect) emit({ type: 'ws:reconnected', data: {}, ts: Date.now() });
  };

  ws.onmessage = (e) => {
    try {
      const msg: WSEvent = JSON.parse(e.data);
      emit(msg);
    } catch { /* ignore malformed */ }
  };

  ws.onclose = (e) => {
    console.log('[WS] closed', e.code);
    if (!teardown && e.code !== 4001) {
      scheduleReconnect(); // backoff + jitter, not a fixed 3s
    }
  };

  ws.onerror = () => ws.close();
}

export function useTicketWS(onEvent: (e: WSEvent) => void) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!WS_URL) return; // WS disabled — polling still active

    subscribers.add(onEventRef);
    // First subscriber opens the connection. StrictMode's mount→unmount→mount
    // lands here twice; the count check makes the second pass a no-op rather
    // than a second socket.
    if (subscribers.size === 1) {
      teardown = false;
      attempt = 0;
      void connect();
    }

    return () => {
      subscribers.delete(onEventRef);
      if (subscribers.size > 0) return; // others still listening — keep it open
      teardown = true;
      hadConnection = false; // เปิดหน้าใหม่ = นับเป็นการต่อครั้งแรกอีกครั้ง
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      sharedWs?.close();
      sharedWs = null;
    };
  }, []); // mount once — [FEAT-20260808-HTTPONLY-FE] a fresh WS ticket is minted on each (re)connect (was: JWT read fresh)
}
