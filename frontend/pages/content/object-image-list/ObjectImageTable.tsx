/**
 * [REFACTOR-20260904-OBJLISTSPLIT] The album table: header, body and pager.
 * ===========================================================================
 * Lifted VERBATIM out of `ObjectImageList.tsx` (§6.3 step 3) — the eight column
 * headers, the empty state, the row map and the pagination strip, with class
 * strings and order byte-identical.
 *
 * 🔴 IT RENDERS ROWS, IT DOES NOT DECIDE THEM. `images` arrives already
 * filtered; the page owns the search and the fetch. Filtering here would put the
 * rule in two places and the two would disagree the first time either changed.
 *
 * ⚠️ The row callbacks are passed straight through rather than rebuilt here. A
 * component that "helpfully" wrapped them in new arrow functions would hand
 * every row a fresh identity on each render, which is the remount trap
 * `GDriveImage` was extracted to fix earlier today.
 *
 * revert: paste the body back above `<ObjectImageFormModal>` in
 *   `ObjectImageList.tsx`, restore `filteredImages` and the two page setters,
 *   delete this file.
 */
import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import type { ObjectImage } from '../../../types';
import { ObjectImageRow } from './ObjectImageRow';
import { SHOW_MATCHING_TAG } from './objectImageList.constants';

export interface ObjectImageTableProps {
  /** Already filtered by the page — this component never filters. */
  images: ObjectImage[];
  loading: boolean;
  groupNames: Record<string, string>;
  hookNames: Record<string, string>;
  statusPendingId: string | null;
  onPreview: (img: ObjectImage) => void;
  onCopyTags: (tags: ObjectImage['matching_tag']) => void;
  onToggleStatus: (img: ObjectImage, next: boolean) => void;
  /** [FEAT-20260907-OBJUPLOADSTEP] straight through to the row. */
  onUpload: (img: ObjectImage) => void;
  onView: (img: ObjectImage) => void;
  onEdit: (img: ObjectImage) => void;
  onDelete: (id: string) => void;
  totalItems: number;
  currentPage: number;
  totalPages: number;
  onPrevPage: () => void;
  onNextPage: () => void;
  t: (key: string, vars?: Record<string, unknown>) => string;
}

export const ObjectImageTable: React.FC<ObjectImageTableProps> = ({
  images,
  loading,
  groupNames,
  hookNames,
  statusPendingId,
  onPreview,
  onCopyTags,
  onToggleStatus,
  onUpload,
  onView,
  onEdit,
  onDelete,
  totalItems,
  currentPage,
  totalPages,
  onPrevPage,
  onNextPage,
  t,
}) => (
  <div className="bg-dark-800 rounded-xl border border-dark-700 shadow-xl overflow-hidden relative">
    {loading && (
      <div className="absolute left-0 top-0 h-0.5 w-full bg-primary-500/80 animate-pulse" />
    )}
    <div className="overflow-x-auto custom-scrollbar">
      <table className="w-full text-left">
        <thead>
          <tr className="bg-dark-900 border-b border-dark-700">
            <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('object_image.header_image')}</th>
            <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('object_image.header_detail')}</th>
            {/* [UI-20260904-HIDEMATCHTAG] gated with its <td> in ObjectImageRow —
                hiding one alone shifts every column after it. */}
            {SHOW_MATCHING_TAG && (
              <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('object_image.header_tag')}</th>
            )}
            <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('object_image.header_categories')}</th>
            <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('object_image.header_storage')}</th>
            <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('object_scope.column')}</th>
            <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('object_scope.status_label')}</th>
            <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">{t('object_image.header_actions')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-dark-700">
          {!loading && images.length === 0 ? (
             <tr>
               <td colSpan={8} className="px-6 py-12 text-center text-slate-500 italic">
                  {t('object_image.no_results')}
               </td>
            </tr>
          ) : (
            images.map((img) => (
              <ObjectImageRow
                key={img.id}
                img={img}
                groupNames={groupNames}
                hookNames={hookNames}
                statusPending={statusPendingId === img.id}
                onPreview={onPreview}
                onCopyTags={onCopyTags}
                onToggleStatus={onToggleStatus}
                onUpload={onUpload}
        onView={onView}
                onEdit={onEdit}
                onDelete={onDelete}
                t={t}
              />
            ))
          )}
        </tbody>
      </table>
    </div>

    {/* Pagination Section */}
    <div className="px-6 py-4 border-t border-dark-700 flex flex-col sm:flex-row items-center justify-between gap-4">
      <span className="text-sm text-slate-500">
        {t('common.showing_total', { count: totalItems })}
      </span>
      <div className="flex gap-2">
        <button
          onClick={onPrevPage}
          disabled={currentPage <= 1}
          className="p-2 rounded-lg border border-dark-600 text-slate-400 hover:text-slate-900 hover:bg-dark-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="flex items-center gap-1 px-3 py-1 rounded-md bg-dark-900 border border-dark-600 text-sm font-medium text-slate-700">
          {currentPage} / {totalPages}
        </div>
        <button
          onClick={onNextPage}
          disabled={currentPage >= totalPages}
          className="p-2 rounded-lg border border-dark-600 text-slate-400 hover:text-slate-900 hover:bg-dark-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  </div>
);
