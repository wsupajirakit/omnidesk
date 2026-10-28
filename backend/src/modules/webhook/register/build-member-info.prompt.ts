/**
 * What the model is asked to find. Copy only — no logic, no imports.
 * ===========================================================================
 * Kept in its own file so the wording can be tuned without opening the function
 * that calls it, and so a future per-OA override has an obvious home. Editing
 * this file cannot break anything else. แก้ข้อความได้โดยไม่ต้องแตะโค้ด.
 *
 * ⚠️ THE SHAPE IS PART OF THE CONTRACT. `buildMemberInfo` parses the answer as
 * JSON with exactly these keys, and treats anything else as "nothing found".
 * Change the keys here and you must change the parser with it.
 *
 * revert: delete with the rest of `register/`.
 */

/** The keys the model must answer with, and the parser must find. */
export const MEMBER_INFO_FIELDS = ['phone_number', 'account_no'] as const;

/**
 * The instruction. Written so an answer that finds nothing is still valid JSON —
 * a model that refuses in prose is the failure mode this avoids.
 */
export const BUILD_MEMBER_INFO_PROMPT = [
  'อ่านข้อความของลูกค้าด้านล่าง แล้วดึงข้อมูลสองอย่างนี้ออกมา:',
  '1) เบอร์โทรศัพท์ (phone_number)',
  '2) เลขที่บัญชีธนาคาร (account_no)',
  '',
  'ตอบกลับเป็น JSON เท่านั้น ห้ามมีข้อความอื่นนอก JSON:',
  '{"phone_number":"<เบอร์ที่พบ หรือ null>","account_no":"<เลขบัญชีที่พบ หรือ null>"}',
  '',
  'กติกา:',
  '- ถ้าไม่พบข้อมูลใด ให้ใส่ null ห้ามเดา ห้ามแต่งขึ้นเอง',
  '- ตัดช่องว่าง ขีด และวงเล็บออกจากตัวเลข',
  '- ถ้ามีหลายค่า ให้เลือกค่าที่ลูกค้าระบุล่าสุด',
].join('\n');
