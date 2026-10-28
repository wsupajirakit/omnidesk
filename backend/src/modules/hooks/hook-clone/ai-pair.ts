/**
 * ==== [FIX-20260818-CLONEAIPAIR] ค่ายย้าย = คีย์ไม่ตามไป ======================
 *
 * กฎเดียวของไฟล์นี้: บนเส้น **duplicate** ถ้า OA ใหม่ลงเอยด้วย `ai_vendor` คนละตัว
 * กับต้นทาง ห้ามสืบทอด `custom_ai_key` และ `ai_model` ของต้นทางมาให้เด็ดขาด
 *
 * ## ทำไมต้องมี (เจอตอน merge p2 เข้ามา 18/08 — ตรวจของจริง ไม่ใช่ทฤษฎี)
 * `clone-merge.ts` เติมค่าแบบไม่รู้จักชื่อ field: อะไรที่แถวใหม่ยังว่างและต้นทางมี
 * ก็เติมให้ (กฎ 2) · เส้นนี้เกิดก่อนที่ p2 จะเพิ่ม `ai_vendor`/`ai_model` จึงไม่รู้ว่า
 * **`ai_vendor` กับ `custom_ai_key` เป็นของคู่กัน** (`hooks.service.ts` §pair doctrine)
 * ผลคือ: ฟอร์ม Copy Item เปิดให้สลับ vendor ได้ (`AiVendorSelect` disable เฉพาะ
 * โหมด view) ⇒ เลือก deepseek ตอน copy ⇒ ค่ายใหม่ถูกเขียนจากฟอร์ม (กฎ 4 ชนะ)
 * แต่ช่อง key ของแถวใหม่ว่าง ⇒ กฎ 2 เติม **คีย์ gemini ของต้นทาง** เข้าไป
 *
 * ## ความเสียหายจริง — ไม่ใช่แค่ "OA เงียบ"
 * `resolveVendorKey` หยิบ "คีย์ของ hook เอง" ก่อนเสมอ โดยไม่ถามว่าคีย์นั้นของค่ายไหน
 * (`webhook/ai-vendors/resolve-vendor-key.ts:59-60`) ⇒ คีย์ Google จะถูกส่งออกไปที่
 * `api.deepseek.com` จริง — ตรงกับสิ่งที่ไฟล์นั้นประกาศห้ามไว้เองเป็นข้อแรก
 * ("คีย์ค่ายหนึ่งห้ามหลุดไปอีกค่ายเด็ดขาด · ไม่มีคีย์ = ปฏิเสธ ไม่ใช่ยืม")
 * ปล่อยช่องคีย์ว่างไว้จึงเป็นสถานะที่ถูก: deepseek จะปฏิเสธตั้งแต่ต้นทาง (ไม่มี env
 * fallback) และ gemini ตกลงบันไดของมันเองตามเดิม — ทั้งสองทางไม่มีคีย์ข้ามค่าย
 *
 * ## ทำไมไม่ยืม `NEVER_CLONE` / กฎของ `cloneHookSettings` มาใช้
 * คนละสถานการณ์: `cloneHookSettings` ทับ OA ที่วิ่งอยู่ และคัดลอก **vendor จากต้นทาง**
 * ⇒ คู่ที่ได้ยังครบเสมอ จึงมีโหมด "ลากคีย์ตาม" กับ "เคลียร์คีย์" ให้เลือก
 * เคสนี้ vendor มาจาก **ฟอร์ม** ส่วนคีย์มาจาก **ต้นทาง** ⇒ ไม่มีทางเป็นคู่ที่ถูกได้เลย
 * ทางเดียวที่ซื่อสัตย์คือไม่เติม แล้วให้แอดมินใส่คีย์ของค่ายใหม่เอง
 *
 * ## ขอบเขต
 * pure function ล้วน · ไม่รู้จัก DB/HTTP · ตัดสินจากสองเอกสารที่ได้รับเท่านั้น
 * แตะเฉพาะคู่ AI — field อื่นทุกตัวยังเดินตามกฎเดิมของ `clone-merge.ts` ไม่เปลี่ยน
 *
 * revert: ลบไฟล์นี้ + บรรทัดที่เรียก `aiPairFieldsToSkip` ใน `clone-merge.ts`
 *         (พฤติกรรมกลับไปเป็น "เติมทุกช่องที่ว่าง" รวมคีย์ข้ามค่าย)
 */

/**
 * Fields bound to the vendor — a model id belongs to a family just as a key does.
 *
 * [FEAT-20260904-VENDORSECCOL] Both vendors' pairs are listed, and a vendor move
 * skips ALL FOUR. The reason is no longer the cross-vendor leak — that became
 * impossible when each vendor got its own columns (`ai-vendor/resolve-vendor-fields.ts`)
 * — but the one it left behind: inheriting the SOURCE's Gemini key into a new
 * OA that was created as DeepSeek parks a credential somebody else pays for in
 * a column nobody is watching. The day that OA is switched back to Gemini it
 * bills the source's account, silently. So a row that changed vendor starts
 * with no AI credentials at all and an admin enters its own.
 * ย้ายค่าย = ไม่รับคีย์/รุ่นของต้นทางสักค่าย · แอดมินกรอกของตัวเอง
 *
 * ⚠️ Not a vendor move ⇒ this list is not consulted and everything is inherited
 *    exactly as before. เหมือนเดิมทุกอย่างถ้าไม่ได้ย้ายค่าย
 */
export const AI_PAIR_FIELDS: readonly string[] = [
  'custom_ai_key',
  'ai_model',
  'custom_ai_key_sec',
  'ai_model_sec',
];

/**
 * ทำให้ค่า vendor เทียบกันได้: ว่าง/null/undefined = "ใช้ค่า default ของระบบ"
 * ซึ่งเป็นสถานะเดียวกันหมด (แถวจริงใน DB ตอนนี้เป็นแบบนี้ทั้ง 7 แถว)
 */
const normalizeVendor = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

/**
 * คืนรายชื่อ field ที่ห้ามสืบทอด เพราะค่ายของ OA ใหม่ไม่ใช่ค่ายเดียวกับต้นทาง
 *
 * @param created แถวที่ `createHook` เพิ่งสร้างจากฟอร์ม
 * @param source  แถวต้นทางที่กด Copy Item มา
 *
 * ⚠️ แถวใหม่ที่ `ai_vendor` ว่าง **ไม่ใช่การย้ายค่าย** — แปลว่าฟอร์มไม่ได้พูดถึงมัน
 * แล้วกฎ 2 ของ `clone-merge.ts` จะเติมค่าของต้นทางกลับมาให้เอง ⇒ คู่ยังครบ
 * (เช่นเดียวกับที่ฟอร์มส่ง '' ซึ่ง `parseAiVendor` แปลงเป็น null ตั้งแต่ชั้น create)
 */
export const aiPairFieldsToSkip = (
  created: Record<string, unknown>,
  source: Record<string, unknown>,
): readonly string[] => {
  const from = normalizeVendor(source['ai_vendor']);
  const to = normalizeVendor(created['ai_vendor']) ?? from;
  return to === from ? [] : AI_PAIR_FIELDS;
};
