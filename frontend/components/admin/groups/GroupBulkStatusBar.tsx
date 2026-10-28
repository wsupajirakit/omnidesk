import React from 'react';

/**
 * ==== [FEAT-20260817-GROUPBULKSTATUS] the "N selected → on / off" bar =========
 *
 * Render-only. It reads a count and calls back; every piece of state (which rows
 * are ticked, the pending choice, the in-flight flag) stays in the Groups page,
 * so extracting this moved no behaviour — the rule FE §6.4 draws the line at.
 *
 * WHY ITS OWN FILE: `pages/admin/Groups.tsx` was 389 lines, and the bulk feature
 * plus the pager pushed it past the 400-line ESLint ceiling. That warning list may
 * only shrink, so the two self-contained sections came out instead of a waiver
 * going in (check-list.md §FE anti-bloat).
 * ห้ามให้ไฟล์ทะลุ 400 แล้วไปขอ waiver — แยกส่วนที่แยกได้ออกมา.
 *
 * It renders NOTHING when nothing is selected, so the page looks exactly as it
 * did before the feature until an operator ticks a row.
 * revert: delete this file + its import and use in Groups.tsx.
 */
interface Props {
  /** How many rows are ticked. Zero renders nothing at all. */
  count: number;
  /** Ask to turn every ticked group on (`true`) or off (`false`). */
  onChoose: (status: boolean) => void;
  /** Drop the selection without changing anything. */
  onClear: () => void;
  labels: {
    selected: string;
    active: string;
    inactive: string;
    /** [FIX-20260817-BULKCANCEL] "ยกเลิก" — it drops the selection, it does not
     *  clear a form field, so the copy is `common.cancel`, not `common.clear`. */
    cancel: string;
  };
}

export const GroupBulkStatusBar: React.FC<Props> = ({
  count,
  onChoose,
  onClear,
  labels,
}) => {
  if (count <= 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-3 px-6 py-3 bg-primary-500/10 border-b border-primary-500/30">
      {/* [FIX-20260817-BULKCANCEL] requirement, 17/08: the cancel action sits on the
          LEFT and reads "ยกเลิก". It used to sit far right behind `ml-auto`, which put the
          only way out of a selection at the opposite end of the bar from the
          buttons that act on it. ปุ่มออกต้องอยู่ข้างปุ่มที่กด ไม่ใช่คนละฝั่ง. */}
      <button
        type="button"
        onClick={onClear}
        /* [UI-20260817-BULKCANCELORANGE] ข้อกำหนด 17/08: ปุ่มนี้ต้องเป็นสีส้ม ชัด และใหญ่
           ของเดิมเป็นลิงก์ตัวอักษรเล็กสีเทา (text-xs + underline) มองไม่เห็นว่ากดได้
           ⇒ เป็นปุ่มจริงสีส้มทึบ ใหญ่กว่าปุ่มสถานะข้าง ๆ หนึ่งขั้น (px-4 py-2 + font-bold)
           โทนส้ม/อำพันเป็นโทนเดียวกับปุ่มยืนยันงานหมู่ที่มีอยู่แล้วใน
           components/bulk/BulkStatusModal.tsx:149 (bg-amber-600 hover:bg-amber-500) */
        className="px-4 py-2 rounded-lg text-sm font-bold bg-orange-500 hover:bg-orange-600 text-white shadow-sm transition-colors"
      >
        {labels.cancel}
      </button>
      <span className="text-sm font-bold text-primary-700">
        {labels.selected} {count}
      </span>
      <button
        type="button"
        onClick={() => onChoose(true)}
        className="px-3 py-1.5 rounded-lg text-sm font-medium bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/25 transition-colors"
      >
        {labels.active}
      </button>
      <button
        type="button"
        onClick={() => onChoose(false)}
        className="px-3 py-1.5 rounded-lg text-sm font-medium bg-slate-500/15 text-slate-600 hover:bg-slate-500/25 transition-colors"
      >
        {labels.inactive}
      </button>
    </div>
  );
};

export default GroupBulkStatusBar;
