/**
 * [UI-20260824-BCASTACTIVE] "สีเขียวมันดูยากไป เข้มกว่านี้ light theme"
 * ===========================================================================
 * 🔴 ทำไมเทสสีถึงคุ้มที่จะมี — บั๊กนี้ไม่ทำให้อะไรพัง มันแค่ทำให้ "ปุ่มไหนถูกเลือกอยู่"
 *    อ่านไม่ออก ⇒ ไม่มีเทสตัวไหนในโลกจับได้ด้วยการ render เฉย ๆ และมันหลุดขึ้น
 *    production มาแล้วรอบหนึ่ง เพราะสตริงถูกก๊อปต่อ ๆ กัน 9 จุดในไฟล์เดียว
 *
 * ⚠️ เทสนี้ยืนยัน "ค่าของธีมสว่างต้องเป็นเขียวเข้ม" ไม่ได้ยืนยันว่าสวย — jsdom
 *    ไม่โหลด stylesheet จึงวัด contrast จริงไม่ได้ ⇒ วัดที่ token ที่เลือกใช้แทน
 *    ซึ่งเป็นสิ่งเดียวที่พิสูจน์ได้ตรงนี้
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CHOICE_ACTIVE,
  CHOICE_IDLE,
  choiceClass,
} from '../components/campaign/pickers/activeChoiceClass';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('[UI-20260824-BCASTACTIVE] สถานะ "เลือกอยู่" ต้องอ่านออกในธีมสว่าง', () => {
  it('⭐ ตัวอักษรของธีมสว่างต้องเป็นเขียวเข้ม ไม่ใช่เขียวมิ้นต์', () => {
    expect(CHOICE_ACTIVE).toContain('text-emerald-700');
    /* emerald-300 (#6EE7B7) ยังอยู่ได้ แต่ต้องอยู่หลัง `dark:` เท่านั้น —
       ถ้ามันโผล่แบบไม่มี prefix แปลว่าธีมสว่างกลับไปจางเหมือนเดิม */
    expect(CHOICE_ACTIVE).not.toMatch(/(^|\s)text-emerald-300/);
    expect(CHOICE_ACTIVE).toContain('dark:text-emerald-300');
  });

  it('⭐ ยังเป็น "เขียว" อยู่ — เปลี่ยนความเข้ม ไม่ได้เปลี่ยนความหมายของสี', () => {
    expect(CHOICE_ACTIVE).toContain('emerald');
    expect(CHOICE_ACTIVE).toContain('bg-emerald-50');
    expect(CHOICE_ACTIVE).toContain('border-emerald-500');
  });

  it('🔴 ปุ่มที่ "ไม่ได้เลือก" ต้องเหมือนเดิมเป๊ะ — งานนี้แตะเฉพาะสถานะที่ถูกเลือก', () => {
    expect(CHOICE_IDLE).toBe('border-dark-700 text-slate-600 hover:border-primary-500/40');
  });

  it('choiceClass สลับสองสถานะตรงตัว', () => {
    expect(choiceClass(true)).toBe(CHOICE_ACTIVE);
    expect(choiceClass(false)).toBe(CHOICE_IDLE);
  });

  it('🔴 ฟอร์มบรอดแคสต์ต้องไม่เหลือสตริงเขียวจางเวอร์ชันก๊อปมือแม้แต่จุดเดียว', () => {
    /* กันการก๊อปกลับเข้ามาใหม่: ถ้ามีคนแปะ `bg-emerald-500/10 text-emerald-300`
       ลงไปอีก เทสนี้แดงทันที ไม่ต้องรอเจ้าของมาบ่นรอบสอง */
    const src = readFileSync(
      resolve(ROOT, 'components/campaign/BroadcastFormModal.tsx'),
      'utf8',
    );
    expect(src).not.toContain('border-emerald-400 bg-emerald-500/10 text-emerald-300');
    expect(src).not.toMatch(/["'`\s]text-emerald-300/);
  });
});
