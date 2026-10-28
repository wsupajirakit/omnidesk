/**
 * [FIX-20260826-STALECONFIRM] กล่องยืนยันค้างข้ามรอบ
 * ============================================================================
 * เจ้าของแจ้ง 26/08: *"หน้า broadcast กดปุ่ม edit (action) แล้ว modal ติดบัค
 * หน้ายืนยันมันขึ้นมาบัง"*
 *
 * 🔴 ต้นเหตุที่วัดได้: `isConfirmOpen` ถูกตั้ง `true` ตอนกดบันทึก แล้ว **ไม่มีเส้นทาง
 *    ไหนตั้งกลับเป็น false ในกรณีสำเร็จ** — `closeOnConfirm={false}` ตั้งใจไม่ให้
 *    กล่องปิดเอง (กันคนยังไม่ติ๊กยินยอมแล้วกล่องหายไปเฉย ๆ) ส่วน `confirmSubmit`
 *    ปิด **ฟอร์มทั้งใบ** ผ่าน `onClose()` ⇒ ค่า `true` ค้างอยู่
 *    ⇒ เปิดฟอร์มรอบถัดไป กล่องเก่าโผล่ทับทันที
 *
 * ⚠️ ทำไมเทสอ่านซอร์สแทนกดจริงใน DOM: อาการนี้เป็น state ที่ค้าง **ข้ามการเปิด
 *    modal สองรอบ** ซึ่งต้อง mount → submit → unmount → mount ใหม่ และฟอร์มนี้
 *    ผูกกับ service หลายตัว · สิ่งที่ตรึงได้ตรงจุดคือ "ตอนเปิดต้องล้างค่าทั้งสามตัว"
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(
  join(__dirname, '../components/campaign/BroadcastFormModal.tsx'),
  'utf8',
);

/** เนื้อของ effect ที่ทำงานตอนฟอร์มเปิด (ก้อนแรกที่ขึ้นต้นด้วย `if (!isOpen) return;`) */
const openEffect = (() => {
  const at = src.indexOf('if (!isOpen) return;');
  expect(at, 'ต้องมี effect ที่ทำงานตอนเปิดฟอร์ม').toBeGreaterThan(-1);
  return src.slice(at, at + 1600);
})();

describe('[STALECONFIRM] เปิดฟอร์ม broadcast ต้องไม่เจอกล่องยืนยันของรอบก่อน', () => {
  it('⭐ (TARGET) ตอนเปิดฟอร์มต้องปิดกล่องยืนยันเสมอ', () => {
    expect(openEffect).toContain('setIsConfirmOpen(false)');
  });

  it('⭐ (TARGET) ตอนเปิดฟอร์มต้องล้างการติ๊กยินยอมด้วย', () => {
    /* ถ้าไม่ล้าง ผู้ใช้จะเปิดมาเจอ "ติ๊กไว้แล้ว" = ข้ามด่านยินยอมที่ตั้งใจให้มี
       ซึ่งอันตรายกว่าอาการเดิมที่แค่กล่องบัง */
    expect(openEffect).toContain('setConsentChecked(false)');
    expect(openEffect).toContain('setConsentMissing(false)');
  });

  it('⭐ (PIN) กล่องยืนยันยังต้องไม่ปิดตัวเองตอนกดยืนยัน', () => {
    /* [UI-20260825-SENDCONSENT] คนที่ยังไม่ติ๊กต้องเห็นกล่องอยู่พร้อมคำเตือน
       ไม่ใช่กล่องหายไปเฉย ๆ แล้วงานไม่ถูกบันทึก · การแก้บั๊กค้างรอบนี้
       **ห้าม** ไปแก้ด้วยการเปลี่ยน `closeOnConfirm` เป็น true */
    expect(src).toContain('closeOnConfirm={false}');
  });
});
