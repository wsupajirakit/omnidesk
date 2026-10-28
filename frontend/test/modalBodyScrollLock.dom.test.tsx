/**
 * [UI-20260828-BGSCROLLLOCK] โมดัลกางอยู่ พื้นหลังต้องไม่เลื่อน
 * ===========================================================================
 * เจ้าของ 28/08: *"เวลา modal boardcast เปิด ห้ามเลื่อน bg ได้แบบนี้มันบัค"*
 *
 * 🔴 เคสที่สำคัญที่สุดคือ **โมดัลซ้อน** ไม่ใช่ใบเดียว. ฟอร์มบรอดแคสต์เปิดกล่องยืนยัน
 *    ทับตัวเองอยู่แล้ว ⇒ ถ้าแต่ละใบตั้ง/คืนค่าเอง ใบที่ปิดก่อนจะคืน scroll ให้ทั้งที่
 *    อีกใบยังกางอยู่ · บั๊กจะกลับมาในสถานะที่หายากกว่าเดิม ⇒ ต้องนับจำนวนใบที่ล็อก
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';

import { Modal } from '../components/common/Modal';

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

const box = (isOpen: boolean, key?: string) => (
  <Modal isOpen={isOpen} key={key}>
    <div>เนื้อใน</div>
  </Modal>
);

describe('[BGSCROLLLOCK] ล็อกพื้นหลังตอนโมดัลเปิด', () => {
  it('⭐⭐ 🔴 เปิด ⇒ body ไม่เลื่อน · ปิด ⇒ คืนให้เลื่อนได้', () => {
    const r = render(box(true));
    expect(document.body.style.overflow).toBe('hidden');

    r.rerender(box(false));
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('⭐⭐ 🔴 ซ้อนสองใบ ปิดใบบนก่อน ⇒ ยังต้องล็อกอยู่', () => {
    /* นี่คือรูปร่างจริงของฟอร์มบรอดแคสต์: ฟอร์มกางอยู่ แล้วเปิดกล่องยืนยันทับ
       แล้วผู้ใช้กด "กลับไปแก้ต่อ" ⇒ กล่องยืนยันปิด ฟอร์มยังอยู่
       ถ้าไม่นับจำนวน ตรงนี้พื้นหลังจะกลับมาเลื่อนได้ทั้งที่ฟอร์มยังกางอยู่ */
    const outer = render(box(true, 'outer'));
    const inner = render(box(true, 'inner'));
    expect(document.body.style.overflow).toBe('hidden');

    inner.unmount();
    expect(document.body.style.overflow).toBe('hidden');

    outer.unmount();
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('⭐ ไม่ได้เปิด ⇒ ไม่ไปยุ่งกับ body เลย', () => {
    document.body.style.overflow = 'auto';
    render(box(false));
    /* 🔴 ต้องเป็นค่าที่หน้าตั้งไว้เอง ไม่ใช่ถูกล้างเป็นค่าว่าง — โมดัลที่ยังไม่เปิด
       ไม่มีสิทธิ์ไปแตะสไตล์ของหน้าอื่น */
    expect(document.body.style.overflow).toBe('auto');
  });

  it('⭐ คืน **ค่าเดิม** ที่หน้าตั้งไว้ ไม่ใช่คืนเป็นค่าว่าง', () => {
    document.body.style.overflow = 'auto';
    const r = render(box(true));
    expect(document.body.style.overflow).toBe('hidden');

    r.rerender(box(false));
    expect(document.body.style.overflow).toBe('auto');
  });
});
