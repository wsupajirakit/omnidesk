import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { LogDateRangeFilter, defaultLogRange, type LogDateRange } from '../../components/common/LogDateRangeFilter';
import { useAuditLogsPageQuery } from '../../services/admin/queries';
import { webhookService, type HookLabel } from '../../services/hook';
import { AuditLog } from '../../types';
import { RefreshCw, Search, ChevronLeft, ChevronRight, Info, X } from 'lucide-react';
import { useI18n } from '../../i18n';
import { JsonViewModal } from '../../components/modals';
// [FEAT-20260817-SELECTROWS] the shared searchable select (same one WebhookLogs uses)
import { SearchableSelect } from '../../components/common';
import { Eye } from 'lucide-react';
import { auditDisplayValue, isSensitiveAuditField } from '../../utils/secretMask';

export const AuditLogs: React.FC = () => {
  const { t } = useI18n();
  /* [FEAT-20260817-HOOKLABELS] labels, not whole hooks. This page reads exactly
     three fields (`line_oa_name`, `company_name`, `alias` — see TruncatedHover
     below), and a full hook document is 105.7 KB: the old preload pulled 376.8 KB
     on every visit to render 81 bytes per row. โหลดแค่ป้าย ไม่ใช่ hook ทั้งก้อน. */
  const [hookInfoMap, setHookInfoMap] = useState<Map<string, HookLabel>>(new Map());
  const [infoModal, setInfoModal] = useState<{
    isOpen: boolean;
    refId?: string;
    hookInfo?: HookLabel;
  }>({
    isOpen: false,
  });
  const [jsonModal, setJsonModal] = useState<{
    isOpen: boolean;
    title: string;
    data: any;
  }>({
    isOpen: false,
    title: '',
    data: null,
  });
  const isModalOpen = infoModal.isOpen || jsonModal.isOpen;

  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState<string>('all');
  /* [FEAT-20260817-SELECTROWS] the six values the native <select> had, same order.
     Memoised on `t` so switching language relabels without rebuilding every render. */
  const actionOptions = useMemo(
    () => [
      { value: 'all', label: t('audit.action_filter_all') },
      { value: 'create', label: t('audit.action_create') },
      { value: 'update', label: t('audit.action_update') },
      /* [FEAT-20260901-AUDITFULLDIFF] `toggle_status` and `toggle_fast_mode`
         dropped from the FILTER only, by owner's call 01/09.
         ⚠️ THE ROWS STILL EXIST — `pages/hook/WebhookList.tsx` writes both
         actions when a switch in the hook table is flipped (note
         'datatable toggle'). Only the BACKEND writes neither; measuring one
         side and calling the value dead was wrong. Nothing else changes: the
         de-dupe pass further down still reads both actions, and clearing the
         filter still lists those rows. What is gone is the ability to narrow
         TO them from this dropdown. ยังมีแถวจริง แค่เลือกกรองเฉพาะมันไม่ได้แล้ว
         revert: restore these two lines — the i18n keys were left in place. */
      { value: 'delete', label: t('audit.action_delete') },
      // [FIX-20260818-AUDITCLONE] กรองหาเฉพาะการโคลนได้
      { value: 'clone', label: t('audit.action_clone') },
    ],
    [t],
  );
  /*
   * [FEAT-20260809-DATERANGE] Defaults to today — hook_audit_logs held 8,120 rows when this
   * was added, and the page previously listed them unbounded.
   * revert: drop this state, the <LogDateRangeFilter/> below and the two params in
   * fetchLogs; the endpoint treats from/to as optional so behaviour returns to unfiltered.
   */
  const [dateRange, setDateRange] = useState<LogDateRange>(defaultLogRange);

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  const TruncatedHover = ({ text, parts, hookInfo }: { text: string; parts: number; hookInfo?: HookLabel }) => {
    const keep = Math.max(8, Math.ceil(text.length / parts));
    const truncated = text.length > keep ? `${text.slice(0, keep)}...` : text;
    const showTooltip = text.length > keep || !!hookInfo;
    return (
      <span className="relative inline-block group align-middle">
        <span className="text-xs font-mono text-slate-600">{truncated}</span>
        {showTooltip && (
          <span className="pointer-events-none absolute left-0 top-full mt-2 z-50 w-[320px] rounded-lg border border-dark-600 bg-dark-900 px-3 py-2 text-xs text-slate-700 shadow-xl opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="font-mono text-[11px] text-slate-600 break-all">{text}</div>
            {hookInfo && (
              <div className="mt-2 flex flex-col gap-1 text-xs text-slate-700">
                <div>
                  <span className="text-slate-500">{t('audit.oa_label')}</span>{' '}
                  {hookInfo.line_oa_name || '-'}
                </div>
                <div>
                  <span className="text-slate-500">{t('audit.company_label')}</span>{' '}
                  {hookInfo.company_name || '-'}
                </div>
                <div>
                  <span className="text-slate-500">{t('audit.alias_label')}</span>{' '}
                  {hookInfo.alias || '-'}
                </div>
              </div>
            )}
          </span>
        )}
      </span>
    );
  };

  const openInfoModal = (refId: string, hookInfo?: HookLabel) => {
    setInfoModal({ isOpen: true, refId, hookInfo });
  };

  const closeInfoModal = () => {
    setInfoModal({ isOpen: false });
  };

  /* ==== [FEAT-20261027-TANSTACK] list + 20s visible-tab poll — the shared contract ====
   * services/query/usePageQuery.ts (`poll`, `onFailure: clear`) owns what this screen hand-wrote here
   * ([FIX-20260809-POLLVIS]): poll only while the tab is visible, read again the moment
   * it shows, both paused while a modal is open, loading on every read, rows cleared on
   * a failed read. Pinned by test/requests/adminPollers.requests.test.tsx.
   * revert: restore this file from tag ckpt-after-tanstack-p1-demo-27102026. */
  const logsQuery = useAuditLogsPageQuery(
    { page: currentPage, limit: itemsPerPage, action: actionFilter === 'all' ? undefined : actionFilter, from: dateRange.from, to: dateRange.to, sort: 'created_at:desc' },
    { paused: isModalOpen, onError: (error: unknown) => { console.error('Failed to load audit logs', error); } },
  );
  const logs: AuditLog[] = logsQuery.page?.data || [];
  const totalItems = logsQuery.page?.pagination?.total || 0;
  const totalPages = logsQuery.page?.pagination?.total_pages || 1;
  const [actionLoading, setActionLoading] = useState(false);   // the screen's own actions (save / delete / toggle)
  const loading = logsQuery.loading || actionLoading;
  const { refetch: refetchList } = logsQuery;
  const fetchLogs = useCallback(async () => { await refetchList(); }, [refetchList]);

  useEffect(() => {
    let isActive = true;
    webhookService
      .getHookLabels()
      .then((data) => {
        if (!isActive) return;
        const map = new Map<string, HookLabel>();
        data.forEach((hook) => {
          map.set(hook._id, hook);
        });
        setHookInfoMap(map);
      })
      .catch((error) => {
        console.warn('Failed to load hook info for audit hover', error);
      });
    return () => {
      isActive = false;
    };
  }, []);

  // [FEAT-20260809-DATERANGE] dateRange joins the existing reset list: a new window makes
  // the current page number meaningless, exactly as changing the action filter does.
  useEffect(() => {
    setCurrentPage(1);
  }, [search, actionFilter, dateRange]);

  const filteredLogs = useMemo(() => {
    const parseTime = (iso: string) => {
      const t = Date.parse(iso);
      return Number.isFinite(t) ? t : 0;
    };

    const getFields = (l: AuditLog) =>
      new Set((l.changed_fields || []).map(c => (c.field || '').toLowerCase()).filter(Boolean));

    // De-dupe common patterns when both backend + client write audit logs:
    // 1) Toggle:
    //    - backend writes `update` (field=status/fast_mode)
    //    - client writes `toggle_status` / `toggle_fast_mode`
    // 2) Form Update/Create:
    //    - backend writes `update` (often includes full payload)
    //    - client writes `update` with note "form update" (diff-only)
    //    - backend writes `create`
    //    - client writes `create` with note "form create"
    // Keep the client entries and hide redundant backend ones close in time.
    const WINDOW_MS = 3000;
    const hasCloseTime = (times: number[] | undefined, t: number) =>
      !!times?.some(x => Math.abs(x - t) <= WINDOW_MS);

    const getRefKey = (l: AuditLog) => l.ref_id || l.hook_id || '';

    const toggleTimesByKey = new Map<string, number[]>(); // key = `${ref_id}:${field}`
    const formUpdateTimesByRef = new Map<string, number[]>(); // ref_id -> [times]
    const formCreateTimesByRef = new Map<string, number[]>(); // ref_id -> [times]

    for (const l of logs) {
      const action = (l.action || '').toLowerCase();
      const createdAt = parseTime(l.created_at);
      const note = (l.note || '').toLowerCase();
      const refKey = getRefKey(l);

      if (action === 'toggle_status') {
        const key = `${refKey}:status`;
        toggleTimesByKey.set(key, [...(toggleTimesByKey.get(key) || []), createdAt]);
      }
      if (action === 'toggle_fast_mode') {
        const key = `${refKey}:fast_mode`;
        toggleTimesByKey.set(key, [...(toggleTimesByKey.get(key) || []), createdAt]);
      }
      if (action === 'update' && note.includes('form update')) {
        formUpdateTimesByRef.set(refKey, [...(formUpdateTimesByRef.get(refKey) || []), createdAt]);
      }
      if (action === 'create' && note.includes('form create')) {
        formCreateTimesByRef.set(refKey, [...(formCreateTimesByRef.get(refKey) || []), createdAt]);
      }
    }

    const deduped: AuditLog[] = [];
    for (const l of logs) {
      const action = (l.action || '').toLowerCase();
      const createdAt = parseTime(l.created_at);
      const fields = getFields(l);
      const note = (l.note || '').toLowerCase();
      const refKey = getRefKey(l);

      if (action === 'update') {
        // Hide redundant backend update when client form update exists nearby.
        if (!note.includes('form update') && hasCloseTime(formUpdateTimesByRef.get(refKey), createdAt)) {
          continue;
        }

        // Hide redundant backend update caused by toggle when toggle exists nearby.
        const fieldsArr = Array.from(fields);
        if (fieldsArr.length === 1 && (fieldsArr[0] === 'status' || fieldsArr[0] === 'fast_mode')) {
          const key = `${refKey}:${fieldsArr[0]}`;
          if (hasCloseTime(toggleTimesByKey.get(key), createdAt)) {
            continue;
          }
        }
      }

      if (action === 'create') {
        // Hide redundant backend create when client form create exists nearby.
        if (!note.includes('form create') && hasCloseTime(formCreateTimesByRef.get(refKey), createdAt)) {
          continue;
        }
      }

      deduped.push(l);
    }

    if (!search) return deduped;
    const query = search.toLowerCase();
    return deduped.filter(l => {
      const actor = `${l.actor?.username || ''} ${l.actor?.display_name || ''}`.toLowerCase();
      const note = (l.note || '').toLowerCase();
      const action = (l.action || '').toLowerCase();
      const refId = (l.ref_id || '').toLowerCase();
      const parent = (l.parent || '').toLowerCase();
      return actor.includes(query) || note.includes(query) || action.includes(query) || refId.includes(query) || parent.includes(query);
    });
  }, [logs, search]);

  const ActionBadge = ({ action }: { action: string }) => {
    const a = (action || '').toLowerCase();
    const cls =
      a.includes('delete') ? 'bg-red-500/10 text-red-400 border-red-500/20' :
      a.includes('create') ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
      a.includes('toggle') ? 'bg-primary-500/10 text-primary-400 border-primary-500/20' :
      'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';

    const label =
      a === 'create' ? t('audit.action_create') :
      a === 'update' ? t('audit.action_update') :
      a === 'toggle_status' ? t('audit.action_toggle_status') :
      a === 'toggle_fast_mode' ? t('audit.action_toggle_fast_mode') :
      a === 'delete' ? t('audit.action_delete') :
      /* [FIX-20260818-AUDITCLONE] แถว action=clone เพิ่งเริ่มบันทึกได้ (enum ฝั่ง BE ไม่มี
         ค่านี้ จึงตอบ 500 ทุกครั้ง) — ถ้าไม่ใส่ที่นี่ badge จะโชว์คำว่า "clone" ดิบ ๆ */
      a === 'clone' ? t('audit.action_clone') :
      action;

    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${cls}`}>
        {label}
      </span>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 bg-dark-800 p-4 rounded-xl border border-dark-700 shadow-lg">
        <div>
          <h2 className="text-xl font-bold text-slate-900">{t('audit.title')}</h2>
          <p className="text-sm text-slate-500">{t('audit.subtitle')}</p>
        </div>

        <div className="flex flex-col lg:flex-row gap-3 w-full xl:w-auto">
          <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto">
            {/* [FEAT-20260817-SELECTROWS] native <select> → shared searchable select.
                The absolute Filter glyph goes with it: this control owns its own
                chevron and search box, and an overlaid icon would sit on the label. */}
            <SearchableSelect
              className="w-full sm:w-48"
              value={actionFilter}
              onChange={setActionFilter}
              options={actionOptions}
              placeholder={t('audit.action_filter_all')}
              maxRows={15}
              wrapLabel
            />

            <div className="relative group w-full sm:w-72">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="text-slate-400 group-focus-within:text-primary-500 transition-colors" size={18} />
              </div>
              <input
                type="text"
                placeholder={t('audit.search_placeholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10 w-full bg-dark-800 border border-dark-600 rounded-lg py-2 text-sm text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
              />
            </div>

            {/* [FEAT-20260809-DATERANGE] Page resets to 1 via the effect above. */}
            <LogDateRangeFilter
              value={dateRange}
              disabled={loading}
              onChange={setDateRange}
              className="w-full sm:w-auto"
            />
          </div>

          <div className="flex gap-2 w-full sm:w-auto sm:ml-auto lg:ml-0">
            <button
              onClick={fetchLogs}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-500 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-lg shadow-primary-500/20 transition-all hover:scale-105 whitespace-nowrap"
            >
              <RefreshCw size={18} />
              {t('common.refresh')}
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
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{t('audit.header_date_time')}</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{t('audit.header_action')}</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{t('audit.header_parent')}</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{t('audit.header_ref_id')}</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{t('audit.header_actor')}</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{t('audit.header_changes')}</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{t('audit.header_note')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700">
              {!loading && filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                    {t('audit.no_results')}
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log._id} className="transition-colors hover:bg-dark-700/50">
                    <td className="px-6 py-4 text-xs text-slate-500 whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString('th-TH', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <ActionBadge action={log.action} />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-xs text-slate-600">
                        {log.parent || '-'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-xs font-mono text-slate-600 bg-dark-900 px-2 py-1 rounded border border-dark-600">
                        {log.ref_id || log.hook_id ? (
                          <TruncatedHover
                            text={log.ref_id || log.hook_id || ''}
                            parts={3}
                            hookInfo={hookInfoMap.get(log.ref_id || log.hook_id || '')}
                          />
                        ) : '-'}
                      </span>
                      {log.ref_id || log.hook_id ? (
                        <button
                          onClick={() => openInfoModal(log.ref_id || log.hook_id || '', hookInfoMap.get(log.ref_id || log.hook_id || ''))}
                          className="ml-2 inline-flex items-center justify-center p-1 rounded-md bg-dark-700 text-slate-600 hover:text-slate-900 hover:bg-dark-600 transition-colors"
                          title={t('audit.view_hook_info')}
                        >
                          <Info size={12} />
                        </button>
                      ) : null}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-slate-900">{log.actor?.display_name || log.actor?.username || '-'}</span>
                        <span className="text-xs text-slate-500">{log.actor?.username ? `@${log.actor.username}` : ''}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600">
                      {log.changed_fields && log.changed_fields.length > 0 ? (
                        <div className="flex flex-col gap-1">
                          {log.changed_fields.slice(0, 3).map((c, idx) => {
                            const isJsonObject = typeof c.to === 'object' && c.to !== null;
                            const isJsonString = typeof c.to === 'string' && (c.to.trim().startsWith('{') || c.to.trim().startsWith('['));
                            const showJsonBtn = isJsonObject || isJsonString;

                            return (
                              <div key={idx} className="text-xs flex items-center gap-2">
                                <span className="text-slate-500 shrink-0">{c.field}:</span>
                                {showJsonBtn ? (
                                  <button
                                    onClick={() => setJsonModal({
                                      isOpen: true,
                                      title: `${t('audit.header_changes')}: ${c.field}`,
                                      /* a credential never reaches the viewer either */
                                      data: isSensitiveAuditField(c.field)
                                        ? auditDisplayValue(c.field, c.to)
                                        : (isJsonObject ? c.to : JSON.parse(c.to)),
                                    })}
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary-500/10 text-primary-600 hover:bg-primary-500/20 transition-all text-[10px] font-bold"
                                  >
                                    <Eye size={10} />
                                    {t('common.view')} JSON
                                  </button>
                                ) : (
                                  /* [FEAT-20260901-AUDITFULLDIFF] show BOTH sides.
                                     `from` was carried by the API and thrown away
                                     here, so a row said what a value became but
                                     never what it had been — the one question an
                                     audit trail is read for. A credential field is
                                     masked on sight: old rows can still hold a raw
                                     value, and this page renders history.
                                     ค่าลับไม่พิมพ์ออกจอ · เห็นทั้งก่อนและหลัง
                                     revert: render `String(c.to)` alone. */
                                  <span className="text-slate-700 truncate max-w-[220px]">
                                    {c.from !== undefined && c.from !== null && String(c.from) !== '' && (
                                      <span className="text-slate-400">
                                        {String(auditDisplayValue(c.field, c.from))}
                                        {' \u2192 '}
                                      </span>
                                    )}
                                    {String(auditDisplayValue(c.field, c.to))}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                          {log.changed_fields.length > 3 && (
                            /* [FEAT-20260901-AUDITFULLDIFF] this used to be plain
                               text, so the rows past the third could not be read
                               at all — the page silently hid part of the record
                               it exists to show. It opens the same JSON viewer
                               the object values already use, with EVERY field and
                               both sides of the change. ของที่เกินสามแถวเดิมดูไม่ได้เลย
                               revert: return this to a <div> with the same label. */
                            <button
                              onClick={() => setJsonModal({
                                isOpen: true,
                                title: `${t('audit.header_changes')} (${log.changed_fields!.length})`,
                                data: log.changed_fields!.map(c => ({
                                  field: c.field,
                                  from: auditDisplayValue(c.field, c.from),
                                  to: auditDisplayValue(c.field, c.to),
                                })),
                              })}
                              className="text-xs text-primary-600 hover:underline text-left"
                            >
                              {t('audit.changed_more', { count: log.changed_fields.length - 3 })}
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-500">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600">
                      {log.note || <span className="text-slate-500">-</span>}
                    </td>
                  </tr>
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
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-2 rounded-lg bg-dark-700 text-slate-400 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={18} />
            </button>
            <span className="text-sm text-slate-600 px-2 font-medium">{currentPage} / {totalPages}</span>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="p-2 rounded-lg bg-dark-700 text-slate-400 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>

      {infoModal.isOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-white/45 backdrop-blur transition-opacity">
          <div className="bg-dark-800 border border-dark-700 rounded-xl shadow-2xl w-full max-w-sm transform transition-all scale-100">
            <div className="flex justify-between items-center p-4 border-b border-dark-700">
              <h3 className="text-xl font-semibold text-slate-900 flex items-center gap-2">
                <Info size={18} className="text-primary-400" />
                {t('audit.ref_info_title')}
              </h3>
              <button onClick={closeInfoModal} className="text-slate-500 hover:text-slate-900 transition-colors">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 flex flex-col gap-3 text-sm text-slate-700">
              <div>
                <span className="text-slate-500">{t('audit.ref_id_label')}</span>{' '}
                <span className="font-mono text-xs break-all">{infoModal.refId || '-'}</span>
              </div>
              <div>
                <span className="text-slate-500">{t('audit.oa_label')}</span>{' '}
                {infoModal.hookInfo?.line_oa_name || '-'}
              </div>
              <div>
                <span className="text-slate-500">{t('audit.company_label')}</span>{' '}
                {infoModal.hookInfo?.company_name || '-'}
              </div>
              <div>
                <span className="text-slate-500">{t('audit.alias_label')}</span>{' '}
                {infoModal.hookInfo?.alias || '-'}
              </div>
            </div>
            <div className="flex justify-end p-4 border-t border-dark-700 bg-dark-900/50 rounded-b-xl">
              <button
                onClick={closeInfoModal}
                className="px-6 py-2 rounded-lg text-sm font-medium text-white shadow-lg transition-all transform hover:scale-105 bg-primary-600 hover:bg-primary-500"
              >
                {t('common.ok')}
              </button>
            </div>
          </div>
        </div>
      )}

      <JsonViewModal
        isOpen={jsonModal.isOpen}
        onClose={() => setJsonModal(prev => ({ ...prev, isOpen: false }))}
        title={jsonModal.title}
        data={jsonModal.data}
      />
    </div>
  );
};
