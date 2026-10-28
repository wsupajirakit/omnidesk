/* [UI-20260825-SENDOPEN] การ์ด "สถานะการส่ง" ต้องกางไว้เสมอ
 *
 * เป็นการ์ดที่ต้องเลือกก่อนกดยืนยันทุกครั้ง (ส่งทันที / ตั้งเวลา / บันทึกร่าง)
 * พับไว้ = ผู้ใช้ต้องกดเปิดเองทุกครั้งที่สร้างงาน
 * ⚠️ modal ใช้ร่วมกันทั้ง create / edit / copy ⇒ จุดเดียวครอบทั้งสาม
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(
  join(process.cwd(), 'components/campaign/BroadcastFormModal.tsx'),
  'utf8',
)
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** ตัดเฉพาะแท็กเปิดของ FormSection ใบที่ testId ตรง — ห้ามตัดตามจำนวนตัวอักษร */
const sectionTag = (testId: string): string => {
  const at = src.indexOf(`testId="${testId}"`);
  expect(at, `ไม่เจอ section ${testId}`).toBeGreaterThan(-1);
  const start = src.lastIndexOf('<FormSection', at);
  const end = src.indexOf('>', at);
  return src.slice(start, end);
};

describe('[SENDOPEN] สถานะการส่ง กางไว้เป็นค่าเริ่มต้น', () => {
  it('⭐⭐ การ์ด "สถานะการส่ง" มี defaultOpen', () => {
    expect(sectionTag('section-send')).toContain('defaultOpen');
  });

  it('⭐ ยังพับเองได้ — FormSection เก็บสถานะในตัวเอง ไม่ได้ถูกล็อคเปิด', () => {
    /* ถ้าวันหนึ่งมีคนเปลี่ยนไปบังคับเปิด (เช่น prop `open` ตายตัว) เคสนี้จะแดง
       เพราะคำสั่งคือ "เปิดค้างไว้ แต่พับเองได้" ไม่ใช่ "ห้ามพับ" */
    const fs = readFileSync(
      join(process.cwd(), 'components/campaign/form/FormSection.tsx'),
      'utf8',
    );
    expect(fs).toContain('useState(defaultOpen)');
  });

  it('⭐ การ์ดพี่น้องที่กางอยู่แล้วต้องไม่ถูกแตะ', () => {
    for (const id of ['section-basic', 'section-message']) {
      expect(sectionTag(id), `${id} ต้องยังกางอยู่`).toContain('defaultOpen');
    }
  });
});
