/**
 * [UI-20260826-HOOKPAGERTOP] แถบแบ่งหน้าของตาราง hook — ใช้ได้ทั้งบนและล่าง
 * ============================================================================
 * เจ้าของแจ้ง 26/08: *"pagination หน้า hook แสดงบน header ด้วย พร้อม total count
 * + per page เหมือน footer เลย"*
 *
 * 🔴 ทำไมต้องแยกเป็น component ไม่ใช่ก๊อปมาร์กอัปไปวางอีกชุด:
 *    แถบนี้มี 4 ตัวควบคุมที่ผูกกับ state เดียวกัน (ยอดรวม · แถวต่อหน้า · ก่อนหน้า ·
 *    ถัดไป) ถ้าก๊อปสองชุด วันหลังใครแก้ที่เดียว บนกับล่างจะเพี้ยนกันเงียบ ๆ
 *    และ `WebhookList.tsx` ก็ยาวเกิน 400 บรรทัดอยู่แล้ว (กติกา FE anti-bloat §6.1)
 *
 * ⚠️ มาร์กอัปยกมา **เหมือนเดิมทุกตัวอักษร** จากบล็อกท้ายตารางเดิม เปลี่ยนอย่างเดียว
 *    คือเส้นขอบ: ตัวล่างใช้ `border-t` ตัวบนใช้ `border-b` — ไม่งั้นเส้นจะไปทับ
 *    กับขอบของตาราง
 * ⚠️ ไม่มี state ของตัวเอง — รับทุกอย่างมาทาง props ⇒ ตัวบนกับตัวล่างอ่าน/เขียน
 *    state ก้อนเดียวกัน กดเปลี่ยนหน้าที่ไหนก็ขยับพร้อมกันทั้งคู่โดยไม่ต้องซิงก์
 *
 * revert: ลบไฟล์นี้ แล้วคืนบล็อก markup เดิมกลับเข้าไปใน WebhookList.tsx
 */
import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { useI18n } from '../../../i18n';

interface Props {
  itemsPerPage: number;
  onItemsPerPage: (n: number) => void;
  perPageOptions: readonly number[];
  currentPage: number;
  totalPages: number;
  onPage: (updater: (prev: number) => number) => void;
  /** ป้ายยอดรวมที่แปลแล้ว — หน้าเรียกเป็นคนแปล component ไม่ยุ่งกับ i18n */
  totalLabel: string;
  /** 'bottom' = เส้นขอบด้านบน (ค่าเดิม) · 'top' = เส้นขอบด้านล่าง */
  edge?: 'top' | 'bottom';
}

export const HookTablePager: React.FC<Props> = ({
  itemsPerPage,
  onItemsPerPage,
  perPageOptions,
  currentPage,
  totalPages,
  onPage,
  totalLabel,
  edge = 'bottom',
}) => {
  const { t } = useI18n();
  return (
  <div
    className={`flex flex-col sm:flex-row justify-between items-center gap-4 px-6 py-4 ${
      edge === 'top' ? 'border-b' : 'border-t'
    } border-dark-700`}
    data-testid={`hook-pager-${edge}`}
  >
    <span className="text-sm text-slate-500">{totalLabel}</span>
    <div className="flex items-center gap-2">
      {/* [FIX-20260728-PERPAGE] dropdown เลือกจำนวนแถวต่อหน้า
          revert: ลบ <select> ก้อนนี้ทั้งหมด */}
      <select
        value={itemsPerPage}
        onChange={(e) => onItemsPerPage(Number(e.target.value))}
        className="px-2 py-1.5 rounded-lg bg-dark-700 text-slate-300 text-sm border border-dark-600 focus:outline-none focus:ring-2 focus:ring-primary-500 cursor-pointer"
        title={t('pageui.hookform.rows_per_page', 'แถวต่อหน้า')}
      >
        {perPageOptions.map((n) => (
          <option key={n} value={n}>{t('pageui.hookform.n_per_page', '{n} / หน้า', { n })}</option>
        ))}
      </select>
      <button
        onClick={() => onPage(prev => Math.max(1, prev - 1))}
        disabled={currentPage === 1}
        className="p-2 rounded-lg bg-dark-700 text-slate-400 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronLeft size={18} />
      </button>
      <span className="text-sm text-slate-600 px-2 font-medium">{currentPage} / {totalPages}</span>
      <button
        onClick={() => onPage(prev => Math.min(totalPages, prev + 1))}
        disabled={currentPage === totalPages}
        className="p-2 rounded-lg bg-dark-700 text-slate-400 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronRight size={18} />
      </button>
    </div>
  </div>
  );
};

export default HookTablePager;
