import React, { useEffect, useMemo, useState } from 'react';
import { useAssignHistoryPageQuery } from '../../services/chat/queries';
import { userService } from '../../services/admin';
import { AssignHistoryEntry, UserEntry } from '../../types';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { AlertModal } from '../../components/modals';
// [FEAT-20260806-SEARCHSELECT] reuse the app's searchable dropdown (same one
// HandoffHistory / WebhookLogs use) so ACTION / ผู้รับงาน / ผู้เปลี่ยน become
// typeahead combos instead of long native <select>s — matching admin styling.
import { SearchableSelect } from '../../components/common';
// [FEAT-20260817-ASSIGNDATERANGE] the same 3-day control the log pages use
import {
  LogDateRangeFilter,
  defaultLogRange,
  type LogDateRange,
} from '../../components/common/LogDateRangeFilter';
import { useI18n } from '../../i18n';

export const AssignHistory: React.FC = () => {
  const { t } = useI18n();

  const [users, setUsers] = useState<UserEntry[]>([]);
  
  const [assignToFilter, setAssignToFilter] = useState<string>('all');
  const [changedByFilter, setChangedByFilter] = useState<string>('all');
  const [actionFilter, setActionFilter] = useState<string>('all');

  // [FEAT-20260806-SEARCHSELECT] option sets for the searchable dropdowns. Same
  // values/labels/order as the old native <select>s — the picker gains search, the
  // resulting filter is byte-identical (proven by the before/after test).
  const actionOptions = useMemo(() => [
    { value: 'all', label: t('pageui.handoff.all_actions', 'ทั้งหมด (All Actions)') },
    { value: 'accept', label: t('assign_history.action_accept') || 'Accept (รับงาน)' },
    { value: 'edit', label: t('assign_history.action_edit') || 'Edit Operator (เปลี่ยนแอดมิน)' },
    { value: 'close', label: t('assign_history.action_close') || 'Close Job (ปิดงาน)' },
    // [FEAT-20260817-REOPENBYADMIN] countable apart from accept — same value
    // the BE writes in assign_histories.action
    { value: 'reopen_by_admin', label: t('assign_history.action_reopen') || 'Reopen (เปิดเคส)' },
  ], [t]);
  const userOptions = useMemo(() => [
    { value: 'all', label: t('assign_history.all_users') || 'All Users' },
    ...users.map(u => ({ value: u.id, label: u.display_name || u.username })),
  ], [users, t]);

  /* [FEAT-20260817-ASSIGNDATERANGE] default = today only. The cap and the Bangkok
     day conversion live in the backend (`resolveLogDateRange`); this is only the
     affordance. revert: drop this state, the control below and the two params. */
  const [dateRange, setDateRange] = useState<LogDateRange>(defaultLogRange);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  
  const [alertState, setAlertState] = useState<{ isOpen: boolean; title: string; message: string; type: 'success' | 'error' }>({
    isOpen: false,
    title: '',
    message: '',
    type: 'error'
  });

  const closeAlert = () => setAlertState(prev => ({ ...prev, isOpen: false }));

  /* [FIX-20260817-USERPRELOADCAP] the two operator dropdowns need every admin's
     id + name, so this list stays — but `limit: 1000` was a lie in the code: the
     backend clamps to 200 (`users.service.ts:35`), so the extra zero never fetched
     anything and only told the next reader that this page pulls a thousand rows.
     200 is the real number on both sides; keep them in sync. A user row is ~796
     bytes and carries no secret (checked the live response: no `password_hash`),
     so at the real cap this is ~160 KB worst case, against 377 KB for ONE hook
     preload — which is why the hook side got a slim endpoint and this did not.
     ตัวเลขในโค้ดต้องตรงกับที่ BE ยอมจริง ไม่งั้นคนอ่านเข้าใจผิด. */
  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const response = await userService.listUsers({ page: 1, limit: 200 });
        setUsers(response.data);
      } catch (error) {
        console.error('Failed to load users for filters', error);
      }
    };
    fetchUsers();
  }, []);

  /* ==== [FEAT-20261027-TANSTACK] list + 20s visible-tab poll — the shared contract ====
   * services/query/usePageQuery.ts (`poll`, `onFailure: clear`) owns what this screen hand-wrote here
   * ([FIX-20260809-POLLVIS]): poll only while the tab is visible, read again the moment
   * it shows, both paused while a modal is open, loading on every read, rows cleared on
   * a failed read. Pinned by test/requests/adminPollers.requests.test.tsx.
   * revert: restore this file from tag ckpt-after-tanstack-p1-demo-27102026. */
  const historiesQuery = useAssignHistoryPageQuery(
    {
      page,
      limit,
      assign_to: assignToFilter === 'all' ? undefined : assignToFilter,
      changed_by_id: changedByFilter === 'all' ? undefined : changedByFilter,
      action: actionFilter === 'all' ? undefined : actionFilter,
      from: dateRange.from,
      to: dateRange.to,
    },
    {
      paused: alertState.isOpen,
      onError: (error: any) => setAlertState({
        isOpen: true,
        title: t('assign_history.error_title') || 'Load Failed',
        message: error?.message || t('assign_history.error_message') || 'Failed to load assignment histories.',
        type: 'error',
      }),
    },
  );
  const histories: AssignHistoryEntry[] = historiesQuery.page?.data || [];
  // the pager keeps the last page that loaded, through a failure — as the old setPagination did
  const pagination = historiesQuery.lastGoodPage?.pagination ?? { page: 1, limit, total: 0, total_pages: 1 };
  const loading = historiesQuery.loading;

  const totalPages = Math.max(1, pagination.total_pages || 1);

  const actionBadge = (action: string | null | undefined) => {
    if (!action) return <span className="text-slate-400 font-bold">-</span>;
    
    let color = 'bg-slate-500/10 text-slate-700 border border-slate-500/20';
    let label = action;

    if (action === 'accept') {
      color = 'bg-emerald-500/10 text-emerald-700 border border-emerald-500/20';
      label = t('assign_history.action_accept') || 'Accept';
    } else if (action === 'edit') {
      color = 'bg-amber-500/10 text-amber-700 border border-amber-500/20';
      label = t('assign_history.action_edit') || 'Edit Operator';
    } else if (action === 'close') {
      color = 'bg-red-500/10 text-red-700 border border-red-500/20';
      label = t('assign_history.action_close') || 'Close Job';
    } else if (action === 'reopen_by_admin') {
      // [FEAT-20260817-REOPENBYADMIN] blue like an accept-family event
      color = 'bg-sky-500/10 text-sky-700 border border-sky-500/20';
      label = t('assign_history.action_reopen') || 'Reopen (เปิดเคส)';
    }

    return (
      <span className={`text-[11px] px-2 py-1 rounded-full font-bold tracking-wide ${color}`}>
        {label}
      </span>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 bg-dark-800 border border-dark-700 rounded-xl px-4 py-4 shadow-lg shadow-black/20">
          <div>
            <p className="text-sm text-slate-500">{t('assign_history.title') || 'Assignment History'}</p>
            <h3 className="text-xl font-semibold text-slate-900">{t('assign_history.subtitle') || 'History of chat assignments'}</h3>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:gap-4">
            {/* [FEAT-20260817-ASSIGNDATERANGE] first in the row, same as the log pages:
                the window bounds everything the other filters then narrow. */}
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">
                {t('common.date') || 'วันที่'}
              </span>
              <LogDateRangeFilter
                value={dateRange}
                disabled={loading}
                onChange={(next) => { setDateRange(next); setPage(1); }}
              />
            </div>

            {/* [FEAT-20260806-SEARCHSELECT] the 3 filters below were native <select>s;
                now searchable combos (identical option set + selected-value semantics). */}
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">
                {t('pageui.handoff.label_action', 'Action / การกระทำ')}
              </span>
              <SearchableSelect
                className="w-56"
                value={actionFilter}
                onChange={(v) => { setActionFilter(v); setPage(1); }}
                options={actionOptions}
              />
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">
                {t('assign_history.filter_assign_to') || 'Assign To'}
              </span>
              <SearchableSelect
                className="w-48"
                value={assignToFilter}
                onChange={(v) => { setAssignToFilter(v); setPage(1); }}
                options={userOptions}
              />
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">
                {t('assign_history.filter_changed_by') || 'Changed By'}
              </span>
              <SearchableSelect
                className="w-48"
                value={changedByFilter}
                onChange={(v) => { setChangedByFilter(v); setPage(1); }}
                options={userOptions}
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto bg-dark-900 border border-dark-700 rounded-xl shadow-lg shadow-black/20 relative">
          {loading && (
            <div className="absolute left-0 top-0 h-0.5 w-full bg-primary-500/80 animate-pulse" />
          )}
          <table className="min-w-full divide-y divide-dark-700">
            <thead className="bg-dark-800">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold tracking-wider uppercase text-slate-500">
                  {t('pageui.handoff.col_customer', 'Customer / ลูกค้า')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold tracking-wider uppercase text-slate-500">
                  Action
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold tracking-wider uppercase text-slate-500">
                  Changed By
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold tracking-wider uppercase text-slate-500">
                  Assigned To
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold tracking-wider uppercase text-slate-500">
                  Date & Time
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-800">
              {!loading && histories.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">
                    {t('assign_history.no_results') || 'No assignment history records found'}
                  </td>
                </tr>
              ) : (
                histories.map(history => (
                  <tr key={history._id} className="hover:bg-dark-900/50 transition-colors">
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {history.chat_room_data?.user_id ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="font-bold text-slate-900">
                            {(history.chat_room_data.user_id as any).full_name || t('pageui.handoff.not_registered', '-(ไม่ได้ลงทะเบียน)-')}
                          </span>
                          <span className="text-xs text-slate-500">
                            Display: {(history.chat_room_data.user_id as any).display_name || '-'}
                          </span>
                          <span className="text-xs font-mono text-slate-400">
                            Tel: {(history.chat_room_data.user_id as any).phone_number || '-'}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-400 italic">Unknown Customer</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {actionBadge(history.action)}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {history.changed_by_data ? (
                        <div className="flex flex-col">
                          <span className="font-medium text-slate-900">
                            {history.changed_by_data.username}
                          </span>
                          <span className="text-xs text-slate-500">
                            {history.changed_by_data.display_name}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-500 italic">System / Unknown</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {history.assign_to_data ? (
                        <div className="flex flex-col">
                          <span className="font-medium text-slate-900">
                            {history.assign_to_data.username}
                          </span>
                          <span className="text-xs text-slate-500">
                            {history.assign_to_data.display_name}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-500 italic">- Unassigned -</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700 font-mono">
                      {new Date(history.created_at).toLocaleString('th-TH', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit'
                      })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col sm:flex-row justify-between items-center gap-4 px-6 py-4 border-t border-dark-700">
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-500">
              {t('common.showing_total', { count: pagination.total }) || `Total: ${pagination.total}`}
            </span>
            <div className="h-4 w-px bg-dark-700 hidden sm:block" />
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-tighter">
                {t('common.per_page') || 'Per Page'}:
              </span>
              <select
                value={limit}
                onChange={(e) => {
                  setLimit(Number(e.target.value));
                  setPage(1);
                }}
                className="bg-dark-800 border border-dark-600 rounded-lg py-1 px-2 text-xs font-bold text-slate-900 focus:ring-2 focus:ring-primary-500 outline-none cursor-pointer"
              >
                {[10, 20, 30, 50, 100].map(v => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-2 rounded-lg bg-dark-700 text-slate-400 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={18} />
            </button>
            <span className="text-sm text-slate-600 px-2 font-medium">{page} / {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-2 rounded-lg bg-dark-700 text-slate-400 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>

      <AlertModal
        isOpen={alertState.isOpen}
        onClose={closeAlert}
        title={alertState.title}
        message={alertState.message}
        type={alertState.type}
      />
    </div>
  );
};
