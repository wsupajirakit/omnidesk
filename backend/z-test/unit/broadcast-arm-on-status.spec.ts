/**
 * [FIX-20260826-ARMONSTATUS] งานที่ตั้งเวลาไว้ต้องถูก "ติดอาวุธ" เสมอ
 * ============================================================================
 * อาการจริงจาก prod 26/08: 3 งาน `status:'scheduled'` · `mode:'repeat'` ·
 * `at_time_min` มีค่า แต่ **`next_run_at` ว่าง** ⇒ `dueScanQuery` มองไม่เห็น
 * ⇒ ไม่ยิงเลย และ **ไม่มี error** เพราะเป็น fail-closed ที่ตั้งใจ
 *
 * 🔴 ต้นเหตุ: เส้นแก้ไขเดิมติดอาวุธเมื่อ `updates['schedule'] !== undefined`
 *    = ผูกกับรูปร่างของ request ไม่ใช่สถานะปลายทาง
 *    ⇒ เปลี่ยน draft → scheduled โดยไม่แตะกฎซ้ำ = ไม่ติดอาวุธ
 *    ทั้ง 3 งานที่ค้าง "เคยถูกแก้หลังสร้าง" ทุกตัว ตรงกับกรณีนี้
 *
 * เคส TARGET ด้านล่างแดงก่อนแก้ · PIN กันไม่ให้แก้แล้วเกิดผลข้างเคียง
 */
import { armNextRunOnUpdate } from '@/modules/content/broadcast-schedule';

/** กฎจริงที่คัดมาจากแถวใน prod (ตัดเฉพาะคีย์ที่มีผล) */
const REPEAT = {
  mode: 'repeat',
  enabled: null,
  at_time_min: 835,
  every_minutes: null,
  days_of_week: [0, 1, 2, 3, 4, 5, 6],
  tz_offset_min: 420,
  max_runs: null,
};

const NOW = new Date('2026-08-26T07:00:00.000Z');

const call = (over: Partial<Parameters<typeof armNextRunOnUpdate>[0]> = {}) =>
  armNextRunOnUpdate({
    statusAfter: 'scheduled',
    scheduleAfter: REPEAT,
    storedNextRunAt: null,
    scheduleTouched: false,
    alreadySetThisRequest: false,
    now: NOW,
    ...over,
  });

/**
 * 🔴 เคสลำดับ — บั๊กรอบสองที่เจอบน stg 26/08
 *
 * รอบแรกผมวาง `armNextRunOnUpdate` ไว้ **ก่อน** จุดที่เซ็ต `updates['schedule']`
 * ⇒ ตอนอ่านค่ายังเป็น `undefined` ตลอด ⇒ `scheduleTouched` เป็น false เสมอ และ
 *   `scheduleAfter` ใช้ของเก่าเสมอ ⇒ กดเซฟแล้ว `updated_at` ขยับ แต่ `next_run_at`
 *   ยังว่าง (ยืนยันจากข้อมูลจริงบน stg)
 * ⚠️ เทสของฟังก์ชันล้วนจับไม่ได้ เพราะฟังก์ชันไม่ผิด — **ที่ผิดคือลำดับในไฟล์**
 *   จึงต้องอ่านซอร์สแล้วเทียบตำแหน่ง
 */
describe('[ARMONSTATUS] ลำดับในไฟล์ — arm ต้องอยู่หลังจุดที่เซ็ต schedule', () => {
  const src = require('node:fs').readFileSync(
    'src/modules/content/broadcasts.service.ts',
    'utf8',
  ) as string;

  it("⭐⭐ (TARGET) armNextRunOnUpdate ต้องอยู่ **หลัง** `updates['schedule'] = `", () => {
    const setAt = src.indexOf("updates['schedule'] = ensureValidSchedule");
    const armAt = src.indexOf('armNextRunOnUpdate({');
    expect(setAt).toBeGreaterThan(-1);
    expect(armAt).toBeGreaterThan(-1);
    /* วางสลับกัน = อ่าน undefined ตลอด = บั๊กที่เจอบน stg */
    expect(armAt).toBeGreaterThan(setAt);
  });

  it('⭐⭐ (TARGET) การล้างด้วย null จากเส้น scheduled_at ต้องไม่ทำให้ arm ถอย', () => {
    /* 🔴 บั๊กรอบสามที่เจอบน stg 26/08 — ฟอร์มส่ง `scheduled_at: null` มา **ทุกครั้ง**
       ที่เซฟงานซ้ำ (BroadcastFormModal.tsx:676 · โหมดซ้ำล้างช่องนี้เป็น null เสมอ)
       ⇒ เส้น `scheduled_at` เขียน `updates['next_run_at'] = null` ก่อนถึงตัว arm
       ⇒ ถ้า arm เช็คแค่ "มีคีย์ไหม" (hasOwnProperty) มันจะถอยให้ null และงานไม่ติดอาวุธ
       ⇒ ต้องถือว่า "ตั้งแล้ว" เฉพาะเมื่อเป็น **Date จริง** เท่านั้น · null = การล้าง
         ซึ่งงานซ้ำต้องคำนวณ cursor ใหม่ทับได้ (cursor ของงานซ้ำมาจากกฎ ไม่ใช่ช่องวันที่)
       ⚠️ งาน "ครั้งเดียว" ที่ถูกล้างวันที่ยังต้องดับอยู่ — arm ไม่ยุ่งเพราะไม่ใช่กฎซ้ำ */
    const at = src.indexOf('armNextRunOnUpdate({');
    const call = src.slice(at, at + 1400);
    expect(call).toContain("updates['next_run_at'] instanceof Date");
    expect(call).not.toContain('hasOwnProperty');
  });

  it('⭐ (PIN) ต้องอ่านจาก `updates` ก่อน แล้วค่อย fallback ไปค่าที่เก็บไว้', () => {
    const call = src.slice(
      src.indexOf('armNextRunOnUpdate({'),
      src.indexOf('armNextRunOnUpdate({') + 500,
    );
    expect(call).toContain("updates['schedule'] ?? broadcast.schedule");
    expect(call).toContain(
      "scheduleTouched: updates['schedule'] !== undefined",
    );
  });
});

describe('[ARMONSTATUS] ติดอาวุธจากสถานะปลายทาง ไม่ใช่จากรูปร่างของ request', () => {
  it('⭐⭐ (TARGET) เปลี่ยนเป็น scheduled โดยไม่ส่ง schedule มาด้วย ต้องยังติดอาวุธ', () => {
    /* นี่คือเคสที่ทำให้ 3 งานใน prod ค้าง — เดิมคืน undefined */
    const got = call({ scheduleTouched: false, storedNextRunAt: null });
    expect(got).toBeInstanceOf(Date);
  });

  it('⭐⭐ (TARGET) แถวเก่าที่ไม่มี cursor ต้องถูกติดอาวุธตอนกดบันทึก', () => {
    expect(call({ storedNextRunAt: undefined })).toBeInstanceOf(Date);
  });

  it('⭐ (PIN) กดบันทึกเฉย ๆ ต้อง **ไม่** เลื่อน cursor ที่มีอยู่แล้ว', () => {
    /* 🔴 ถ้าเลื่อนทุกครั้งที่บันทึก งานจะไม่มีวันยิง เพราะรอบถัดไปถอยหนีตลอด */
    const cursor = new Date('2026-08-27T06:55:00.000Z');
    expect(
      call({ storedNextRunAt: cursor, scheduleTouched: false }),
    ).toBeUndefined();
  });

  it('⭐ (PIN) แก้กฎซ้ำ ⇒ ต้องคำนวณ cursor ใหม่ ถึงจะมีของเดิมอยู่', () => {
    const cursor = new Date('2026-08-27T06:55:00.000Z');
    expect(
      call({ storedNextRunAt: cursor, scheduleTouched: true }),
    ).toBeInstanceOf(Date);
  });

  it('⭐ (PIN) เส้น scheduled_at ตั้งไปแล้วในรอบนี้ ⇒ ห้ามทับ', () => {
    expect(call({ alreadySetThisRequest: true })).toBeUndefined();
  });

  it('⭐ (PIN) ไม่ใช่สถานะ scheduled ⇒ ไม่ติดอาวุธ', () => {
    for (const s of ['draft', 'sent', 'failed', 'cancelled', 'sending']) {
      expect({ s, got: call({ statusAfter: s }) }).toEqual({
        s,
        got: undefined,
      });
    }
  });

  it('⭐ (PIN) ไม่ใช่กฎซ้ำ ⇒ ไม่ใช่หน้าที่ตัวนี้ (cursor มาจาก scheduled_at)', () => {
    expect(call({ scheduleAfter: { mode: 'once' } })).toBeUndefined();
    expect(call({ scheduleAfter: null })).toBeUndefined();
  });

  it('⭐ (PIN) กฎที่คำนวณรอบไม่ได้ ⇒ undefined ไม่ใช่ค่ามั่ว', () => {
    expect(
      call({
        scheduleAfter: { mode: 'repeat', enabled: false, at_time_min: 835 },
      }),
    ).toBeUndefined();
  });
});
