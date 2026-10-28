/**
 * [FIX-20260824-UNHIDETEMPLATE] "ข้อความ (template_message)" ต้องเลือกได้
 * ===========================================================================
 * เจ้าของ 24/08: *"type ที่ยอมให้ select flex id บน form fe ได้คือ type แบบข้อความ
 * … ให้ไปยกเลิกการซ่อน type นี้ใน flex message create/edit ด้วย หน้า fe มันซ่อนยุ"*
 *
 * 🔴 ทำไมต้องมีเทสนี้: `HIDDEN_FLEX_TYPES` เป็น array ตัวเดียวที่คุมทั้ง
 *    "ตัวเลือกตอนสร้าง/แก้ไข" และ "filter หน้า list" ⇒ ใครเติมชื่อกลับเข้าไป
 *    แอดมินจะ **สร้างการ์ดชนิดนี้ไม่ได้เลย** และแคมเปญ broadcast จะมีตัวเลือก
 *    ผูกการ์ดแต่ไม่มีของให้เลือก — พังแบบเงียบ ไม่มี error ที่ไหน
 *    ซ่อนกลับ = ไม่มีของให้เลือก แต่ไม่มีใคร error
 */
import { describe, it, expect } from 'vitest';

import {
  FLEX_TYPES,
  HIDDEN_FLEX_TYPES,
  VISIBLE_FLEX_TYPES
} from '../components/flex/FlexMessageFormModal';

describe('template_message — ต้องเลือกได้ในหน้าสร้าง/แก้ไข', () => {
  it('🔴 ไม่อยู่ในรายการซ่อน', () => {
    expect(HIDDEN_FLEX_TYPES).not.toContain('template_message');
  });

  it('🔴 โผล่ในตัวเลือกที่มองเห็นจริง', () => {
    expect(VISIBLE_FLEX_TYPES.map(t => t.value)).toContain('template_message');
  });

  it('ยังอยู่ใน FLEX_TYPES เต็ม — การ์ดเก่าชนิดนี้ต้อง normalize/แสดงป้ายได้', () => {
    /* ถ้าหลุดจากลิสต์เต็ม การ์ดที่เก็บค่านี้ไว้แล้วจะถูก normalize กลับเป็น
       'slip' ⇒ ข้อมูลเดิมเปลี่ยนชนิดเงียบ ๆ */
    expect(FLEX_TYPES.map(t => t.value)).toContain('template_message');
  });

  it('ป้ายยังบอก value จริงเป็นภาษาอังกฤษในวงเล็บ ตามแบบทุกตัว', () => {
    const entry = FLEX_TYPES.find(t => t.value === 'template_message');
    expect(entry?.label).toContain('template_message');
  });
});

describe('normal — ยังซ่อนอยู่ตามเดิม', () => {
  it('🔴 เจ้าของสั่งเปิดตัวเดียว ห้ามเหมาเปิดทั้งสองตัว', () => {
    expect(HIDDEN_FLEX_TYPES).toContain('normal');
    expect(VISIBLE_FLEX_TYPES.map(t => t.value)).not.toContain('normal');
  });
});
