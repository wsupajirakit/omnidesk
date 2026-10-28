import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * [FEAT-20260817-DATEINPUTOPEN] ช่องเวลาของ broadcast ต้องกดตรงไหนก็เปิด
 * ===========================================================================
 * เจ้าของสั่ง 26/08: *"นาฬิกา กดตรงไหนของ input ก็แสดง timepicker เลย
 * ไม่ต้องกด icon ก็ได้"* — เป็นกติกาเดียวกับที่ทำกับ date picker ไว้แล้ว 17/08
 *
 * เทสอ่านซอร์สจริง เพราะสิ่งที่ต้องกันคือ **ช่องที่ถูกลืม** ไม่ใช่พฤติกรรมของ
 * `openNativePicker` (ตัวนั้นมีเทสของตัวเองอยู่แล้วที่ `LogDateRangeFilter.value.test.tsx`
 * และต้องเรียกตรง ๆ เพราะ React กลืน throw ตอน fireEvent — เขียนไว้ในไฟล์นั้น)
 */

const read = (rel: string): string =>
  readFileSync(join(process.cwd(), rel), 'utf8');

/** ทุกช่องกรอกเวลาในเส้น broadcast — เพิ่มช่องใหม่เมื่อไหร่ ต้องมาต่อลิสต์นี้ */
const FIELDS: Array<[string, string]> = [
  ['components/campaign/schedule/RepeatRuleForm.tsx', 'time'],
  ['components/campaign/schedule/RepeatDetailModal.tsx', 'time'],
  ['components/campaign/BroadcastFormModal.tsx', 'datetime-local'],
];

describe('ช่องเวลาในฟอร์ม broadcast เปิด picker ได้ทั้งช่อง', () => {
  it.each(FIELDS)('⭐ %s ต่อ openNativePicker แล้ว', (file) => {
    const src = read(file);
    expect(src).toContain('openNativePicker');
    expect(src).toMatch(/onClick=\{openNativePicker\}/);
  });

  it.each(FIELDS)('⭐ %s ไม่ผูกกับ focus (จะวนเปิดไม่หยุดบน Chrome)', (file) => {
    // focus ยิงตอน picker ปิดด้วย ⇒ ผูกกับ focus = เปิดใหม่ทันทีเป็นวงจร
    expect(read(file)).not.toMatch(/onFocus=\{openNativePicker\}/);
  });

  it('⭐ ทุกช่องที่ต่อแล้ว ใช้ตัวเดียวกัน ไม่มีใครเขียน showPicker เอง', () => {
    /* เขียนเองแล้วจะลืมกันสองชั้น (เมธอดไม่มี / โยน NotAllowedError) ซึ่งเป็น
       เหตุผลที่ `openNativePicker` ถูก export ออกมาตั้งแต่แรก */
    for (const [file] of FIELDS) {
      expect(read(file)).not.toMatch(/\.showPicker\(\)/);
    }
  });
});
