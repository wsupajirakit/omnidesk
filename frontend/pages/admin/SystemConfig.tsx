import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { configService } from '../../services/admin';
import { useConfigsPageQuery } from '../../services/admin/queries';
import { SystemConfigEntry, SystemConfigFormData } from '../../types';
import { Plus, RefreshCw, Trash2, Edit2, ChevronLeft, ChevronRight, Globe, Share2, Layers, Settings, ListFilter, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { ConfirmModal } from '../../components/modals';
import { AlertModal } from '../../components/modals';
import { ConfigFormModal } from '../../components/admin';
import { ConnectionTestModal } from '../../components/hook';
import { useI18n } from '../../i18n';
import { getStoredAuth } from '../../services/authStorage';

export const SystemConfig: React.FC = () => {
  const { t } = useI18n();

  const auth = getStoredAuth();

  const [activeTab, setActiveTab] = useState<'web' | 'config'>('web');
  const [revealedKeys, setRevealedKeys] = useState<Record<string, boolean>>({});

  const [currentPage, setCurrentPage] = useState(1);
  const [limit, setLimit] = useState(20);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<SystemConfigEntry | undefined>(undefined);

  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);

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
  const isModalOpen = isFormOpen || !!deleteId || alertState.isOpen || isTestModalOpen;

  const showAlert = (title: string, message: string, type: 'success' | 'error') => {
    setAlertState({ isOpen: true, title, message, type });
  };

  const closeAlert = () => setAlertState(prev => ({ ...prev, isOpen: false }));

  const toggleReveal = (id: string) => {
    setRevealedKeys(prev => ({ ...prev, [id]: !prev[id] }));
  };

  /* ==== [FEAT-20261027-TANSTACK] list + 20s visible-tab poll — the shared contract ====
   * services/query/usePageQuery.ts (`poll`, `onFailure: clear`) owns what this screen hand-wrote here
   * ([FIX-20260809-POLLVIS]): poll only while the tab is visible, read again the moment
   * it shows, both paused while a modal is open, loading on every read, rows cleared on
   * a failed read. Pinned by test/requests/adminPollers.requests.test.tsx.
   * revert: restore this file from tag ckpt-after-tanstack-p1-demo-27102026. */
  const configsQuery = useConfigsPageQuery(
    { page: currentPage, limit: limit, type: activeTab, flag: activeTab === 'config' ? '2,3' : '1' },
    { paused: isModalOpen, onError: (e: any) => { console.error(e); showAlert(t('system_config.alert_load_failed_title'), e.message || t('system_config.alert_load_failed_message'), 'error'); } },
  );
  const configs: SystemConfigEntry[] = configsQuery.page?.data || [];
  const totalItems = configsQuery.page?.pagination?.total || 0;
  const totalPages = configsQuery.page?.pagination?.total_pages || 1;
  const [actionLoading, setActionLoading] = useState(false);   // the screen's own actions (save / delete / toggle)
  const loading = configsQuery.loading || actionLoading;
  const { refetch: refetchList } = configsQuery;
  const fetchConfigs = useCallback(async () => { await refetchList(); }, [refetchList]);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, limit]);

  const userRole = auth?.role?.name || '';
  const isAuthorizedToTest = userRole === 'superadmin' || userRole === 'superuser' || userRole === 'admin';

  const testCreds = useMemo(() => {
    const baseUrl = configs.find(c => c.key === 'EXTERNAL_API_BASE_URL')?.value;
    const username = configs.find(c => c.key === 'EXTERNAL_API_USERNAME')?.value;
    const password = configs.find(c => c.key === 'EXTERNAL_API_PASSWORD')?.value;
    if (baseUrl && username && password) {
      // [FIX-20260801-HOOKTYPES] config.value ประกาศเป็น string | number | boolean
      // (ตารางเดียวเก็บค่าได้หลายชนิด) แต่ 3 ตัวนี้เป็นสตริงเสมอ — URL/ผู้ใช้/รหัสผ่าน
      // เส้น testExternalApi ก็รับสตริง · แปลงให้ชัดตรงนี้ที่เดียว ไม่ต้อง cast กระจาย
      return { baseUrl: String(baseUrl), username: String(username), password: String(password) };
    }
    return null;
  }, [configs]);

  const handleTestConnection = async () => {
    if (!testCreds) return;
    setTestLoading(true);
    try {
      const res = await configService.testExternalApi(testCreds);
      setTestResult(res);
      setIsTestModalOpen(true);
    } catch (e: any) {
      console.error(e);
      setTestResult({
        error: e.message || 'Failed to connect via proxy',
        details: e.rawResponse ? JSON.parse(e.rawResponse) : undefined
      });
      setIsTestModalOpen(true);
    } finally {
      setTestLoading(false);
    }
  };

  const openCreate = () => {
    setEditing(undefined);
    setIsFormOpen(true);
  };

  const openEdit = (entry: SystemConfigEntry) => {
    setEditing(entry);
    setIsFormOpen(true);
  };

  const submitForm = async (data: SystemConfigFormData) => {
    try {
      if (editing) {
        await configService.updateConfig(editing._id, { value: data.value, flag: data.flag, detail: data.detail });
        showAlert(t('system_config.alert_updated_title'), t('system_config.alert_updated_message'), 'success');
      } else {
        await configService.createConfig({ ...data, type: activeTab });
        showAlert(t('system_config.alert_created_title'), t('system_config.alert_created_message'), 'success');
      }
      await fetchConfigs();
    } catch (e: any) {
      console.error(e);
      showAlert(t('system_config.alert_save_failed_title'), e.message || t('system_config.alert_save_failed_message'), 'error');
      throw e;
    }
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    setActionLoading(true);
    try {
      await configService.deleteConfig(deleteId);
      showAlert(t('system_config.alert_deleted_title'), t('system_config.alert_deleted_message'), 'success');
      await fetchConfigs();
    } catch (e: any) {
      console.error(e);
      showAlert(t('system_config.alert_delete_failed_title'), e.message || t('system_config.alert_delete_failed_message'), 'error');
    } finally {
      setActionLoading(false);
      setDeleteId(null);
    }
  };

  const handleExecuteCustom = async (payload: any) => {
    return await configService.testCustomConfig(payload);
  };

  const FlagBadge = ({ flag }: { flag: number }) => (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
      flag === 1 ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-slate-500/10 text-slate-300 border-slate-500/20'
    }`}>
      {flag === 1 ? t('status.enabled') : t('status.disabled')}
    </span>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 bg-dark-800 p-4 rounded-xl border border-dark-700 shadow-lg">
        <div>
          <h2 className="text-xl font-bold text-slate-900">{t('system_config.title')}</h2>
          <p className="text-sm text-slate-500">{t('system_config.subtitle')}</p>
        </div>

        <div className="flex flex-col lg:flex-row items-start lg:items-center gap-4 w-full xl:w-auto">
          {/* Tab Selector */}
          <div className="flex bg-dark-900 p-1 rounded-xl border border-dark-600 w-full sm:w-auto shrink-0 shadow-inner">
            <button
              onClick={() => setActiveTab('web')}
              className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-2 rounded-lg text-sm font-bold transition-all ${
                activeTab === 'web'
                  ? 'bg-primary-600 text-white shadow-lg'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <Globe size={18} />
              Web Config
            </button>
            <button
              onClick={() => setActiveTab('config')}
              className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-2 rounded-lg text-sm font-bold transition-all ${
                activeTab === 'config'
                  ? 'bg-primary-600 text-white shadow-lg'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <Share2 size={18} />
              3rd Party Config
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            {isAuthorizedToTest && testCreds && (
              <button
                onClick={handleTestConnection}
                disabled={testLoading}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all shadow-lg shadow-blue-500/20"
              >
                {testLoading ? <RefreshCw size={18} className="animate-spin" /> : <ShieldCheck size={18} />}
                Test Credentials
              </button>
            )}

            <button
              onClick={fetchConfigs}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-dark-700 hover:bg-dark-600 text-slate-900 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
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
          <div className="absolute left-0 top-0 h-0.5 w-full bg-primary-500/80 animate-pulse z-10" />
        )}
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-dark-900 border-b border-dark-700">
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">
                   <div className="flex items-center gap-2">
                     <Layers size={14} className="text-primary-500" />
                     {t('system_config.header_key')}
                   </div>
                </th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">
                   <div className="flex items-center gap-2">
                     <Settings size={14} className="text-primary-500" />
                     {t('system_config.header_value')}
                   </div>
                </th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    <Eye size={14} className="text-primary-500" />
                    {t('system_config.header_flag')}
                  </div>
                </th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">{t('system_config.header_detail')}</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest text-right whitespace-nowrap">{t('system_config.header_actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700 bg-dark-800/40">
              {!loading && configs.filter(c => !c.key.startsWith('EXTERNAL_ENDPOINT_')).length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-20 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-16 h-16 rounded-full bg-dark-900 flex items-center justify-center text-slate-600">
                        <ListFilter size={32} strokeWidth={1.5} />
                      </div>
                      <p className="text-slate-500 font-medium">{t('system_config.no_results')}</p>
                    </div>
                  </td>
                </tr>
              ) : (
                configs
                  .filter((c) => !c.key.startsWith('EXTERNAL_ENDPOINT_'))
                  .map((c) => (
                  <tr key={c._id} className="transition-all hover:bg-dark-700/60 group">
                    <td className="px-6 py-5 whitespace-nowrap">
                      <span className="text-xs font-mono font-bold text-primary-400 bg-primary-500/5 px-2.5 py-1.5 rounded-lg border border-primary-500/20 group-hover:bg-primary-500/10 transition-colors">
                        {c.key}
                      </span>
                    </td>
                    <td className="px-6 py-5 text-sm text-slate-700 min-w-[300px] break-all">
                      <div className="flex items-center gap-2 p-2.5 rounded-lg bg-dark-900/50 border border-dark-600 font-medium group/val">
                        <span className="flex-1 font-mono">
                          {c.key === 'EXTERNAL_API_PASSWORD' && !revealedKeys[c._id] 
                            ? '••••••••••••••••' 
                            : c.value}
                        </span>
                        {c.key === 'EXTERNAL_API_PASSWORD' && (
                          <button 
                            type="button"
                            onClick={() => toggleReveal(c._id)}
                            className="p-1 hover:bg-dark-700 rounded transition-colors text-slate-500 hover:text-primary-500"
                            title={revealedKeys[c._id] ? t('change_password.hide') : t('change_password.show')}
                          >
                            {revealedKeys[c._id] ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-5 whitespace-nowrap">
                      <FlagBadge flag={c.flag} />
                    </td>
                    <td className="px-6 py-5 text-sm text-slate-600">
                      {c.detail || <span className="text-slate-500 italic">No description</span>}
                    </td>
                    <td className="px-6 py-5 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-2.5 opacity-60 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => openEdit(c)}
                          className="p-2 rounded-xl hover:bg-primary-500/20 text-slate-500 hover:text-primary-500 transition-all hover:scale-110 active:scale-90"
                          title={t('common.edit')}
                        >
                          <Edit2 size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="bg-dark-900/80 backdrop-blur-sm px-6 py-4 border-t border-dark-700 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-500">
              {t('common.showing_items', {
                from: totalItems > 0 ? (currentPage - 1) * limit + 1 : 0,
                to: Math.min(currentPage * limit, totalItems),
                total: totalItems
              })}
            </span>
            <div className="h-4 w-px bg-dark-600 hidden sm:block" />
            <div className="flex items-center gap-2">
              <label className="text-xs font-bold text-slate-600 uppercase tracking-tighter">{t('common.per_page')}:</label>
              <select
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                className="bg-dark-800 border border-dark-600 rounded-lg py-1 px-2 text-xs font-bold text-slate-900 focus:ring-1 focus:ring-primary-500 outline-none transition-all cursor-pointer"
              >
                {[10, 20, 50, 100].map(v => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage <= 1 || loading}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-dark-600 text-slate-500 hover:text-slate-900 hover:bg-dark-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all font-bold text-xs"
            >
              <ChevronLeft size={16} />
              {t('common.previous')}
            </button>
            <div className="flex items-center px-4 bg-dark-800 border border-dark-600 rounded-xl text-xs font-bold text-primary-500">
              {currentPage} / {totalPages}
            </div>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages || loading}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-dark-600 text-slate-500 hover:text-slate-900 hover:bg-dark-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all font-bold text-xs"
            >
              {t('common.next')}
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      <ConfigFormModal
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        onSubmit={submitForm}
        initialData={editing}
      />

      <ConnectionTestModal
        isOpen={isTestModalOpen}
        onClose={() => setIsTestModalOpen(false)}
        automatedData={testResult}
        onExecuteCustom={handleExecuteCustom}
        configBaseUrl={testCreds?.baseUrl}
      />

      <ConfirmModal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={confirmDelete}
        title={t('system_config.delete_title')}
        message={t('system_config.delete_message')}
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

export default SystemConfig;
