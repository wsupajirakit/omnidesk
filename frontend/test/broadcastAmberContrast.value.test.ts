/**
 * [FIX-20260825-AMBERCONTRAST] สีเหลือง/อำพันอ่อนเกินไปบนธีมสว่าง อ่านไม่ออก
 *
 * เจ้าของแจ้ง 25/08 พร้อมภาพ: ป้าย "ตั้งเวลา" ในคอลัมน์ "สถานะงาน"
 * *"สีเหลืองอ่านไม่ออก light theme สีอ่อนเกินไป"*
 *
 * ต้นเหตุ: เฉด 300/400 เป็นสีที่ออกแบบมาสำหรับ **พื้นมืด** แต่หน้านี้เป็นธีมสว่างล้วน
 * (`pages/messaging/Broadcasts.tsx` ไม่มีคลาส `dark:` แม้แต่ตัวเดียว)
 * และป้าย `sent` ข้าง ๆ ใช้ `text-emerald-500` ที่เข้มกว่า ⇒ ไม่สม่ำเสมอกันเองด้วย
 *
 * เทสนี้กันการย้อนกลับ: ห้ามมีตัวอักษรเหลือง/อำพันเฉดอ่อนในย่านนี้อีก
 * เว้นแต่จะมีคู่ `dark:` กำกับ (แปลว่าตั้งใจใช้กับพื้นมืดจริง ๆ)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FILES = [
  'pages/messaging/Broadcasts.tsx',
  'components/campaign/BroadcastFormModal.tsx',
  'components/campaign/mint/MintChoiceModal.tsx',
  'components/campaign/schedule/RepeatRuleForm.tsx',
];

/* จับเฉพาะสีของ "ตัวอักษร" — พื้นหลังแบบ bg-amber-500/10 ไม่เกี่ยว
   และปล่อยผ่านถ้าบรรทัดนั้นมี dark: กำกับ (ตั้งใจใช้กับพื้นมืด) */
const PALE_TEXT = /\btext-(?:amber|yellow)-[1-4]00\b/;

describe('[AMBERCONTRAST] ไม่มีตัวอักษรเหลือง/อำพันเฉดอ่อนบนธีมสว่าง', () => {
  it.each(FILES)('%s', (rel) => {
    const lines = readFileSync(join(process.cwd(), rel), 'utf8').split('\n');
    const offenders = lines
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => PALE_TEXT.test(line) && !line.includes('dark:'))
      .map(({ line, n }) => `${n}: ${line.trim().slice(0, 80)}`);
    expect(offenders).toEqual([]);
  });

  /* ⭐ ป้าย "ตั้งเวลา" คือตัวที่เจ้าของชี้มาโดยตรง — ปักไว้เฉพาะเจาะจง
     เพื่อให้เห็นทันทีว่าอันไหนพังถ้ามีใครเปลี่ยนกลับ */
  it('⭐⭐ ป้าย scheduled ใช้เฉดที่อ่านออกบนพื้นสว่าง', () => {
    const src = readFileSync(join(process.cwd(), FILES[0]), 'utf8');
    const i = src.indexOf("status === 'scheduled'");
    expect(i).toBeGreaterThan(-1);
    const region = src.slice(i, i + 200);
    expect(region).toContain('bg-yellow-500/10');   // anchor: ตัดถูกที่
    expect(region).not.toMatch(PALE_TEXT);
  });
});
