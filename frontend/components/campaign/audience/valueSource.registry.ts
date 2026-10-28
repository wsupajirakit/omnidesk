/**
 * [FEAT-20260824-BCASTTAGPICK] Which rule keys need a picker instead of a box.
 * ===========================================================================
 * เจ้าของ 24/08: *"dive จริงอย่าสร้างหนี้ทำดี ๆ"* · และก่อนหน้านั้น *"เพิ่ม ท่อ … ในอนาคต
 * จะมี tier + อื่น ๆ อีก ใน member raw profile ก็สามารถเลือกได้ ทำท่อเผื่อไว้เลย"*.
 *
 * ── ปัญหา ────────────────────────────────────────────────────────────────────
 * `RuleValueInput` เลือกหน้าตาช่องจาก **`type`** ของฟิลด์ (`date`/`boolean`/`string[]`/
 * `string`) ซึ่งถูกต้องสำหรับเกือบทุกฟิลด์ แต่ `customer_tag` ประกาศ `type: 'string'`
 * ทั้งที่ค่าที่รับจริงคือ `tags._id` เท่านั้น ⇒ ช่อง text จะรับ "VIP" แล้วเงียบ
 *
 * 🔴 ทำไมเป็นตารางคีย์ ไม่ใช่ `if (key === 'customer_tag')` ใน `RuleValueInput`
 *    เจ้าของบอกไว้แล้วว่าจะมี tier / raw profile / ticket type ตามมา ⇒ ถ้าเขียน
 *    เงื่อนไขตรง ๆ ไฟล์นั้นจะโตขึ้นทุกครั้งที่เพิ่มฟิลด์ **เพิ่ม picker ใหม่ = เพิ่ม 1 entry
 *    ที่นี่** และ `RuleValueInput` ไม่ต้องรู้จักคีย์ไหนเลยตลอดไป
 *
 * ⚠️ ทำไมไม่ให้ BE บอกมา — `AudienceSource` ฝั่ง BE ไม่มีช่อง "options"/"widget"
 *    (ดู `audience-source.types.ts`) การเพิ่มเข้าไปคือแก้สัญญาของ endpoint ที่
 *    ฟอร์มทั้งหน้าอ่านอยู่ ⇒ แพงกว่าปัญหา วันที่มี picker ตัวที่สามค่อยคุยกันใหม่
 *    ตอนนี้ตารางนี้คือ "ฝั่งจอรู้ว่าคีย์ไหนต้องใช้เครื่องมือพิเศษ" ซึ่งเป็นความรู้ของฝั่งจอจริง ๆ
 *
 * 🔴 ห้ามใส่คีย์ที่ BE ไม่รู้จัก — entry ที่นี่ไม่ได้ทำให้ฟิลด์โผล่ในฟอร์ม
 *    รายการฟิลด์มาจาก `/api/broadcasts/audience-sources` เสมอ ตารางนี้แค่
 *    เปลี่ยน "หน้าตาช่องค่า" ของคีย์ที่มีอยู่แล้ว
 *
 * revert: ลบไฟล์นี้ + การเรียกใน `RuleValueInput.tsx` ⇒ ทุกคีย์กลับไปใช้ช่องตาม type
 */

/** Widgets a rule value may use, beyond the plain type-driven boxes. */
export type ValueWidget = 'customer-tag' | 'tier';

/**
 * คีย์ → widget. ว่างไว้แปลว่า "ใช้ช่องตาม `type` ตามปกติ"
 *
 * ⚠️ คีย์ต้องสะกดตรงกับ `audience-source.registry.ts` ฝั่ง BE เป๊ะ ๆ
 *    สะกดผิด = ไม่ error แค่ได้ช่อง text เหมือนเดิม (fail ไปทางที่ปลอดภัย)
 */
const WIDGET_BY_KEY: Readonly<Record<string, ValueWidget>> = {
  customer_tag: 'customer-tag',
  /* [FEAT-2708-TIERUNLOCK] (งาน 5.5) tier เลือกจากรายการกลาง (`tierOptions.ts`)
     — ช่อง text ตาม type จะรับ "Gold" แล้วเงียบ เพราะ WHERE ใช้ code ตัวพิมพ์เล็ก */
  'tier.code': 'tier',
  /* [FEAT-2708-TIERUNLOCK] (งาน 5.5) tier เลือกจากรายการกลาง (`tierOptions.ts`)
     — ช่อง text ตาม type จะรับ "Gold" แล้วเงียบ เพราะ WHERE ใช้ code ตัวพิมพ์เล็ก */

};

/**
 * `undefined` — ไม่ใช่ `'text'` — เมื่อคีย์นี้ไม่ต้องการ widget พิเศษ
 * เพื่อให้ผู้เรียกแยก "ไม่มีในตาราง" ออกจาก "มีในตารางและเป็น text" ได้
 * absent ≠ default. ห้ามยุบสองอย่างนี้.
 */
/* [FEAT-20260825-HASVALUE] op ที่ "ไม่ต้องกรอกค่า"
   ===========================================================================
   `has_value` / `no_value` ถามว่า **มีหรือไม่มี** ⇒ ไม่มีอะไรให้กรอก
   ก่อนหน้านี้ฟอร์มไม่มีแพทเทิร์นนี้เลย — `RuleValueInput` คืน input ทุกเส้นทาง

   ⭐ ทำไมตัดสินจาก **op** ไม่ใช่ **key** (ต่างจาก `WIDGET_BY_KEY` ด้านบน):
      widget ผูกกับ key เพราะ "คีย์นี้ต้องเลือกจากรายการ" เป็นคุณสมบัติของคีย์
      แต่ "ไม่ต้องกรอกค่า" เป็นคุณสมบัติของ **ตัวดำเนินการ** · วันไหนมีคอลัมน์ที่
      เปิดทั้ง `lte` และ `has_value` การผูกกับ key จะซ่อนช่องกรอกตอนเลือก `lte` ด้วย
   ⚠️ `op` ที่ยังไม่ถูกเลือก (undefined) ⇒ **แสดงช่องกรอก** — เดาไปทางที่ผู้ใช้
      ยังกรอกได้ ปลอดภัยกว่าซ่อนช่องแล้วเขาไม่รู้ว่าต้องทำอะไรต่อ */
export const OPS_WITHOUT_VALUE: readonly string[] = ['has_value', 'no_value'];

/** op นี้ต้องกรอกค่าไหม — `undefined` (ยังไม่เลือก) นับว่าต้อง */
export const opTakesValue = (op: string | undefined): boolean =>
  op === undefined || !OPS_WITHOUT_VALUE.includes(op);

export function widgetForKey(key: string | undefined): ValueWidget | undefined {
  if (typeof key !== 'string' || key === '') return undefined;
  return WIDGET_BY_KEY[key];
}
