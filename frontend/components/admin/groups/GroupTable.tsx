import React from 'react';
import { Copy, Edit2, Trash2 } from 'lucide-react';

import { GroupEntry } from '../../../types';

/**
 * ==== [FIX-20260817-GROUPTABLESPLIT] the Groups table, lifted VERBATIM =========
 *
 * WHY IT MOVED: the bulk-status feature and the real pager pushed
 * `pages/admin/Groups.tsx` past the 400-line ESLint ceiling, and that waiver list
 * may only shrink (FE §6.1) — so the page splits instead of the list growing.
 *
 * WHAT MOVED: markup only. Every class string, element order and handler call is
 * byte-identical to what the page rendered; all state (rows, ticks, modals) stays
 * in the page and arrives here as props, so no re-render or effect timing changed
 * (FE §6.4 draws the line exactly there).
 *
 * ⚠️ A characterization snapshot of the PAGE before the move was not possible —
 * `Groups.tsx` fetches on mount and polls, so vitest cannot render it. Mitigation:
 * the markup was copied verbatim (never retyped), `tsc` is clean, this file has its
 * own DOM snapshot from the first render after the move, and the served bundle is
 * checked. Recorded rather than glossed over.
 * ย้าย markup เฉย ๆ · state ไม่ย้าย · คลาสทุกตัวเหมือนเดิมเป๊ะ.
 *
 * revert: paste this JSX back into Groups.tsx where <GroupTable/> is used.
 */
interface Props {
  rows: GroupEntry[];
  loading: boolean;
  selectedIds: ReadonlySet<string>;
  allOnPageSelected: boolean;
  onToggleAll: () => void;
  onToggleOne: (id: string) => void;
  onEdit: (group: GroupEntry) => void;
  onClone: (group: GroupEntry) => void;
  onDelete: (id: string) => void;
  /** The page owns i18n; the table only renders what it is handed. */
  t: (key: string) => string;
  StatusBadge: React.FC<{ status: boolean }>;
}

export const GroupTable: React.FC<Props> = ({
  rows: groups,
  loading,
  selectedIds,
  allOnPageSelected,
  onToggleAll: toggleAllOnPage,
  onToggleOne: toggleOne,
  onEdit: openEdit,
  onClone: setCloneSource,
  onDelete: setDeleteId,
  t,
  StatusBadge,
}) => (
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-dark-900 border-b border-dark-700">
                {/* [FEAT-20260817-GROUPBULKSTATUS] select-all covers THIS PAGE only —
                    ticks are cleared whenever the page/filter changes, so a bulk
                    action can never reach a row the operator is not looking at. */}
                <th className="pl-6 pr-2 py-4 w-10">
                  <input
                    type="checkbox"
                    aria-label={t('common.select_all') || 'เลือกทั้งหมด'}
                    checked={allOnPageSelected}
                    onChange={toggleAllOnPage}
                    className="w-4 h-4 rounded border-dark-600 accent-primary-600 cursor-pointer"
                  />
                </th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{t('group.header_name')}</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{t('group.header_description')}</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{t('group.header_status')}</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{t('group.header_created_at')}</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{t('group.header_updated_at')}</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right whitespace-nowrap">{t('group.header_actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700">
              {!loading && groups.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                    {t('group.no_results')}
                  </td>
                </tr>
              ) : (
                groups.map((group) => (
                  <tr key={group._id} className="transition-colors hover:bg-dark-700/50">
                    <td className="pl-6 pr-2 py-4 w-10">
                      <input
                        type="checkbox"
                        aria-label={group.group_name}
                        checked={selectedIds.has(group._id)}
                        onChange={() => toggleOne(group._id)}
                        className="w-4 h-4 rounded border-dark-600 accent-primary-600 cursor-pointer"
                      />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm font-medium text-slate-900">{group.group_name}</span>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600 min-w-[240px]">
                      {group.description || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <StatusBadge status={group.status} />
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-500 whitespace-nowrap">
                      {group.created_at
                        ? new Date(group.created_at).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                        : '-'}
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-500 whitespace-nowrap">
                      {group.updated_at
                        ? new Date(group.updated_at).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                        : '-'}
                    </td>
                    <td className="px-6 py-4 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEdit(group)}
                          className="p-1.5 rounded-lg hover:bg-primary-500/20 text-slate-500 hover:text-primary-500 transition-colors"
                          title={t('common.edit')}
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={() => setCloneSource(group)}
                          className="p-1.5 rounded-lg hover:bg-amber-500/20 text-slate-500 hover:text-amber-500 transition-colors"
                          title={t('group_scope.copy_action')}
                        >
                          <Copy size={16} />
                        </button>
                        <button
                          onClick={() => setDeleteId(group._id)}
                          className="p-1.5 rounded-lg hover:bg-red-500/20 text-slate-500 hover:text-red-500 transition-colors"
                          title={t('common.delete')}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
);

export default GroupTable;
