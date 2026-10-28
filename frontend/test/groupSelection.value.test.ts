/* [FEAT-20260817-GROUPBULKSTATUS] selection maths + the sentence the operator reads
 * ===========================================================================
 * งานหมู่บนหน้า group: ติ๊กหลายแถวแล้วเปิด/ปิดทีเดียว · ตรรกะที่ต้องถูกคือ
 *   · select-all ต้องเป็น "ของหน้านี้" ไม่ใช่ทั้ง collection
 *   · หน้าว่างต้องไม่นับว่า "เลือกครบ" (ไม่งั้น header ติ๊กเองโดยไม่มีอะไรให้ทำ)
 *   · set ต้องเป็นตัวใหม่ทุกครั้ง (React state ห้าม mutate ไม่งั้นไม่ re-render)
 *   · ข้อความสรุปต้องบอก "ผลจริง" ไม่ใช่จำนวนที่สั่ง — server ข้ามกลุ่มที่สถานะตรงอยู่แล้ว
 *
 * เทสตรงที่ฟังก์ชัน เพราะหน้า Groups.tsx render ใน vitest ไม่ได้ (fetch ตอน mount + poll)
 */
import { describe, it, expect } from 'vitest';

import {
  allSelected,
  toggleOne,
  toggleAllOnPage,
  bulkStatusMessage,
} from '../components/admin/groups/groupSelection';

describe('[GROUPBULK] allSelected', () => {
  it('⭐ หน้าว่าง = ไม่ใช่ "เลือกครบ"', () => {
    expect(allSelected([], new Set())).toBe(false);
    expect(allSelected([], new Set(['a']))).toBe(false);
  });

  it('ครบทุกแถวบนหน้า = true · ขาดแถวเดียว = false', () => {
    expect(allSelected(['a', 'b'], new Set(['a', 'b']))).toBe(true);
    expect(allSelected(['a', 'b'], new Set(['a']))).toBe(false);
  });

  it('ติ๊กที่อยู่นอกหน้านี้ ไม่ทำให้กลายเป็นเลือกครบ', () => {
    expect(allSelected(['a', 'b'], new Set(['a', 'z']))).toBe(false);
  });
});

describe('[GROUPBULK] toggleOne', () => {
  it('เพิ่ม/ถอด และคืน set ตัวใหม่เสมอ (ห้าม mutate state)', () => {
    const before = new Set(['a']);
    const added = toggleOne(before, 'b');
    expect([...added].sort()).toEqual(['a', 'b']);
    expect(before.has('b')).toBe(false); // ตัวเดิมต้องไม่ถูกแตะ
    expect(added).not.toBe(before);

    const removed = toggleOne(added, 'a');
    expect([...removed]).toEqual(['b']);
  });
});

describe('[GROUPBULK] toggleAllOnPage', () => {
  it('⭐ ยังไม่ครบ → ติ๊กเพิ่มเฉพาะแถวของหน้านี้ (ของหน้าอื่นคงอยู่)', () => {
    const next = toggleAllOnPage(new Set(['z']), ['a', 'b']);
    expect([...next].sort()).toEqual(['a', 'b', 'z']);
  });

  it('⭐ ครบอยู่แล้ว → ถอดออกเฉพาะแถวของหน้านี้', () => {
    const next = toggleAllOnPage(new Set(['a', 'b', 'z']), ['a', 'b']);
    expect([...next]).toEqual(['z']);
  });

  it('หน้าว่าง → ไม่เปลี่ยนอะไร', () => {
    expect([...toggleAllOnPage(new Set(['z']), [])]).toEqual(['z']);
  });
});

describe('[GROUPBULK] bulkStatusMessage — บอกผลจริง', () => {
  it('⭐ มีกลุ่มที่สถานะตรงอยู่แล้ว → ต้องบอกจำนวนนั้นด้วย', () => {
    expect(
      bulkStatusMessage({ matched: 20, modified: 3, unchanged: 17 }, 'ใช้งาน'),
    ).toBe('ใช้งาน · 3 / 20 (เดิมอยู่แล้ว 17)');
  });

  it('เปลี่ยนหมด → ไม่ต้องมีวงเล็บ', () => {
    expect(
      bulkStatusMessage({ matched: 2, modified: 2, unchanged: 0 }, 'ปิด'),
    ).toBe('ปิด · 2 / 2');
  });

  it('ไม่มีอะไรเปลี่ยนเลย → ยังบอกตามจริง ไม่ใช่ "สำเร็จ" ลอย ๆ', () => {
    expect(
      bulkStatusMessage({ matched: 5, modified: 0, unchanged: 5 }, 'ใช้งาน'),
    ).toBe('ใช้งาน · 0 / 5 (เดิมอยู่แล้ว 5)');
  });
});
