/**
 * ==== [FEAT-20260811-CHATPIN] ปักหมุดห้องแชทใน panel ซ้ายของหน้า ticket ====
 *
 * เจ้าของสั่ง 2026-08-11: ปักหมุดแชท · **"prefrenece ของใครของมัน"** ·
 * **"save prefrence"** · **"max 20 ต้องเตือน"** · badge รูปหมุด (ไม่มีตัวนับ) เด่นทั้งสองธีม
 *
 * ## เก็บที่ไหน — ไม่มีของใหม่เลย
 * `users.preferences.pinned_rooms` ผ่าน `services/admin/preferencesService.ts`
 * ที่มีอยู่แล้ว (คอมเมนต์หัวไฟล์นั้นเขียนเองว่าออกแบบให้เพิ่ม section ใหม่ได้
 * โดยไม่แตะ backend หรือ type) ⇒ **BE 0 บรรทัด · ไม่มี collection ใหม่ ·
 * ไม่แตะ `chat_rooms` · ไม่ต้อง migrate**
 *
 * ## ทำไมเป็น array ไม่ใช่ object/Set
 * `deepMerge` ทั้งสองฝั่ง (BE `users-prefs.service.ts:71` และ FE
 * `preferencesService.ts:45`) **แทน array ทั้งก้อน ไม่ concat** ⇒ ส่งชุดใหม่ทั้งชุด
 * ได้เลย จึงไม่ต้องมี endpoint แยกสำหรับ unpin และหมุดที่เอาออกไม่ค้าง
 * ⚠️ ถ้าวันหนึ่งใครเปลี่ยน `deepMerge` เป็น concat/union **หมุดจะลบไม่ออก**
 * — บันทึกไว้ที่ `omnidesk-api/todo/be_todo26_11082026.md` §3.1
 *
 * ## ทำไมไฟล์นี้แยกออกมา
 * `TicketChat.tsx` ~3.9k บรรทัดอยู่แล้วและเจ้าของสั่งว่า "ห้ามบวม" ⇒ ตรรกะทั้งหมด
 * อยู่ที่นี่ (pure functions เทสได้โดยไม่ render) หน้าจอเหลือแค่เรียกใช้
 *
 * revert: ลบไฟล์นี้ + จุดเรียกใน `TicketChat.tsx` · ค่าที่ค้างใน `preferences`
 * ไม่มีผลกับอะไรเลย ไม่ต้องล้าง
 */
import {
  getInitialPreferences,
  saveLocalPreference,
  savePreferences,
} from '../admin';

/** เพดานที่เจ้าของกำหนด — ครบแล้วต้อง "เตือน" ไม่ใช่ตัดเงียบหรือเด้งอันเก่าออก */
export const PIN_MAX = 20;

/** key ใน `users.preferences` — ชื่อนี้ตรงกับที่จดไว้ใน be_todo26 */
const PREF_KEY = 'pinned_rooms';

/**
 * อ่านรายการหมุดของแอดมินคนที่ล็อกอินอยู่
 *
 * ทนทุกรูปข้อมูล: ไม่เคยตั้งค่า / เป็น `null` / เป็นชนิดอื่นเพราะถูกแก้มือ
 * ⇒ คืน `[]` เสมอ ไม่ throw — หน้ารายการเคสต้องไม่พังเพราะ preference เพี้ยน
 * กรองเฉพาะ string ที่ไม่ว่าง และตัดค่าซ้ำ (ค่าซ้ำทำให้ sort ไม่นิ่ง)
 */
export const readPinned = (): string[] => {
  const raw = getInitialPreferences()?.[PREF_KEY];
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const k = v.trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
};

/** ผลของการกดปุ่มหมุด — `limit` = เต็มเพดาน ผู้เรียกต้องเตือนแล้วไม่ปัก */
export type TogglePinResult =
  | { ok: true; next: string[]; pinned: boolean }
  | { ok: false; reason: 'limit'; max: number };

/**
 * คำนวณรายการหมุดชุดใหม่จากการกดปุ่มหนึ่งครั้ง — **pure ไม่แตะ storage**
 *
 * - อยู่ในรายการแล้ว ⇒ เอาออก (**ไม่ติดเพดานเสมอ** ไม่งั้น list ที่เกิน 20
 *   จากข้อมูลเก่าจะทำให้ผู้ใช้ติดตาย เอาหมุดออกไม่ได้เลย)
 * - ยังไม่มี + ยังไม่เต็ม ⇒ ต่อท้าย (ท้าย = ปักล่าสุด ลำดับใน array คือลำดับปัก
 *   จึงไม่ต้องเก็บ `pinned_at`)
 * - ยังไม่มี + เต็มแล้ว ⇒ `{ ok: false, reason: 'limit' }` ⇒ ผู้เรียกเตือน
 *
 * ⚠️ เช็คเพดาน**ตอนกด** ไม่ใช่ตอน render แล้ว disable ปุ่มทิ้งไว้ — ปุ่มที่กดไม่ได้
 * โดยไม่บอกเหตุผลทำให้ผู้ใช้เดาเอง การเตือนต้องเกิดจากการกระทำ
 */
export const togglePin = (current: string[], key: string): TogglePinResult => {
  const k = String(key ?? '').trim();
  if (!k) return { ok: false, reason: 'limit', max: PIN_MAX }; // key ว่าง = ปักไม่ได้
  if (current.includes(k)) {
    return { ok: true, next: current.filter((x) => x !== k), pinned: false };
  }
  if (current.length >= PIN_MAX) return { ok: false, reason: 'limit', max: PIN_MAX };
  return { ok: true, next: [...current, k], pinned: true };
};

/**
 * บันทึกรายการหมุด — local ทันที (sync) แล้วค่อย PUT ขึ้น BE
 *
 * เขียน local ก่อนเพราะถ้าผู้ใช้ refresh ทันทีหลังกด `savePreferences` อาจยังไม่จบ
 * (หรือถูกยกเลิกเพราะ navigate) — แบบเดียวกับที่ธีมทำอยู่
 * (`preferencesService.ts:51-64` อธิบายเหตุผลนี้ไว้)
 * ⚠️ ไม่ throw: หมุดเป็น preference ของหน้าจอ ยิงไม่ขึ้นก็ต้องไม่ทำให้หน้าเคสพัง
 */
export const persistPinned = (next: string[]): void => {
  saveLocalPreference({ [PREF_KEY]: next });
  void savePreferences({ [PREF_KEY]: next }).catch(() => {
    /* local เขียนแล้ว · รอบหน้าที่กดจะ PUT ทั้งชุดใหม่อยู่แล้ว */
  });
};

/**
 * comparator เอาห้องที่ปักไว้ขึ้นก่อน — ใช้ครอบ comparator เดิมของแต่ละรายการ
 *
 * ⚠️ ทำไมต้องเป็น "ตัวครอบ" ไม่ใช่ sort แยก: `TicketChat.tsx` มี **3 เส้น** ที่แสดง
 * รายการ (`groupedEndedTickets` `:1492` · `groupedBotTickets` `:1522` ·
 * `visibleTickets` ที่ไม่มี sort ของตัวเองเลย) ⇒ ถ้าเขียน sort ใหม่แยกจะเพี้ยนกันเอง
 * ตัวครอบทำให้ลำดับเดิมภายในกลุ่มที่ปัก/ไม่ปัก **ไม่เปลี่ยนแม้แต่นิด**
 *
 * ลำดับของหมุดใช้ index ใน `pinned` (ปักก่อนอยู่บนกว่า) — ไม่เอาเวลาข้อความมาปน
 * ไม่งั้นหมุดจะสลับที่กันเองเวลามีข้อความใหม่ ซึ่งเป็นสิ่งที่ปักหมุดพยายามกันอยู่
 */
export const byPinnedFirst =
  <T,>(pinned: string[], keyOf: (item: T) => string) =>
  (base: (a: T, b: T) => number) =>
  (a: T, b: T): number => {
    const ia = pinned.indexOf(keyOf(a));
    const ib = pinned.indexOf(keyOf(b));
    const pa = ia >= 0;
    const pb = ib >= 0;
    if (pa && pb) return ia - ib; // ปักทั้งคู่ ⇒ เรียงตามลำดับที่ปัก
    if (pa !== pb) return pa ? -1 : 1; // ปักอันเดียว ⇒ อันที่ปักขึ้นก่อน
    return base(a, b); // ไม่ปักทั้งคู่ ⇒ ลำดับเดิมเป๊ะ
  };
