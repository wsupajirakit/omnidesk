/**
 * ==== [FEAT-20260805-CHAIN] START ====
 *
 * Handoff Chains — config UI (sequential A/B/C steps + gate + per-OA endpoint override)
 * and run history (audit: needs_review badge/filter + per-step drill-in).
 * BE is already built + verified (gated by `handoff.manage`); this page only consumes it.
 * Structure/styling mirror pages/HandoffTargets.tsx.
 *
 * revert: delete this file + its route in App.tsx + the chain methods in handoffService.ts.
 * ==== [FEAT-20260805-CHAIN] ====
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus, RefreshCw, Trash2, Edit2, Loader2, X, ChevronDown, ChevronRight,
  ListChecks, History, AlertTriangle, Save,
} from 'lucide-react';
import {
  handoffService, HandoffChain, HandoffChainStep, HandoffChainRun,
} from '../../services/chat';
import { ConfirmModal } from '../../components/modals';
import { useI18n } from '../../i18n';

type Tab = 'config' | 'history';
const ACTIONS: HandoffChainStep['on_true'][] = ['continue', 'stop', 'reply'];
const emptyStep = (order: number): HandoffChainStep => ({
  order, target_key: '', enabled: true, is_payment: true, on_true: 'reply', on_false: 'continue',
});
const emptyChain = (): HandoffChain => ({
  key: '', name: '', enabled: false, env_tag: 'dev', subject_types: ['slip_verification'],
  scope: { bindings: [] }, steps: [emptyStep(1)], statement: { path: 'data', start_index: 0 },
});

const STATUS_COLOR: Record<string, string> = {
  running: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  succeeded: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  replied: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  stopped: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  locked_review: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

export default function HandoffChains() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('config');
  const [toast, setToast] = useState<{ ok: boolean; message: string } | null>(null);
  const notify = (ok: boolean, message: string) => {
    setToast({ ok, message });
    setTimeout(() => setToast(null), ok ? 2600 : 4200);
  };

  /* ── config: chains ── */
  const [chains, setChains] = useState<HandoffChain[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<HandoffChain | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState<HandoffChain | null>(null);

  const loadChains = useCallback(async () => {
    setLoading(true);
    try { setChains(await handoffService.listChains()); }
    catch { notify(false, t('pageui.handoff.chains_load_failed', 'โหลด chains ไม่สำเร็จ')); }
    finally { setLoading(false); }
  }, []);

  /* ── history: runs ── */
  const [runs, setRuns] = useState<HandoffChainRun[]>([]);
  const [runTotal, setRunTotal] = useState(0);
  const [onlyReview, setOnlyReview] = useState(false);
  const [search, setSearch] = useState('');
  const [runLoading, setRunLoading] = useState(false);
  const [detail, setDetail] = useState<{ run: HandoffChainRun; steps: any[] } | null>(null);

  const loadRuns = useCallback(async () => {
    setRunLoading(true);
    try {
      const r = await handoffService.listChainRuns({ needs_review: onlyReview, search: search.trim() || undefined, limit: 30 });
      setRuns(r.data); setRunTotal(r.total);
    } catch { notify(false, t('pageui.handoff.history_load_failed', 'โหลดประวัติไม่สำเร็จ')); }
    finally { setRunLoading(false); }
  }, [onlyReview, search]);

  useEffect(() => { loadChains(); }, [loadChains]);
  useEffect(() => { if (tab === 'history') loadRuns(); }, [tab, loadRuns]);

  /* ── save chain ── */
  const save = async () => {
    if (!editing) return;
    if (!/^[a-z0-9_-]{1,64}$/.test(editing.key)) { notify(false, t('pageui.handoff.key_rule', 'key ต้องเป็น a-z 0-9 _ - (1–64)')); return; }
    if (!editing.steps || editing.steps.length === 0) { notify(false, t('pageui.handoff.need_step', 'ต้องมีอย่างน้อย 1 step')); return; }
    setSaving(true);
    try {
      const payload = { ...editing };
      if (editing._id) await handoffService.updateChain(editing._id, payload);
      else await handoffService.createChain(payload);
      notify(true, t('pageui.handoff.saved', 'บันทึกแล้ว'));
      setEditing(null);
      await loadChains();
    } catch (e: any) { notify(false, e?.message || t('pageui.handoff.save_failed', 'บันทึกไม่สำเร็จ')); }
    finally { setSaving(false); }
  };

  const del = async () => {
    if (!confirmDel?._id) return;
    try { await handoffService.deleteChain(confirmDel._id); notify(true, t('pageui.handoff.deleted', 'ลบ "{key}" แล้ว', { key: confirmDel.key })); setConfirmDel(null); await loadChains(); }
    catch (e: any) { notify(false, e?.message || t('pageui.handoff.delete_failed', 'ลบไม่สำเร็จ')); }
  };

  /* ── step editor helpers ── */
  const setStep = (i: number, patch: Partial<HandoffChainStep>) => {
    if (!editing) return;
    const steps = [...(editing.steps || [])];
    steps[i] = { ...steps[i], ...patch };
    setEditing({ ...editing, steps });
  };
  const addStep = () => editing && setEditing({ ...editing, steps: [...(editing.steps || []), emptyStep((editing.steps?.length || 0) + 1)] });
  const removeStep = (i: number) => editing && setEditing({ ...editing, steps: (editing.steps || []).filter((_, k) => k !== i) });

  const bindings = editing?.scope?.bindings || [];
  const addBinding = (hook_id: string) => {
    if (!editing || !hook_id) return;
    if (bindings.some(b => b.hook_id === hook_id)) return;
    setEditing({ ...editing, scope: { bindings: [...bindings, { hook_id, enabled: true }] } });
  };
  const removeBinding = (hook_id: string) => editing && setEditing({ ...editing, scope: { bindings: bindings.filter(b => b.hook_id !== hook_id) } });

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto text-gray-800 dark:text-gray-100">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold flex items-center gap-2"><ListChecks className="w-5 h-5" /> Handoff Chains</h1>
        <div className="flex gap-2">
          <button onClick={() => setTab('config')} className={`px-3 py-1.5 rounded text-sm ${tab === 'config' ? 'bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-gray-800'}`}>Config</button>
          {/* [FEAT-20260806-HISTORY] ปุ่มประวัติเปิดหน้าเมนูใหม่ (เหมือนกดจากเมนูประวัติ handoff) แทน tab inline */}
          <button onClick={() => { window.location.href = '/#/handoff-history'; }} className="px-3 py-1.5 rounded text-sm flex items-center gap-1 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200"><History className="w-4 h-4" /> {t('pageui.handoff.history', 'ประวัติ')}</button>
        </div>
      </div>

      {toast && (
        <div className={`mb-3 px-4 py-2 rounded text-sm ${toast.ok ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{toast.message}</div>
      )}

      {tab === 'config' && (
        <div>
          <div className="flex justify-between mb-3">
            <button onClick={loadChains} className="px-3 py-1.5 rounded bg-gray-100 dark:bg-gray-800 text-sm flex items-center gap-1"><RefreshCw className="w-4 h-4" /> {t('pageui.handoff.refresh', 'รีเฟรช')}</button>
            <button onClick={() => setEditing(emptyChain())} className="px-3 py-1.5 rounded bg-indigo-600 text-white text-sm flex items-center gap-1"><Plus className="w-4 h-4" /> {t('pageui.handoff.add_chain', 'เพิ่ม chain')}</button>
          </div>
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : chains.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm">{t('pageui.handoff.no_chain', 'ยังไม่มี chain')}</div>
          ) : (
            <div className="space-y-2">
              {chains.map(c => (
                <div key={c._id} className="border dark:border-gray-700 rounded p-3 flex items-center justify-between">
                  <div>
                    <div className="font-medium flex items-center gap-2">
                      {c.key}
                      <span className={`text-xs px-1.5 py-0.5 rounded ${c.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{c.enabled ? 'ON' : 'OFF'}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800">{c.env_tag}</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">{c.name} · {c.steps?.length || 0} steps · {c.scope?.bindings?.length || 0} OA</div>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => setEditing(JSON.parse(JSON.stringify(c)))} className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800"><Edit2 className="w-4 h-4" /></button>
                    <button onClick={() => setConfirmDel(c)} className="p-1.5 rounded hover:bg-red-50 text-red-600"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'history' && (
        <div>
          <div className="flex flex-wrap gap-2 mb-3 items-center">
            <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && loadRuns()} placeholder={t('pageui.handoff.search_member_ph', 'ค้นหา member…')} className="px-3 py-1.5 rounded border dark:border-gray-700 bg-transparent text-sm" />
            <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={onlyReview} onChange={e => setOnlyReview(e.target.checked)} /> <AlertTriangle className="w-4 h-4 text-amber-500" /> {t('pageui.handoff.only_review', 'เฉพาะที่ต้องตรวจ')}</label>
            <button onClick={loadRuns} className="px-3 py-1.5 rounded bg-gray-100 dark:bg-gray-800 text-sm">{t('pageui.handoff.search', 'ค้นหา')}</button>
            <span className="text-xs text-gray-500 ml-auto">{t('pageui.handoff.total_n', 'รวม {n}', { n: runTotal })}</span>
          </div>
          {runLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : (
            <div className="space-y-1.5">
              {runs.map(r => (
                <button key={r._id} onClick={async () => { try { setDetail(await handoffService.getChainRun(r._id)); } catch { notify(false, t('pageui.handoff.detail_load_failed', 'โหลด detail ไม่สำเร็จ')); } }}
                  className="w-full text-left border dark:border-gray-700 rounded p-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/50 flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${STATUS_COLOR[r.status] || 'bg-gray-100'}`}>{r.status}</span>
                    {r.needs_review && <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500 text-white flex items-center gap-0.5"><AlertTriangle className="w-3 h-3" /> {t('pageui.handoff.review_badge', 'ตรวจ')}</span>}
                    <span className="text-sm truncate">{r.member_user_id}</span>
                  </div>
                  <span className="text-xs text-gray-400">{r.chain_key} · x{r.cursor ?? 0}</span>
                </button>
              ))}
              {runs.length === 0 && <div className="text-center py-10 text-gray-400 text-sm">{t('pageui.handoff.no_items', 'ไม่มีรายการ')}</div>}
            </div>
          )}
        </div>
      )}

      {/* ── chain editor modal ── */}
      {editing && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center overflow-auto py-8 px-3">
          <div className="bg-white dark:bg-gray-900 rounded-lg w-full max-w-2xl p-5 my-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-bold">{editing._id ? t('pageui.handoff.edit_chain', 'แก้ไข chain') : t('pageui.handoff.create_chain', 'สร้าง chain')}</h2>
              <div className="flex items-center gap-2">
                {/* [FEAT-20260805-CHAIN] mint chain อัตโนมัติ topup→walletpay */}
                {!editing._id && (
                  <button type="button"
                    onClick={() => setEditing({
                      ...editing, key: 'topup_chain', name: 'สลิป → topup → walletpay', enabled: true, env_tag: 'dev',
                      subject_types: ['slip_verification'],
                      steps: [
                        { order: 1, target_key: 'topup', enabled: true, is_payment: true, on_true: 'reply', on_false: 'continue' },
                        { order: 2, target_key: 'walletpay', enabled: true, is_payment: true, on_true: 'reply', on_false: 'reply' },
                      ],
                      statement: { path: 'data', start_index: 0 },
                    })}
                    className="px-2.5 py-1 rounded bg-indigo-50 text-indigo-700 text-xs font-bold hover:bg-indigo-100">⚡ mint auto (topup→walletpay)</button>
                )}
                <button onClick={() => setEditing(null)}><X className="w-5 h-5" /></button>
              </div>
            </div>
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <label className="block">key <input disabled={!!editing._id} value={editing.key} onChange={e => setEditing({ ...editing, key: e.target.value })} className="w-full mt-1 px-2 py-1.5 rounded border dark:border-gray-700 bg-transparent disabled:opacity-50" /></label>
                <label className="block">name <input value={editing.name || ''} onChange={e => setEditing({ ...editing, name: e.target.value })} className="w-full mt-1 px-2 py-1.5 rounded border dark:border-gray-700 bg-transparent" /></label>
              </div>
              <div className="flex gap-4 items-center">
                <label className="flex items-center gap-1"><input type="checkbox" checked={!!editing.enabled} onChange={e => setEditing({ ...editing, enabled: e.target.checked })} /> {t('pageui.handoff.enabled', 'เปิดใช้งาน')}</label>
                <label className="flex items-center gap-1">env
                  <select value={editing.env_tag} onChange={e => setEditing({ ...editing, env_tag: e.target.value as any })} className="ml-1 px-2 py-1 rounded border dark:border-gray-700 bg-transparent"><option value="dev">dev</option><option value="prod">prod</option></select>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">statement path <input value={editing.statement?.path || 'data'} onChange={e => setEditing({ ...editing, statement: { ...editing.statement, path: e.target.value } })} className="w-full mt-1 px-2 py-1.5 rounded border dark:border-gray-700 bg-transparent" /></label>
                <label className="block">start index <input type="number" value={editing.statement?.start_index ?? 0} onChange={e => setEditing({ ...editing, statement: { ...editing.statement, start_index: Number(e.target.value) } })} className="w-full mt-1 px-2 py-1.5 rounded border dark:border-gray-700 bg-transparent" /></label>
              </div>

              {/* steps */}
              <div>
                <div className="flex justify-between items-center mb-1"><span className="font-medium">{t('pageui.handoff.steps_in_order', 'Steps (ตามลำดับ)')}</span><button onClick={addStep} className="text-xs px-2 py-1 rounded bg-indigo-600 text-white flex items-center gap-1"><Plus className="w-3 h-3" /> step</button></div>
                <div className="space-y-2">
                  {(editing.steps || []).map((s, i) => (
                    <div key={i} className="border dark:border-gray-700 rounded p-2 grid grid-cols-12 gap-1.5 items-center">
                      <input type="number" value={s.order} onChange={e => setStep(i, { order: Number(e.target.value) })} className="col-span-1 px-1 py-1 rounded border dark:border-gray-700 bg-transparent" title="order" />
                      <input value={s.target_key} onChange={e => setStep(i, { target_key: e.target.value })} placeholder="target_key" className="col-span-3 px-1.5 py-1 rounded border dark:border-gray-700 bg-transparent" />
                      <label className="col-span-2 flex items-center gap-1 text-xs"><input type="checkbox" checked={!!s.is_payment} onChange={e => setStep(i, { is_payment: e.target.checked })} /> payment</label>
                      <select value={s.on_true} onChange={e => setStep(i, { on_true: e.target.value as any })} className="col-span-2 px-1 py-1 rounded border dark:border-gray-700 bg-transparent" title="on TRUE">{ACTIONS.map(a => <option key={a} value={a}>T→{a}</option>)}</select>
                      <select value={s.on_false} onChange={e => setStep(i, { on_false: e.target.value as any })} className="col-span-2 px-1 py-1 rounded border dark:border-gray-700 bg-transparent" title="on FALSE">{ACTIONS.map(a => <option key={a} value={a}>F→{a}</option>)}</select>
                      <label className="col-span-1 flex items-center gap-0.5 text-xs"><input type="checkbox" checked={s.enabled !== false} onChange={e => setStep(i, { enabled: e.target.checked })} /></label>
                      <button onClick={() => removeStep(i)} className="col-span-1 text-red-500"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  ))}
                </div>
              </div>

              {/* bindings (OA) — paste/add hook_id; empty = chain does NOT fire (opt-in) */}
              <div>
                <div className="font-medium mb-1">OA bindings <span className="text-xs text-gray-400">{t('pageui.handoff.bindings_hint', '(chain ทำงานเฉพาะ OA ที่ผูก · ว่าง = ไม่ทำงาน)')}</span></div>
                <div className="flex gap-1 mb-1">
                  <input id="bindInput" placeholder={t('pageui.handoff.bind_ph', 'วาง hook_id แล้ว Enter')} onKeyDown={e => { if (e.key === 'Enter') { addBinding((e.target as HTMLInputElement).value.trim()); (e.target as HTMLInputElement).value = ''; } }} className="flex-1 px-2 py-1.5 rounded border dark:border-gray-700 bg-transparent" />
                </div>
                <div className="flex flex-wrap gap-1">
                  {bindings.map(b => (
                    <span key={b.hook_id} className="text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 flex items-center gap-1">{b.hook_id}<button onClick={() => removeBinding(b.hook_id)}><X className="w-3 h-3" /></button></span>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5 pt-3 border-t dark:border-gray-700">
              <button onClick={() => setEditing(null)} className="px-4 py-1.5 rounded border dark:border-gray-600 text-sm">{t('pageui.handoff.cancel', 'ยกเลิก')}</button>
              <button onClick={save} disabled={saving} className="px-4 py-1.5 rounded bg-indigo-600 text-white text-sm flex items-center gap-1">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} {t('pageui.handoff.save', 'บันทึก')}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── run detail modal ── */}
      {detail && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center overflow-auto py-8 px-3">
          <div className="bg-white dark:bg-gray-900 rounded-lg w-full max-w-3xl p-5 my-auto">
            <div className="flex justify-between items-center mb-3">
              <h2 className="font-bold flex items-center gap-2">Run · {detail.run.chain_key} {detail.run.needs_review && <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500 text-white">{t('pageui.handoff.needs_review', 'ต้องตรวจ')}</span>}</h2>
              <button onClick={() => setDetail(null)}><X className="w-5 h-5" /></button>
            </div>
            <div className="text-xs text-gray-500 mb-3">member {detail.run.member_user_id} · slip {String(detail.run.slip_record_id)} · status {detail.run.status}</div>
            <div className="space-y-2">
              {detail.steps.map((s, i) => (
                <div key={i} className="border dark:border-gray-700 rounded p-2.5 text-xs">
                  <div className="flex items-center gap-2 font-medium">
                    <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800">step {s.chain_step}</span>
                    <span>{s.target_key}</span>
                    <span className={`px-1.5 py-0.5 rounded ${s.context?.outcome === 'TRUE' ? 'bg-green-100 text-green-700' : s.context?.outcome === 'TIMEOUT' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>{s.context?.outcome || s.status}</span>
                    {s.context?.slip_locked && <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">🔒 {s.context?.lock_reason}</span>}
                    <span className="ml-auto text-gray-400">stmt[{s.stmt_idx ?? '-'}] · {s.triggered_by}</span>
                  </div>
                  {/* [FEAT-20260805-CHAIN] log ครบ: endpoint + headers + request body + response body + timeout */}
                  <div className="mt-1.5 space-y-1 text-gray-500 break-all">
                    <div>endpoint: <span className="font-mono">{s.request?.method || 'POST'} {s.request?.url || s.context?.endpoint_url || '-'}</span></div>
                    <div>reason: {s.context?.reason || s.outcome_code || '-'}
                      {s.final?.http_status != null && ` · http ${s.final.http_status}`}
                      {s.final?.received_via && ` · ${s.final.received_via}`}
                    </div>
                    {s.request?.headers_redacted && (
                      <div>headers (redacted):<pre className="mt-0.5 bg-gray-50 dark:bg-gray-800 rounded p-1.5 overflow-auto max-h-24 text-[11px] whitespace-pre-wrap">{JSON.stringify(s.request.headers_redacted, null, 2)}</pre></div>
                    )}
                    {s.request?.body != null && (
                      <div>request body:<pre className="mt-0.5 bg-gray-50 dark:bg-gray-800 rounded p-1.5 overflow-auto max-h-32 text-[11px] whitespace-pre-wrap">{JSON.stringify(s.request.body, null, 2)}</pre></div>
                    )}
                    {(s.final?.raw != null || s.final?.raw_text) && (
                      <div>response body:<pre className="mt-0.5 bg-gray-50 dark:bg-gray-800 rounded p-1.5 overflow-auto max-h-32 text-[11px] whitespace-pre-wrap">{JSON.stringify(s.final?.raw ?? s.final?.raw_text, null, 2)}</pre></div>
                    )}
                    {s.final?.received_via === 'timeout' && (
                      <div className="text-amber-600">{t('pageui.handoff.step_timeout', '⏱ timeout — ไม่มี response (ผลกำกวม · ล็อก+ต้องตรวจ)')}</div>
                    )}
                  </div>
                </div>
              ))}
              {detail.steps.length === 0 && <div className="text-gray-400 text-sm">{t('pageui.handoff.no_step', 'ยังไม่มี step')}</div>}
            </div>
          </div>
        </div>
      )}

      {confirmDel && (
        <ConfirmModal
          isOpen={true}
          title={t('pageui.handoff.delete_chain_title', 'ลบ chain?')}
          message={t('pageui.handoff.delete_chain_msg', 'ลบ "{key}" (soft delete) — ประวัติ run เดิมยังอยู่', { key: confirmDel.key })}
          onConfirm={del}
          onCancel={() => setConfirmDel(null)}
          onClose={() => setConfirmDel(null)}
        />
      )}
    </div>
  );
}
// ==== [FEAT-20260805-CHAIN] END ====
