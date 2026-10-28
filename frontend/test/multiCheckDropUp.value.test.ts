import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  clippingRect,
  shouldDropUp,
  MENU_MAX_PX,
} from '../components/campaign/pickers/dropDirection';

/**
 * [FIX-20260826-DROPUPCLIP] เมนูของ select ในโมดัลยังโดนขอบตัดอยู่
 * ===========================================================================
 * เจ้าของแจ้ง 26/08 พร้อมภาพ: ช่อง LINE OA ในฟอร์ม broadcast กางลงล่างแล้ว
 * **กินขอบ** มองไม่เห็นตัวเลือกท้าย ๆ
 *
 * 🔴 ต้นเหตุ ไม่ใช่ "ยังไม่ได้ทำ dropUp" — `[UI-20260825-DROPUP]` ทำไว้แล้วเมื่อ 25/08
 * แต่มันวัดที่ว่างด้วย `window.innerHeight` ทั้งที่ตัวเมนูถูกตัดโดย **ฟอร์ม** ซึ่งมี
 * `overflow-y-auto` (`BroadcastFormModal.tsx:859`) ไม่ใช่ถูกตัดโดยจอ
 * ⇒ จอเหลือที่ว่างเยอะ (เลยไม่พลิกขึ้น) แต่กล่องฟอร์มจบไปแล้ว ⇒ เมนูโดนตัด
 * ของที่ absolute อยู่ในกล่อง overflow จะถูกกล่องนั้นตัดเสมอ z-index ช่วยไม่ได้
 *
 * เทสชุดนี้ปักที่ **การตัดสิน** ไม่ใช่ที่พิกเซล — เพราะสิ่งที่ผิดคือวัดผิดกล่อง
 */

const rect = (top: number, bottom: number): DOMRect =>
  ({ top, bottom, height: bottom - top }) as DOMRect;

describe('shouldDropUp — วัดกับกล่องที่ตัดจริง ไม่ใช่กับจอ', () => {
  it('🔴 พลิกขึ้น เมื่อจอเหลือที่แต่กล่องที่ตัดไม่เหลือ', () => {
    /* เคสจากภาพที่เจ้าของส่งมาเป๊ะ ๆ: ปุ่มอยู่ใกล้ก้นฟอร์ม
       - จอสูง 1000 ปุ่มจบที่ 700 ⇒ เทียบกับจอเหลือ 300 (พอ! เลยไม่เคยพลิก)
       - แต่ฟอร์มจบที่ 720 ⇒ เหลือจริงแค่ 20 ⇒ เมนู 256px โดนตัด */
    expect(
      shouldDropUp({
        trigger: rect(660, 700),
        clip: rect(100, 720),
      }),
    ).toBe(true);
  });

  it('ไม่พลิก เมื่อข้างล่างในกล่องที่ตัดยังพอ', () => {
    expect(
      shouldDropUp({
        trigger: rect(200, 240),
        clip: rect(100, 900),
      }),
    ).toBe(false);
  });

  it('🔴 ไม่พลิก เมื่อข้างล่างไม่พอ แต่ข้างบนยิ่งไม่พอ', () => {
    /* กติกาเดิมจาก [UI-20260825-DROPUP] ที่ต้องรักษาไว้: ปุ่มที่อยู่ครึ่งบนของโมดัล
       ถ้าบังคับพลิกขึ้นจะโดนขอบบนตัดแทน = ย้ายปัญหา ไม่ใช่แก้ปัญหา */
    expect(
      shouldDropUp({
        trigger: rect(110, 150),
        clip: rect(100, 300),
      }),
    ).toBe(false);
  });

  it('พลิกขึ้น เมื่อข้างบนกว้างกว่าข้างล่างจริง ๆ', () => {
    expect(
      shouldDropUp({
        trigger: rect(600, 640),
        clip: rect(100, 660),
      }),
    ).toBe(true);
  });

  it('ไม่มีกล่องที่ตัด ⇒ ตกกลับไปใช้จอ (พฤติกรรมเดิม)', () => {
    // หน้าอื่นที่ไม่ได้อยู่ในโมดัลต้องทำงานเหมือนเดิมทุกประการ
    expect(
      shouldDropUp({ trigger: rect(660, 700), clip: null, viewportH: 1000 }),
    ).toBe(false);
    expect(
      shouldDropUp({ trigger: rect(900, 940), clip: null, viewportH: 1000 }),
    ).toBe(true);
  });

  it('เมนูสูงสุดเป็นค่าเดียวกับที่กล่องเมนูใช้จริง', () => {
    // ตัวเลขนี้ต้องมาจากที่เดียว ไม่งั้นคำนวณด้วย 256 แต่วาดด้วย 320 = วัดผิดตลอด
    expect(MENU_MAX_PX).toBe(256);
  });
});

describe('clippingRect — หากล่องที่ตัดจริง', () => {
  const el = (overflowY: string, parent: unknown = null): unknown => ({
    parentElement: parent,
    getBoundingClientRect: () => rect(0, 100),
    __overflowY: overflowY,
  });

  const styleOf = (n: unknown): { overflowY: string } => ({
    overflowY: (n as { __overflowY: string }).__overflowY,
  });

  it('เจอ ancestor ตัวแรกที่ overflow ไม่ใช่ visible', () => {
    const scroller = el('auto');
    const inner = el('visible', scroller);
    expect(clippingRect(inner as never, styleOf as never)).not.toBeNull();
  });

  it('คืน null เมื่อไม่มี ancestor ไหนตัดเลย', () => {
    const root = el('visible');
    const inner = el('visible', root);
    expect(clippingRect(inner as never, styleOf as never)).toBeNull();
  });

  it('ไม่พังเมื่อไม่มี parent เลย', () => {
    expect(clippingRect(el('visible') as never, styleOf as never)).toBeNull();
  });
});

describe('call site ต้องส่งกล่องที่ตัดจริงเข้าไป', () => {
  it('⭐ MultiCheckSelect เรียก shouldDropUp พร้อม clippingRect ไม่ใช่ null', () => {
    /* 🔴 เคสนี้เกิดจาก mutation ที่ไม่แดง: เปลี่ยน `clip: clippingRect(el)` เป็น
       `clip: null` แล้วเทสข้างบนยังเขียวหมด เพราะมันพิสูจน์แค่ "ฟังก์ชันคิดถูก"
       ไม่ได้พิสูจน์ว่า "คนเรียกส่งของถูกเข้าไป" — ซึ่งคือบั๊กเดิมเป๊ะ ๆ
       (ตัวเลขถูก แต่วัดกับกล่องผิด) */
    const src = readFileSync(
      join(process.cwd(), 'components/campaign/pickers/MultiCheckSelect.tsx'),
      'utf8',
    );
    expect(src).toMatch(/clip:\s*clippingRect\(el\)/);
    // และต้องไม่มีที่ไหนกลับไปคำนวณกับ window เองอีก
    expect(src).not.toMatch(/window\.innerHeight - /);
  });
});
