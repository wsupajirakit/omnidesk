import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { 
  ChevronLeft, 
  ChevronRight, 
  Plus, 
  RefreshCw, 
  Search, 
  Trash2, 
  Edit2, 
  Download, 
  Eye, 
  ZoomIn, 
  FileJson, 
  Info,
  ChevronDown,
  ChevronUp,
  ArrowRight
} from 'lucide-react';
import { slipVerificationService } from '../../services/finance';
import { SlipVerificationEntry, Member } from '../../types';
import { ImageZoomModal } from '../../components/modals';
import { JsonModal } from '../../components/modals';
import { MemberProfileModal } from '../../components/chat';
import { ConfirmModal } from '../../components/modals';
import { AlertModal } from '../../components/modals';
import { useI18n } from '../../i18n';
import { API_BASE_URL } from '../../services/apiClient';
import { SlipDetailModal } from '../../components/slip';
// [FEAT-20260817-SELECTROWS] the shared searchable select (same one WebhookLogs uses)
import { SearchableSelect } from '../../components/common';
// [FEAT-20260817-SLIPDATERANGE] the same 3-day control webhook/audit already use
import {
  LogDateRangeFilter,
  defaultLogRange,
  type LogDateRange,
} from '../../components/common/LogDateRangeFilter';

export const SlipVerification: React.FC = () => {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [slips, setSlips] = useState<SlipVerificationEntry[]>([]);
  const [search, setSearch] = useState('');
  const [apiStatus, setApiStatus] = useState('');
  /* [FEAT-20260817-SELECTROWS] same three values the native <select> had, same order.
     `useMemo` because i18n labels change with the language, not on every render. */
  const statusOptions = useMemo(
    () => [
      { value: '', label: t('slip.filter_status_all') },
      { value: 'success', label: t('status.success') },
      { value: 'failed', label: t('status.failed') },
    ],
    [t],
  );
  /* [FEAT-20260817-SLIPDATERANGE] default = today only, capped at 3 days by the
     shared control AND by the backend. Filters `transaction_date` (the day the
     money moved) per the owner's decision, not the row's created_at. */
  const [dateRange, setDateRange] = useState<LogDateRange>(defaultLogRange());
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const itemsPerPage = 10;

  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedJson, setSelectedJson] = useState<any>(null);
  const [selectedUser, setSelectedUser] = useState<{ user: Member; externalData?: any } | null>(null);
  const [viewingRecord, setViewingRecord] = useState<SlipVerificationEntry | null>(null);
  const [selectedDetail, setSelectedDetail] = React.useState<{ status: string, detail: string, condition?: string } | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const isSlipNotFound = (slip: SlipVerificationEntry) => {
    const error = slip.callback_response?.['1']?.data?.debug?.body?.slip_check_raw_response?.error;
    return error?.code === 'SLIP_NOT_FOUND';
  };

  const toggleRow = (id: string) => {
    const next = new Set(expandedRows);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedRows(next);
  };

  const getBankLogo = (bankCode?: string) => {
    if (!bankCode) return null;
    let code = bankCode.toUpperCase().trim();
    
    // Map common variations
    const mapping: Record<string, string> = {
      'KBAN': 'KBANK',
      'KBNK': 'KBANK',
      'SCB': 'SCB',
      'BBL': 'BBL',
      'KTB': 'KTB',
      'BAY': 'BAY',
      'GSB': 'GSB',
      'GSBB': 'GSB'
    };

    if (mapping[code]) code = mapping[code];
    
    // Codes from the project's public/banks/ folder
    const validCodes = ['BAAC', 'BAY', 'BBL', 'CIMB', 'CITI', 'GHB', 'GSB', 'HSBC', 'IBANK', 'ICBC', 'KBANK', 'KKP', 'KTB', 'LHB', 'SCB', 'TCRB', 'TISCO', 'TTB', 'UOB', 'PROMPTPAY', 'TRUEMONEY'];
    if (validCodes.includes(code)) return `/assets/banks/${code}.png`;
    return null;
  };

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
    type: 'success'
  });

  const showAlert = (title: string, message: string, type: 'success' | 'error') => {
    setAlertState({ isOpen: true, title, message, type });
  };

  const fetchSlips = useCallback(async () => {
    setLoading(true);
    try {
      const res = await slipVerificationService.listSlips({
        page: currentPage,
        limit: itemsPerPage,
        search,
        api_status: apiStatus,
        sort: 'created_at:desc',
        start_date: dateRange.from,
        end_date: dateRange.to,
      });
      setSlips(res.data || []);
      setTotalItems(res.pagination?.total || 0);
      setTotalPages(res.pagination?.total_pages || 1);
    } catch (e: any) {
      console.error(e);
      showAlert(t('slip.alert_load_failed_title'), e.message || t('slip.alert_load_failed_message'), 'error');
    } finally {
      setLoading(false);
    }
  }, [currentPage, search, apiStatus, dateRange, t]);

  useEffect(() => {
    fetchSlips();
  }, [fetchSlips]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setCurrentPage(1);
    fetchSlips();
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    try {
      await slipVerificationService.deleteSlip(deleteId);
      showAlert(t('slip.alert_deleted_title'), t('slip.alert_deleted_message'), 'success');
      fetchSlips();
    } catch (e: any) {
      console.error(e);
      showAlert(t('slip.alert_delete_failed_title'), e.message || t('slip.alert_delete_failed_message'), 'error');
    } finally {
      setDeleteId(null);
    }
  };

  const formatDate = (dateString?: string, forcedDash: boolean = false) => {
    if (!dateString || forcedDash) return '-';
    try {
      const date = new Date(dateString).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });
      const time = new Date(dateString).toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
      return `${date} at ${time}`;
    } catch {
      return dateString;
    }
  };

  const StatusBadge = ({ status }: { status: string }) => {
    const color = status === 'success' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 
                  status === 'failed' ? 'bg-red-500/10 text-red-500 border-red-500/20' : 
                  'bg-amber-500/10 text-amber-500 border-amber-500/20';
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${color}`}>
        {status.toUpperCase()}
      </span>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 bg-dark-800 p-4 rounded-xl border border-dark-700 shadow-lg">
        <div>
          <h2 className="text-xl font-bold text-slate-900">{t('slip.title')}</h2>
          <p className="text-sm text-slate-500">{t('slip.subtitle')}</p>
        </div>

        <form onSubmit={handleSearch} className="flex flex-col lg:flex-row gap-3 w-full xl:w-auto">
          <div className="relative group w-full sm:w-72">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="text-slate-400 group-focus-within:text-primary-500 transition-colors" size={18} />
            </div>
            <input
              type="text"
              placeholder={t('slip.search_placeholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 w-full bg-dark-800 border border-dark-600 rounded-lg py-2 text-sm text-slate-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
            />
          </div>

          {/* [FEAT-20260817-SLIPDATERANGE] same control, same placement idea as
              WebhookLogs.tsx:254 — a new window makes the current page number
              meaningless, so it resets to 1 exactly like the other filters. */}
          <LogDateRangeFilter
            value={dateRange}
            disabled={loading}
            onChange={(next) => {
              setDateRange(next);
              setCurrentPage(1);
            }}
          />

          {/* [FEAT-20260817-SELECTROWS] native <select> → the shared searchable one,
              same values and same order. `maxRows`/`wrapLabel` are the opt-in props
              the owner asked for (15 rows then scroll, long labels wrap). */}
          <SearchableSelect
            className="w-full sm:w-44"
            value={apiStatus}
            onChange={(v) => {
              setApiStatus(v);
              setCurrentPage(1);
            }}
            options={statusOptions}
            placeholder={t('slip.filter_status_all')}
            maxRows={15}
            wrapLabel
          />

          <div className="flex gap-2 w-full sm:w-auto">
             <button
              type="submit"
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-dark-700 hover:bg-dark-600 text-slate-900 px-4 py-2 rounded-lg text-sm font-medium transition-colors border border-dark-600"
            >
              <RefreshCw size={18} />
              {t('common.refresh')}
            </button>
          </div>
        </form>
      </div>

      <div className="bg-dark-800 rounded-xl border border-dark-700 shadow-xl overflow-hidden relative">
        {loading && (
          <div className="absolute left-0 top-0 h-0.5 w-full bg-primary-500/80 animate-pulse" />
        )}
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-dark-900 border-b border-dark-700">
                <th className="px-4 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-center w-16">View</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Date / Time (Info)</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Account Info</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('slip.header_slip_image')}</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('slip.header_amount')}</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 tracking-wider">{t('pageui.content.slip_col_api_status', 'สถานะ API')}</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right pr-6">{t('common.response')}</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700">
              {!loading && slips.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-slate-500">
                    {t('slip.no_results')}
                  </td>
                </tr>
              ) : (
                slips.map((slip) => (
                  <React.Fragment key={slip.id}>
                  <tr className={`transition-colors hover:bg-dark-700/50 ${expandedRows.has(slip.id) ? 'bg-indigo-50/50' : ''}`}>
                    <td className="px-4 py-4 text-center whitespace-nowrap">
                       <button
                         onClick={() => setViewingRecord(slip)}
                         className="p-1.5 rounded-lg bg-primary-100 text-primary-600 hover:bg-primary-600 hover:text-white transition-all shadow-sm border border-primary-200"
                         title="View Details"
                       >
                         <Eye size={16} />
                       </button>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium text-slate-900">{formatDate(slip.transaction_date, isSlipNotFound(slip))}</span>
                        <span className="text-[11px] text-slate-600 font-bold">
                          [{t('pageui.content.slip_checked_at', 'ตรวจสอบเมื่อ')} {formatDate(slip.created_at)}]
                        </span>
                      </div>
                    </td>

                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-4">
                         <div className="relative group">
                            <button
                               onClick={() => setSelectedUser(slip.line_user ? { user: slip.line_user, externalData: slip.external_data } : null)}
                               className="p-1.5 rounded-full bg-primary-500 text-white shadow-md border-2 border-dark-800 hover:scale-110 transition-transform disabled:opacity-50 disabled:cursor-not-allowed z-10"
                               title={t('slip.view_profile')}
                               disabled={!slip.line_user}
                            >
                               <Info size={14} />
                            </button>
                         </div>
                         <div className="flex flex-col gap-0.5">
                            <span className="text-sm font-bold text-slate-900">
                               {slip.external_data?.customer?.customer_name || '-'}
                            </span>
                            <span className="text-[11px] text-emerald-500 font-bold leading-none">
                               {slip.line_user?.display_name || '-'}
                            </span>
                         </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                       {slip.internal_content_id?.image_url ? (
                          <div 
                            className="relative w-12 h-16 rounded-lg border border-dark-600 overflow-hidden group cursor-zoom-in"
                            onClick={() => setSelectedImage(API_BASE_URL + slip.internal_content_id?.image_url)}
                          >
                             <img 
                               src={API_BASE_URL + slip.internal_content_id.image_url} 
                               alt="Slip Thumbnail" 
                               className="w-full h-full object-cover transition-transform group-hover:scale-110"
                             />
                             <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                <ZoomIn size={16} className="text-white" />
                             </div>
                          </div>
                       ) : (
                          <div className="w-12 h-16 rounded-lg bg-dark-900 border border-dark-700 dashed flex items-center justify-center text-[10px] text-slate-500 text-center px-1 font-medium">
                             No Image
                          </div>
                       )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-emerald-600 font-bold">
                      {slip.amount.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {(() => {
                        const body = slip.callback_response?.['1']?.data?.debug?.body || 
                                     slip.callback_response?.data?.debug?.body;
                        const detail = body?.detail;
                        const condition = body?.condition;
                        
                        const isOrange = detail?.toLowerCase().includes('duplicate') || 
                                         detail?.toLowerCase().includes('out_of_time') || 
                                         detail?.toLowerCase().includes('not_match_min');
                        const borderClass = isOrange 
                          ? 'bg-orange-50 text-orange-700 border-orange-200 shadow-sm' 
                          : slip.api_status === 'failed' 
                            ? 'bg-red-50 text-red-600 border-red-200' 
                            : 'bg-blue-50 text-blue-600 border-blue-200';

                        const handleDetailClick = () => {
                          setSelectedDetail({ 
                            status: slip.api_status, 
                            detail: detail || slip.api_status.toUpperCase(), 
                            condition: condition 
                          });
                        };

                        return (
                          <div className="flex flex-col items-start gap-1">
                            <button onClick={handleDetailClick}>
                              <StatusBadge status={slip.api_status} />
                            </button>
                            {detail && (
                              <button 
                                onClick={handleDetailClick}
                                className={`text-[9px] font-bold px-2 py-0.5 rounded-md border transition-all truncate max-w-[130px] shadow-sm hover:brightness-95 active:scale-95 ${borderClass}`}
                                title={detail}
                              >
                                {detail}
                              </button>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                      <td className="px-6 py-4 text-right pr-6 whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2.5">
                           {slip.callback_response && (
                              <button
                                onClick={() => setSelectedJson(slip.callback_response)}
                                className="p-1.5 rounded-lg bg-emerald-100/50 text-emerald-600 hover:bg-emerald-600 hover:text-white transition-all shadow-sm border border-emerald-200"
                                title={t('slip.view_callback_response')}
                              >
                                 <FileJson size={15} />
                              </button>
                           )}
                           {(slip.raw_content || slip.raw_response) && (
                              <button
                                onClick={() => setSelectedJson(slip.raw_content || slip.raw_response)}
                                className="p-1.5 rounded-lg bg-indigo-100/50 text-indigo-600 hover:bg-indigo-600 hover:text-white transition-all shadow-sm border border-indigo-200"
                                title={t('slip.view_raw_response')}
                              >
                                 <FileJson size={15} />
                              </button>
                           )}
                           <button
                              onClick={() => toggleRow(slip.id)}
                              className={`p-1.5 rounded-lg transition-all ${expandedRows.has(slip.id) ? 'bg-primary-500 text-white' : 'text-slate-400 hover:bg-slate-100'}`}
                           >
                              {expandedRows.has(slip.id) ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                           </button>
                        </div>
                     </td>
                  </tr>
                  {/* Expanded Content */}
                  {expandedRows.has(slip.id) && (
                    <tr className="bg-slate-50/50">
                      <td colSpan={9} className="px-10 py-8">
                         <div className="flex flex-col gap-8">
                            <div className="flex items-center justify-center gap-20">
                               {/* Sender */}
                               <div className="flex flex-col items-center gap-3">
                                  <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">{t('pageui.content.slip_sender', 'ผู้โอน')}</span>
                                  <div className="flex items-center gap-4 p-4 rounded-2xl bg-white border border-slate-200 shadow-sm group hover:border-primary-300 transition-colors">
                                     <div className="w-14 h-14 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center p-1 overflow-hidden">
                                        {getBankLogo(slip.sender_bank) ? (
                                           <img src={getBankLogo(slip.sender_bank)!} alt={slip.sender_bank} className="w-full h-full object-contain" />
                                        ) : (
                                           <span className="text-[10px] font-bold text-slate-400">{slip.sender_bank}</span>
                                        )}
                                     </div>
                                     <div className="flex flex-col">
                                        <span className="text-sm font-bold text-slate-800">{slip.sender_account_name || '-'}</span>
                                        <span className="text-xs font-mono text-slate-500">{slip.sender_account_no || '-'}</span>
                                     </div>
                                  </div>
                               </div>

                               {/* Arrow Container */}
                               <div className="flex-1 max-w-[200px] flex flex-col items-center gap-1.5 pt-6">
                                  <div className="w-full h-[2px] bg-indigo-200 relative">
                                     <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 border-t-2 border-r-2 border-indigo-300 rotate-45" />
                                     <div className="absolute inset-0 bg-repeat-x flex items-center justify-around">
                                        <div className="w-1 h-1 rounded-full bg-white" />
                                        <div className="w-1 h-1 rounded-full bg-white" />
                                        <div className="w-1 h-1 rounded-full bg-white" />
                                        <div className="w-1 h-1 rounded-full bg-white" />
                                     </div>
                                  </div>
                                  <ArrowRight size={16} className="text-indigo-300" />
                               </div>

                               {/* Receiver */}
                               <div className="flex flex-col items-center gap-3">
                                  <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">{t('pageui.content.slip_receiver', 'ผู้รับ')}</span>
                                  <div className="flex items-center gap-4 p-4 rounded-2xl bg-white border border-slate-200 shadow-sm group hover:border-emerald-300 transition-colors">
                                     <div className="w-14 h-14 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center p-1 overflow-hidden">
                                        {getBankLogo(slip.receiver_bank) ? (
                                           <img src={getBankLogo(slip.receiver_bank)!} alt={slip.receiver_bank} className="w-full h-full object-contain" />
                                        ) : (
                                           <span className="text-[10px] font-bold text-slate-400">{slip.receiver_bank}</span>
                                        )}
                                     </div>
                                     <div className="flex flex-col">
                                        <span className="text-sm font-bold text-slate-800">{slip.receiver_account_name || '-'}</span>
                                        <span className="text-xs font-mono text-slate-500">{slip.receiver_account_no || '-'}</span>
                                     </div>
                                  </div>
                               </div>
                            </div>

                            {/* Additional Info */}
                             <div className="flex items-center justify-between pt-6 border-t border-slate-200/60">
                                 <div className="flex items-center gap-6">
                                    <div className="flex items-center gap-2">
                                       <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-sm shadow-emerald-200" />
                                       <span className="text-xs font-bold text-emerald-600 uppercase tracking-widest">{t('slip.verified')}</span>
                                    </div>
                                    <div className="h-4 w-[1px] bg-slate-200" />
                                   <div className="flex items-center gap-3">
                                      {slip.callback_response && (
                                         <button
                                            onClick={() => setSelectedJson(slip.callback_response)}
                                            className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100 hover:bg-emerald-600 hover:text-white transition-all text-[10px] font-bold uppercase tracking-wider"
                                         >
                                            <FileJson size={12} />
                                            Callback JSON
                                         </button>
                                      )}
                                      {(slip.raw_content || slip.raw_response) && (
                                         <button
                                            onClick={() => setSelectedJson(slip.raw_content || slip.raw_response)}
                                            className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-100 hover:bg-indigo-600 hover:text-white transition-all text-[10px] font-bold uppercase tracking-wider"
                                         >
                                            <FileJson size={12} />
                                            Raw Response
                                         </button>
                                      )}
                                   </div>
                                </div>
                                 <div className="flex items-center gap-5">
                                    <div className="flex items-center gap-2">
                                       <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">{t('pageui.content.slip_date_on_slip', 'วันที่ในสลิป:')}</span>
                                       <span className="text-xs font-bold text-slate-700 bg-slate-100 px-3 py-1 rounded-lg border border-slate-200">{formatDate(slip.transaction_date, isSlipNotFound(slip))}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                       <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">{t('pageui.content.slip_check_date', 'วันที่ทำการตรวจสอบ:')}</span>
                                       <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-3 py-1 rounded-lg border border-indigo-100">{formatDate(slip.created_at)}</span>
                                    </div>
                                 </div>
                             </div>
                         </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col sm:flex-row justify-between items-center gap-4 px-6 py-4 border-t border-dark-700">
          <span className="text-sm text-slate-500">
            {t('common.showing_total', { count: totalItems })}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className="p-2 rounded-lg bg-dark-700 text-slate-400 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={18} />
            </button>
            <span className="text-sm text-slate-600">{currentPage} / {totalPages}</span>
            <button
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
              className="p-2 rounded-lg bg-dark-700 text-slate-400 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>

      <ImageZoomModal 
        isOpen={!!selectedImage}
        imageUrl={selectedImage || ''}
        onClose={() => setSelectedImage(null)}
      />

      <SlipDetailModal 
        isOpen={!!viewingRecord}
        slip={viewingRecord}
        onClose={() => setViewingRecord(null)}
        onPreviewJson={(data) => setSelectedJson(data)}
      />

      <JsonModal 
        isOpen={!!selectedJson} 
        data={selectedJson} 
        onClose={() => setSelectedJson(null)} 
        title={t('slip.raw_response_title')} 
      />

      <MemberProfileModal
        isOpen={!!selectedUser}
        user={selectedUser?.user || null}
        externalData={selectedUser?.externalData}
        onClose={() => setSelectedUser(null)}
      />
      <ConfirmModal
        isOpen={!!deleteId}
        title={t('slip.delete_title')}
        message={t('slip.delete_message')}
        onConfirm={confirmDelete}
        onClose={() => setDeleteId(null)}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
      />

      <AlertModal
        isOpen={alertState.isOpen}
        onClose={() => setAlertState(prev => ({ ...prev, isOpen: false }))}
        title={alertState.title}
        message={alertState.message}
        type={alertState.type}
      />

      {/* Detail Modal */}
      {selectedDetail && (
        <AlertModal
          isOpen={true}
          onClose={() => setSelectedDetail(null)}
          title={selectedDetail.status.toUpperCase()}
          message={`${selectedDetail.detail}${selectedDetail.condition ? '\n' + selectedDetail.condition : ''}`}
          type={(() => {
            const detailLower = selectedDetail.detail.toLowerCase();
            const isOrange = detailLower.includes('duplicate') || 
                             detailLower.includes('out_of_time') || 
                             detailLower.includes('not_match_min');
            if (isOrange) return 'warning';
            return selectedDetail.status === 'success' ? 'success' : 'error';
          })()}
        />
      )}
    </div>
  );
};
export default SlipVerification;
