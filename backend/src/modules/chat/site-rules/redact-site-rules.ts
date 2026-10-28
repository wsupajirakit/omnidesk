/**
 * [SEC-20260825-SITERULESMASK] ปิดบังเลขบัญชีและ ref_id ก่อนออกจากเซิร์ฟเวอร์
 * ============================================================================
 * เจ้าของ 25/08: *"จุดข้อมูลเว็บทั้งในการ์ดและใน raw ดิบ เบลอเลขที่ บช 50% ·
 * เบลอ ref_id 70%"* และกำชับว่า *"ต้องไม่หลุดใน get / response / inspect"*
 *
 * 🔴 นั่นคือเหตุผลที่ตัวนี้อยู่ฝั่ง **เซิร์ฟเวอร์** ไม่ใช่ฝั่งหน้าจอ
 *    ซ่อนด้วย CSS หรือตัดตอน render ยังคงส่งค่าเต็มออกไปกับ response ⇒ เปิด
 *    devtools แท็บ network ก็เห็นครบทุกตัว · การปิดบังที่เชื่อได้มีที่เดียวคือ
 *    ก่อนค่าออกจากเครื่อง
 *
 * 🔴 จุดคอขวดจุดเดียว: `members.service.ts#getHookSiteRules` ซึ่ง
 *    `refreshHookSiteRules` ก็ `return` ตัวนี้ต่อ ⇒ ปิดที่นี่คลุมทั้งสองเส้น
 *    ถ้าวันหลังมีเส้นที่สามที่ส่ง `raw_site_rules_data` ออกไป **ต้องมาเรียกตัวนี้ด้วย**
 *
 * ── รูปแบบการปิดบัง ────────────────────────────────────────────────────────
 * เก็บ "หัว" ไว้ให้พอจำได้ แล้วแทนที่ส่วนที่เหลือด้วย `*` — รูปเดียวกับที่เจ้าของ
 * ใช้เองในตัวอย่างที่ส่งมา (`"3c0a9e80************************"`)
 *   · `account_number` ปิด 50% ⇒ เห็นครึ่งแรก
 *   · `ref_id`         ปิด 70% ⇒ เห็น 30% แรก
 *
 * ⚠️ ความยาวเดิมถูกรักษาไว้ เพราะหน้าจอจัดคอลัมน์จากความยาว และการย่อให้สั้นลง
 *    จะทำให้ตารางขยับ · ไม่ได้ทำให้เดาค่าจริงได้ง่ายขึ้น เพราะส่วนที่ปิดไม่มีข้อมูล
 * ⚠️ เดินทั้งก้อนแบบ recursive — คีย์สองตัวนี้โผล่ได้หลายชั้น (`bank_account.accounts[]`
 *    วันนี้ · พรุ่งนี้อาจมีที่อื่น) และ "การ์ด" กับ "raw ดิบ" อ่านก้อนเดียวกัน
 *    ⇒ ปิดที่ก้อน ไม่ใช่ปิดทีละที่แสดงผล
 * ⚠️ ไม่แตะค่าที่เก็บในฐาน — ปิดเฉพาะสำเนาที่กำลังจะส่งออก ระบบภายใน
 *    (เช่นตัวเช็ค notice ที่อ่าน `status`/`is_view`) จึงไม่ถูกกระทบ
 *
 * revert: ลบไฟล์นี้ + การเรียกใน `members.service.ts`
 */

/** สัดส่วนที่ถูกปิด ต่อคีย์ · แก้ที่นี่ที่เดียว */
export const MASK_RATIO: Readonly<Record<string, number>> = {
  account_number: 0.5,
  ref_id: 0.7,
};

/**
 * ปิดบังสตริงหนึ่งค่า โดยเก็บหัวไว้และแทนที่ส่วนท้ายด้วย `*`
 *
 * ⚠️ ค่าสั้นมาก (<= 2 ตัว) ปิดทั้งหมด — เก็บ "ครึ่งแรก" ของค่า 2 ตัวคือเปิดเผย
 *    ครึ่งหนึ่งของทั้งค่า ซึ่งไม่ได้ปิดอะไรเลย
 */
export const maskValue = (raw: unknown, ratio: number): unknown => {
  if (typeof raw !== 'string' || raw.length === 0) return raw;
  if (raw.length <= 2) return '*'.repeat(raw.length);
  const hidden = Math.max(1, Math.ceil(raw.length * ratio));
  const keep = Math.max(0, raw.length - hidden);
  return raw.slice(0, keep) + '*'.repeat(raw.length - keep);
};

/**
 * คืนสำเนาของก้อนข้อมูล โดยคีย์ใน `MASK_RATIO` ถูกปิดบังทุกชั้น
 *
 * ⚠️ คืน **ของใหม่เสมอ** ไม่แก้ของเดิมในที่ — ผู้เรียกอาจถือ document จาก
 *    mongoose ที่ถูกใช้ต่อในที่อื่น การแก้ในที่จะทำให้ค่าที่ปิดบังแล้วรั่วไป
 *    ปนกับตรรกะภายใน
 * ⚠️ กันวนซ้ำด้วย `seen` — ก้อนที่อ้างถึงตัวเองจะทำให้ recursion ไม่จบ
 */
export const redactSiteRules = <T>(
  input: T,
  seen = new WeakSet<object>(),
): T => {
  if (Array.isArray(input)) {
    return input.map((v) => redactSiteRules(v, seen)) as unknown as T;
  }
  if (input === null || typeof input !== 'object') return input;
  if (seen.has(input)) return input;
  seen.add(input);

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const ratio = MASK_RATIO[k];
    out[k] =
      ratio === undefined ? redactSiteRules(v, seen) : maskValue(v, ratio);
  }
  return out as unknown as T;
};
