/**
 * [UI-20260828-OANAMETONE] ชื่อ OA ในโมดัลผู้ใช้ต้องอ่านออกในธีมสว่าง
 * ===========================================================================
 * เจ้าของ 28/08: *"สีมันจืดไป light theme ... เอาเข้มขึ้น label hook oa name"*
 *
 * 🔴 `text-slate-300` + `hover:text-white` เป็นชุดสีของพื้นมืด · โมดัลนี้อยู่บนพื้น
 *    สว่าง ⇒ ชื่อ OA อ่านเหมือน "ถูกปิดใช้งาน" ทั้งที่ติ๊กเลือกอยู่
 *    และ hover เป็นสีขาว = หายไปกับพื้นเลย
 *
 * ⚠️ เทสนี้อ่าน source text ไม่ได้ render — สิ่งที่ต้องกันคือ "คลาสของพื้นมืด
 *    หลุดกลับมาเป็นสีหลัก" ซึ่งเป็นเรื่องของตัวอักษรในไฟล์ ไม่ใช่พฤติกรรม
 *    ⇒ ถูกกว่าและตรงกว่าการ mount โมดัลทั้งใบเพื่อดูสีข้อความบรรทัดเดียว
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(
  join(__dirname, '..', 'components', 'admin', 'UserFormModal.tsx'),
  'utf8',
);

/** บรรทัดที่วาดชื่อ OA แต่ละตัวในรายการสิทธิ์ */
const oaRow =
  src.split('\n').find((l) => l.includes('<label key={hook._id}')) ?? '';

describe('[OANAMETONE] ชื่อ OA อ่านออกในธีมสว่าง', () => {
  it('⭐⭐ 🔴 ไม่ใช้โทนพื้นมืดเป็นสีหลักอีกแล้ว', () => {
    expect(oaRow).not.toBe('');
    /* ต้องไม่มี `text-slate-300` แบบไม่มี `dark:` นำหน้า */
    expect(oaRow).not.toMatch(/(?<!dark:)text-slate-300/);
    expect(oaRow).not.toMatch(/(?<!dark:)hover:text-white/);
  });

  it('⭐⭐ ธีมสว่างใช้โทนเข้ม และ hover เข้มขึ้น ไม่ใช่สว่างขึ้น', () => {
    /* 🔴 บนพื้นสว่าง การ hover เป็นสีขาวคือการทำให้ข้อความหายไป */
    expect(oaRow).toContain('text-slate-700');
    expect(oaRow).toContain('hover:text-slate-900');
  });

  it('⭐ ธีมมืดยังได้ค่าเดิม — ไม่ได้ไปทำให้อีกธีมพังแทน', () => {
    expect(oaRow).toContain('dark:text-slate-300');
    expect(oaRow).toContain('dark:hover:text-white');
  });
});
