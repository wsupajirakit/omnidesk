/**
 * ==== [FIX-20260810-TIERSOURCE] แหล่งเดียวของ "tier ของลูกค้า" ====
 *
 * ## ปัญหาที่แก้
 * ป้าย tier บน **panel ซ้าย** กับบน **header ห้องแชต** เคยอ่านคนละที่:
 *   - panel  : `line_user_data.tier` (มากับ ticket list)
 *   - header : ยิง `getRawProfile(memberId)` สดตอนเปิดห้อง
 *
 * ผลคือคนเดียวกันเห็นป้ายไม่เหมือนกัน — เคสจริงที่เจอ: ลูกค้า 0965550015
 * panel ขึ้น `Normal 0` แต่ header ว่าง เพราะ header ไม่ได้ `memberId`
 * (`line_user_data` ไม่ได้ populate ในบางเส้น ⇒ `._id` เป็น undefined
 * ⇒ `ChatRoomView.tsx` `if (!memberId) return;` ⇒ ไม่ยิง API เลย)
 *
 * ## ทางแก้ (เจ้าของสั่ง 2026-08-10)
 * ทั้งสองจุดอ่าน **`raw_profile_data` จาก DB** ผ่านฟังก์ชันเดียวในไฟล์นี้
 * ⇒ ตรงกันเสมอโดยไม่ต้องพึ่ง `memberId` และไม่ต้องยิง API เพิ่ม
 *
 * ## ทำไม raw_profile_data ดีกว่า members.tier
 * นับจริงบน dev (13 คน): มีทั้งคู่ 3 · **มีแค่ raw_profile_data 1** · ไม่มีเลย 9
 * ⇒ อ่านจาก raw ได้ครอบคลุมกว่า และเป็นค่าที่ปลายทางส่งมาจริง ไม่ใช่ค่าที่เราคัดลอกไว้
 * `members.tier` ยังใช้เป็นตัวสำรอง เพราะบางเส้นอาจมีแต่ตัวนั้น
 *
 * ## รูปร่างของข้อมูล (ตรวจกับ DB จริง)
 * ```
 * member.raw_profile_data = { success: true, data: { profile: { tier: {...} } } }
 * member.tier             = { code, name, level, raw, updated_at }
 * ```
 * ปลายทางบางเจ้าห่อ `data` บางเจ้าไม่ห่อ จึงลองทั้งสองรูป
 *
 * ## revert
 * ลบไฟล์นี้ แล้วให้ panel กลับไปอ่าน `line_user_data.tier` ตรง ๆ และ header
 * กลับไปใช้ `getRawProfile` — พฤติกรรมเดิม (ที่ไม่ตรงกัน) จะกลับมา
 */

/** tier ที่ปลายทางส่งมา — โครงต่างกันได้ตามเจ้า จึงไม่ผูกชนิดแน่น */
export type MemberTier = {
  code?: string | null;
  name?: string | null;
  level?: number | null;
} | null;

/**
 * ดึง tier ของลูกค้าจาก member object (ที่มากับ ticket หรือโหลดแยก)
 *
 * ลำดับ: `raw_profile_data` (ค่าที่ปลายทางส่งมาจริง) → `members.tier` (ตัวสำรอง)
 * ไม่เจอ ⇒ `null` ⇒ ผู้เรียกไม่ต้องแสดงป้าย
 *
 * ⚠️ รับ `any` โดยตั้งใจ — ข้อมูลนี้มาจากปลายทางภายนอกที่รูปไม่คงที่
 * การผูกชนิดแน่นจะทำให้ต้องแก้ทุกครั้งที่เจ้าใหม่ส่งรูปไม่เหมือนเดิม
 */
export const tierOfMember = (member: any): MemberTier => {
  if (!member || typeof member !== 'object') return null;

  const raw = member.raw_profile_data;
  // ปลายทางบางเจ้าห่อด้วย { data: { profile } } บางเจ้าเป็น { profile } ตรง ๆ
  const fromRaw =
    raw?.data?.profile?.tier ?? raw?.profile?.tier ?? raw?.tier ?? null;
  if (fromRaw) return fromRaw as MemberTier;

  return (member.tier as MemberTier) ?? null;
};

/**
 * ข้อความบนป้าย เช่น `Normal 0`
 *
 * ⚠️ `level` เป็น 0 ได้ (Normal) ซึ่ง falsy — ห้ามใช้ `||` ไม่งั้นเลข 0 จะหาย
 * ⚠️ `code`/`name` อาจเป็นสตริงว่างเมื่อปลายทางส่ง tier เป็นตัวเลขล้วน
 */
export const tierBadgeText = (tier: MemberTier): string => {
  if (!tier) return '';
  const label =
    [tier.name, tier.code].find(
      (v) => v !== null && v !== undefined && String(v) !== '',
    ) ?? '';
  const lv = tier.level;
  const lvText = lv === null || lv === undefined ? '' : String(lv);
  return [label, lvText].filter(Boolean).join(' ');
};
