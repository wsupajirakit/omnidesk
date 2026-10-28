/* [UI-20260825-HEADERBTN] ปุ่มบน header ขนาดเท่า footer · ไม่มีปุ่มกากบาท
 * และ [UI-20260825-CONFIRM2] ยืนยันสองชั้น ต้องครบทั้งสองปุ่ม ทุกโหมด
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(
  join(process.cwd(), 'components/campaign/BroadcastFormModal.tsx'),
  'utf8',
);

/** แท็กของปุ่มที่มี name ตรง — ตัดจาก <button ถึง > ของแท็กเปิดเท่านั้น */
const btn = (name: string): string => {
  const at = src.indexOf(`name="${name}"`);
  expect(at, `ไม่เจอปุ่ม ${name}`).toBeGreaterThan(-1);
  const start = src.lastIndexOf('<button', at);
  return src.slice(start, src.indexOf('>', src.indexOf('className', at)));
};

describe('[HEADERBTN] ปุ่ม header', () => {
  it('⭐⭐ ขนาดเท่าปุ่ม footer (px-6 py-2.5)', () => {
    for (const n of ['header_cancel', 'header_confirm']) {
      expect(btn(n), `${n} ต้องเป็นขนาดเดียวกับ footer`).toContain('px-6 py-2.5');
      expect(btn(n), `${n} ต้องไม่ใช่ขนาดเล็กเดิม`).not.toContain('px-4 py-1.5');
    }
  });

  it('⭐⭐ ไม่มีปุ่มกากบาทแล้ว', () => {
    expect(src).toContain('hideClose');
  });

  it('⭐⭐ ยังปิดโมดัลได้อยู่ — ไม่มีทางติดอยู่ข้างใน', () => {
    /* เอา X ออกแล้วต้องเหลือทางออก ไม่งั้นผู้ใช้ปิดไม่ได้
       [UI-20260828-DISCARDGUARD] ปุ่มนี้ไม่ได้เรียก `onClose` ตรง ๆ แล้ว — มันผ่าน
       `requestClose` ซึ่งถามก่อนถ้ามีงานค้าง แล้วค่อยปิด
       🔴 สิ่งที่เคสนี้ปักคือ **ยังมีทางออก** ไม่ใช่ชื่อฟังก์ชัน ⇒ ปักสองชั้น:
          ปุ่มต้องต่ออยู่กับ `requestClose` และ `requestClose` ต้องเรียก `onClose`
          จริงในสักทางหนึ่ง · ถ้าปักแค่ชื่อปุ่ม วันที่ `requestClose` ลืมเรียก
          `onClose` เทสจะยังเขียวทั้งที่ผู้ใช้ติดอยู่ข้างในจริง ๆ
       ⚠️ พฤติกรรมตอนกดของจริง (ถาม/ไม่ถาม/ปิดจริง) วัดที่
          `broadcastDiscardGuard.dom.test.tsx` ซึ่ง render ของจริง — ไฟล์นี้อ่าน
          source text จึงพิสูจน์ได้แค่ว่า "สายไม่ขาด" */
    expect(btn('header_cancel')).toContain('onClick={requestClose}');
    expect(src).toContain('const requestClose = () => {');
    const body = src.slice(src.indexOf('const requestClose = () => {'));
    expect(body.slice(0, body.indexOf('};'))).toContain('onClose();');
  });
});

describe('[CONFIRM2] ยืนยันสองชั้น ครบทั้งสองปุ่ม', () => {
  it('⭐⭐ ปุ่ม header ยิง submit ของฟอร์มเดียวกับปุ่มล่าง', () => {
    /* 🔴 `form="broadcast-form"` คือเส้นเดียวที่ทำให้ปุ่มนอก <form> ยิง submit ได้
       ขาดไป = กดแล้วเงียบสนิท ไม่มี error ให้เห็น */
    expect(btn('header_confirm')).toContain('type="submit"');
    expect(btn('header_confirm')).toContain('form="broadcast-form"');
  });

  it('⭐⭐ submit ไม่ได้บันทึกทันที — เปิดชั้นยืนยันก่อนเสมอ', () => {
    /* ทั้งสองปุ่มเข้า handleSubmit ตัวเดียวกัน ⇒ ชั้นยืนยันครอบทุกโหมด
       (create / update / copy) โดยไม่ต้องมีเงื่อนไขแยกโหมด */
    const at = src.indexOf('setIsConfirmOpen(true)');
    expect(at, 'ชั้นยืนยันยังอยู่ไหม').toBeGreaterThan(-1);
    expect(src).toContain('const confirmSubmit');
    /* ตัวที่บันทึกจริงต้องอยู่หลังชั้นยืนยัน ไม่ใช่ใน handleSubmit */
    expect(src.indexOf('const confirmSubmit')).toBeGreaterThan(at);
  });
});
