/**
 * [FIX-20260824-DROPCAMERA] `SLIP_QUICK_REPLY` — ไม่เคยมีเทสคุมมาก่อนเลย
 * ===========================================================================
 * ยืนยันกับ LINE doc จริงก่อนแก้ (ไม่มั่ว): quickReply.items รับ 1-13 รายการ
 * ไม่มี minimum มากกว่า 1 · action `camera`/`cameraRoll` ต้องการแค่ type+label
 * ⇒ เหลือปุ่มเดียวไม่ผิดสเปก
 *
 * revert: ใส่ปุ่ม camera กลับ (ดูคอมเมนต์ใน slip-flex.handler.ts)
 */
import { SLIP_QUICK_REPLY } from '@/modules/webhook';

describe('[FIX-20260824-DROPCAMERA] SLIP_QUICK_REPLY เหลือปุ่มเดียว', () => {
  it('⭐ มีปุ่มเดียว — เลือกภาพ (cameraRoll)', () => {
    expect(SLIP_QUICK_REPLY.items).toHaveLength(1);
    expect(SLIP_QUICK_REPLY.items[0]).toEqual({
      type: 'action',
      action: { type: 'cameraRoll', label: 'เลือกรูปภาพ' },
    });
  });

  it('ไม่มีปุ่ม camera (ถ่ายรูปใหม่) หลงเหลืออยู่', () => {
    const hasCamera = SLIP_QUICK_REPLY.items.some(
      (i) => (i.action as { type?: string }).type === 'camera',
    );
    expect(hasCamera).toBe(false);
  });

  it('รูปร่างยังตรงสเปก LINE — items 1-13 ตัว, แต่ละตัวมี type:"action"', () => {
    expect(SLIP_QUICK_REPLY.items.length).toBeGreaterThanOrEqual(1);
    expect(SLIP_QUICK_REPLY.items.length).toBeLessThanOrEqual(13);
    for (const item of SLIP_QUICK_REPLY.items) {
      expect(item.type).toBe('action');
    }
  });
});
