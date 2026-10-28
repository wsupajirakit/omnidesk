/**
 * The words scenario A uses. Copy only — no logic, no imports.
 * ===========================================================================
 * Every string and every choice scenario A makes lives here, so changing what a
 * system-opened case says never means opening the code that opens it. The case
 * writer itself knows HOW to open a case, not WHY — the why is these values.
 * แก้ข้อความ/หมวดได้ที่นี่ที่เดียว ไม่ต้องแตะโค้ด.
 *
 * ⚠️ The divider sentence is BUILT FROM the need, not written twice. The owner
 * asked for them to say the same thing; deriving one from the other is what
 * keeps that true after somebody edits it.
 * divider สร้างจาก need ⇒ แก้ที่เดียว ไม่มีทางเพี้ยนจากกัน.
 *
 * revert: delete this file with `scenario-a.ts`.
 */

/**
 * Why the case exists, in the customer's terms. Also the ticket's need detail.
 * Owner, 2026-08-20: "needDetail + dividerContent 'ต้องการลงทะเบียน'".
 * Was `'ลูกค้าต้องการลงทะเบียน'` until then.
 */
export const SCENARIO_A_NEED_DETAIL = 'ต้องการลงทะเบียน';

/**
 * 'Other' | 'Payment' — the values the tickets collection actually holds.
 *
 * ⚠️ `category` HAS NO ENUM (`ticket.schema.ts:95-107` says so itself): Mongoose
 * stores whatever it is handed, so a misspelling here does not throw — the case
 * simply lands in a bucket no admin screen filters on, and nobody finds out.
 * Verified 2026-08-20 against the schema doc and every literal in `src/`; NOT
 * yet against live rows (Mongo was down). สะกดผิดไม่ error แต่เคสจะหายไปเงียบ ๆ.
 */
export const SCENARIO_A_CATEGORY = 'Other';

/** What the divider in the chat says. Derived, so it cannot drift from the need. */
export const scenarioADividerText = (need: string): string =>
  `เคสนี้สร้างโดยระบบ ${need}`;
