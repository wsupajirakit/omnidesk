import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * ==== [FIX-20260817-GROUPPAGER] the pager that finally shows a page number =====
 *
 * The Groups page had two arrows and nothing else: no page number, no page size.
 * An operator could not tell which page they were on, which is what the owner
 * reported ("ไม่มีหมายเลขหน้าขึ้น"). This is the same shape the app already uses on
 * `pages/messaging/DynamicTagList.tsx:838-861` — page size on the left, `current /
 * total` between the arrows — so the dashboard keeps ONE pager language rather
 * than growing a second one.
 *
 * Render-only: page and page-size state stay in the parent (FE §6.4). Extracted
 * because the bulk feature pushed `Groups.tsx` past the 400-line ceiling, and that
 * waiver list may only shrink.
 * revert: delete this file + its import and use in Groups.tsx.
 */
export const PER_PAGE_OPTIONS = [25, 50, 100] as const;

interface Props {
  page: number;
  totalPages: number;
  perPage: number;
  onPageChange: (page: number) => void;
  onPerPageChange: (perPage: number) => void;
}

export const GroupTablePager: React.FC<Props> = ({
  page,
  totalPages,
  perPage,
  onPageChange,
  onPerPageChange,
}) => (
  <div className="flex items-center gap-3">
    <select
      value={perPage}
      aria-label="rows per page"
      onChange={(e) => onPerPageChange(Number(e.target.value))}
      className="bg-dark-800 border border-dark-600 rounded-lg py-1.5 px-2 text-sm text-slate-900 focus:ring-2 focus:ring-primary-500 outline-none cursor-pointer"
    >
      {PER_PAGE_OPTIONS.map((n) => (
        <option key={n} value={n}>
          {n} / Page
        </option>
      ))}
    </select>
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-label="previous page"
        onClick={() => onPageChange(Math.max(1, page - 1))}
        disabled={page <= 1}
        className="p-2 rounded-lg border border-dark-600 text-slate-500 hover:text-slate-900 hover:bg-dark-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronLeft size={16} />
      </button>
      {/* The number itself — the part that was missing. */}
      <div className="flex items-center gap-1">
        <span className="text-sm font-bold text-primary-500">{page}</span>
        <span className="text-sm text-slate-500">/</span>
        <span className="text-sm text-slate-500">{totalPages}</span>
      </div>
      <button
        type="button"
        aria-label="next page"
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
        className="p-2 rounded-lg border border-dark-600 text-slate-500 hover:text-slate-900 hover:bg-dark-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  </div>
);

export default GroupTablePager;
