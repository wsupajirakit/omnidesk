import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, RefreshCw, Search, Trash2, Edit2, Filter, Eye, Copy, Power, Loader2 } from 'lucide-react';
import { autoReplyService } from '../../services/messaging';
import { useAutoRepliesPageQuery } from '../../services/messaging/queries';
import { AutoReplyEntry, AutoReplyFormData } from '../../types';
import { AutoReplyFormModal } from '../../components/campaign';
import { ConfirmModal } from '../../components/modals';
import { AlertModal } from '../../components/modals';
import { useI18n } from '../../i18n';

type StatusFilter = 'all' | 'active' | 'inactive';

export const AutoReplies: React.FC = () => {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<AutoReplyEntry | undefined>(undefined);
  const [prefill, setPrefill] = useState<AutoReplyEntry | undefined>(undefined);
  const [isView, setIsView] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [isToggleLoading, setIsToggleLoading] = useState(false);
  const [toggleConfirm, setToggleConfirm] = useState<{
    isOpen: boolean;
    item?: AutoReplyEntry;
    nextActive?: boolean;
  }>({
    isOpen: false
  });
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
  const isModalOpen = isFormOpen || !!deleteId || alertState.isOpen || toggleConfirm.isOpen || isToggleLoading;

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
  const itemsQuery = useAutoRepliesPageQuery(
    { page: currentPage, limit: itemsPerPage, active: statusFilter === 'all' ? undefined : statusFilter === 'active', sort: 'priority:desc' },
    { paused: isModalOpen, onError: (e: any) => { console.error(e); showAlert(t('auto_reply.alert_load_failed_title'), e.message || t('auto_reply.alert_load_failed_message'), 'error'); } },
  );
  const items: AutoReplyEntry[] = itemsQuery.page?.data || [];
  const totalItems = itemsQuery.page?.pagination?.total || 0;
  const totalPages = itemsQuery.page?.pagination?.total_pages || 1;
  const [actionLoading, setActionLoading] = useState(false);   // the screen's own actions (save / delete / toggle)
  const loading = itemsQuery.loading || actionLoading;
  const { refetch: refetchList } = itemsQuery;
  const fetchItems = useCallback(async () => { await refetchList(); }, [refetchList]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, statusFilter]);

  const filteredItems = useMemo(() => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter(item =>
      item.name.toLowerCase().includes(q) ||
      item.keyword.toLowerCase().includes(q)
    );
  }, [items, search]);

  const openCreate = () => {
    setEditing(undefined);
    setPrefill(undefined);
    setIsView(false);
    setIsFormOpen(true);
  };

  const openEdit = (entry: AutoReplyEntry) => {
    setEditing(entry);
    setPrefill(undefined);
    setIsView(false);
    setIsFormOpen(true);
  };

  const openView = (entry: AutoReplyEntry) => {
    setEditing(entry);
    setPrefill(undefined);
    setIsView(true);
    setIsFormOpen(true);
  };

  const openCopy = (entry: AutoReplyEntry) => {
    setEditing(undefined);
    setPrefill(entry);
    setIsView(false);
    setIsFormOpen(true);
  };

  const submitForm = async (data: AutoReplyFormData) => {
    try {
      if (editing) {
        await autoReplyService.updateAutoReply(editing.id, data);
        showAlert(t('auto_reply.alert_updated_title'), t('auto_reply.alert_updated_message'), 'success');
      } else {
        await autoReplyService.createAutoReply(data);
        showAlert(t('auto_reply.alert_created_title'), t('auto_reply.alert_created_message'), 'success');
      }
      await fetchItems();
    } catch (e: any) {
      console.error(e);
      showAlert(t('auto_reply.alert_save_failed_title'), e.message || t('auto_reply.alert_save_failed_message'), 'error');
      throw e;
    }
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    setActionLoading(true);
    try {
      await autoReplyService.deleteAutoReply(deleteId);
      showAlert(t('auto_reply.alert_deleted_title'), t('auto_reply.alert_deleted_message'), 'success');
      await fetchItems();
    } catch (e: any) {
      console.error(e);
      showAlert(t('auto_reply.alert_delete_failed_title'), e.message || t('auto_reply.alert_delete_failed_message'), 'error');
    } finally {
      setActionLoading(false);
      setDeleteId(null);
    }
  };

  const openToggleModal = (item: AutoReplyEntry) => {
    setToggleConfirm({ isOpen: true, item, nextActive: !item.active });
  };

  const confirmToggle = async () => {
    if (!toggleConfirm.item || toggleConfirm.nextActive === undefined) return;
    setIsToggleLoading(true);
    try {
      await autoReplyService.updateAutoReplyActive(toggleConfirm.item.id, toggleConfirm.nextActive);
      const message = toggleConfirm.nextActive
        ? t('auto_reply.toggle_enabled', { name: toggleConfirm.item.name })
        : t('auto_reply.toggle_disabled', { name: toggleConfirm.item.name });
      showAlert(t('auto_reply.alert_toggle_title'), message, 'success');
      await fetchItems();
    } catch (e: any) {
      console.error(e);
      showAlert(t('auto_reply.alert_toggle_failed_title'), e.message || t('auto_reply.alert_toggle_failed_message'), 'error');
    } finally {
      setIsToggleLoading(false);
      setToggleConfirm({ isOpen: false });
    }
  };

  const TogglePill = ({
    on,
    onClick,
    icon: Icon,
    colorOn,
    colorOff = 'bg-slate-200 border border-dark-600',
    knobOn = 'translate-x-7 text-emerald-600 bg-white/90',
    knobOff = 'translate-x-0 text-slate-700 bg-white/70',
    scale = 1
  }: {
    on: boolean;
    onClick: () => void;
    icon: React.ComponentType<{ size?: number }>;
    colorOn: string;
    colorOff?: string;
    knobOn?: string;
    knobOff?: string;
    scale?: number;
  }) => (
    <button
      onClick={onClick}
      className={`relative inline-flex items-center h-9 w-16 rounded-full transition-all duration-300 ${on ? colorOn : colorOff} shadow-lg hover:shadow-xl`}
      style={{ transform: `scale(${scale})` }}
    >
      <span
        className={`absolute left-1 top-1 h-7 w-7 rounded-full flex items-center justify-center transition-transform duration-300 ${on ? knobOn : knobOff}`}
      >
        <Icon size={16} />
      </span>
    </button>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 bg-dark-800 p-4 rounded-xl border border-dark-700 shadow-lg">
        <div>
          <h2 className="text-xl font-bold text-slate-900">{t('auto_reply.title')}</h2>
          <p className="text-sm text-slate-700">{t('auto_reply.subtitle')}</p>
        </div>

        <div className="flex flex-col lg:flex-row gap-3 w-full xl:w-auto">
          <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto">
            <div className="relative w-full sm:w-40">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Filter className="text-slate-700" size={16} />
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
                <Search className="text-slate-700 group-focus-within:text-primary-500 transition-colors" size={18} />
              </div>
              <input
                type="text"
                placeholder={t('auto_reply.search_placeholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10 w-full bg-dark-800 border border-dark-600 rounded-lg py-2 text-sm text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
              />
            </div>
          </div>

          <div className="flex gap-2 w-full sm:w-auto sm:ml-auto lg:ml-0">
            <button
              onClick={fetchItems}
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
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-dark-900 border-b border-dark-700">
                <th className="px-6 py-4 text-xs font-semibold text-slate-700 uppercase tracking-wider whitespace-nowrap">{t('auto_reply.header_name')}</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-700 uppercase tracking-wider whitespace-nowrap">{t('auto_reply.header_keyword')}</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-700 uppercase tracking-wider whitespace-nowrap">{t('auto_reply.header_match_type')}</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-700 uppercase tracking-wider whitespace-nowrap">{t('auto_reply.header_priority')}</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-700 uppercase tracking-wider whitespace-nowrap">{t('auto_reply.header_status')}</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-700 uppercase tracking-wider whitespace-nowrap">{t('auto_reply.header_updated_at')}</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-700 uppercase tracking-wider text-right whitespace-nowrap">{t('auto_reply.header_actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700">
              {!loading && filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-700">
                    {t('auto_reply.no_results')}
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => (
                  <tr key={item.id} className="transition-colors hover:bg-dark-700/50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm font-medium text-slate-900">{item.name}</span>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600">{item.keyword}</td>
                    <td className="px-6 py-4 text-xs text-slate-700 whitespace-nowrap">{t(`auto_reply.match_${item.match_type}`)}</td>
                    <td className="px-6 py-4 text-xs text-slate-700 whitespace-nowrap">{item.priority}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <TogglePill
                        on={item.active}
                        onClick={() => openToggleModal(item)}
                        icon={Power}
                        colorOn="bg-emerald-500 shadow-[0_10px_30px_rgba(16,185,129,0.35)]"
                        colorOff="bg-slate-200 border border-dark-600"
                        knobOn="translate-x-7 text-emerald-600 bg-white"
                        knobOff="translate-x-0 text-slate-700 bg-white/80"
                        scale={0.6}
                      />
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-700 whitespace-nowrap">
                      {item.updated_at
                        ? new Date(item.updated_at).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                        : '-'}
                    </td>
                    <td className="px-6 py-4 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openView(item)}
                          className="p-1.5 rounded-lg hover:bg-blue-500/20 text-slate-700 hover:text-blue-500 transition-colors"
                          title={t('common.view')}
                        >
                          <Eye size={16} />
                        </button>
                        <button
                          onClick={() => openEdit(item)}
                          className="p-1.5 rounded-lg hover:bg-primary-500/20 text-slate-700 hover:text-primary-500 transition-colors"
                          title={t('common.edit')}
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={() => openCopy(item)}
                          className="p-1.5 rounded-lg hover:bg-indigo-500/20 text-slate-700 hover:text-indigo-500 transition-colors"
                          title={t('auto_reply.copy_action')}
                        >
                          <Copy size={16} />
                        </button>
                        <button
                          onClick={() => setDeleteId(item.id)}
                          className="p-1.5 rounded-lg hover:bg-red-500/20 text-slate-700 hover:text-red-500 transition-colors"
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

        <div className="flex flex-col sm:flex-row justify-between items-center gap-4 px-6 py-4 border-t border-dark-700">
          <span className="text-sm text-slate-700">
            {t('common.showing_total', { count: totalItems })}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className="p-2 rounded-lg bg-dark-700 text-slate-700 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={18} />
            </button>
            <span className="text-sm text-slate-600">{currentPage} / {totalPages}</span>
            <button
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
              className="p-2 rounded-lg bg-dark-700 text-slate-700 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>

      <AutoReplyFormModal
        isOpen={isFormOpen}
        onClose={() => {
          setIsFormOpen(false);
          setEditing(undefined);
          setPrefill(undefined);
          setIsView(false);
        }}
        onSubmit={submitForm}
        initialData={prefill ?? editing}
        mode={isView ? 'view' : editing ? 'update' : 'create'}
      />

      <ConfirmModal
        isOpen={!!deleteId}
        title={t('auto_reply.delete_title')}
        message={t('auto_reply.delete_message')}
        onConfirm={confirmDelete}
        onClose={() => setDeleteId(null)}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
      />

      <ConfirmModal
        isOpen={toggleConfirm.isOpen}
        onClose={() => setToggleConfirm({ isOpen: false })}
        onConfirm={confirmToggle}
        title={t('auto_reply.toggle_title', {
          state: toggleConfirm.nextActive ? t('status.on') : t('status.off')
        })}
        message={toggleConfirm.item ? t('auto_reply.toggle_message', { name: toggleConfirm.item.name }) : ''}
        type="warning"
      />

      <AlertModal
        isOpen={alertState.isOpen}
        onClose={closeAlert}
        title={alertState.title}
        message={alertState.message}
        type={alertState.type}
      />

      {isToggleLoading && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-white/45 backdrop-blur transition-opacity">
          <div className="bg-dark-800 border border-dark-700 rounded-xl shadow-2xl w-full max-w-sm transform transition-all scale-100">
            <div className="flex items-center gap-3 p-6 border-b border-dark-700">
              <Loader2 className="animate-spin text-primary-400" size={20} />
              <h3 className="text-lg font-semibold text-slate-900">{t('auto_reply.updating_title')}</h3>
            </div>
            <div className="p-6 text-sm text-slate-600">
              {t('auto_reply.updating_message')}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
