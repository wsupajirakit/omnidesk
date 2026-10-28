/**
 * [UI-20260826-AUDIENCE3] ตัวเลือกเงื่อนไขที่ "แสดงบนจอ" — ตัดเหลือ 3 ตัว
 * ============================================================================
 * เจ้าของสั่ง 26/08: *"option ตัดเหลือแค่สามตัว ตัวเลือกที่เหลือซ่อนไว้
 * (เผื่อเอากลับมาอีก จะได้ง่าย)"*
 *
 * 🔴 **ซ่อน ไม่ได้ลบ** — ฝั่ง BE ยังประกาศครบทุกตัวเหมือนเดิม (`audience-source.registry.ts`)
 *    งานที่บันทึกไว้แล้วซึ่งใช้คีย์ที่ถูกซ่อน **ยังทำงานได้ปกติ** เพราะ BE ไม่รู้จัก
 *    รายการนี้เลย · ที่นี่กรองเฉพาะ "สิ่งที่ยื่นให้คนเลือกใหม่" เท่านั้น
 *
 * ⚠️ ถ้าเปิดคืน ให้ย้ายคีย์จาก HIDDEN ขึ้นมาที่ VISIBLE — **บรรทัดเดียว**
 *    นี่คือเหตุผลที่เขียนเป็นสองรายการคู่กัน แทนที่จะลบชื่อทิ้ง: คนหลังจะเห็นว่ามี
 *    อะไรอยู่บ้างโดยไม่ต้องไปไล่หาใน repo อีกฝั่ง
 *
 * ⚠️ สามตัวนี้ตรงกับตัวเลือกของปุ่ม Mint พอดี (mint/mint.registry.ts) โดยตั้งใจ
 *    เพื่อให้ "กด mint" กับ "เลือกเอง" ได้ผลลัพธ์ชุดเดียวกัน ไม่ใช่คนละโลก
 *
 * revert: ลบไฟล์นี้ แล้วเอา `.filter(isVisibleSource)` ออกจาก AudienceRuleBuilder
 */

/** คีย์ที่ยื่นให้ผู้ใช้เลือกได้ตอนนี้ */
export const VISIBLE_SOURCE_KEYS: readonly string[] = [
  'follow_up.notice_deposit_at',    // เคยได้รับแจ้งเตือนเรื่องฝาก
  'follow_up.notice_withdraw_at',   // เคยได้รับแจ้งเตือนเรื่องถอน
  'follow_up.customer_helper_at',   // ได้รับการ์ดลงทะเบียนแต่ยังไม่ลงทะเบียน
  /* [FEAT-2708-TIERUNLOCK] เจ้าของ 27/08 (งาน 5.5): ปลดล็อคสองตัวนี้คืน —
     tier ใช้ code (WHERE ชี้ raw profile ตาม registry BE) · tag ติ๊ก+ค้นหา
     ตัวเลือก UI: TierValuePicker/TagValuePicker ผ่าน valueSource.registry */
  'tier.code',                      // ระดับสมาชิก (WHERE ด้วย code จาก raw profile)
  'customer_tag',                   // แท็กลูกค้า (เก็ทรายการใหม่ทุกครั้งที่เปิด)

];

/** คีย์ที่ BE ยังมีอยู่ครบ แต่ยังไม่ยื่นให้เลือก — ย้ายขึ้นข้างบนได้ทันทีเมื่อต้องการ */
export const HIDDEN_SOURCE_KEYS: readonly string[] = [
  'follow_up.abandon_at',           // เคยถูกชวนให้ลงทะเบียน แต่ยังไม่ลงทะเบียน
  'follow_up.request_reg_at',
  'follow_up.notice_payment_at',
  'tier.name',
];

export const isVisibleSource = (key: string): boolean =>
  VISIBLE_SOURCE_KEYS.includes(key);
