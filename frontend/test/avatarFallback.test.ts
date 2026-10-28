import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
/* [REFACTOR-20260905-CUSTPROV] this reads the page PLUS the files it was split
   into. The composer and the right-hand panels moved out of TicketChat.tsx to
   components/chat/{chat-input,ticket-detail}; the code this spec pins moved
   with them, so the read follows the code. Every assertion below is unchanged
   — see test/ticketChatSource.ts for the file list and the one caveat. */
import { ticketChatSource } from './ticketChatSource';

/**
 * [FIX-20260826-AVATARBLANK] รูป avatar พังแล้วต้องมีรูปแทน ไม่ใช่วงกลมว่าง
 * ===========================================================================
 * เจ้าของแจ้ง 26/08 พร้อมภาพ: *"รูปหาย"* — วงกลมขาว มีขอบเขียว แต่ข้างในไม่มีอะไร
 *
 * 🔴 ทำไมมันอ่านผิดความหมาย: วงกลมว่างหน้าตาเหมือน "ลูกค้าคนนี้ไม่มีรูป" ทั้งที่
 * ความจริงคือ "รูปโหลดไม่ขึ้น" — สองอย่างนี้คนละเรื่องกันสิ้นเชิง
 * URL ของ LINE CDN เป็น signed URL ที่**หมดอายุได้** และบางแถวก็ไม่มี URL มาเลย
 * ⇒ ไม่ใช่เคสหายาก
 *
 * ⚠️ เทสอยู่ระดับซอร์ส ไม่ได้ mount หน้าจอ เพราะ jsdom **ไม่โหลดรูปจริง** ⇒ ยิง
 * `onError` เองไม่ได้ · การ mount แล้ว assert ว่า "มี onError" จึงไม่ได้พิสูจน์
 * อะไรมากกว่าการอ่านซอร์ส แต่แพงกว่าเยอะ
 *
 * ⚠️ และเทสนี้ **ห้ามแตะ className** — `avatarRingClass` ถูก assert แบบเป๊ะทีละ
 * ตัวอักษรที่ `orphanRooms.value.test.ts` · ที่เพิ่มมีแค่ attribute ใหม่
 */
const SRC = ticketChatSource();

describe('avatar ที่โหลดไม่ขึ้น ต้องตกไปที่รูปแทน', () => {
  it('⭐ avatar ทั้งสองจุดมี onError (panel ขวา + การ์ดในลิสต์)', () => {
    /* 🔴 mutation ที่เคสนี้ฆ่า: ลบ onError ออกจากจุดใดจุดหนึ่ง แล้วจุดนั้นจะกลับไป
       เป็นวงกลมว่างเหมือนเดิม โดยไม่มีเทสอื่นแดงเลย */
    const withFallback = SRC.match(/img\.src = AVATAR_FALLBACK;/g) ?? [];
    expect(withFallback.length).toBe(2);
  });

  it('⭐ กัน loop ไม่รู้จบ เมื่อรูปแทนก็โหลดไม่ขึ้น', () => {
    /* 🔴 ถ้าไม่มี `img.onerror = null` และรูป fallback ก็พัง (เช่นเน็ตหลุด)
       onError จะยิงซ้ำตัวเองไม่หยุด — เบราว์เซอร์ค้างทั้งแท็บ
       ต้องมีทั้งการเช็ค src ซ้ำ และการถอด handler ออก */
    expect((SRC.match(/img\.onerror = null;/g) ?? []).length).toBe(2);
    expect((SRC.match(/if \(img\.src === AVATAR_FALLBACK\) return;/g) ?? []).length).toBe(2);
  });

  it('รูปแทนไม่ใช่ค่าว่าง', () => {
    // ถ้าเป็น '' เบราว์เซอร์จะยิงกลับมาที่หน้าเดิม = คำขอที่ไม่มีความหมาย
    const m = SRC.match(/const AVATAR_FALLBACK = '([^']+)'/);
    expect(m?.[1]).toBeTruthy();
    expect(m?.[1]).toMatch(/^https?:\/\//);
  });
});
