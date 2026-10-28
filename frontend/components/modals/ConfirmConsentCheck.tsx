/**
 * [UI-20260826-DELCONSENT] ช่องติ๊กยืนยันก่อนกดปุ่มอันตราย — ใหญ่ กดง่าย
 * ============================================================================
 * เจ้าของสั่ง 26/08: *"modal delete webhook เพิ่ม checkmark ก่อน ใหญ่ ๆ กดง่าย"*
 *
 * 🔴 ทำไมต้องมี: ปุ่ม "ยืนยัน" สีแดงอยู่ตำแหน่งเดียวกับปุ่ม "ตกลง" ของ dialog
 *    ทั่วไปในแอป ⇒ กดพลาดได้ด้วยความเคยชิน และการลบ webhook พาข้อมูลของทั้ง OA
 *    หายไปด้วย · ช่องติ๊กบังคับให้เกิด "การกระทำที่ตั้งใจ" หนึ่งครั้งก่อนถึงปุ่ม
 *
 * ⚠️ ทั้งแถบเป็น `<label>` ⇒ กดตรงไหนก็ติ๊กได้ ไม่ต้องเล็งกล่องสี่เหลี่ยมเล็ก ๆ
 *    (นี่คือ "ใหญ่ ๆ กดง่าย" ที่เจ้าของขอ — ไม่ใช่แค่ขยาย checkbox)
 * ⚠️ กล่องติ๊กเองก็ `h-6 w-6` ไม่ใช่ค่า default ~13px ของเบราว์เซอร์
 * ⚠️ ตัว component **ไม่ถือ state เอง** — ผู้เรียกถือ เพราะปุ่มยืนยันต้องอ่านค่า
 *    เดียวกันนี้เพื่อ disable ตัวเอง ถ้าเก็บ state ไว้ข้างในจะส่งออกไปไม่ได้
 *
 * revert: ลบไฟล์นี้ + prop `confirmDisabled` ใน ConfirmModal + การใช้งานใน WebhookList
 */
import React from 'react';
import { Check } from 'lucide-react';

interface Props {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** ข้อความที่ผู้ใช้ต้องรับทราบ — ผู้เรียกเป็นคนเขียนให้ตรงกับสิ่งที่กำลังจะเกิด */
  label: string;
}

export const ConfirmConsentCheck: React.FC<Props> = ({ checked, onChange, label }) => (
  <label
    data-testid="confirm-consent"
    className={`mt-4 flex cursor-pointer select-none items-center gap-3 rounded-xl border-2 p-4 transition-colors ${
      checked
        ? 'border-red-500 bg-red-50 dark:bg-red-950/30'
        : 'border-slate-200 bg-slate-50 hover:border-slate-300 dark:border-dark-700 dark:bg-dark-900/40'
    }`}
  >
    <span
      className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border-2 transition-colors ${
        checked ? 'border-red-600 bg-red-600 text-white' : 'border-slate-300 bg-white dark:bg-dark-800'
      }`}
      aria-hidden
    >
      {checked && <Check size={16} strokeWidth={3} />}
    </span>
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="sr-only"
    />
    <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{label}</span>
  </label>
);

export default ConfirmConsentCheck;
