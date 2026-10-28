/**
 * [FIX-20260826-ARMONSTATUS] ตัดสินว่า "หลังอัปเดตแล้ว งานนี้ต้องมี cursor ไหม"
 * ============================================================================
 * เจ้าของแจ้ง 26/08: *"ตั้งเวลา job broadcast แล้ว server ไม่ทำงาน ไม่มี log error"*
 *
 * 🔴 ต้นเหตุที่วัดได้จาก prod: มี 3 งาน `status: 'scheduled'` · `mode: 'repeat'`
 *    · `at_time_min` มีค่า · แต่ **`next_run_at` ว่าง** ⇒ `dueScanQuery` กรองด้วย
 *    `{ status:'scheduled', next_run_at: { $lte: now } }` ⇒ มองไม่เห็นตลอดกาล
 *    และ **เงียบ ไม่ error** เพราะมันคือ fail-closed ที่ออกแบบไว้
 *
 * 🔴 ช่องรั่ว: เส้นแก้ไขเดิมติดอาวุธก็ต่อเมื่อ `updates['schedule'] !== undefined`
 *    คือผูกกับ **"request นี้ส่ง schedule มาไหม"** แทนที่จะผูกกับ
 *    **"หลังอัปเดตแล้วงานนี้ควรมี cursor ไหม"**
 *    ⇒ เปลี่ยนสถานะ draft → scheduled โดยไม่แตะกฎซ้ำ = ไม่ติดอาวุธ
 *    (ยืนยันด้วยการรันตรรกะจริง 26/08: กรณีนี้คืน "ไม่ถูกตั้ง")
 *    ⇒ ทั้ง 3 งานที่ค้างในฐาน "เคยถูกแก้หลังสร้าง" ทุกตัว ตรงกับกรณีนี้เป๊ะ
 *
 * ⇒ ตัวนี้คิดจาก **สถานะปลายทาง** ไม่ใช่จากรูปร่างของ request
 *
 * ⚠️ คืน `undefined` = **ไม่แตะ** `next_run_at` · ต่างจาก `null` ที่แปลว่า "ล้าง"
 *    absent กับ null คนละความหมาย (schema เขียนกำกับไว้) ห้ามยุบรวม
 * ⚠️ ไม่ทับ cursor ที่ตั้งไว้แล้ว **เว้นแต่กฎเปลี่ยน** — ไม่งั้นกดบันทึกเฉย ๆ
 *    จะเลื่อนรอบถัดไปออกไปทุกครั้ง กลายเป็นงานที่ไม่ยิงสักที
 *
 * revert: ลบไฟล์นี้ แล้วคืนบล็อก `if (updates['schedule'] !== undefined)` เดิม
 *         ใน broadcasts.service.ts
 */
import { computeNextRun } from './next-run';
import { isRepeatRule } from './schedule-shape';

export interface ArmOnUpdateInput {
  /** สถานะหลังอัปเดต */
  readonly statusAfter: string;
  /** กฎซ้ำหลังอัปเดต */
  readonly scheduleAfter: unknown;
  /** cursor ที่เก็บอยู่ก่อนอัปเดต */
  readonly storedNextRunAt: Date | null | undefined;
  /** request นี้ส่ง `schedule` มาด้วยไหม (⇒ กฎอาจเปลี่ยน ต้องคำนวณใหม่) */
  readonly scheduleTouched: boolean;
  /** เส้น `scheduled_at` ตั้ง cursor ไปแล้วในรอบนี้หรือยัง */
  readonly alreadySetThisRequest: boolean;
  readonly now?: Date;
}

/**
 * @returns `Date` = ตั้งค่านี้ · `undefined` = ไม่แตะ
 */
export function armNextRunOnUpdate(input: ArmOnUpdateInput): Date | undefined {
  const {
    statusAfter,
    scheduleAfter,
    storedNextRunAt,
    scheduleTouched,
    alreadySetThisRequest,
    now = new Date(),
  } = input;

  // เส้น `scheduled_at` เพิ่งตั้งไปแล้วในรอบนี้ — อย่าไปทับของที่ตั้งใจตั้ง
  if (alreadySetThisRequest) return undefined;

  // ไม่ใช่งานที่รอคิวอยู่ ⇒ ไม่มีอะไรให้ติดอาวุธ
  if (statusAfter !== 'scheduled') return undefined;

  // ไม่ใช่กฎซ้ำ ⇒ cursor มาจาก `scheduled_at` เท่านั้น ไม่ใช่หน้าที่ตัวนี้
  if (!isRepeatRule(scheduleAfter as never)) return undefined;

  /* ติดอาวุธเมื่อ:
       · ยังไม่เคยมี cursor เลย  ← เคสที่ทำให้ 3 งานใน prod ค้าง
       · หรือกฎถูกแก้ในรอบนี้    ← เวลาเปลี่ยน cursor ต้องเปลี่ยนตาม
     ⚠️ นอกจากนี้ไม่แตะ — กดบันทึกเฉย ๆ ต้องไม่เลื่อนรอบถัดไปออกไป */
  const hasCursor =
    storedNextRunAt instanceof Date && !Number.isNaN(storedNextRunAt.getTime());
  if (hasCursor && !scheduleTouched) return undefined;

  return computeNextRun(scheduleAfter as never, now, 0) ?? undefined;
}
