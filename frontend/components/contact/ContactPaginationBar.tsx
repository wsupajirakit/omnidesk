/* [FEAT-20260814-CONTACTPAGE] Contact list pagination bar
 * ===========================================================================
 * Owner, 14/08: "หน้านี้ห้ามแสดงทั้งหมดทำเป็น next page … pagination นะ per page
 * ด้วย ห้ามแสดงทั้งหมด แต่ค้นหาต้องค้นได้ปกติ" — the list must show ONE page at
 * a time (replacing the old append-forever "โหลดเพิ่ม" button), with a per-page
 * selector. Search stays server-side and untouched — this bar only navigates.
 *
 * STATELESS BY DESIGN: no useState/useEffect here. The parent (Contact.tsx)
 * owns page/perPage and fetches; this component only renders + raises events.
 * That keeps §6.4 (moving state = higher bar) entirely out of scope.
 *
 * revert: delete this file + the <ContactPaginationBar> block and the perPage
 *         state in pages/chat/Contact.tsx (marker [FEAT-20260814-CONTACTPAGE]),
 *         restore the "โหลดเพิ่ม" footer from git history.
 */
import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useI18n } from '../../i18n';

export const PER_PAGE_OPTIONS = [10, 20, 50, 100] as const;

interface Props {
  page: number;
  pages: number;
  total: number;
  perPage: number;
  loading?: boolean;
  onPageChange: (page: number) => void;
  onPerPageChange: (perPage: number) => void;
}

export const ContactPaginationBar: React.FC<Props> = ({
  page, pages, total, perPage, loading = false, onPageChange, onPerPageChange,
}) => {
  const { t } = useI18n();
  // Clamp so a stale page (e.g. filters shrank the result set) can never
  // render "หน้า 5 / 2" or navigate out of range.
  const lastPage = Math.max(1, pages);
  const current = Math.min(Math.max(1, page), lastPage);
  const canPrev = !loading && current > 1;
  const canNext = !loading && current < lastPage;

  return (
    <div className="shrink-0 border-t border-gray-200 bg-white px-3 py-2 flex items-center justify-between gap-2">
      {/* per-page — เปลี่ยนแล้ว parent จะ reset ไปหน้า 1 เอง */}
      <label className="flex items-center gap-1.5 text-[12px] text-gray-500 whitespace-nowrap">
        {t('pageui.contact.pager_show', 'แสดง')}
        <select
          value={perPage}
          disabled={loading}
          onChange={(e) => onPerPageChange(Number(e.target.value))}
          className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-[12px] text-gray-700 focus:outline-none focus:border-blue-500 disabled:opacity-50"
          title={t('pageui.contact.pager_per_page', 'จำนวนต่อหน้า')}
        >
          {PER_PAGE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        {t('pageui.contact.pager_per_page_suffix', '/ หน้า')}
      </label>

      <div className="flex items-center gap-1.5">
        <span className="text-[12px] text-gray-400 tabular-nums whitespace-nowrap">
          {t('pageui.contact.pager_page', 'หน้า')} <b className="text-gray-600">{current}</b> / {lastPage}
          <span className="hidden sm:inline"> · {total.toLocaleString()} {t('pageui.contact.people', 'คน')}</span>
        </span>
        <button
          type="button"
          onClick={() => onPageChange(current - 1)}
          disabled={!canPrev}
          className="p-2 rounded-md border border-gray-300 text-gray-500 hover:text-blue-600 hover:border-blue-500 transition-colors disabled:opacity-40 disabled:hover:text-gray-500 disabled:hover:border-gray-300"
          title={t('pageui.contact.pager_prev', 'หน้าก่อนหน้า')}
        ><ChevronLeft size={18} /></button>
        <button
          type="button"
          onClick={() => onPageChange(current + 1)}
          disabled={!canNext}
          className="p-2 rounded-md border border-gray-300 text-gray-500 hover:text-blue-600 hover:border-blue-500 transition-colors disabled:opacity-40 disabled:hover:text-gray-500 disabled:hover:border-gray-300"
          title={t('pageui.contact.pager_next', 'หน้าถัดไป')}
        ><ChevronRight size={18} /></button>
      </div>
    </div>
  );
};
