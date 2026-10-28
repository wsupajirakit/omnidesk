import React, { useCallback, useEffect, useState } from 'react';
import { LogDateRangeFilter, defaultLogRange, type LogDateRange } from '../../components/common/LogDateRangeFilter';
import { webhookLogService } from '../../services/hook';
import { WebhookLogEntry } from '../../types';
import { Info, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { AlertModal } from '../../components/modals';
import { WebhookLogDetailModal } from '../../components/modals';
import { SearchableSelect } from '../../components/common';
import { useI18n } from '../../i18n';

export const WebhookLogs: React.FC = () => {
  const { t } = useI18n();
  const statusOptions: { value: string; label: string }[] = [
    { value: 'all', label: t('status.all_statuses') },
    { value: 'error', label: t('status.errors') },
    { value: 'success', label: t('status.success') },
    /* [FIX-20260815-SUPPRESSEDFILTER] `suppressed` is filterable now, because the
       backend can finally store it: omnidesk-api `40ac596` widened the enum to
       ["success","error","suppressed"] after Mongoose had been REJECTING — and
       silently dropping — every such row.

       WHAT IT MEANS: the bot chose a card and deliberately did not send it,
       because the payment tool had already answered the customer. Neither a
       success (nothing was sent) nor an error (nothing failed), which is why it
       carries its own badge below ([FIX-20260815-SUPPRESSEDBADGE]).

       WHY IT BELONGS HERE: those are the rows someone hunts for when a customer
       says "the bot said nothing". Until now the only way to reach them was "All
       Statuses" and reading the table by eye — visible, but unfindable.

       ⚠️ The rule this list follows is in [FEAT-20260729-ACTIONOPTS] below: an
       option is added only when a row can actually hold it. Adding a fourth
       status here means adding it to the BE enum FIRST, or the filter returns an
       empty table that reads as "no logs" instead of "impossible filter".
       `webhookLogsStatusFilter.ui.test.tsx` reads the BE enum and fails naming
       any status this list has missed. revert: delete this entry. */
    { value: 'suppressed', label: t('status.suppressed') },
    /* [FIX-20260828-SKIPSTATUS] `skipped` — OA ที่แผนตัดสินว่าไม่ต้องส่ง (เช่นไม่มี
       ผู้รับสักคน) · เดิมถูกบันทึกเป็น `error` ⇒ อ่านเป็น "ระบบพัง" ทั้งที่ไม่มีอะไรเสีย
       ⚠️ เพิ่มที่นี่ตามกฎที่เขียนไว้ข้างบน: enum ฝั่ง BE โตแล้ว ตัวกรองต้องโตตาม
          ไม่งั้นแถวเหล่านั้นจะหายจากทุกตัวกรองยกเว้น "ทุกสถานะ" */
    { value: 'skipped', label: t('status.skipped') }
    // [FEAT-20260729-ACTIONOPTS] 'pending' removed: no row can ever hold it —
    // it is not in the model's status enum. Picking it always returned an empty
    // table, which reads as "no logs" rather than "impossible filter".
    // revert: restore the pending entry.
  ];

  const channelOptions: { value: string; label: string }[] = [
    { value: 'all', label: t('common.all_channels') || 'All Channels' },
    { value: 'line_api', label: 'LINE API' },
    { value: 'telegram', label: 'Telegram' },
    { value: 'gemini', label: 'Gemini' },
    /* [FIX-20260816-WLOGVENDOR] BE now files each AI row under the vendor that
     * ANSWERED it, instead of writing 'gemini' for every hook. Without this
     * option a DeepSeek OA's rows are reachable only under "All Channels", and
     * the Gemini filter silently under-reports (it used to catch them by lying).
     * The pair is BE-decided: omnidesk-api owns the value written to
     * `webhook_logs.log_source`; this list only has to mirror it.
     * เพิ่มค่าให้ตรงกับที่ BE เขียนจริง ไม่งั้นกรองไม่เจอ
     * revert: delete this line (rows stay visible under All Channels). */
    { value: 'deepseek', label: 'DeepSeek' },
    // [FEAT-20260729-CLINKLOG] the customer-landing / 3rd-party calls.
    // Filtering by channel rather than action_type on purpose: the fetch rows
    // are named after the endpoint key (customer_link_fetch_<key>), which is
    // configured per tool and cannot be listed in a fixed dropdown. The channel
    // catches every row from this path — the form submit and the webhook
    // pre-fetch alike — in one click.
    { value: 'customer_link', label: t('webhook_logs.filter_channel_customer_link') },
    // ==== [FEAT-20260801-LOGSOURCE] แยก "ใครสั่งยิง" เป็นตัวเลือกในกล่องเดียวกัน
    // ผู้ใช้สั่งให้รวมมาที่ Channel ไม่ต้องมีกล่องแยก
    // ค่าเขียนเป็น "<channel>:<source>" แล้วแตกตอนยิง API (ดู fetchLogs)
    // source เก็บอยู่ใน request_meta.source ซึ่ง BE มี meta_key/meta_value ให้กรองอยู่แล้ว
    // → ไม่ต้องเพิ่มเส้น BE ใหม่เลย
    // revert: ลบ 2 บรรทัดนี้ + การแตกค่าใน fetchLogs
    { value: 'customer_link:manual_refresh', label: `　└ ${t('pageui.hook.logs.src_manual_refresh', 'แอดมินกด refresh')}` },
    { value: 'customer_link:webhook_prefetch', label: `　└ ${t('pageui.hook.logs.src_webhook_prefetch', 'ระบบดึงตอนลูกค้าทัก')}` },
    { value: 'other', label: 'Other' }
  ];

  const actionOptions: { value: string; label: string }[] = [
    { value: 'all', label: t('webhook_logs.filter_action_all') || 'All Actions / ทั้งหมด' },
    { value: 'incoming_line_webhook', label: 'Incoming LINE Webhook' },
    { value: 'handle_webhook', label: 'Handle Webhook' },
    { value: 'generate_response', label: 'Generate AI Response' },
    { value: 'line_reply', label: 'LINE Reply' },
    { value: 'line_push', label: 'LINE Push' },
    { value: 'send_broadcast', label: 'Send Broadcast' },
    { value: 'verify_bank_slip', label: 'Verify Bank Slip' },
    { value: 'slip_flex_reply', label: 'Slip Flex Reply' },
    { value: 'slip_error_flex_reply', label: 'Slip Error Flex Reply' },
    { value: 'auto_reply', label: 'Auto Reply' },
    { value: 'auto_reply_push', label: 'Auto Reply Push' },
    { value: 'fetch_document', label: 'Fetch Document' },
    { value: 'context_retrieval', label: 'Context Retrieval' },
    { value: 'send_assist_message', label: 'Send Assist Message' },
    { value: 'send_assist_photo', label: 'Send Assist Photo' },
    { value: 'image_answer_reply', label: 'Image Answer Reply' },
    { value: 'missing_profile_data_reply', label: 'Missing Profile Reply' },
    { value: 'api_missing_data_reply', label: 'API Missing Data Reply' },
    { value: 'get_profile', label: 'Get Profile' },
    { value: 'out_of_hours_reply', label: 'Out of Hours Reply' },
    { value: 'rate_limit_reply', label: 'Rate Limit Reply' },
    // ==== [FEAT-20260729-ACTIONOPTS] actions that exist in the data but were
    // missing from this list, so their rows could not be filtered at all.
    // Confirmed against a distinct() on the live collection rather than guessed:
    // custreg_send_link, custreg_already_linked and login were all present in
    // the database and absent here.
    //
    // customer_link_match is the form submit. The pre-fetch rows are named
    // customer_link_fetch_<endpoint key>, and that key is configured per tool,
    // so they cannot be enumerated here — use the "Customer Link" CHANNEL filter
    // to catch every row from that path at once.
    // revert: delete these six entries.
    { value: 'custreg_send_link', label: 'Customer Register — Send Link' },
    { value: 'custreg_already_linked', label: 'Customer Register — Already Linked' },
    { value: 'customer_link_match', label: 'Customer Link — Match' },
    { value: 'push_message', label: 'Push Message' },
    { value: 'dynamic_tag_calculation_error', label: 'Dynamic Tag Error' },
    // ==== [FEAT-20260731-TAGMISMATCH] START
    // Rows written by ragEngineService when the Training Document contains a
    // marker that has no row in the dynamic_tags table, so it was never replaced
    // and reached the customer raw (e.g. "[[odk_x_900063]]", a 6-digit typo of
    // the real 7-digit tag). raw_request.unknown_markers holds the names.
    // เลือกอันนี้เพื่อดูว่า marker ตัวไหนพิมพ์ผิด ของ OA ไหน
    // REVERT: delete this one entry (and the 2 i18n keys of the same name).
    { value: 'dynamic_tag_marker_mismatch', label: t('webhook_logs.filter_action_tag_mismatch') || 'Dynamic Tag — Unknown Marker' },
    // ==== [FEAT-20260731-TAGMISMATCH] END
    { value: 'login', label: 'Login (API Token)' }
  ];

  const [logs, setLogs] = useState<WebhookLogEntry[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  /*
   * [FEAT-20260809-DATERANGE] Defaults to today so the first paint is a cheap, bounded
   * query instead of paging through the whole collection.
   * revert: drop this state, the <LogDateRangeFilter/> below and the two params in
   * fetchLogs — the endpoint treats from/to as optional, so the list returns to unfiltered.
   */
  const [dateRange, setDateRange] = useState<LogDateRange>(defaultLogRange);
  const [limit, setLimit] = useState(20);
  const [pagination, setPagination] = useState({
    page: 1,
    limit,
    total: 0,
    total_pages: 1
  });
  const [loading, setLoading] = useState(false);
  const [alertState, setAlertState] = useState<{ isOpen: boolean; title: string; message: string; type: 'success' | 'error' }>({
    isOpen: false,
    title: '',
    message: '',
    type: 'error'
  });
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const isModalOpen = isDetailOpen || alertState.isOpen;

  const closeAlert = () => setAlertState(prev => ({ ...prev, isOpen: false }));

  // Caching is done on the BACK END (30s, scope-aware) — the FE just fetches.
  // `force` is kept so the refresh button can bust the server cache if needed.
  const fetchLogs = useCallback(async (_force = false) => {
    setLoading(true);
    try {
      // [FEAT-20260801-LOGSOURCE] ค่าในกล่อง Channel เป็นได้ 2 รูป:
      //   "customer_link"                  → กรองแค่ช่องทาง
      //   "customer_link:manual_refresh"   → ช่องทาง + ที่มา
      const [chanRaw, srcRaw] = String(channelFilter).split(':');
      const chanOnly = chanRaw === 'all' ? undefined : chanRaw;
      const srcOnly = srcRaw || '';
      const data = await webhookLogService.getLogsWithFilters({
        page,
        limit,
        status: statusFilter === 'all' ? undefined : statusFilter,
        channel: chanOnly,
        action_type: actionFilter === 'all' ? undefined : actionFilter,
        // [FEAT-20260801-LOGSOURCE] ไม่ได้เลือกตัวที่มี ":" = ไม่ส่งไปเลย → เหมือนเดิม
        meta_key: srcOnly ? 'source' : undefined,
        meta_value: srcOnly || undefined,
        // [FEAT-20260809-DATERANGE] Bare YYYY-MM-DD — the backend reads these as Bangkok
        // days and caps the span. Do NOT convert to ISO here (see LogDateRangeFilter).
        from: dateRange.from,
        to: dateRange.to
      });
      setLogs(data.data);
      setPagination(data.pagination);
    } catch (error: any) {
      setLogs([]);
      setAlertState({
        isOpen: true,
        title: t('webhook_logs.error_title'),
        message: error?.message || t('webhook_logs.error_message'),
        type: 'error'
      });
    } finally {
      setLoading(false);
    }
  }, [limit, page, statusFilter, channelFilter, actionFilter, dateRange, t]);

  // Fetch on mount + whenever params change. The old unconditional 20s polling
  // loop is gone (it hammered the endpoint) — use the manual refresh button.
  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  /* [FIX-20260815-SUPPRESSEDBADGE] `suppressed` fell through to the catch-all
     amber, whose `text-yellow-200` on a `bg-yellow-500/20` pill is unreadable on
     the light theme this page now uses — the owner could not make out the word
     at all. It gets its own amber pill with a dark enough foreground.

     WHAT `suppressed` MEANS: the bot CHOSE a card and deliberately did not send
     it, because the payment tool had already answered the customer
     (`slip-flex.handler.ts`, and the enum that finally accepts it,
     `[FIX-20260815-SUPPRESSEDENUM]`). It is neither a success (nothing was sent)
     nor an error (nothing failed), so it keeps a colour of its own rather than
     borrowing one of theirs.

     The remaining fall-through keeps the old amber for any status nobody has
     styled yet — but with a readable foreground, since that was the actual
     defect. revert: restore the single-line ternary. */
  const statusBadge = (status: string) => {
    const color =
      status === 'error'
        ? 'bg-red-600/30 text-red-200 border border-red-500/40'
        : status === 'success'
          ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/30'
          : status === 'suppressed'
            ? 'bg-amber-100 text-amber-800 border border-amber-300'
            /* [FIX-20260828-SKIPSTATUS] `skipped` มีสีของตัวเอง ไม่ตกลง fallback
               🔴 ส้ม: ไม่ใช่เขียว (ไม่ได้ส่งถึงใคร) และไม่ใช่แดง (ไม่มีอะไรพัง)
               ⚠️ ใช้โทนเดียวกับ `suppressed` เพราะเป็นครอบครัวเดียวกัน — "ไม่ได้ส่ง
                  และไม่ใช่ความผิดพลาด" · แยกจากกันด้วยคำ ไม่ใช่ด้วยสี */
            : status === 'skipped'
              ? 'bg-amber-100 text-amber-800 border border-amber-300'
              : 'bg-yellow-100 text-yellow-800 border border-yellow-400';
    const label =
      status === 'error' ? t('status.error') :
      status === 'success' ? t('status.success') :
      status === 'pending' ? t('status.pending') :
      status === 'suppressed' ? t('status.suppressed') :
      status === 'skipped' ? t('status.skipped') :
      status;
    return (
      <span className={`text-[11px] px-2 py-1 rounded-full font-semibold tracking-wide ${color}`}>
        {label}
      </span>
    );
  };

  const openDetail = (id: string) => {
    setSelectedLogId(id);
    setIsDetailOpen(true);
  };

  const closeDetail = () => {
    setIsDetailOpen(false);
    setSelectedLogId(null);
  };

  const totalPages = Math.max(1, pagination.total_pages || 1);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 bg-dark-800 border border-dark-700 rounded-xl px-4 py-4 shadow-lg shadow-black/20">
          <div>
            <p className="text-sm text-slate-500">{t('webhook_logs.title')}</p>
            <h3 className="text-xl font-semibold text-slate-900">{t('webhook_logs.subtitle')}</h3>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:gap-4">
            {/* [FEAT-20260806-SEARCHSELECT] searchable dropdowns */}
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">{t('status.status')}</span>
              {/* [FEAT-20260817-SELECTROWS] 15 rows then scroll, long labels wrap */}
              <SearchableSelect className="w-44" value={statusFilter} onChange={(v) => { setStatusFilter(v); setPage(1); }} options={statusOptions} maxRows={15} wrapLabel />
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Channel</span>
              <SearchableSelect className="w-44" value={channelFilter} onChange={(v) => { setChannelFilter(v); setPage(1); }} options={channelOptions} maxRows={15} wrapLabel />
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Action</span>
              <SearchableSelect className="w-52" value={actionFilter} onChange={(v) => { setActionFilter(v); setPage(1); }} options={actionOptions} maxRows={15} wrapLabel />
            </div>

            {/* [FEAT-20260809-DATERANGE] Defaults to today. Resets to page 1 because a new
                window makes the current page number meaningless. */}
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">{t('common.date') || 'วันที่'}</span>
              <LogDateRangeFilter
                value={dateRange}
                disabled={loading}
                onChange={(next) => { setDateRange(next); setPage(1); }}
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
                <th className="px-4 py-3 text-left text-xs font-semibold tracking-wider uppercase text-slate-500">{t('webhook_logs.header_alias')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold tracking-wider uppercase text-slate-500">{t('webhook_logs.header_channel')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold tracking-wider uppercase text-slate-500">Action Type</th>
                <th className="px-4 py-3 text-left text-xs font-semibold tracking-wider uppercase text-slate-500">{t('webhook_logs.header_created_at')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold tracking-wider uppercase text-slate-500">{t('webhook_logs.header_status')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold tracking-wider uppercase text-slate-500">{t('webhook_logs.header_action')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-800">
              {!loading && logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">
                    {t('webhook_logs.no_results')}
                  </td>
                </tr>
              ) : (
                logs.map(log => (
                  <tr key={log._id} className="hover:bg-dark-900/50 transition-colors">
                    <td className="px-4 py-3 text-sm text-slate-700">{log.hook_alias}</td>
                    {/* [FEAT-20260801-LOGSOURCE] บอกในตารางเลยว่าแถวนี้ใครสั่งยิง
                        เดิมเห็นแต่ "customer_link" เหมือนกันหมด แยกไม่ออกว่าอันไหน
                        มาจากปุ่ม refresh ของแอดมิน · ต้องไล่กรองทีละอันถึงจะรู้
                        ⚠️ แถวที่ไม่มี request_meta.source (log เก่า / ช่องทางอื่น)
                           แสดงเหมือนเดิมเป๊ะ ไม่มีอะไรงอกมา */}
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {log.channel}
                      {log.request_meta?.source === 'manual_refresh' && (
                        <span className="ml-1.5 text-[11px] font-bold text-amber-600">(manual)</span>
                      )}
                      {log.request_meta?.source === 'webhook_prefetch' && (
                        <span className="ml-1.5 text-[11px] text-slate-400">(webhook)</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      <span className="font-mono text-xs bg-dark-800 px-2 py-1 rounded border border-dark-600">
                        {log.action_type || '-'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {new Date(log.created_at).toLocaleString('th-TH', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit'
                      })}
                    </td>
                    <td className="px-4 py-3">{statusBadge(log.status)}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => openDetail(log._id)}
                        className="p-2 rounded-lg bg-dark-800 border border-dark-600 text-slate-600 hover:text-slate-900 hover:border-primary-500 transition-colors"
                        title={t('webhook_logs.view_detail')}
                      >
                        <Info size={16} />
                      </button>
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
              {t('common.showing_total', { count: pagination.total })}
            </span>
            <div className="h-4 w-px bg-dark-700 hidden sm:block" />
            <button
              onClick={() => fetchLogs(true)}
              disabled={loading}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-dark-600 text-xs font-bold text-slate-600 hover:text-slate-900 hover:bg-dark-700 transition-colors disabled:opacity-50"
              title={t('pageui.hook.logs.reload', 'โหลดใหม่')}
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> {t('pageui.hook.logs.reload', 'โหลดใหม่')}
            </button>
            <div className="h-4 w-px bg-dark-700 hidden sm:block" />
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-tighter">{t('common.per_page') || 'Per Page'}:</span>
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

      <WebhookLogDetailModal
        isOpen={isDetailOpen}
        logId={selectedLogId || undefined}
        onClose={closeDetail}
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
