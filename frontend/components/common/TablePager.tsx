import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { DirectionalSelect } from './DirectionalSelect';
import { useI18n } from '../../i18n';

/**
 * ==== [FEAT-20260824-TABLEPAGER] one pager for any table ====================
 *
 * Owner, 24/08: "page gnation / per page ทั้งสอง table" — the Broadcasts page
 * had prev/next arrows on both of its tables and a HARD-CODED page size of 10.
 * An admin with 400 campaigns could only walk them ten at a time.
 *
 * WHY A NEW FILE INSTEAD OF REUSING ONE OF THE TWO THAT EXIST.
 * `components/contact/ContactPaginationBar.tsx` and
 * `components/admin/groups/GroupTablePager.tsx` already do this job, but each
 * lives inside a FEATURE folder. Importing the contact pager into a messaging
 * page would tie two unrelated features together: a contact-only tweak (its
 * summary says "N คน", its options are 10/20/50/100) would silently reshape the
 * broadcast footer. So the shared role goes where shared UI primitives already
 * live — `components/common/`. ตัวไหนเป็นของ feature ก็อยู่ใน feature นั้น
 * ของกลางต้องอยู่ common.
 *
 * ⚠️ The other two pages are deliberately NOT migrated here — that is a
 * separate refactor with its own snapshots to re-bless. This file is additive.
 *
 * STATELESS BY DESIGN (same contract as both existing pagers): page and perPage
 * live in the parent, which is also what fetches. This renders and raises.
 *
 * The row summary is a `summary` NODE rather than text built in here, because
 * every caller counts a different thing ("N คน" / "N รายการ") through its own
 * `t()`. Hard-coding a sentence here would force one wording on all of them.
 *
 * revert: delete this file + its line in components/common/index.ts, and put
 *         the inline footers back in pages/messaging/Broadcasts.tsx.
 */

/** Owner-specified page sizes for the broadcast tables. */
export const TABLE_PER_PAGE_OPTIONS = [10, 25, 50, 100] as const;

interface Props {
  page: number;
  totalPages: number;
  perPage: number;
  /** Optional left-hand blurb (row totals etc.) rendered by the caller in its own locale. */
  summary?: React.ReactNode;
  loading?: boolean;
  onPageChange: (page: number) => void;
  onPerPageChange: (perPage: number) => void;
  /** Prefix for this pager's data-testid attributes — two pagers on one page must not collide. */
  testId?: string;
  perPageOptions?: readonly number[];
  className?: string;
}

export const TablePager: React.FC<Props> = ({
  page,
  totalPages,
  perPage,
  summary,
  loading = false,
  onPageChange,
  onPerPageChange,
  testId = 'table-pager',
  perPageOptions = TABLE_PER_PAGE_OPTIONS,
  className = '',
}) => {
  const { t } = useI18n();
  /* Clamp before rendering OR raising. A filter change can shrink the result
     set while `page` still holds the old number, and an unclamped bar would
     both print "หน้า 9 / 2" and ask the server for a page that cannot exist.
     Same guard, same reason, as ContactPaginationBar. */
  const lastPage = Math.max(1, totalPages);
  const current = Math.min(Math.max(1, page), lastPage);
  const canPrev = !loading && current > 1;
  const canNext = !loading && current < lastPage;

  return (
    <div
      data-testid={testId}
      className={`flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 ${className}`}
    >
      <div className="flex items-center gap-3 text-xs text-slate-500">
        {summary}
      </div>

      <div className="flex items-center gap-3">
        {/* per-page — parent resets to page 1; see the handlers in the page. */}
        <label className="flex items-center gap-1.5 text-xs text-slate-500 whitespace-nowrap">
          {t('pageui.common.pager_show', 'แสดง')}
          {/* [UI-20260825-DIRSELECT] ตัวนี้อยู่ล่างสุดของหน้า เมนูจึงตกขอบล่างเสมอ
              เจ้าของสั่ง 25/08 ให้เปิดขึ้นบน · `<select>` มาตรฐานให้เบราว์เซอร์วาด
              เมนูเอง บังคับทิศทางไม่ได้ ⇒ ใช้ตัวที่วัดที่ว่างแล้วเลือกทิศเอง
              ⚠️ ข้างในยังมี `<select>` จริงซ่อนอยู่ ⇒ `${testId}-per-page` ยังเป็น
                 `HTMLSelectElement` เหมือนเดิม เทสที่ยิง `fireEvent.change` ไม่พัง
              revert: กลับไปใช้ `<select>` ตรง ๆ (props ชื่อเดียวกัน) */}
          <DirectionalSelect
            name={`${testId}-per-page`}
            value={String(perPage)}
            disabled={loading}
            title={t('pageui.common.pager_per_page_title', 'จำนวนต่อหน้า')}
            options={perPageOptions.map((n) => ({ value: String(n), label: String(n) }))}
            onChange={(v) => onPerPageChange(Number(v))}
            className="bg-dark-800 border border-dark-600 rounded-lg py-1.5 px-2 text-sm text-slate-900 focus:ring-2 focus:ring-primary-500 outline-none cursor-pointer disabled:opacity-50 min-w-[4.5rem]"
          />
          {t('pageui.common.pager_per_page_suffix', '/ หน้า')}
        </label>

        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid={`${testId}-prev`}
            aria-label="previous page"
            title={t('pageui.common.pager_prev', 'หน้าก่อนหน้า')}
            onClick={() => onPageChange(current - 1)}
            disabled={!canPrev}
            className="p-2 rounded-lg border border-dark-600 bg-dark-700 text-slate-500 hover:text-slate-900 hover:bg-dark-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft size={16} />
          </button>
          <div className="flex items-center gap-1 tabular-nums" data-testid={`${testId}-position`}>
            <span className="text-sm font-bold text-primary-500">{current}</span>
            <span className="text-sm text-slate-500">/</span>
            <span className="text-sm text-slate-500">{lastPage}</span>
          </div>
          <button
            type="button"
            data-testid={`${testId}-next`}
            aria-label="next page"
            title={t('pageui.common.pager_next', 'หน้าถัดไป')}
            onClick={() => onPageChange(current + 1)}
            disabled={!canNext}
            className="p-2 rounded-lg border border-dark-600 bg-dark-700 text-slate-500 hover:text-slate-900 hover:bg-dark-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default TablePager;
