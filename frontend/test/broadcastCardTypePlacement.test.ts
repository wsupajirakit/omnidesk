/* [UI-20260825-CARDINMSG] "เนื้อหาการ์ด" ต้องอยู่ในหมวด "เนื้อหาข้อความ"
 *
 * เจ้าของ: *"เนื้อหาการ์ด ย้ายไปอยู่ block ข้อความซ้าย เป็นหมวดเดียวกัน"*
 * เหตุผล: มันเลือกว่าการ์ดที่ส่งจะเหมือนกันทุกคนหรือเติมข้อมูลรายคน ⇒ เป็น
 * คุณสมบัติของ "เนื้อหาที่ส่ง" ไม่ใช่ของ "วิธีส่ง"
 *
 * ⚠️ ย้าย JSX ล้วน ไม่ได้ย้าย state ⇒ เคสนี้ปัก "อยู่ในย่านไหน" กับ
 *    "เงื่อนไข multicast ยังติดมาด้วยไหม" ซึ่งเป็นสองอย่างที่การย้ายทำพังได้จริง
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(
  join(process.cwd(), 'components/campaign/BroadcastFormModal.tsx'),
  'utf8',
);

/** ช่วงของ FormSection ใบที่ testId ตรง — ตัดจากแท็กเปิดถึง </FormSection> ถัดไป */
const sectionRange = (testId: string): [number, number] => {
  const at = src.indexOf(`testId="${testId}"`);
  expect(at, `ไม่เจอ section ${testId}`).toBeGreaterThan(-1);
  const start = src.lastIndexOf('<FormSection', at);
  const end = src.indexOf('</FormSection>', at);
  expect(end).toBeGreaterThan(start);
  return [start, end];
};

/* [UI-20260903-CARDTYPETWOPLACES] JSX ของตัวเลือกถูกแยกไปเป็น
   `form/BroadcastCardTypePicker.tsx` เพราะเจ้าของสั่งให้มี **สองจุด**
   ⇒ `name="card_type"` ไม่อยู่ในไฟล์โมดัลอีกแล้ว · เคสด้านล่างจึงปักที่
     "จุดเรียกคอมโพเนนต์" แทน ซึ่งเป็นสิ่งเดียวกันในเชิงพฤติกรรม
   ⚠️ ยังปักเรื่องเดิมครบทั้งสามข้อ: อยู่ในหมวดเนื้อหาข้อความ · ไม่อยู่ในหมวด
      ผู้รับ · เงื่อนไข multicast ยังติดมาด้วย */
describe('[CARDINMSG] เนื้อหาการ์ดอยู่ในหมวดเนื้อหาข้อความ', () => {
  const cardAt = src.indexOf('testId="card-type-picker-message"');

  it('⭐⭐ ตัวเลือก card_type (จุดเดิม) อยู่ในบล็อก "เนื้อหาข้อความ"', () => {
    expect(cardAt, 'จุดเรียกตัวเลือกการ์ดของขั้น 2 ยังอยู่ไหม').toBeGreaterThan(-1);
    const [start, end] = sectionRange('section-message');
    expect(cardAt).toBeGreaterThan(start);
    expect(cardAt).toBeLessThan(end);
  });

  it('⭐⭐ ไม่ได้อยู่ในบล็อกผู้รับแล้ว (ของเดิม)', () => {
    const [start, end] = sectionRange('section-target');
    expect(cardAt < start || cardAt > end).toBe(true);
  });

  it('⭐⭐ เงื่อนไข multicast ติดมาด้วย — broadcast ต้องยังไม่เห็นตัวเลือกนี้', () => {
    /* `/message/broadcast` ไม่มีรายชื่อผู้รับ ⇒ การ์ดรายคนไม่มีที่ใส่ความต่าง
       ถ้าย้ายแล้วเงื่อนไขหลุด แอดมินจะบันทึกงานที่ส่งไม่ได้เลย */
    const before = src.slice(Math.max(0, cardAt - 900), cardAt);
    expect(before).toContain("formData.send_kind === 'multicast'");
  });

  it('⭐ ป้ายเตือนค่าใช้จ่ายของการ์ดรายคนอยู่กับตัวเลือก ไม่ได้ตกค้างที่เดิม', () => {
    /* ⚠️ ย้ายไปอยู่ในไฟล์คอมโพเนนต์แล้ว ⇒ ปักที่ไฟล์นั้น และปักว่า **ไม่**
       ตกค้างในไฟล์โมดัล ซึ่งคือสิ่งที่การแยกไฟล์ต้องรับประกัน */
    const picker = readFileSync(
      join(process.cwd(), 'components/campaign/form/BroadcastCardTypePicker.tsx'),
      'utf8',
    );
    expect(picker).toContain('card-type-cost');
    expect(picker).toContain('broadcast.card_type_cost');
    expect(src).not.toContain('card-type-cost');
  });
});

/* [UI-20260903-CARDTYPETWOPLACES] เจ้าของ 03/09: *"เพิ่มกล่องเนื้อหาการ์ด ให้เลือก
   ได้สองจุด · จุดเดิมแท็บ 2 ถูกแล้ว · จุดใหม่แท็บ 5 เมื่อเลือก multicast จะแสดงออกมา"*
   ⚠️ เคสชุดนี้ปักสิ่งที่ **การก๊อป JSX ไปวางจะทำพัง**: ต้องเป็นคอมโพเนนต์ตัวเดียว
      กันสองจุด (ไม่ใช่สอง <select>) และทั้งสองจุดต้องเขียน field เดียวกัน */
describe('[CARDTYPETWOPLACES] ตัวเลือกเนื้อหาการ์ดมีสองจุด', () => {
  const atMessage = src.indexOf('testId="card-type-picker-message"');
  const atTarget = src.indexOf('testId="card-type-picker-target"');

  it('⭐⭐ จุดใหม่อยู่ในบล็อกผู้รับ (ขั้น 5) — คนละที่กับจุดเดิม', () => {
    expect(atTarget, 'จุดเรียกของขั้น 5 ยังอยู่ไหม').toBeGreaterThan(-1);
    const [start, end] = sectionRange('section-target');
    expect(atTarget).toBeGreaterThan(start);
    expect(atTarget).toBeLessThan(end);
    expect(atTarget).not.toBe(atMessage);
  });

  it('⭐⭐ จุดใหม่ก็มีเงื่อนไข multicast — broadcast ต้องไม่เห็นทั้งสองจุด', () => {
    /* คู่ broadcast + การ์ดรายคน ถูก BE ปฏิเสธตั้งแต่ตาราง send-matrix
       ถ้าจุดใหม่ลืมประตูนี้ แอดมินจะตั้งค่าที่ส่งไม่ได้จากขั้น 5 */
    const before = src.slice(Math.max(0, atTarget - 900), atTarget);
    expect(before).toContain("formData.send_kind === 'multicast'");
  });

  it('⭐⭐ เป็นคอมโพเนนต์ตัวเดียวกันทั้งสองจุด ไม่ใช่ JSX ที่ก๊อปมาวาง', () => {
    /* 🔴 หัวใจของเคสนี้ · ถ้าใครก๊อป <select name="card_type"> ไปวางเป็นจุดที่สอง
       สองจุดจะเพี้ยนจากกันได้เงียบ ๆ (ป้ายราคา/ตัวเลือก/การแปลง '' → null) */
    expect(src).not.toContain('name="card_type"');
    const calls = src.match(/<BroadcastCardTypePicker\b/g) ?? [];
    expect(calls.length, 'ต้องเรียกคอมโพเนนต์เดียวกันพอดีสองครั้ง').toBe(2);
  });

  it('⭐⭐ ทั้งสองจุดเขียน `card_type` ตัวเดียวกัน — ค่าเดียว สองหน้าจอ', () => {
    /* ถ้าจุดใหม่ไปเขียน field อื่น มันจะกลายเป็น "สองการตั้งค่า" ที่ขัดกันเอง */
    const writes = src.match(/card_type: next/g) ?? [];
    expect(writes.length).toBe(2);
  });
});
