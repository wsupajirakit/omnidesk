import {
  FLEX_VAR_TYPES,
  buildCustomerHelperVarGuidelines,
} from '@/modules/content/flex-var/flex-var-guidelines';

/**
 * [FEAT-20260810-CUSHELPERTYPE] สัญญาของ flex type `customerhelper`
 *
 * สิ่งที่ล็อกไว้ และเหตุผล:
 *   (A) `customerhelper` ต้องอยู่ใน FLEX_VAR_TYPES — ไม่งั้น
 *       `getFlexVariableGuidelines` จะ normalize ทิ้งเป็นค่า default ก่อนถึง
 *       เงื่อนไขที่แจก {{cus_land_url}} แล้ว tag จะหายไปเงียบ ๆ
 *       (บั๊กนี้เกิดจริงตอนพัฒนา เจอเพราะยิง API จริง ไม่ใช่จาก unit test)
 *   (B) tag ต้องมีรูป {{cus_land_url}} เป๊ะ — FE ใช้ตารางนี้เป็น allowlist
 *       ตอน validate ถ้าชื่อเพี้ยนแม้ตัวเดียว ผู้ใช้จะเซฟการ์ดไม่ได้
 *   (C) ต้อง noPrefix — ไม่งั้นจะกลายเป็น {{context.cus_land_url}} ซึ่งไม่มีใครแทนค่าให้
 * เทสนี้ต้องพังถ้ามีคนถอด type ออกจากลิสต์ หรือเปลี่ยนชื่อ tag.
 */

describe('customerhelper — flex var type', () => {
  it('อยู่ใน FLEX_VAR_TYPES (ไม่งั้น guideline endpoint จะ normalize ทิ้ง)', () => {
    expect(
      (FLEX_VAR_TYPES as readonly string[]).includes('customerhelper'),
    ).toBe(true);
  });

  it('ไม่ได้ไปลบ type เดิมออก — ของเก่าต้องอยู่ครบ', () => {
    for (const t of ['normal', 'profile', 'custom', 'profile-semi-custom']) {
      expect((FLEX_VAR_TYPES as readonly string[]).includes(t)).toBe(true);
    }
  });
});

describe('customerhelper — {{cus_land_url}}', () => {
  const rows = buildCustomerHelperVarGuidelines();

  it('แจก tag เดียว ชื่อ {{cus_land_url}} เป๊ะ', () => {
    expect(rows).toHaveLength(1);
    // FE ใช้ค่านี้เป็น allowlist ตอน validate — เพี้ยนแม้ตัวเดียว = เซฟการ์ดไม่ได้
    expect(rows[0]!.tag).toBe('{{cus_land_url}}');
  });

  it('เป็น noPrefix — ไม่ถูกเติม namespace ทับ', () => {
    // ถ้าไม่ noPrefix ตัวประกอบจะทำเป็น {{<role>.cus_land_url}} ซึ่งไม่มีใครแทนค่าให้
    // ⇒ ลูกค้าจะเห็น {{...}} ดิบบนการ์ด
    expect(rows[0]!.noPrefix).toBe(true);
  });

  it('มีคำอธิบายและตัวอย่างให้คนตั้งค่าอ่านเข้าใจ', () => {
    expect(String(rows[0]!.desc || '').trim().length).toBeGreaterThan(0);
    expect(String(rows[0]!.example || '')).toMatch(/^https?:\/\//);
  });
});
