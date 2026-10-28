/**
 * [FIX-20260828-SKIPSTATUS] "ถูกข้าม" ไม่ใช่ "พัง"
 * ===========================================================================
 * เจ้าของ 28/08 พร้อมแถวจริง:
 *   `"status": "error", "error_message": "this OA was skipped: empty"`
 *   *"skip ไม่ควร error ควร status = skip"*
 *
 * 🔴 กับดักที่ต้องกันให้ได้: `[FIX-20260815-SUPPRESSEDENUM]` บันทึกไว้ว่าการเขียน
 *    ค่าที่ **ไม่อยู่ใน enum** ทำให้ Mongoose ปฏิเสธทั้ง document และตัวเขียนถูกห่อ
 *    catch ไว้ ⇒ **แถวหายเงียบ** โดยไม่มีใครรู้ · เคสสุดท้ายของไฟล์นี้คือตัวที่
 *    พิสูจน์ว่าเรื่องเดิมจะไม่เกิดซ้ำ — validate กับ schema จริง ไม่ใช่กับ double
 */
import { model as mongooseModel } from 'mongoose';

import { outcomesFrom } from '@/modules/content/broadcast-run/new-send.helpers';
import { WebhookLogSchema } from '@/modules/system/schemas/webhook-log.schema';

/** รายงานหนึ่งรอบ เท่าที่ `outcomesFrom` อ่าน */
const report = (skipReason?: string) =>
  ({
    runId: 'r1',
    outcome: 'ok',
    detail: 'run ok',
    plan: { perOa: [{ ...(skipReason ? { skipReason } : {}) }] },
    result: { perOa: [] },
  }) as never;

describe('[SKIPSTATUS] OA ที่ถูกข้าม', () => {
  it('⭐⭐ 🔴 มี skipReason ⇒ ติดธง skipped และข้อความบอกเหตุผล', () => {
    const [out] = outcomesFrom(['h1'], report('empty'));

    expect(out?.skipped).toBe(true);
    expect(out?.error).toBe('this OA was skipped: empty');
  });

  it('⭐⭐ 🔴 `ok` ยังเป็น false — สถานะรวมของงานต้องไม่เปลี่ยน', () => {
    /* 🔴 ถ้าเผลอทำเป็น true งานที่ทุก OA ถูกข้าม (ไม่มีใครได้รับสักคน) จะรายงาน
       ว่า "sent" แล้ว `claim.ts` จะปลดงานเป็น sent · รอบถัดไปไม่ถูกหยิบอีกเลย
       ⇒ ซ่อนความจริงแบบที่แย่กว่าการรายงานว่า error */
    const [out] = outcomesFrom(['h1'], report('empty'));
    expect(out?.ok).toBe(false);
  });

  it('⭐⭐ 🔴 ไม่มี skipReason (รอบไม่ได้เริ่มเลย) ⇒ ไม่ใช่ skip — ยังเป็น error จริง', () => {
    /* สองเรื่องนี้ต้องไม่กลืนกัน · "แผนตัดสินว่าไม่ต้องส่ง" ต่างจาก "ส่งไม่ได้" */
    const [out] = outcomesFrom(['h1'], report());

    expect(out?.skipped).toBeUndefined();
    expect(out?.ok).toBe(false);
  });
});

describe('[SKIPSTATUS] schema ยอมรับค่าใหม่จริง — แถวต้องไม่หายเงียบ', () => {
  const LogModel = mongooseModel('SkipStatusProbe', WebhookLogSchema);
  const row = (status: string) =>
    new LogModel({
      hook_id: undefined,
      channel: 'line_api',
      action_type: 'send_broadcast',
      status,
    });

  it('⭐⭐ 🔴 `skipped` ผ่าน validation ของ schema จริง', () => {
    /* 🔴 นี่คือเคสที่กัน `[FIX-20260815-SUPPRESSEDENUM]` ไม่ให้เกิดซ้ำ:
       ตัวเขียน log ถูกห่อ catch ⇒ ถ้า enum ไม่รับ แถวจะหายโดยไม่มีใครรู้
       ⇒ ต้อง validate กับ schema ตัวจริง ไม่ใช่กับ double */
    expect(row('skipped').validateSync()?.errors?.['status']).toBeUndefined();
  });

  it('⭐ ค่าเดิมทั้งสามยังผ่านเหมือนเดิม — ไม่ได้ไปตัดของใครทิ้ง', () => {
    for (const status of ['success', 'error', 'suppressed']) {
      expect(row(status).validateSync()?.errors?.['status']).toBeUndefined();
    }
  });

  it('⭐ ค่าที่ไม่รู้จักยังถูกปฏิเสธ — enum ยังทำหน้าที่อยู่', () => {
    expect(row('banana').validateSync()?.errors?.['status']).toBeDefined();
  });
});
