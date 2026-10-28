import React, { useCallback, useState } from 'react';
import { objectCategoryService } from '../../services/media';
import { useObjectCategoriesPageQuery } from '../../services/media/queries';
// [FEAT-20260901-OBJSCOPECELL] Access column + row switch, shared with the album list.
import {
  ObjectRowStatusToggle,
  ObjectScopeCell,
  useScopeNames,
} from '../../components/object/scope';
import { ObjectCategory, ObjectCategoryFormData } from '../../types';
import { Plus, RefreshCw, Search, Trash2, Edit2, ChevronLeft, ChevronRight, Eye } from 'lucide-react';
import { ConfirmModal } from '../../components/modals';
import { AlertModal } from '../../components/modals';
import { ObjectCategoryFormModal } from '../../components/object';
import { useI18n } from '../../i18n';

export const ObjectCategoryList: React.FC = () => {
  const { t } = useI18n();
  // [FEAT-20260901-OBJSCOPECELL] One catalogue load per page, not per row.
  const { groupNames, hookNames } = useScopeNames();
  // [FEAT-20260901-OBJROWSTATUS] Which row's switch is mid-flight.
  const [statusPendingId, setStatusPendingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<ObjectCategory | undefined>(undefined);
  const [formMode, setFormMode] = useState<'create' | 'update' | 'view'>('create');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [alertState, setAlertState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: 'success' | 'error';
  }>({
    isOpen: false,
    title: '',
    message: '',
    type: 'success',
  });

  const showAlert = (title: string, message: string, type: 'success' | 'error') => {
    setAlertState({ isOpen: true, title, message, type });
  };

  const closeAlert = () => setAlertState(prev => ({ ...prev, isOpen: false }));

  /* ==== [FEAT-20261027-TANSTACK] the list read — shared contract ====================
   * services/query/usePageQuery.ts (`onFailure: 'keep'`, no poll): read on mount and on
   * every key change, loading on every read, a failed read alerts and KEEPS the rows.
   * Pinned by test/requests/contentLists.requests.test.tsx (passes on old and new code).
   * revert: restore this file from tag ckpt-after-tanstack-p4-demo-27102026. */
  const categoriesQuery = useObjectCategoriesPageQuery(
    { search: search.trim() || undefined },
    (e: any) => { console.error(e); showAlert(t('common.error_title'), e.message || t('object_category.alert_load_failed'), 'error'); },
  );
  const categories: ObjectCategory[] = categoriesQuery.page || [];
  const totalItems = categories.length;
  const totalPages = 1;
  const [actionLoading, setActionLoading] = useState(false);   // the screen's own actions
  const loading = categoriesQuery.loading || actionLoading;
  const { refetch: refetchCategories } = categoriesQuery;
  const fetchCategories = useCallback(async () => { await refetchCategories(); }, [refetchCategories]);

  const openCreate = () => {
    setEditing(undefined);
    setFormMode('create');
    setIsFormOpen(true);
  };

  const openEdit = (category: ObjectCategory) => {
    setEditing(category);
    setFormMode('update');
    setIsFormOpen(true);
  };

  const openView = (category: ObjectCategory) => {
    setEditing(category);
    setFormMode('view');
    setIsFormOpen(true);
  };

  const submitForm = async (data: ObjectCategoryFormData) => {
    try {
      if (editing) {
        await objectCategoryService.updateCategory(editing.id, data);
        showAlert(t('status.success'), t('object_category.alert_updated'), 'success');
      } else {
        await objectCategoryService.createCategory(data);
        showAlert(t('status.success'), t('object_category.alert_created'), 'success');
      }
      setIsFormOpen(false);
      fetchCategories();
    } catch (e: any) {
      console.error(e);
      showAlert(t('common.error_title'), e.message || t('common.save_error'), 'error');
      throw e;
    }
  };

  /**
   * [FEAT-20260901-OBJROWSTATUS] Flip one row's switch.
   *
   * Goes through the ordinary update endpoint rather than a bespoke one, so the
   * backend writes the same audit row it writes for any other change — the
   * question "who turned this off, and when" has one answer in one place.
   *
   * Sends ONLY `status`. Replaying the whole row would let a stale list
   * overwrite a scope someone edited in another tab a second ago.
   *
   * The list is refetched rather than patched in place: the server is what
   * decides, and a local flip would lie if the write was rejected.
   */
  const toggleStatus = async (row: ObjectCategory, next: boolean) => {
    setStatusPendingId(row.id);
    try {
      await objectCategoryService.updateCategory(row.id, {
        status: next,
      } as ObjectCategoryFormData);
      await fetchCategories();
    } catch (e: any) {
      console.error(e);
      showAlert(t('common.error_title'), e.message || t('common.save_error'), 'error');
    } finally {
      setStatusPendingId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    setActionLoading(true);
    try {
      await objectCategoryService.deleteCategory(deleteId);
      showAlert(t('status.success'), t('object_category.alert_deleted'), 'success');
      fetchCategories();
    } catch (e: any) {
      console.error(e);
      showAlert(t('common.error_title'), e.message || t('common.error_message'), 'error');
    } finally {
      setActionLoading(false);
      setDeleteId(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-slate-900">{t('object_category.title')}</h2>
          <p className="text-sm text-slate-500">{t('object_category.subtitle')}</p>
        </div>

        <div className="flex flex-col lg:flex-row gap-3 w-full xl:w-auto">
          <div className="relative group w-full lg:w-72">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="text-slate-400 group-focus-within:text-primary-500 transition-colors" size={18} />
            </div>
            <input
              type="text"
              placeholder={t('common.search_placeholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 w-full bg-slate-50 border border-slate-200 rounded-lg py-2 text-sm text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
            />
          </div>

          <div className="flex gap-2 w-full sm:w-auto">
            <button
              onClick={fetchCategories}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              <RefreshCw className={loading ? 'animate-spin' : ''} size={18} />
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

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden relative">
        {loading && (
          <div className="absolute left-0 top-0 h-0.5 w-full bg-primary-500/80 animate-pulse" />
        )}
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('object_category.header_name')}</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('object_scope.column')}</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('object_scope.status_label')}</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('object_category.header_created_at')}</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">{t('object_category.header_actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-slate-700">
              {!loading && categories.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-500">
                    {t('object_category.no_results')}
                  </td>
                </tr>
              ) : (
                  categories.map((c) => (
                  <tr key={c.id} className="transition-colors hover:bg-slate-50">
                    <td className="px-6 py-4 font-medium">{c.name}</td>
                    <td className="px-6 py-4">
                      <ObjectScopeCell
                        groupIds={(c.group_providers as unknown[]) || []}
                        hookIds={c.hook_ids || []}
                        groupNames={groupNames}
                        hookNames={hookNames}
                        rowName={c.name}
                      />
                    </td>
                    <td className="px-6 py-4">
                      <ObjectRowStatusToggle
                        value={c.status}
                        name={c.name}
                        pending={statusPendingId === c.id}
                        onConfirm={(next) => toggleStatus(c, next)}
                      />
                    </td>
                    <td className="px-6 py-4 text-sm">
                      {c.created_at ? new Date(c.created_at).toLocaleString() : '-'}
                    </td>
                    <td className="px-6 py-4 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openView(c)}
                          className="p-1.5 rounded-lg hover:bg-slate-500/10 text-slate-400 hover:text-slate-600 transition-colors"
                          title={t('common.view')}
                        >
                          <Eye size={16} />
                        </button>
                        <button
                          onClick={() => openEdit(c)}
                          className="p-1.5 rounded-lg hover:bg-primary-500/10 text-slate-400 hover:text-primary-600 transition-colors"
                          title={t('common.edit')}
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={() => setDeleteId(c.id)}
                          className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-400 hover:text-red-600 transition-colors"
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

        <div className="px-6 py-4 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4">
          <span className="text-sm text-slate-500">
            {t('common.showing_total', { count: totalItems })}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              className="p-2 rounded-lg border border-slate-200 text-slate-400 hover:text-slate-900 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            <div className="px-4 py-2 text-sm font-medium text-slate-700">
              {currentPage} / {totalPages}
            </div>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              className="p-2 rounded-lg border border-slate-200 text-slate-400 hover:text-slate-900 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      <ObjectCategoryFormModal
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        onSubmit={submitForm}
        initialData={editing}
        mode={formMode}
      />

      <ConfirmModal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={confirmDelete}
        title={t('object_category.delete_title')}
        message={t('object_category.delete_message')}
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
