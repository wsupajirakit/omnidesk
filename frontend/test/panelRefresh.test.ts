/* [FIX-20260825-PANELREFRESH] กด refresh แล้ว panel ขวาต้องสดทั้งแผง
 *
 * อาการ: หมวด · ป้ายกำกับ · การติดตาม · โน๊ต ยังเป็นของเก่าหลังกดปุ่ม
 * เหตุ: การ์ดสองใบโหลดเองแบบผูกกับ `room._id` (remount ถึงจะยิงซ้ำ) อีกสองใบ
 *       อ่านจาก prop (ต้องดึงข้อมูลใหม่) ⇒ ต้องแก้สองท่าพร้อมกัน
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

import {
  PANEL_REFRESH_ACTION,
  shouldRefreshPanel,
  panelCardKey,
} from '../pages/chat/panelRefresh';
/* [REFACTOR-20260905-CUSTPROV] this reads the page PLUS the files it was split
   into. The composer and the right-hand panels moved out of TicketChat.tsx to
   components/chat/{chat-input,ticket-detail}; the code this spec pins moved
   with them, so the read follows the code. Every assertion below is unchanged
   — see test/ticketChatSource.ts for the file list and the one caveat. */
import { ticketChatSource } from './ticketChatSource';

const strip = (s: string) =>
  s.replace(/(^|[^:])\/\/[^\n]*/g, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
const chat = strip(ticketChatSource());

describe('[PANELREFRESH] §1 กฎล้วน', () => {
  it('⭐⭐ (T1) กดปุ่ม refresh → รีเฟรชทั้งแผง', () => {
    expect(shouldRefreshPanel(PANEL_REFRESH_ACTION)).toBe(true);
  });

  /* ⚠️ พลิกระหว่างทาง 25/08 — เดิมเคสนี้กัน `chat_opened` ออกด้วย
     เหตุผลเดิมคือ "กลัวโน๊ตที่พิมพ์ค้างหายตอน remount" ซึ่ง **ผิด**:
     `panelCardKey` มี id ของลูกค้าอยู่ ⇒ สลับห้อง key เปลี่ยนและ remount อยู่แล้ว
     draft จึงข้ามห้องไม่ได้ตั้งแต่แรก · และเจ้าของสั่งว่าคลิกเข้าห้องต้องได้ของสด
     เหมือน raw profile / site rules ⇒ `chat_opened` ต้องนับด้วย */
  it('⭐⭐ (T2a) คลิกเข้าห้อง → รีเฟรชด้วย (ครึ่งแผงสด ครึ่งแผงเก่าไม่ได้)', () => {
    expect(shouldRefreshPanel('chat_opened')).toBe(true);
  });

  it('⭐⭐ (T2b) action ที่เกิด "ระหว่าง" ทำงานอยู่ ต้องไม่กระชากแผง', () => {
    /* `case_taken` (กดรับเคส) และ push จาก BE (ลูกค้าเพิ่งผูกบัญชี) เกิดตอน
       แอดมินอยู่ในห้องแล้ว — remount ตอนนั้นคือดึงแผงใต้มือคนที่กำลังพิมพ์ */
    for (const a of ['case_taken', 'profile_pushed', '', null, undefined]) {
      expect(shouldRefreshPanel(a as unknown)).toBe(false);
    }
  });

  it('⭐⭐ (T3) key เปลี่ยนเมื่อ nonce ขยับ — ไม่งั้นการ์ดไม่ remount', () => {
    expect(panelCardKey('tags', 'r1', 0)).not.toBe(panelCardKey('tags', 'r1', 1));
  });

  it('⭐⭐ (T4) key เปลี่ยนเมื่อสลับลูกค้า — ไม่งั้นค้างข้อมูลคนก่อนหน้า', () => {
    expect(panelCardKey('tags', 'r1', 0)).not.toBe(panelCardKey('tags', 'r2', 0));
  });

  it('⭐ (T5) การ์ดคนละใบต้องคนละ key', () => {
    expect(panelCardKey('tags', 'r1', 0)).not.toBe(panelCardKey('notes', 'r1', 0));
  });

  it('(T6) ไม่มี id ก็ยังได้ key ที่ใช้ได้ ไม่ระเบิด', () => {
    expect(panelCardKey('tags', null, 0)).toContain('none');
  });
});

describe('[PANELREFRESH] §2 ต่อสายจริงใน TicketChat', () => {
  it('⭐⭐ (T7) มี effect ที่ฟังปุ่ม refresh และใช้กฎจากไฟล์กฎ', () => {
    expect(chat).toContain('shouldRefreshPanel(');
    expect(chat).toContain('tc:customer-profile-updated');
  });

  it('⭐⭐ (T8) การ์ดสามใบถูก key ด้วย panelCardKey — ไม่ได้ปล่อยไว้เฉย ๆ', () => {
    /* ⚠️ ตัดหน้าต่างให้จบที่ `/>` ของ **ตัวมันเอง** ห้ามตัดตามจำนวนตัวอักษร
       เคสนี้เคยเขียนแบบ `slice(at, at + 160)` แล้ว mutation ที่ลบ key ของ
       `<CustomerTags>` ทิ้ง **ไม่แดง** เพราะหน้าต่างล้นไปเจอ `key=` ของการ์ด
       บรรทัดถัดไป · หน้าต่างที่กว้างเกินจริง = ไม่ได้ปักอะไรเลย */
    for (const card of ['<FollowUpCard', '<CustomerTags', '<CustomerNotes']) {
      const at = chat.indexOf(card);
      expect(at, `${card} ยังอยู่ไหม`).toBeGreaterThan(-1);
      const end = chat.indexOf('/>', at);
      expect(end, `${card} ปิดแท็กที่ไหน`).toBeGreaterThan(at);
      const own = chat.slice(at, end);
      expect(own, `${card} ต้องถูก key ด้วย panelCardKey`).toContain('key={panelCardKey(');
    }
  });

  it('⭐⭐ (T9) รีเฟรชต้องดึง "ข้อมูลใหม่" ด้วย ไม่ใช่ remount อย่างเดียว', () => {
    /* remount ช่วยแค่ป้ายกับโน๊ต · หมวดกับการติดตามอ่านจาก prop
       ⇒ ต้องมีการดึง room และ ticket ใหม่ในย่านเดียวกัน */
    const i = chat.indexOf('shouldRefreshPanel(');
    expect(i).toBeGreaterThan(-1);
    const region = chat.slice(i, i + 1400);
    expect(region).toContain('listRooms');      // ดึง room ใหม่ → การติดตาม
    expect(region).toContain('fetchActive');    // ดึง ticket ใหม่ → หมวด
  });
});
