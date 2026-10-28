/**
 * [P2-20260813] · [FIX-20260828-AIVENDORTRUTH] รายชื่อ AI vendor — แหล่งเดียวของทั้งแอป
 * ===========================================================================
 * เจ้าของ 28/08: *"`AI_VENDORS` ต้องมี single truth (เหมือน modal edit/create)
 * ไม่งั้นมั่ว"*
 *
 * 🔴 เดิมรายชื่อนี้เป็น `const VENDORS` **ที่อยู่ในไฟล์ `AiVendorSelect.tsx` เท่านั้น**
 *    (module-private) ⇒ หน้าจออื่นที่ต้องให้เลือก vendor เอาไปใช้ไม่ได้ ต้องก๊อป
 *    รายชื่อไปวางเอง · วันที่เพิ่ม vendor ตัวที่สาม จะมีที่ต้องแก้สองที่ และที่ที่ลืม
 *    จะกลายเป็นเมนูที่ขาดตัวเลือกโดยไม่มีอะไรฟ้อง — นั่นคือเหตุผลที่ยกออกมาไว้ที่นี่
 *
 * 🔴 **นี่คือแหล่งเดียวฝั่งหน้าจอ — ห้ามประกาศรายชื่อ vendor ที่อื่นอีก**
 *    เพิ่ม vendor ใหม่ = แก้ที่นี่ที่เดียว แล้วทุกหน้าจอได้ตามกันหมด
 *
 * ⚠️ ฝั่ง BE มีรายชื่อของตัวเองที่ `hooks/ai-vendor/parse-ai-vendor.ts` (`AI_VENDORS`)
 *    ซึ่งเป็นตัว **ตัดสินจริง** ตอนเขียนลงฐาน · สองฝั่งนี้ต้องเพิ่มพร้อมกันเสมอ —
 *    เพิ่มที่นี่ฝั่งเดียว ผู้ใช้จะเลือกได้แต่เซฟไม่ผ่านพร้อม error ดิบ ๆ
 *    เพิ่มที่ BE ฝั่งเดียว ตัวเลือกก็จะไม่โผล่บนจอ
 *    ⇒ คนละ runtime จึงรวมเป็นไฟล์เดียวไม่ได้ แต่ต้องแก้คู่กันเสมอ
 *
 * ⚠️ ผูก type กับ `HookFormData['ai_vendor']` ไม่ใช่ `string` — ถ้าพิมพ์ชื่อ vendor
 *    ผิดตรงนี้ จะเป็น error ตอน compile แทนที่จะไปโผล่เป็น error ตอนผู้ใช้กดเซฟ
 *
 * revert: ย้ายรายชื่อกลับเข้า `AiVendorSelect.tsx` แล้วลบไฟล์นี้ (และผู้ใช้รายอื่น
 *   ของมันจะต้องหาที่มาของรายชื่อเอง — ซึ่งคือปัญหาเดิม)
 */
import type { HookFormData } from '../types/hook';

/** vendor ตามที่ API ประกาศไว้ · `''` บนจอคือ "ใช้ค่าเริ่มต้น" ไม่ใช่ค่าหนึ่งในนี้ */
export type AiVendor = NonNullable<HookFormData['ai_vendor']>;

export const AI_VENDORS: ReadonlyArray<{ value: AiVendor; labelKey: string }> = [
  { value: 'gemini', labelKey: 'hook_form.ai_vendor_gemini' },
  { value: 'deepseek', labelKey: 'hook_form.ai_vendor_deepseek' },
];

/**
 * [FEAT-20260904-VENDORSECCOL] ชื่อค่ายที่ต้องอ้างถึงในโค้ด — ประกาศได้ที่ไฟล์นี้ไฟล์เดียว
 *
 * 🔴 `aiVendorSingleTruth.value.test.ts` สแกนทุกไฟล์ในโปรเจกต์ และจะแดงทันทีถ้ามีไฟล์อื่น
 *    เขียนสตริง `'deepseek'` เอาไว้เอง · หน้าจอที่ต้องถามว่า "ใช่ค่ายนี้ไหม" ให้ import
 *    ค่านี้ไปใช้ ห้ามพิมพ์ชื่อเอง — วันที่เพิ่มค่ายที่สาม จะได้ไม่ต้องไล่หาว่าใครพิมพ์ไว้ตรงไหน
 *    (ด่านนี้จับผมได้จริงตอนทำฟีเจอร์นี้ 04/09 — เขียน `=== 'deepseek'` ไว้ในคอมโพเนนต์)
 */
export const VENDOR_DEEPSEEK: AiVendor = 'deepseek';

/**
 * ลดค่าดิบจากช่องเลือกให้เหลือ vendor ที่รู้จัก
 * `''` หรืออะไรที่ไม่รู้จัก ⇒ `null` = "ใช้ค่าเริ่มต้น" (BE อ่าน null แบบนี้)
 */
export const asAiVendor = (raw: string): AiVendor | null =>
  AI_VENDORS.some((v) => v.value === raw) ? (raw as AiVendor) : null;
