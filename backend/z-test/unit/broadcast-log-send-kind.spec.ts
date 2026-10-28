/**
 * [FIX-20260826-LOGSENDKIND] แถว log ของการยิงต้องบอก "ชนิดที่ยิงจริง"
 * ============================================================================
 * เจ้าของเปิด log detail ของรอบที่เพิ่งยิง (26/08 15:06) แล้วเจอ:
 *   endpoint = .../multicast  แต่  action_type = "send_broadcast"
 * และถามว่า "มันบันทึก action ผิดหรือเปล่า multi ไม่ใช่ broad"
 *
 * 🔴 ทำไม **ไม่แก้ `action_type`**: คำนั้นเป็น key ตระกูล ("การยิงจากหน้า broadcast")
 *    ที่ 4 ที่ยึดอยู่ — เปลี่ยนเมื่อไหร่ = กระทบทันที:
 *      · webhook-log.controller.ts:85,132 — ตัดสินสิทธิ์: send_broadcast ⇒
 *        `broadcast.manage` · ค่าอื่น ⇒ `webhook_log.manage` ⇒ คนที่เคยเปิดดูได้จะโดน 403
 *      · FE Broadcasts.tsx:197 + broadcastPolling.ts — กรอง log แท็บประวัติ ⇒ log ใหม่หาย
 *      · FE WebhookLogs.tsx:83 — ตัวเลือกกรอง
 *    ⇒ ทางที่ "ห้ามกระทบ" คือคงคำเดิม แล้วบันทึกชนิดจริงเพิ่มเป็น field ใหม่
 *
 * ⇒ `payload_summary.send_kind` — additive ล้วน:
 *      · `payload_summary` เป็น Mixed อยู่แล้ว (schema ไม่ถูกแตะ ไม่มี migration)
 *      · แถวเก่าไม่มี field นี้ = อ่านได้เหมือนเดิมทุกอย่าง
 *      · โผล่ใน raw JSON ที่เจ้าของเปิดดูทันที โดย FE ไม่ต้องแก้อะไร
 */
import { payloadSummaryOf } from '@/modules/content/broadcast-run/new-send.helpers';

describe('[LOGSENDKIND] payload_summary บอกชนิดที่ยิงจริง', () => {
  it('⭐⭐ (TARGET) multicast ต้องบันทึก send_kind = multicast', () => {
    const out = payloadSummaryOf(
      'job-1',
      { type: 'text', text: 'x' },
      'multicast',
    );
    expect(out['send_kind']).toBe('multicast');
  });

  it('⭐ (TARGET) broadcast ก็บันทึกของตัวเอง', () => {
    const out = payloadSummaryOf(
      'job-1',
      { type: 'text', text: 'x' },
      'broadcast',
    );
    expect(out['send_kind']).toBe('broadcast');
  });

  it('⭐ (PIN) field เดิมไม่ขยับสักตัว — additive เท่านั้น', () => {
    const out = payloadSummaryOf(
      'job-9',
      { type: 'text', text: 'hi' },
      'multicast',
    );
    expect(out).toMatchObject({
      broadcast_id: 'job-9',
      message_type: 'text',
      text: 'hi',
    });
  });

  it('⭐ (PIN) action_type ยังเป็น send_broadcast — ห้ามใครเปลี่ยน key ตระกูลนี้', () => {
    /* เปลี่ยนคำนี้ = log หายจากหน้าประวัติ + สิทธิ์เปิดดูสลับตัว (เหตุผลเต็มที่หัวไฟล์) */
    const src = require('node:fs').readFileSync(
      'src/modules/content/broadcast-run/new-send.service.ts',
      'utf8',
    ) as string;
    expect(src).toContain("action_type: 'send_broadcast'");
  });
});
