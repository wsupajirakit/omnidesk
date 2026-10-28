/* [UI-20260825-BCASTNEWEST] รายการบรอดแคสต์ต้องเรียงใหม่สุดขึ้นบน
 *
 * เดิมขอ `scheduled_at:asc` ⇒ เก่าสุดอยู่บน · และ `scheduled_at` เป็น null
 * สำหรับงานที่ไม่ได้ตั้งเวลา ⇒ กลุ่มนั้นไม่มีลำดับที่คนอ่านเดาได้
 *
 * ⚠️ BE ไม่มี whitelist ของ sort field — `parseSort` ส่งชื่อ field ผ่านไปที่
 *    Mongo ตรง ๆ ⇒ พิมพ์ผิดไม่ error แต่ได้ลำดับมั่วเงียบ ๆ เคสนี้จึงปักทั้ง
 *    "ทิศทาง" และ "ชื่อ field"
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(process.cwd(), 'pages/messaging/Broadcasts.tsx'), 'utf8')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  .replace(/\/\*[\s\S]*?\*\//g, '');

describe('[BCASTNEWEST] รายการบรอดแคสต์เรียงใหม่สุดขึ้นบน', () => {
  it('⭐⭐ ขอ sort แบบ desc — ไม่ใช่ asc', () => {
    const at = src.indexOf('listBroadcasts(');
    expect(at, 'ยังเรียก listBroadcasts อยู่ไหม').toBeGreaterThan(-1);
    const call = src.slice(at, src.indexOf('}', src.indexOf('sort:', at)));
    expect(call).toContain(':desc');
    expect(call).not.toContain(':asc');
  });

  it('⭐⭐ เรียงด้วยคอลัมน์ที่ตารางโชว์จริง (อัปเดตล่าสุด)', () => {
    /* เรียงด้วย field ที่ผู้ใช้มองไม่เห็น = ลำดับที่อธิบายไม่ได้เมื่อมีคนถาม */
    expect(src).toContain("sort: 'updated_at:desc'");
  });

  it('⭐ ไม่กลับไปใช้ scheduled_at ซึ่งเป็น null ได้', () => {
    expect(src).not.toContain('scheduled_at:asc');
  });
});
