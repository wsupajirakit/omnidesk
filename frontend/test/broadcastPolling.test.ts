/* [PERF-20260825-POLLPOLICY] นโยบายรีเฟรชของหน้า Broadcasts
 *
 * เหตุผลเชิงออกแบบ + ตัวเลขที่วัดมาอยู่ในหัวไฟล์ `broadcastPolling.ts`
 * เคสที่นี่ปักเฉพาะ "พฤติกรรม" ซึ่งเป็นส่วนที่พังแล้วเงียบ
 */
import { describe, it, expect } from 'vitest';
import {
  AUTO_FETCH_MS,
  shouldPoll,
  sourceForTick,
  shouldLoadLogs,
} from '../pages/messaging/broadcastPolling';

const ctx = (o: Partial<{ tab: string; hidden: boolean; modalOpen: boolean }> = {}) => ({
  tab: 'broadcasts',
  hidden: false,
  modalOpen: false,
  ...o,
});

describe('[POLLPOLICY] เมื่อไหร่ถึงยิง', () => {
  it('⭐ รอบเป็น 45 วินาที', () => {
    expect(AUTO_FETCH_MS).toBe(45_000);
  });

  it('⭐⭐ แท็บเบราว์เซอร์ถูกซ่อน = ไม่ยิง', () => {
    /* แท็บพื้นหลังยิงไปเรื่อย ๆ คือดีเฟกต์เดิมที่นโยบายนี้มาแทน */
    expect(shouldPoll(ctx({ hidden: true }))).toBe(false);
    expect(sourceForTick(ctx({ hidden: true }))).toBeNull();
  });

  it('⭐⭐ โมดัลเปิดอยู่ = ไม่ยิง', () => {
    /* รีเฟรชใต้ฟอร์มที่เปิดอยู่ = กระชากข้อมูลใต้มือคนที่กำลังกรอก */
    expect(shouldPoll(ctx({ modalOpen: true }))).toBe(false);
    expect(sourceForTick(ctx({ modalOpen: true }))).toBeNull();
  });
});

describe('[POLLPOLICY] ยิงอะไร', () => {
  it('⭐⭐ ยิงเฉพาะแท็บที่ผู้ใช้เห็นอยู่ ไม่ยิงทั้งสองตัว', () => {
    /* 🔴 นี่คือส่วนที่ตัดของเสียจริง — เดิมยิง log ทุกรอบแม้ผู้ใช้อยู่แท็บ
       บรอดแคสต์และมองไม่เห็นตาราง log เลย */
    expect(sourceForTick(ctx({ tab: 'broadcasts' }))).toBe('broadcasts');
    expect(sourceForTick(ctx({ tab: 'history' }))).toBe('logs');
  });

  it('⭐ แท็บที่ไม่รู้จัก → ถือเป็นรายการบรอดแคสต์ ไม่ใช่เงียบ', () => {
    /* เพิ่มแท็บใหม่แล้วลืมมาแก้ที่นี่ ควรได้ข้อมูลผิดที่ ดีกว่าได้หน้าค้าง */
    expect(sourceForTick(ctx({ tab: 'something-new' }))).toBe('broadcasts');
  });
});

/* ⚠️ FLIPPED 25/08/2026 — เดิมสองเคสนี้รับ `openedOnce: boolean` (latch ที่ติดแล้ว
   ไม่ปลด) และทั้งคู่เขียว ทั้งที่ของจริงพัง: call site ต้องใส่ `activeTab` ใน deps
   ของ effect ไม่งั้นเปิดแท็บครั้งแรกจะไม่ยิงเลย ⇒ พอ latch ติดค้าง การสลับ**กลับ**
   มาแท็บรายการก็ยิงคิวรี่ log ซ้ำ ทั้งที่ตารางนั้นไม่ได้อยู่บนจอ
   เคสเก่าจับไม่ได้เพราะมันเทสเฉพาะฟังก์ชันบริสุทธิ์ ไม่ได้เทสว่ามันถูกเรียกด้วย
   "อะไร" — บทเรียนคือ pin ที่ระดับหน้าจอด้วย (ดู [BCASTLAZY] ใน
   broadcastTabsAndPaging.dom.test.tsx) ไม่ใช่แค่ระดับฟังก์ชัน
   ⇒ พลิกเป็นตัดสินจากแท็บที่เห็นอยู่ ห้ามลบเคส */
describe('[POLLPOLICY] lazy load ของตาราง log', () => {
  it('⭐⭐ อยู่แท็บรายการ = ไม่แตะ log เลย', () => {
    expect(shouldLoadLogs('broadcasts')).toBe(false);
  });

  it('⭐ อยู่แท็บประวัติ = โหลดได้', () => {
    expect(shouldLoadLogs('history')).toBe(true);
  });

  it('⭐⭐ สลับกลับมาแท็บรายการ = หยุดยิง ไม่ใช่ยิงต่อเพราะเคยเปิด', () => {
    /* นี่คือบั๊กที่ latch ทำไว้ตรง ๆ · ตารางไม่ได้ mount แล้วแต่ยังจ่ายคิวรี่อยู่ */
    expect(shouldLoadLogs('broadcasts')).toBe(false);
  });

  it('แท็บที่ไม่รู้จัก = ไม่โหลด log — คนที่ไม่ได้ขอ ไม่ต้องจ่าย', () => {
    expect(shouldLoadLogs('something-new')).toBe(false);
  });
});
