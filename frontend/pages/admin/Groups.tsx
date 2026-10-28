import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, Filter, Plus, RefreshCw, Search, Trash2, Edit2 } from 'lucide-react';
import { groupService, groupScopeService, sumScopeCloneTargets, type ScopeCloneResult } from '../../services/admin';
import { useGroupsPageQuery } from '../../services/admin/queries';
import { authService } from '../../services/admin';
import { GroupEntry, GroupFormData } from '../../types';
import {
  GroupFormModal,
  GroupScopeCloneModal,
  GroupBulkStatusBar,
  GroupTablePager,
  GroupTable,
} from '../../components/admin';
// [FEAT-20260817-GROUPBULKSTATUS] pure selection maths + result sentence
import {
  allSelected,
  toggleOne as toggleOneId,
  toggleAllOnPage as toggleAllIds,
  bulkStatusMessage,
} from '../../components/admin/groups/groupSelection';
import { ConfirmModal } from '../../components/modals';
import { AlertModal } from '../../components/modals';
import { useI18n } from '../../i18n';

type StatusFilter = 'all' | 'active' | 'inactive';

export const Groups: React.FC = () => {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [currentPage, setCurrentPage] = useState(1);
  /* [FIX-20260817-GROUPPAGER] the page size is a CHOICE now (was a hardcoded 25
     with no control), matching the DynamicTagList pager the app already uses. */
  const [perPage, setPerPage] = useState(25);
  /**
   * [FIX-20260817-GROUPSEARCH] the search term the SERVER sees.
   *
   * `search` is what the user is typing; this is the settled value, 350ms behind.
   * The list used to filter client-side over the 25 rows of the current page
   * while `totalItems`/`totalPages` came from an unfiltered server query — so a
   * match on page 3 was invisible and the pager counted rows the user could not
   * see. The BE has always accepted `group_name` (groups.service.ts:123-128).
   * ค้นหาที่ server ไม่ใช่กรองหน้าเดียว — ไม่งั้นเลขหน้ากับผลลัพธ์ไม่ตรงกัน.
   */
  const [searchQuery, setSearchQuery] = useState('');
  /* [FEAT-20260817-GROUPBULKSTATUS] ticked rows + the pending on/off choice. */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkTarget, setBulkTarget] = useState<boolean | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<GroupEntry | undefined>(undefined);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  // [FEAT-20260816-GROUPSCOPECLONE] the group whose permissions are being copied
  const [cloneSource, setCloneSource] = useState<GroupEntry | null>(null);
  const [alertState, setAlertState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: 'success' | 'error';
  }>({
    isOpen: false,
    title: '',
    message: '',
    type: 'success'
  });
  const isModalOpen = isFormOpen || !!deleteId || alertState.isOpen || !!cloneSource || bulkTarget !== null;

  const showAlert = (title: string, message: string, type: 'success' | 'error') => {
    setAlertState({ isOpen: true, title, message, type });
  };

  const closeAlert = () => setAlertState(prev => ({ ...prev, isOpen: false }));

  /* ==== [FEAT-20261027-TANSTACK] list + 20s visible-tab poll — the shared contract ====
   * services/query/usePageQuery.ts (`poll`, `onFailure: clear`) owns what this screen hand-wrote here
   * ([FIX-20260809-POLLVIS]): poll only while the tab is visible, read again the moment
   * it shows, both paused while a modal is open, loading on every read, rows cleared on
   * a failed read. Pinned by test/requests/adminPollers.requests.test.tsx.
   * revert: restore this file from tag ckpt-after-tanstack-p1-demo-27102026. */
  const groupsQuery = useGroupsPageQuery(
    { page: currentPage, limit: perPage, status: statusFilter === 'all' ? undefined : statusFilter === 'active', group_name: searchQuery.trim() || undefined },
    { paused: isModalOpen, onError: (e: any) => { console.error(e); showAlert(t('group.alert_load_failed_title'), e.message || t('group.alert_load_failed_message'), 'error'); } },
  );
  const groups: GroupEntry[] = groupsQuery.page?.data || [];
  const totalItems = groupsQuery.page?.pagination?.total || 0;
  const totalPages = groupsQuery.page?.pagination?.total_pages || 1;
  const [actionLoading, setActionLoading] = useState(false);   // the screen's own actions (save / delete / toggle)
  const loading = groupsQuery.loading || actionLoading;
  const { refetch: refetchList } = groupsQuery;
  const fetchGroups = useCallback(async () => { await refetchList(); }, [refetchList]);

  /* [FIX-20260817-GROUPSEARCH] 350ms after the last keystroke, ask the server.
     Without the delay every character would be a request; without the server
     round trip the pager lies (see `searchQuery`). */
  useEffect(() => {
    const timer = window.setTimeout(() => setSearchQuery(search), 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter, perPage]);

  /* A new page/filter means the ticks refer to rows that are no longer on screen —
     keeping them would let a bulk action hit something the operator cannot see. */
  useEffect(() => {
    setSelectedIds(new Set());
  }, [currentPage, perPage, searchQuery, statusFilter]);

  /* ==== [FEAT-20260817-GROUPBULKSTATUS] tick rows, flip the switch once ======
   * The maths lives in `groups/groupSelection.ts` (pure, unit-tested); this keeps
   * only the wiring. The confirm step is deliberate: this is the one control that
   * writes many rows at once and the server applies it all-or-nothing, so a
   * mis-click is wrong for every ticked group, not partly undoable.
   * revert: delete these handlers, the checkbox column, the bar and the modal. */
  const pageIds = groups.map((g) => g._id);
  const allOnPageSelected = allSelected(pageIds, selectedIds);
  const toggleAllOnPage = () =>
    setSelectedIds((prev) => toggleAllIds(prev, pageIds));
  const toggleOne = (id: string) =>
    setSelectedIds((prev) => toggleOneId(prev, id));

  const submitBulkStatus = async () => {
    if (bulkTarget === null || selectedIds.size === 0) return;
    setBulkSaving(true);
    try {
      const res = await groupService.bulkUpdateGroupStatus(
        Array.from(selectedIds),
        bulkTarget,
      );
      setSelectedIds(new Set());
      setBulkTarget(null);
      await fetchGroups();
      showAlert(
        t('group.bulk_status_done_title'),
        bulkStatusMessage(res, t(bulkTarget ? 'status.active' : 'status.inactive'), t('pageui.admin.already_in_state', 'เดิมอยู่แล้ว')),
        'success',
      );
    } catch (e: any) {
      showAlert(
        t('group.bulk_status_failed_title'),
        e?.message || '',
        'error',
      );
    } finally {
      setBulkSaving(false);
    }
  };

  const openCreate = () => {
    setEditing(undefined);
    setIsFormOpen(true);
  };

  const openEdit = (entry: GroupEntry) => {
    setEditing(entry);
    setIsFormOpen(true);
  };

  /**
   * [FEAT-20260816-GROUPSCOPECLONE] `cloneFromGroupId` is create-only and 1:1 —
   * the new group is the single target. A failed copy alerts and CONTINUES: the
   * group itself was created, and the row action can retry the copy.
   */
  const submitForm = async (data: GroupFormData, cloneFromGroupId?: string) => {
    try {
      if (editing) {
        if (!editing._id) {
          throw new Error(t('group.alert_invalid_id'));
        }
        await groupService.updateGroup(editing._id, data);
      } else {
        const created = await groupService.createGroup(data);
        if (cloneFromGroupId && created?._id) {
          await groupScopeService.cloneOnCreate(cloneFromGroupId, created._id).catch((err: any) => {
            console.error(err);
            showAlert(t('group_scope.title'), err?.message || t('group_scope.clone_failed'), 'error');
          });
        }
      }
      await authService.refresh();
      window.location.reload();
    } catch (e: any) {
      console.error(e);
      showAlert(t('group.alert_save_failed_title'), e.message || t('group.alert_save_failed_message'), 'error');
      throw e;
    }
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    setActionLoading(true);
    try {
      await groupService.deleteGroup(deleteId);
      showAlert(t('group.alert_deleted_title'), t('group.alert_deleted_message'), 'success');
      await fetchGroups();
    } catch (e: any) {
      console.error(e);
      showAlert(t('group.alert_delete_failed_title'), e.message || t('group.alert_delete_failed_message'), 'error');
    } finally {
      setActionLoading(false);
      setDeleteId(null);
    }
  };

  // the clone dialog closes itself on success, so the outcome is reported here
  const reportCloneResult = (result: ScopeCloneResult) => {
    const { dynamic_tags: tags, flex_messages: flex } = sumScopeCloneTargets(result);
    showAlert(t('group_scope.title'), t('group_scope.done', { tags, flex }), 'success');
    fetchGroups();
  };

  const StatusBadge = ({ status }: { status: boolean }) => (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
      status ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-slate-500/10 text-slate-300 border-slate-500/20'
    }`}>
      {status ? t('status.active') : t('status.inactive')}
    </span>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 bg-dark-800 p-4 rounded-xl border border-dark-700 shadow-lg">
        <div>
          <h2 className="text-xl font-bold text-slate-900">{t('group.title')}</h2>
          <p className="text-sm text-slate-500">{t('group.subtitle')}</p>
        </div>

        <div className="flex flex-col lg:flex-row gap-3 w-full xl:w-auto">
          <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto">
            <div className="relative w-full sm:w-40">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Filter className="text-slate-400" size={16} />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="pl-9 pr-4 w-full bg-dark-800 border border-dark-600 rounded-lg py-2 text-sm text-slate-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none appearance-none cursor-pointer"
              >
                <option value="all">{t('status.all_status')}</option>
                <option value="active">{t('status.active')}</option>
                <option value="inactive">{t('status.inactive')}</option>
              </select>
            </div>

            <div className="relative group w-full sm:w-72">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="text-slate-400 group-focus-within:text-primary-500 transition-colors" size={18} />
              </div>
              <input
                type="text"
                placeholder={t('group.search_placeholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10 w-full bg-dark-800 border border-dark-600 rounded-lg py-2 text-sm text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
              />
            </div>
          </div>

          <div className="flex gap-2 w-full sm:w-auto sm:ml-auto lg:ml-0">
            <button
              onClick={fetchGroups}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-dark-700 hover:bg-dark-600 text-slate-900 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              <RefreshCw size={18} />
              {t('common.refresh')}
            </button>
            <button
              onClick={openCreate}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-500 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-lg shadow-primary-500/20 transition-all hover:scale-105 whitespace-nowrap"
            >
              <Plus size={18} />
              {t('common.add_new')}
            </button>
          </div>
        </div>
      </div>

      <div className="bg-dark-800 rounded-xl border border-dark-700 shadow-xl overflow-hidden relative">
        {loading && (
          <div className="absolute left-0 top-0 h-0.5 w-full bg-primary-500/80 animate-pulse" />
        )}
        {/* [FEAT-20260817-GROUPBULKSTATUS] render-only section; every piece of
            state stays here (FE §6.4). Hidden entirely with no selection. */}
        <GroupBulkStatusBar
          count={selectedIds.size}
          onChoose={setBulkTarget}
          onClear={() => setSelectedIds(new Set())}
          /* [FIX-20260817-BULKI18N] every key below now exists in all four locales.
             The old `|| 'fallback'` idiom was dead code AND misleading: `t()` returns
             the KEY when it is missing (i18n/index.tsx:79), and a key string is
             truthy — which is why the bar showed "common.selected 4" on screen. */
          labels={{
            selected: t('common.selected'),
            active: t('status.active'),
            inactive: t('status.inactive'),
            cancel: t('common.cancel'),
          }}
        />
        {/* [FIX-20260817-GROUPTABLESPLIT] markup lifted verbatim into
            components/admin/groups/GroupTable.tsx — state stays here. */}
        <GroupTable
          rows={groups}
          loading={loading}
          selectedIds={selectedIds}
          allOnPageSelected={allOnPageSelected}
          onToggleAll={toggleAllOnPage}
          onToggleOne={toggleOne}
          onEdit={openEdit}
          onClone={setCloneSource}
          onDelete={setDeleteId}
          t={t}
          StatusBadge={StatusBadge}
        />

        <div className="bg-dark-900 px-6 py-4 border-t border-dark-700 flex flex-col sm:flex-row items-center justify-between gap-4">
          <span className="text-sm text-slate-500">
            {t('common.showing_items', {
              /* [FIX-20260817-GROUPPAGER] counts come from the SERVER's total, not
                 from the rows on screen — the old version reported "1-3 of 3"
                 while the collection held 40. */
              from: totalItems > 0 ? (currentPage - 1) * perPage + 1 : 0,
              to: Math.min(currentPage * perPage, totalItems),
              total: totalItems
            })}
          </span>
          {/* [FIX-20260817-GROUPPAGER] page number + page size — both were missing
              (two bare arrows). Shape matches the DynamicTagList pager. */}
          <GroupTablePager
            page={currentPage}
            totalPages={totalPages}
            perPage={perPage}
            onPageChange={setCurrentPage}
            onPerPageChange={setPerPage}
          />
        </div>
      </div>

      <GroupFormModal
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        onSubmit={submitForm}
        initialData={editing}
        cloneSources={groups}
      />

      <GroupScopeCloneModal
        isOpen={!!cloneSource}
        onClose={() => setCloneSource(null)}
        source={cloneSource}
        groups={groups}
        onApplied={reportCloneResult}
      />

      {/* [FEAT-20260817-GROUPBULKSTATUS] the confirm for the many-row write. The
          message names the count and the target state, because "ยืนยัน?" alone
          does not tell the operator what they are about to do to 20 groups. */}
      <ConfirmModal
        isOpen={bulkTarget !== null}
        onClose={() => setBulkTarget(null)}
        onConfirm={submitBulkStatus}
        title={t('group.bulk_status_title')}
        message={
          `${selectedIds.size} ${t('group.title')} → ` +
          `${bulkTarget ? t('status.active') : t('status.inactive')}` +
          (bulkSaving ? ' …' : '')
        }
        type={bulkTarget ? 'info' : 'danger'}
      />

      <ConfirmModal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={confirmDelete}
        title={t('group.delete_title')}
        message={t('group.delete_message')}
        type="danger"
      />

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
