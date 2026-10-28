/**
 * [FIX-20260824-DRAGMEMCHATONLY] จำความสูงกล่องพิมพ์เฉพาะตอนคุยจริง
 *
 * เจ้าของแจ้ง: เปิดห้อง "บอทกำลังดูแล / เปิดเคส" แล้วกล่องยังสูงค้างจากห้องก่อน
 * คำสั่ง: "ให้จำค่าเฉพาะเวลาแชท เวลาอื่นไม่จำ" + "ค่าเดียวร่วมกันทุกห้องที่คุย"
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  heightFor,
  shouldRemember,
  DEFAULT_COMPOSER_H,
  IDLE_COMPOSER_H,
} from '../pages/chat/composerHeightMemory';
/* [REFACTOR-20260905-CUSTPROV] this reads the page PLUS the files it was split
   into. The composer and the right-hand panels moved out of TicketChat.tsx to
   components/chat/{chat-input,ticket-detail}; the code this spec pins moved
   with them, so the read follows the code. Every assertion below is unchanged
   — see test/ticketChatSource.ts for the file list and the one caveat. */
import { ticketChatSource } from './ticketChatSource';

describe('[DRAGMEMCHATONLY] กฎการจำความสูง', () => {
  /* ⚠️ เคสนี้ถูก **พลิก** 25/08 — เดิมคืน DEFAULT (156) เมื่อห้องพิมพ์ไม่ได้
     เจ้าของแจ้งรอบสอง "ทำไมกล่องพวกที่ไม่ได้พร้อมแชท มันยังสูงอยู่" พร้อมภาพ
     ⇒ 156 คือความสูงของกล่องพิมพ์ปกติ ซึ่งห้องที่พิมพ์ไม่ได้ไม่ต้องใช้
     (overlay ทับอยู่แล้ว พิมพ์ไม่ได้อยู่ดี) · เจ้าของเคาะ "เอาแค่ 60"
     เคสเดิมเก็บไว้เป็นบรรทัดบนสุดเพื่อไม่ให้เสียหลักฐานว่าเคยตกลง 156 มาก่อน */
  it('⭐⭐ ห้องที่ไม่ได้คุย = 60 เสมอ แม้เคยลากไว้', () => {
    // อาการที่เจ้าของเจอ: เคยลาก 300 ในห้องที่คุย แล้วเปิดห้องบอทดูแล
    expect(heightFor(false, 300)).toBe(IDLE_COMPOSER_H);
    /* [UI-20260826-IDLE20] เดิมปักไว้ที่ 28 — เจ้าของสั่งลดอีก 30% เป็นรอบที่ห้า
       (156 → 60 → 40 → 28 → 20) · **พลิกค่า ไม่ลบเคส** ตามกติกา: เคสนี้ยังทำ
       หน้าที่เดิมคือกันไม่ให้ใครเผลอเปลี่ยนความสูงห้องที่ยังไม่รับเคสโดยไม่ตั้งใจ
       ⚠️ 20 < MIN_H (39) และถูกต้อง — ค่านี้ไม่ผ่าน clamp (ดูเหตุผลเต็มที่
          composerHeightMemory.ts) · เคสที่ปัก MIN_H อยู่ที่ composerDragRange.test.ts
          และ **ต้องไม่ขยับ** เพราะห้องที่คุยได้ยังต้องเผื่อที่ให้ข้อความหนึ่งบรรทัด */
    expect(IDLE_COMPOSER_H).toBe(20);
  });

  it('⭐ ห้องที่ไม่ได้คุย ต้อง **ไม่ใช่** ความสูงของกล่องพิมพ์ปกติอีกแล้ว', () => {
    expect(heightFor(false, null)).not.toBe(DEFAULT_COMPOSER_H);
  });

  it('⭐⭐ ห้องที่กำลังคุย = ได้ค่าที่ลากไว้', () => {
    expect(heightFor(true, 300)).toBe(300);
  });

  it('⭐ ห้องที่คุยแต่ยังไม่เคยลาก = ค่าเริ่มต้น 156 (PIN — ห้ามขยับ)', () => {
    // เจ้าของเคยสั่งไว้ตอน DRAGDEEPER: "ลากให้เล็กลงได้ ไม่ใช่เปิดมาเล็กลง"
    expect(heightFor(true, null)).toBe(DEFAULT_COMPOSER_H);
    expect(DEFAULT_COMPOSER_H).toBe(156);
  });

  it('⭐ ค่าเดียวใช้ร่วมกัน — ห้องที่คุยห้องไหนก็ได้ค่าเดียวกัน', () => {
    const remembered = 250;
    expect(heightFor(true, remembered)).toBe(heightFor(true, remembered));
  });

  it('⭐⭐ จำเฉพาะตอนคุยจริง — ลากในห้องบอทดูแลต้องไม่ติดไปห้องอื่น', () => {
    expect(shouldRemember(true)).toBe(true);
    expect(shouldRemember(false)).toBe(false);
  });
});

const strip = (s: string) =>
  // ⚠️ ตัด // ก่อน /* */ เสมอ (สลับกันแล้วจะกลืนโค้ดจริง)
  s.replace(/(^|[^:])\/\/[^\n]*/g, '$1').replace(/\/\*[\s\S]*?\*\//g, '');

describe('[DRAGMEMCHATONLY] TicketChat ต่อสายเข้ากับกฎกลางจริง', () => {
  const src = strip(ticketChatSource());

  it('⭐ import และเรียกใช้จริง ไม่เขียนเงื่อนไขซ้ำในหน้า', () => {
    /* [REFACTOR-20260905-CUSTPROV] the composer moved to
       components/chat/chat-input, so its specifier for the same module is now
       '../../../pages/chat/composerHeightMemory'. The claim is unchanged — the
       rules are IMPORTED, not re-implemented — so the pin matches the module,
       not the number of `../` in front of it. */
    expect(src).toMatch(/from '[^']*\/?composerHeightMemory'/);
    expect(src.split('heightFor(').length - 1).toBeGreaterThanOrEqual(1);
  });

  it('⭐⭐ ต้องผูกกับ accepted (สถานะคุยจริง) ไม่ใช่แค่เปลี่ยนห้อง', () => {
    const i = src.indexOf('heightFor(');
    expect(i).toBeGreaterThan(-1);
    const region = src.slice(Math.max(0, i - 400), i + 200);
    expect(region).toContain('accepted');
  });
});
