/**
 * ==== [FEAT-20260806-HISTORY] Handoff History — standalone page ====
 *
 * One-stop audit log for handoff, 3 levels. Datatable (same look as Webhook Logs) whose rows
 * expand: RUN row → its raw_transaction + STEP list → each STEP → REQUEST/RESULT.
 * RUN carries everything high-level: member (name/phone), slip, raw_transaction, status, needs_review.
 * Gated by `handoff.history` (or `handoff.manage`); superadmin bypasses via permAllows.
 *
 * revert: delete this file + its route in App.tsx + the menu item + the handoff.history perm rows.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { LogDateRangeFilter, defaultLogRange, type LogDateRange } from '../../components/common/LogDateRangeFilter';
import {
  RefreshCw, Loader2, ChevronDown, ChevronRight, ChevronLeft, History, AlertTriangle, Search, User, Phone, FileJson, X, Copy, Check, IdCard, Hash,
} from 'lucide-react';
import { handoffService, HandoffChainRun } from '../../services/chat';
import { SearchableSelect } from '../../components/common';
import { useI18n } from '../../i18n';
import { hasMultiplePasses, passNumber } from '../../utils/handoffPasses';
import { copyText } from '../../utils/copyText';

const STATUS_BADGE: Record<string, string> = {
  running: 'bg-blue-100 text-blue-700',
  succeeded: 'bg-emerald-100 text-emerald-700',
  replied: 'bg-emerald-100 text-emerald-700',
  stopped: 'bg-slate-100 text-slate-600',
  locked_review: 'bg-amber-100 text-amber-700',
  failed: 'bg-red-100 text-red-700',
};
const STATUSES = ['', 'running', 'succeeded', 'replied', 'stopped', 'locked_review', 'failed'];
const outcomeColor = (o?: string) =>
  o === 'TRUE' ? 'bg-emerald-100 text-emerald-700' : o === 'TIMEOUT' ? 'bg-amber-100 text-amber-700' : o ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500';
const fmt = (d?: string) => d ? new Date(d).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-';

// small copy-to-clipboard button with a transient check.
const CopyBtn: React.FC<{ text: string; title?: string }> = ({ text, title }) => {
  const { t } = useI18n();
  const [ok, setOk] = useState(false);
  if (!text) return null;
  return (
    <button type="button" title={title || t('pageui.handoff.copy', 'คัดลอก')}
      /* [FIX-20260830-COPYHTTP2] the tick follows the real copy — see utils/copyText */
      onClick={(e) => {
        e.stopPropagation();
        void copyText(text).then((ok) => {
          if (!ok) return;
          setOk(true);
          setTimeout(() => setOk(false), 1200);
        });
      }}
      className="shrink-0 p-1 rounded hover:bg-slate-200/70 text-slate-400 hover:text-slate-700 transition-colors">
      {ok ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
    </button>
  );
};

// one row in the profile card: icon + label + value + copy.
const ProfileRow: React.FC<{ icon: React.ReactNode; label: string; value?: string; mono?: boolean }> = ({ icon, label, value, mono }) => {
  if (!value) return null;
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="text-slate-400 shrink-0">{icon}</span>
      <span className="text-slate-400 shrink-0 w-16">{label}</span>
      <span className={`text-slate-700 truncate flex-1 ${mono ? 'font-mono' : 'font-medium'}`}>{value}</span>
      <CopyBtn text={value} title={`copy ${label}`} />
    </div>
  );
};

const JsonBlock: React.FC<{ label: string; value: any; max?: string }> = ({ label, value, max = 'max-h-40' }) => (
  <div>
    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{label}</div>
    <pre className={`mt-0.5 bg-dark-800 border border-dark-600 rounded p-1.5 overflow-auto ${max} text-[11px] whitespace-pre-wrap break-all text-slate-700`}>
      {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
    </pre>
  </div>
);

export default function HandoffHistory() {
  const { t } = useI18n();
  const [runs, setRuns] = useState<HandoffChainRun[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [onlyReview, setOnlyReview] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [chainFilter, setChainFilter] = useState('');
  const [page, setPage] = useState(1);
  /*
   * [FEAT-20260809-DATERANGE] Defaults to today, matching the other two log pages.
   * handoff_chain_runs is small today, but it grows one row per payment run, so the bound
   * is applied now rather than after it becomes a problem.
   * revert: drop this state, the <LogDateRangeFilter/> below and the two params in load().
   */
  const [dateRange, setDateRange] = useState<LogDateRange>(defaultLogRange);
  const [limit, setLimit] = useState(20);

  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, { run: HandoffChainRun; steps: any[]; slip?: any } | 'loading'>>({});
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const [rawTxOpen, setRawTxOpen] = useState<string | null>(null);
  const [slipOpen, setSlipOpen] = useState<string | null>(null);
  const [stmtOpen, setStmtOpen] = useState<string | null>(null);
  // [FEAT-20260806-RAWMODAL] raw JSON preview modal — sections per level (RUN + each STEP)
  const [rawModal, setRawModal] = useState<{ title: string; sections: { label: string; data: any }[] } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await handoffService.listChainRuns({
        needs_review: onlyReview, search: search.trim() || undefined,
        status: statusFilter || undefined, chain_key: chainFilter.trim() || undefined, page, limit,
        // [FEAT-20260809-DATERANGE] Bare YYYY-MM-DD — backend reads them as Bangkok days.
        from: dateRange.from, to: dateRange.to,
      });
      setRuns(r.data); setTotal(r.total);
    } finally { setLoading(false); }
  }, [onlyReview, search, statusFilter, chainFilter, page, limit, dateRange]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const toggleRun = async (id: string) => {
    if (expandedRun === id) { setExpandedRun(null); return; }
    setExpandedRun(id); setExpandedStep(null);
    if (!details[id]) {
      setDetails(prev => ({ ...prev, [id]: 'loading' }));
      try { const d = await handoffService.getChainRun(id); setDetails(prev => ({ ...prev, [id]: d })); }
      catch { setDetails(prev => { const n = { ...prev }; delete n[id]; return n; }); }
    }
  };
  const memberName = (r: HandoffChainRun) => r.member?.display_name || r.member?.full_name || r.member_user_id || '—';

  // build raw sections for the modal: the whole run + every step (raw, divided per level).
  const openRawAll = (r: HandoffChainRun, d: { run: HandoffChainRun; steps: any[] }) => {
    const sections: { label: string; data: any }[] = [{ label: 'RUN (level 1)', data: d.run || r }];
    (d.steps || []).forEach((s: any, i: number) => sections.push({ label: `STEP ${s.chain_step ?? i + 1} · ${s.target_key} (level 2/3)`, data: s }));
    setRawModal({ title: `raw · ${memberName(r)} · ${r.chain_key}`, sections });
  };

  return (
    <div className="flex flex-col gap-6">
      {/* header card + filters (webhook-logs style) */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 bg-dark-800 border border-dark-700 rounded-xl px-4 py-4 shadow-lg shadow-black/20">
          <div className="flex items-center gap-2">
            <History className="w-6 h-6 text-cyan-600" />
            <div>
              <p className="text-sm text-slate-500">{t('handoff_hist.subtitle')}</p>
              <h3 className="text-xl font-semibold text-slate-900">{t('handoff_hist.title')}</h3>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 sm:items-end">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">{t('handoff_hist.member')}</span>
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && (setPage(1), load())}
                  placeholder={t('handoff_hist.search_ph')} className="pl-8 pr-3 py-2 rounded-lg border border-dark-600 bg-dark-800 text-sm text-slate-900 w-56 focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Status</span>
              <SearchableSelect className="w-40" value={statusFilter} onChange={v => { setStatusFilter(v); setPage(1); }}
                placeholder={t('handoff_hist.all_status')}
                options={STATUSES.map(s => ({ value: s, label: s || t('handoff_hist.all_status') }))} />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Chain</span>
              <input value={chainFilter} onChange={e => setChainFilter(e.target.value)} onKeyDown={e => e.key === 'Enter' && (setPage(1), load())}
                placeholder="chain key" className="px-3 py-2 rounded-lg border border-dark-600 bg-dark-800 text-sm text-slate-900 w-32 focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            {/* [FEAT-20260809-DATERANGE] Resets to page 1 like every other filter here. */}
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">{t('common.date') || 'วันที่'}</span>
              <LogDateRangeFilter
                value={dateRange}
                disabled={loading}
                onChange={next => { setDateRange(next); setPage(1); }}
              />
            </div>
            <label className="flex items-center gap-1.5 text-sm text-slate-600 self-end pb-2 cursor-pointer">
              <input type="checkbox" checked={onlyReview} onChange={e => { setOnlyReview(e.target.checked); setPage(1); }} />
              <AlertTriangle className="w-4 h-4 text-amber-500" /> {t('handoff_hist.need_review')}
            </label>
          </div>
        </div>
      </div>

      {/* table */}
      <div className="overflow-x-auto bg-dark-900 border border-dark-700 rounded-xl shadow-lg shadow-black/20 relative">
        {loading && <div className="absolute left-0 top-0 h-0.5 w-full bg-primary-500/80 animate-pulse" />}
        <table className="min-w-full divide-y divide-dark-700">
          <thead className="bg-dark-800">
            <tr>
              <th className="px-3 py-3 w-8"></th>
              <th className="px-4 py-3 text-left text-xs font-semibold tracking-wider uppercase text-slate-500">Member</th>
              <th className="px-4 py-3 text-left text-xs font-semibold tracking-wider uppercase text-slate-500">Status</th>
              <th className="px-4 py-3 text-left text-xs font-semibold tracking-wider uppercase text-slate-500">Chain</th>
              <th className="px-4 py-3 text-left text-xs font-semibold tracking-wider uppercase text-slate-500">Slip</th>
              <th className="px-4 py-3 text-left text-xs font-semibold tracking-wider uppercase text-slate-500">{t('pageui.handoff.col_time', 'เวลา')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-dark-800">
            {!loading && runs.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">{t('handoff_hist.no_rows')}</td></tr>
            ) : runs.map(r => {
              const open = expandedRun === r._id;
              const d = details[r._id];
              const fullRun: any = (d && d !== 'loading') ? d.run : r; // full run once loaded
              return (
                <React.Fragment key={r._id}>
                  <tr onClick={() => toggleRun(r._id)} className={`transition-colors cursor-pointer ${open ? 'bg-blue-500/10' : 'hover:bg-dark-900/50'}`}>
                    <td className={`px-3 py-3 ${open ? 'text-blue-600' : 'text-slate-400'}`}>{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      <div className="flex items-center gap-1.5 font-bold"><User className="w-3.5 h-3.5 text-slate-400" />{memberName(r)}</div>
                      {r.member?.phone_number && <div className="flex items-center gap-1 text-xs text-slate-400 mt-0.5"><Phone className="w-3 h-3" />{r.member.phone_number}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${STATUS_BADGE[r.status] || 'bg-slate-100 text-slate-600'}`}>{r.status}</span>
                      {r.needs_review && <span className="ml-1 text-xs px-1.5 py-0.5 rounded bg-amber-500 text-white inline-flex items-center gap-0.5"><AlertTriangle className="w-3 h-3" />{t('handoff_hist.review_badge')}</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">{r.chain_key} <span className="text-slate-400">· x{r.cursor ?? 0}</span></td>
                    <td className="px-4 py-3 text-xs font-mono text-slate-500">{r.slip_record_id ? String(r.slip_record_id).slice(-8) : '-'}</td>
                    <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">{fmt(r.created_at || r.started_at)}</td>
                  </tr>

                  {open && (
                    <tr className="bg-blue-500/[0.06]">
                      <td colSpan={6} className="py-3 pr-4 pl-12 border-l-4 border-blue-500">
                        {/* ── RUN level (บนสุด) — profile card (ซ้าย) + run fields (ขวา) ── */}
                        <div className="text-[10px] font-bold text-blue-600 uppercase tracking-widest mb-1.5">{t('handoff_hist.run_level')}</div>
                        <div className="flex flex-col lg:flex-row gap-3 mb-2">
                          {/* customer profile card */}
                          <div className="lg:w-72 shrink-0 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                            <div className="flex items-center gap-2 mb-2">
                              <div className="w-9 h-9 rounded-full bg-cyan-100 text-cyan-700 flex items-center justify-center font-bold shrink-0">
                                {(memberName(r)[0] || '?').toUpperCase()}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1">
                                  <span className="font-bold text-slate-800 truncate">{memberName(r)}</span>
                                  <CopyBtn text={memberName(r)} title={t('pageui.handoff.copy_name', 'copy ชื่อ')} />
                                </div>
                                {r.member?.full_name && r.member.full_name !== memberName(r) && <div className="text-xs text-slate-400 truncate">{r.member.full_name}</div>}
                              </div>
                            </div>
                            <div className="space-y-1 border-t border-slate-100 pt-2">
                              <ProfileRow icon={<Phone size={13} />} label="phone" value={r.member?.phone_number} mono />
                              <ProfileRow icon={<IdCard size={13} />} label="line_user" value={r.member?.line_user_id} mono />
                              <ProfileRow icon={<Hash size={13} />} label="member id" value={r.member?.record_id} mono />
                              <ProfileRow icon={<User size={13} />} label="member_uid" value={fullRun.member_user_id} mono />
                            </div>
                          </div>
                          {/* run technical fields (ทับศัพท์) */}
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-xs text-slate-600 flex-1 content-start">
                            <span>status: <span className="font-bold">{fullRun.status}</span></span>
                            <span>chain: <span className="font-mono">{fullRun.chain_key}</span></span>
                            <span>cursor (x): <span className="font-mono">{fullRun.cursor ?? 0}</span></span>
                            <span>{t('handoff_hist.cur_step')}: <span className="font-mono">{fullRun.current_step_order ?? '—'}</span></span>
                            <span>needs_review: <span className={fullRun.needs_review ? 'text-amber-600 font-bold' : ''}>{String(!!fullRun.needs_review)}</span></span>
                            <span>env: <span className="font-mono">{fullRun.env_tag || '—'}</span></span>
                            <span>subject: <span className="font-mono">{fullRun.subject_type || '—'}</span></span>
                            <span>hook_id: <span className="font-mono">{fullRun.hook_id ? String(fullRun.hook_id).slice(-8) : '—'}</span></span>
                            <span className="flex items-center gap-1">slip: <span className="font-mono truncate">{String(fullRun.slip_record_id) || '—'}</span><CopyBtn text={String(fullRun.slip_record_id || '')} title="copy slip id" /></span>
                            <span className="col-span-2 md:col-span-3">{t('handoff_hist.run_time')}: <span className="font-mono">{fmt(fullRun.started_at)} → {fullRun.ended_at ? fmt(fullRun.ended_at) : '—'}</span></span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 mb-2">
                          {fullRun.raw_transaction != null && (
                            <button onClick={() => setRawTxOpen(rawTxOpen === r._id ? null : r._id)} title={t('pageui.handoff.raw_tx_title', 'raw_transaction (ทั้งก้อน)')}
                              className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-xs font-bold transition-colors ${rawTxOpen === r._id ? 'border-blue-500/60 bg-blue-500/10 text-blue-700' : 'border-dark-600 bg-dark-800 text-slate-600 hover:text-slate-900 hover:border-primary-500'}`}>
                              <FileJson size={14} /> raw_transaction
                            </button>
                          )}
                          {/* [FEAT-20260806-RAWMODAL] file icon → raw json ทุกเลเวล */}
                          {d && d !== 'loading' && (
                            <button onClick={() => openRawAll(r, d)} title={t('pageui.handoff.raw_all_title', 'raw json ทุกเลเวล (run + ทุก step)')}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-dark-600 bg-dark-800 text-xs font-bold text-slate-600 hover:text-slate-900 hover:border-primary-500 transition-colors">
                              <FileJson size={14} /> raw json (all-level)
                            </button>
                          )}
                          {/* [FEAT-20260806-HISTORY] slip ที่ผูก (collapsible) */}
                          {d && d !== 'loading' && d.slip && (
                            <button onClick={() => setSlipOpen(slipOpen === r._id ? null : r._id)} title={t('pageui.handoff.slip_title', 'ข้อมูลสลิปที่เริ่ม run นี้')}
                              className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-xs font-bold transition-colors ${slipOpen === r._id ? 'border-blue-500/60 bg-blue-500/10 text-blue-700' : 'border-dark-600 bg-dark-800 text-slate-600 hover:text-slate-900 hover:border-primary-500'}`}>
                              <FileJson size={14} /> slip
                            </button>
                          )}
                          {/* statement[x] ที่ใช้ยิง (จับคู่ ref_id ใน raw_transaction) (collapsible) */}
                          {d && d !== 'loading' && (() => {
                            const refs = new Set((d.steps || []).map((s: any) => s.statement_ref).filter(Boolean));
                            const stmts = ((fullRun.raw_transaction && fullRun.raw_transaction.statement) || []).filter((x: any) => x && refs.has(x.ref_id));
                            return stmts.length ? (
                              <button onClick={() => setStmtOpen(stmtOpen === r._id ? null : r._id)} title={t('pageui.handoff.stmt_title', 'statement[x] ที่ยิงจริง (ref ตรงกับ step)')}
                                className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-xs font-bold transition-colors ${stmtOpen === r._id ? 'border-blue-500/60 bg-blue-500/10 text-blue-700' : 'border-dark-600 bg-dark-800 text-slate-600 hover:text-slate-900 hover:border-primary-500'}`}>
                                <FileJson size={14} /> statement[x] ({stmts.length})
                              </button>
                            ) : null;
                          })()}
                        </div>
                        {rawTxOpen === r._id && fullRun.raw_transaction != null && <div className="mb-2"><JsonBlock label="raw_transaction" value={fullRun.raw_transaction} max="max-h-64" /></div>}
                        {slipOpen === r._id && d && d !== 'loading' && d.slip && <div className="mb-2"><JsonBlock label={t('pageui.handoff.slip_block', 'slip (ที่เริ่ม run นี้ · masked)')} value={d.slip} max="max-h-64" /></div>}
                        {stmtOpen === r._id && d && d !== 'loading' && (() => {
                          const refs = new Set((d.steps || []).map((s: any) => s.statement_ref).filter(Boolean));
                          const stmts = ((fullRun.raw_transaction && fullRun.raw_transaction.statement) || []).filter((x: any) => x && refs.has(x.ref_id));
                          return <div className="mb-2"><JsonBlock label={t('pageui.handoff.stmt_block', 'statement[x] ที่ใช้ยิง (ref ตรง step)')} value={stmts} max="max-h-64" /></div>;
                        })()}
                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">{t('handoff_hist.steps_level')}</div>

                        {d === 'loading' || d === undefined ? (
                          <div className="flex items-center gap-2 text-xs text-slate-400 py-2"><Loader2 className="w-4 h-4 animate-spin" /> {t('handoff_hist.loading_step')}</div>
                        ) : d.steps.length === 0 ? (
                          <div className="text-xs text-slate-400 py-2">{t('handoff_hist.no_step')}</div>
                        ) : (
                          <div className="space-y-1.5">
                            {/* [FEAT-20260818-PASSBADGE] A run walks its legs once
                                normally, but every [ลองใหม่] tap sends it round
                                again — and BE now returns one row per pass
                                (`attempt`: 0 = the pass the slip started, >0 = a
                                tap). Steps arrive in real time order, so without
                                a label two passes read as one confusing sequence
                                (topup, walletpay, topup…).
                                Shown ONLY when a run actually has more than one
                                pass: labelling every ordinary run "รอบ 1" would
                                add noise to the ~95% that never retried.
                                Rows written before BE carried `attempt` report 0,
                                so an old run stays unlabelled exactly as today.
                                revert: delete this const and the badge below. */}
                            {(() => {
                              const multiPass = hasMultiplePasses(d.steps);
                              return d.steps.map((s: any, i: number) => {
                              const skey = `${r._id}:${i}`;
                              const sopen = expandedStep === skey;
                              return (
                                <div key={skey} className={`border rounded ${sopen ? 'border-blue-500/50 bg-blue-500/[0.06]' : 'border-dark-600 bg-dark-900'}`}>
                                  <button onClick={() => setExpandedStep(sopen ? null : skey)} className={`w-full text-left px-2.5 py-1.5 flex items-center gap-2 text-xs ${sopen ? '' : 'hover:bg-dark-800/60'}`}>
                                    {sopen ? <ChevronDown className="w-3.5 h-3.5 shrink-0 text-blue-600" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0 text-slate-400" />}
                                    <span className="px-1.5 py-0.5 rounded bg-dark-700 font-bold shrink-0 text-slate-600">step {s.chain_step}</span>
                                    {multiPass && (
                                      <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-bold shrink-0" title={t('handoff_hist.pass_hint')}>
                                        {t('handoff_hist.pass')} {passNumber(s)}
                                      </span>
                                    )}
                                    <span className="font-bold text-slate-700">{s.target_key}</span>
                                    <span className={`px-1.5 py-0.5 rounded font-bold ${outcomeColor(s.context?.outcome)}`}>{s.context?.outcome || s.status}</span>
                                    {s.context?.slip_locked && <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">🔒 {s.context?.lock_reason}</span>}
                                    <span className="ml-auto text-slate-400">
                                      stmt[{s.stmt_idx ?? '-'}]{s.context?.statement_ref ? ` · ref ${String(s.context.statement_ref).slice(0, 8)}` : ''}
                                      {s.context?.duration_ms != null ? ` · ${s.context.duration_ms}ms` : ''} · {s.triggered_by}
                                    </span>
                                  </button>
                                  {sopen && (
                                    <div className="border-t border-dark-700 px-2.5 py-2 space-y-2 text-xs">
                                      {/* step start/end — request.sent_at → final.received_at */}
                                      <div className="text-slate-500">
                                        {t('handoff_hist.step_time')}: <span className="font-mono text-slate-700">{fmt(s.request?.sent_at)} → {s.final?.received_at ? fmt(s.final.received_at) : (s.final?.received_via === 'timeout' ? t('handoff_hist.timeout_noresp') : '—')}</span>
                                      </div>
                                      <div className="text-slate-500">
                                        endpoint: <span className="font-mono break-all text-slate-700">{s.request?.method || 'POST'} {s.request?.url || s.context?.endpoint_url || '-'}</span>
                                        {s.context?.timeout_ms != null && <span> · timeout {s.context.timeout_ms}ms</span>}
                                        {s.context?.used_hook_override && <span className="ml-1 px-1 py-0.5 rounded bg-cyan-100 text-cyan-700">hook creds</span>}
                                      </div>
                                      <div className="text-slate-500">
                                        reason: {s.context?.reason || s.outcome_code || '-'}
                                        {s.final?.http_status != null && ` · http ${s.final.http_status}`}
                                        {s.final?.received_via && ` · ${s.final.received_via}`}
                                      </div>
                                      {s.request?.headers_redacted && <JsonBlock label="request headers (redacted)" value={s.request.headers_redacted} max="max-h-24" />}
                                      {s.request?.body != null && <JsonBlock label="request body" value={s.request.body} />}
                                      {(s.final?.raw != null || s.final?.raw_text) && <JsonBlock label="response body" value={s.final?.raw ?? s.final?.raw_text} />}
                                      {/* [FIX-20260815-SHOWSKIPDIAG] a step that never called out.
                                          BE writes `final.parsed` for a leg that stopped BEFORE sending
                                          (payment-runner.service.ts `[FEAT-20260815-STEPNORUNLOG]` +
                                          `[FEAT-20260815-MATCHDIAG]`): why it stopped, the matching rule
                                          we applied, and what the statement list actually held.
                                          This block was MISSING — the page only ever rendered
                                          `final.raw` / `raw_text`, which a skipped step does not have,
                                          so the row showed three lines and nothing else. The owner, on
                                          that screen: "ทำไมมันมีแต่การ์ดกับ reason โง่ๆ".
                                          ⚠️ Additive: a step that DID run has no `parsed`, so nothing
                                          about the normal render changes.
                                          revert: delete this block — the data stays in Mongo. */}
                                      {s.final?.parsed?.skipped && (
                                        <div className="rounded border border-amber-300/60 bg-amber-50 px-2 py-1.5 space-y-1.5">
                                          <div className="font-bold text-amber-800">
                                            ⏭ Step not sent
                                          </div>
                                          {s.final.parsed.note && (
                                            <div className="text-amber-900/80">{s.final.parsed.note}</div>
                                          )}
                                          {s.final.parsed.diag && (
                                            <>
                                              {s.final.parsed.diag.summary && (
                                                <div className="font-bold text-slate-700">
                                                  Summary: {s.final.parsed.diag.summary}
                                                </div>
                                              )}
                                              {s.final.parsed.diag.narrowing && (
                                                <div className="text-slate-600 font-mono text-[11px]">
                                                  Narrowing: {s.final.parsed.diag.narrowing.rows_total} rows
                                                  {' → '}{s.final.parsed.diag.narrowing.after_provider} (provider)
                                                  {' → '}{s.final.parsed.diag.narrowing.after_status} (status)
                                                  {' → '}{s.final.parsed.diag.narrowing.after_amount} (amount)
                                                  {s.final.parsed.diag.slip_amount != null && ` · slip amount ${s.final.parsed.diag.slip_amount}`}
                                                  {s.final.parsed.diag.path_state && ` · ${s.final.parsed.diag.path_state}`}
                                                </div>
                                              )}
                                              {/* [FEAT-20260815-MATCHDIAG] which tools the OA had bound
                                                  when this decision was made — same ids as the
                                                  [TOOLCHECK] log lines, so screen and log cross-check.
                                                  Without it "walletpay is off" and "walletpay is on but
                                                  nothing matched" look identical on this row. */}
                                              {/* Collapsed by DEFAULT (owner, 15/08/2026): four mono lines of ids
                                                  pushed the summary and the rule out of view, and they are
                                                  reference material — you look them up when a summary raises a
                                                  question, not on every read. `<details>` keeps them one click
                                                  away with no state to manage and no change to the other blocks. */}
                                              {s.final.parsed.diag.tools && (
                                                <details className="text-slate-600 font-mono text-[11px]">
                                                  <summary className="cursor-pointer select-none text-slate-500 font-sans font-bold hover:text-slate-700">
                                                    tool bindings at decision time
                                                  </summary>
                                                  <div className="mt-1 space-y-0.5 pl-3 border-l-2 border-slate-300">
                                                    <div>custom_tool: {s.final.parsed.diag.tools.custom_tool_id} · {s.final.parsed.diag.tools.custom_tool_status ? 'ON' : 'OFF'}</div>
                                                    <div>payment_tool: {s.final.parsed.diag.tools.payment_tool_id} · {s.final.parsed.diag.tools.payment_tool_status ? 'ON' : 'OFF'}</div>
                                                    <div>walletpay_tool: {s.final.parsed.diag.tools.walletpay_tool_id} · {s.final.parsed.diag.tools.walletpay_tool_status ? 'ON' : 'OFF'}</div>
                                                    {s.final.parsed.diag.tools.walletpay_uses && (
                                                      <div className="text-slate-500">walletpay leg would use: {s.final.parsed.diag.tools.walletpay_uses}</div>
                                                    )}
                                                  </div>
                                                </details>
                                              )}
                                              {s.final.parsed.diag.rule && (
                                                <JsonBlock label="candidate rule (what we filter on)" value={s.final.parsed.diag.rule} max="max-h-40" />
                                              )}
                                              {Array.isArray(s.final.parsed.diag.passed_rows) && s.final.parsed.diag.passed_rows.length > 0 && (
                                                <JsonBlock label="rows that passed provider + status" value={s.final.parsed.diag.passed_rows} max="max-h-40" />
                                              )}
                                              {Array.isArray(s.final.parsed.diag.rows_seen) && s.final.parsed.diag.rows_seen.length > 0 && (
                                                <JsonBlock label="statements actually found (rows_seen)" value={s.final.parsed.diag.rows_seen} max="max-h-40" />
                                              )}
                                              {s.final.parsed.diag.truncated && (
                                                <div className="text-slate-500">· truncated (list too long)</div>
                                              )}
                                              {/* [FEAT-20260815-RAWPROFILEDIAG] the whole profile response the
                                                  tool returned, credential-masked by the BE. The derived views
                                                  above only explain the shape we expect — when the shape ITSELF
                                                  is the surprise, this is the material to check them against.
                                                  Last block on purpose: biggest, and read only when the
                                                  summaries do not settle the question. */}
                                              {s.final.parsed.diag.raw_profile != null && (
                                                <JsonBlock label="raw profile response (masked)" value={s.final.parsed.diag.raw_profile} max="max-h-72" />
                                              )}
                                              {s.final.parsed.diag.error && (
                                                <div className="text-red-600">diag error: {s.final.parsed.diag.error}</div>
                                              )}
                                            </>
                                          )}
                                        </div>
                                      )}
                                      {s.final?.received_via === 'timeout' && <div className="text-amber-600 font-medium">⏱ {t('handoff_hist.timeout_note')}</div>}
                                    </div>
                                  )}
                                </div>
                              );
                            });
                            })()}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* footer: total + reload + per-page + pagination (webhook-logs style) */}
      <div className="flex flex-col sm:flex-row justify-between items-center gap-4 px-6 py-4 border-t border-dark-700 -mt-4">
        <div className="flex items-center gap-4">
          <span className="text-sm text-slate-500">{t('handoff_hist.total')} {total} {t('handoff_hist.rows_unit')}</span>
          <div className="h-4 w-px bg-dark-700 hidden sm:block" />
          <button onClick={load} disabled={loading} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-dark-600 text-xs font-bold text-slate-600 hover:text-slate-900 hover:bg-dark-700 transition-colors disabled:opacity-50">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> {t('handoff_hist.reload')}
          </button>
          <div className="h-4 w-px bg-dark-700 hidden sm:block" />
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-tighter">{t('handoff_hist.per_page')}:</span>
            <select value={limit} onChange={e => { setLimit(Number(e.target.value)); setPage(1); }}
              className="bg-dark-800 border border-dark-600 rounded-lg py-1 px-2 text-xs font-bold text-slate-900 focus:ring-2 focus:ring-primary-500 outline-none cursor-pointer">
              {[10, 20, 30, 50, 100].map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
            className="p-2 rounded-lg bg-dark-700 text-slate-400 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"><ChevronLeft size={18} /></button>
          <span className="text-sm text-slate-600 px-2 font-medium">{page} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
            className="p-2 rounded-lg bg-dark-700 text-slate-400 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"><ChevronRight size={18} /></button>
        </div>
      </div>

      {/* [FEAT-20260806-RAWMODAL] raw JSON preview — all levels, one collapsible section each */}
      {rawModal && <RawModal title={rawModal.title} sections={rawModal.sections} onClose={() => setRawModal(null)} />}
    </div>
  );
}

// raw JSON modal: each level = its own collapsible section (divided, easy to open).
const RawModal: React.FC<{ title: string; sections: { label: string; data: any }[]; onClose: () => void }> = ({ title, sections, onClose }) => {
  const [openIdx, setOpenIdx] = useState<number>(0); // first section open by default
  return (
    <div className="fixed inset-0 z-[120] bg-black/50 flex items-start justify-center overflow-auto py-10 px-4">
      <div className="bg-white rounded-xl w-full max-w-3xl shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-dark-600 sticky top-0 bg-white rounded-t-xl">
          <div className="flex items-center gap-2 font-bold text-slate-800 text-sm"><FileJson size={16} className="text-cyan-600" /> {title}</div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><X size={18} /></button>
        </div>
        <div className="p-3 space-y-2 max-h-[75vh] overflow-y-auto">
          {sections.map((sec, i) => {
            const open = openIdx === i;
            return (
              <div key={i} className={`rounded-lg border ${open ? 'border-blue-500/50' : 'border-dark-600'} overflow-hidden`}>
                <button onClick={() => setOpenIdx(open ? -1 : i)}
                  className={`w-full text-left px-3 py-2 flex items-center gap-2 text-sm font-bold transition-colors ${open ? 'bg-blue-500/10 text-blue-700' : 'bg-dark-800 text-slate-700 hover:bg-slate-100'}`}>
                  {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  <span className="flex-1">{sec.label}</span>
                  <FileJson size={13} className="text-slate-400" />
                </button>
                {open && (
                  <pre className="bg-dark-900 border-t border-dark-600 p-2.5 overflow-auto max-h-[45vh] text-[11px] whitespace-pre-wrap break-all text-slate-700">
                    {JSON.stringify(sec.data, null, 2)}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
// ==== [FEAT-20260806-HISTORY] END
