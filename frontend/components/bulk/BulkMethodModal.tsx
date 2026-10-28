/* ==== [FEAT-20260806-BULKMETHOD] START — bulk-apply ONE setting across many OAs ====
 * A standalone stepper that REPLACES the old On/Off popup on /#/hooks with a
 * "choose method to apply" chooser. Pluggable + removable: WebhookList opens this
 * instead of BulkStatusModal, and the old modal + its state are left intact so
 * reverting is a one-line repoint of the toolbar button.
 *
 *   Flow — one choice per step, the rest hidden, Back to revise:
 *     [target]  two tick-boxes: use the N pre-selected OAs  |  pick group(s) → OA(s)
 *         └ pick → [group] MULTI-SELECT (tick several groups) → [oa] OAs from ALL
 *                  picked groups (multi-group; ตาม perm JWT)
 *     [method]  one of:  OA On/Off · Slip Verification · Customer Link · Custom Tool
 *               On / Off is always visible (nothing preselected — click to record)
 *     [confirm] review (groups + OA names + method + On/Off), then a SECOND nested
 *               modal requires a ✓ check before anything is written (double-confirm)
 *
 * Apply: status → bulkUpdateHookStatus · the 3 flags → bulkUpdateHookSetting. Both BE
 * endpoints check group access per hook, so a multi-group id list is fine as-is.
 * ⚠️ Handoff On/Off is intentionally NOT here yet — phase 2 (see auto_todo). Adding
 *    it later = one METHODS entry + a handoff bulk endpoint, nothing else changes.
 * revert: delete this file + its import/state/render in WebhookList, and repoint the
 *         On/Off toolbar button back to openBulkStatus.
 * ==== [FEAT-20260806-BULKMETHOD] END
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  X, Search, Loader2, ChevronDown, Check, Power, ShieldCheck, Link2, Wrench,
  CheckSquare, Square, Layers, ArrowRight, AlertTriangle, Banknote,
  BellOff, Bot,
} from 'lucide-react';
import { webhookService } from '../../services/hook';
import { fetchVisibleGroups, filterVisibleHooks, VisibleGroup } from '../../services/admin';
import { useI18n } from '../../i18n';
/* [FEAT-20260828-BULKAI] รายชื่อ vendor มาจากแหล่งเดียวของแอป ห้ามก๊อปมาวางที่นี่
   ดูเหตุผลเต็มที่ `config/aiVendors.ts` */
import { AI_VENDORS, asAiVendor } from '../../config/aiVendors';

export interface BulkTargetOA { id: string; name: string }

interface HookLike { _id?: string; id?: string; alias?: string; display_name?: string; line_oa_name?: string; company_name?: string; _grpName?: string }
const hookId = (h: HookLike) => String(h?._id || h?.id || '');
const hookLabel = (h: HookLike) => h?.display_name || h?.line_oa_name || h?.company_name || h?.alias || hookId(h);

// the 5 shippable methods. status → its own bulk endpoint; payment_tool_status → its own
// VALIDATED endpoint; the rest → /hook/settings/bulk.
// (handoff is deliberately omitted until phase 2 — see the header note)
//
// [FEAT-20260809-BULKPAYMENT] `payment_tool_status` is NOT part of the settings/bulk whitelist
// on purpose. It routes to PATCH /hook/payment/bulk, which validates every target before
// enabling and refuses the whole batch (403 + blocked[]) if any OA is not ready. Adding it to
// the generic route would skip that check and switch money on for half-configured OAs.
/* [FEAT-20260828-BULKAI] `ai` ไม่ใช่สวิตช์ on/off เหมือนอีกหกตัว — มันตั้ง "ค่า"
   (vendor / model) และติ๊กแยกกันได้ · ทางเดินของหกตัวเดิมไม่ถูกแตะเลย
   ⚠️ ทุกที่ที่แตกแขนงด้วย `method === 'ai'` มีเหตุผลกำกับไว้ที่จุดนั้น */
type MethodKey = 'status' | 'slip_check' | 'customer_link_enabled' | 'custom_tool_status' | 'payment_tool_status' | 'ignore_abandon_assist' | 'ai';
/** methods that go through PATCH /hook/settings/bulk (the plain, unvalidated whitelist) */
type SettingMethodKey = 'slip_check' | 'customer_link_enabled' | 'custom_tool_status';
const METHODS: Array<{ key: MethodKey; icon: React.ReactNode; labelKey: string }> = [
  { key: 'status', icon: <Power size={22} />, labelKey: 'bulk_method.m_status' },
  { key: 'slip_check', icon: <ShieldCheck size={22} />, labelKey: 'bulk_method.m_slip' },
  { key: 'customer_link_enabled', icon: <Link2 size={22} />, labelKey: 'bulk_method.m_customer_link' },
  { key: 'custom_tool_status', icon: <Wrench size={22} />, labelKey: 'bulk_method.m_custom_tool' },
  { key: 'payment_tool_status', icon: <Banknote size={22} />, labelKey: 'bulk_method.m_payment' },
  // [FEAT-20260821-BULKABANDON] its own validated route — see webhookService for why it must
  // not join the generic settings whitelist (golden parity).
  { key: 'ignore_abandon_assist', icon: <BellOff size={22} />, labelKey: 'bulk_method.m_abandon' },
  // [FEAT-20260828-BULKAI] ตั้ง vendor / model — เส้น PATCH /hook/ai/bulk ของตัวเอง
  { key: 'ai', icon: <Bot size={22} />, labelKey: 'bulk_method.m_ai' },
];
const METHOD_LABEL_KEY: Record<MethodKey, string> = {
  status: 'bulk_method.m_status',
  slip_check: 'bulk_method.m_slip',
  customer_link_enabled: 'bulk_method.m_customer_link',
  custom_tool_status: 'bulk_method.m_custom_tool',
  payment_tool_status: 'bulk_method.m_payment',
  ignore_abandon_assist: 'bulk_method.m_abandon',
  ai: 'bulk_method.m_ai',
};

type TargetMode = 'selected' | 'pick';
type StepKey = 'target' | 'group' | 'oa' | 'method' | 'confirm';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** OAs already selected in the page toolbar (the "(N)") — display + id source */
  preselected: BulkTargetOA[];
  /** called after a successful apply so the page can refresh + show its own alert */
  /* [FEAT-20260828-BULKAI] `state` เป็น null ได้แล้ว และมี `stateLabel` มาแทน
     🔴 AI ไม่มีสถานะเปิด/ปิด — การบังคับให้ส่ง boolean จะทำให้ข้อความสรุปโกหก
        (ต้องเลือกระหว่าง "เปิด" กับ "ปิด" ทั้งที่ผู้ใช้ตั้ง vendor)
     ⚠️ ผู้เรียกต้องอ่าน `stateLabel` ก่อน แล้วค่อยตกไปที่ `state` — ดูจุดใช้ใน
        `WebhookList.tsx` · หกตัวเดิมยังส่ง boolean เหมือนเดิมทุกตัว */
  onApplied: (info: { methodLabel: string; state: boolean | null; stateLabel?: string; count: number }) => void;
}

export const BulkMethodModal: React.FC<Props> = ({ isOpen, onClose, preselected, onApplied }) => {
  const { t } = useI18n();
  const hasPre = preselected.length > 0;

  const [targetMode, setTargetMode] = useState<TargetMode>('selected');
  const [step, setStep] = useState<StepKey>('target');

  const [groups, setGroups] = useState<VisibleGroup[]>([]);
  // MULTI-GROUP: several groups can be ticked at once
  const [pickedGroupIds, setPickedGroupIds] = useState<Set<string>>(new Set());
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupSearch, setGroupSearch] = useState('');

  const [hooks, setHooks] = useState<HookLike[]>([]);
  const [loadingHooks, setLoadingHooks] = useState(false);
  const [oaSearch, setOaSearch] = useState('');
  // id → name map, accumulates across everything (multi-group)
  const [pickedOa, setPickedOa] = useState<Record<string, string>>({});

  const [method, setMethod] = useState<MethodKey | null>(null);
  const [value, setValue] = useState<boolean | null>(null);
  /* [FEAT-20260828-BULKAI] สองช่องนี้ **ติ๊กแยกกัน** ตามที่เจ้าของสั่ง
     🔴 ธง "ติ๊กหรือยัง" แยกจาก "ค่าที่เลือก" โดยตั้งใจ — ติ๊กแล้วปล่อยว่างคือคำสั่ง
        ที่มีความหมายจริง (= ใช้ค่าเริ่มต้น ⇒ เขียน null) ซึ่งต่างจากไม่ติ๊ก
        (= อย่าไปยุ่งกับช่องนี้) · ถ้ายุบเป็นตัวแปรเดียว สองเจตนานี้จะแยกไม่ออก
        และการตั้ง vendor อย่างเดียวจะไปล้าง model ของ OA ทิ้งด้วย */
  const [aiVendorOn, setAiVendorOn] = useState(false);
  const [aiVendor, setAiVendor] = useState('');
  const [aiModelOn, setAiModelOn] = useState(false);
  const [aiModel, setAiModel] = useState('');

  const [confirmOpen, setConfirmOpen] = useState(false); // the 2nd (nested) confirm layer
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  /* [FEAT-20260809-BULKPAYMENT] the OAs a 403 refused, kept structured ({alias, reason}) so
     each can be listed on its own row. Cleared everywhere `error` is, so a stale refusal from
     a previous attempt can never linger behind a later screen. */
  const [blockedRows, setBlockedRows] = useState<Array<{ alias?: string; reason?: string }>>([]);

  // fresh start every open — no preselected → force the pick path
  useEffect(() => {
    if (!isOpen) return;
    setTargetMode(hasPre ? 'selected' : 'pick');
    setStep(hasPre ? 'target' : 'group');
    setPickedGroupIds(new Set()); setGroupOpen(false); setGroupSearch('');
    setHooks([]); setOaSearch(''); setPickedOa({});
    setMethod(null); setValue(null); setConfirmOpen(false); setSaving(false); setError(''); setBlockedRows([]);
    // [FEAT-20260828-BULKAI] ล้างพร้อมกับตัวอื่น — ค่าค้างจากรอบก่อนคือคำสั่งที่ไม่มีใครสั่ง
    setAiVendorOn(false); setAiVendor(''); setAiModelOn(false); setAiModel('');
  }, [isOpen, hasPre]);

  useEffect(() => {
    if (!isOpen || targetMode !== 'pick' || groups.length) return;
    fetchVisibleGroups().then(setGroups).catch(() => setGroups([]));
  }, [isOpen, targetMode, groups.length]);

  // load OAs of ALL picked groups (perm-filtered), merged + tagged with their group.
  // KEEP prior OA picks → true multi-group.
  const groupKey = useMemo(() => [...pickedGroupIds].sort().join(','), [pickedGroupIds]);
  useEffect(() => {
    if (!pickedGroupIds.size) { setHooks([]); return; }
    let alive = true; setLoadingHooks(true);
    Promise.all([...pickedGroupIds].map((gid) =>
      webhookService.getHooksByGroup(gid)
        .then((hs) => filterVisibleHooks(hs as any[]).map((h: any) => ({ ...h, _grpName: groups.find((g) => g._id === gid)?.group_name || '' })))
        .catch(() => [])
    )).then((arrs) => {
      if (!alive) return;
      const merged: HookLike[] = []; const seen = new Set<string>();
      arrs.flat().forEach((h: HookLike) => { const id = hookId(h); if (id && !seen.has(id)) { seen.add(id); merged.push(h); } });
      setHooks(merged);
    }).finally(() => { if (alive) setLoadingHooks(false); });
    return () => { alive = false; };
  }, [groupKey, groups]);

  const filteredGroups = useMemo(() => {
    const q = groupSearch.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) => `${g.group_name} ${g.description || ''}`.toLowerCase().includes(q));
  }, [groups, groupSearch]);
  const pickedGroupNames = [...pickedGroupIds].map((id) => groups.find((g) => g._id === id)?.group_name || id);

  const filteredHooks = useMemo(() => {
    const q = oaSearch.trim().toLowerCase();
    if (!q) return hooks;
    return hooks.filter((h) => `${hookLabel(h)} ${h.alias || ''} ${h._grpName || ''}`.toLowerCase().includes(q));
  }, [hooks, oaSearch]);

  // the OAs the action will actually hit — pick mode reads the accumulated map so a
  // selection survives switching groups (multi-group)
  const pickedCount = Object.keys(pickedOa).length;
  const targetOAs: BulkTargetOA[] = targetMode === 'selected'
    ? preselected
    : Object.entries(pickedOa).map(([id, name]) => ({ id, name }));
  const targetIds = targetOAs.map((o) => o.id);

  // step flow depends on the chosen target mode (recomputed live)
  const flow: StepKey[] = targetMode === 'selected'
    ? ['target', 'method', 'confirm']
    : hasPre ? ['target', 'group', 'oa', 'method', 'confirm'] : ['group', 'oa', 'method', 'confirm'];
  const idx = Math.max(0, flow.indexOf(step));

  /* [FEAT-20260828-BULKAI] พร้อมไปต่อไหม
     · ติ๊ก vendor แล้วต้อง **เลือก** ด้วย — ติ๊กแล้วปล่อยว่างคือคำสั่งที่ไม่ชัด
       (จะสื่อว่า "ใช้ค่าเริ่มต้น" ก็ได้ แต่บนจอมันแยกจาก "ยังไม่ได้เลือก" ไม่ออก)
     · ติ๊ก model แล้วปล่อยว่าง **ได้** และแปลว่า "ใช้ค่าเริ่มต้นของ vendor" ซึ่งเป็น
       สิ่งที่ผู้ใช้อาจตั้งใจจริง (ล้างโมเดลที่เคยตั้งไว้) ⇒ ไม่บังคับให้กรอก */
  const aiReady =
    (aiVendorOn && asAiVendor(aiVendor) !== null) || aiModelOn;

  const canNext =
    step === 'target' ? true
    : step === 'group' ? pickedGroupIds.size > 0
    : step === 'oa' ? pickedCount > 0
    /* [FEAT-20260828-BULKAI] AI ไม่มี on/off ⇒ เงื่อนไขคนละข้อ
       ต้องติ๊กอย่างน้อยหนึ่งช่อง และช่องที่ติ๊กต้องมีค่าใช้ได้
       ⚠️ หกตัวเดิมยังใช้เงื่อนไขเดิมทุกตัวอักษร */
    : step === 'method' ? (method === 'ai' ? aiReady : (method !== null && value !== null))
    : true;

  const goNext = () => { if (canNext && idx < flow.length - 1) { setStep(flow[idx + 1]); setError(''); setBlockedRows([]); } };
  const goBack = () => { if (idx > 0) { setStep(flow[idx - 1]); setError(''); setBlockedRows([]); } };
  const jump = (s: StepKey) => { const j = flow.indexOf(s); if (j >= 0 && j <= idx) { setStep(s); setError(''); setBlockedRows([]); } };

  const toggleGroup = (gid: string) => setPickedGroupIds((prev) => { const n = new Set(prev); n.has(gid) ? n.delete(gid) : n.add(gid); return n; });
  const toggleOa = (h: HookLike) => setPickedOa((prev) => {
    const id = hookId(h); const n = { ...prev };
    if (n[id]) delete n[id]; else n[id] = hookLabel(h);
    return n;
  });
  const removeOa = (id: string) => setPickedOa((prev) => { const n = { ...prev }; delete n[id]; return n; });
  const allShownPicked = filteredHooks.length > 0 && filteredHooks.every((h) => pickedOa[hookId(h)]);
  const toggleAllShown = () => setPickedOa((prev) => {
    const n = { ...prev };
    if (allShownPicked) filteredHooks.forEach((h) => { delete n[hookId(h)]; });
    else filteredHooks.forEach((h) => { n[hookId(h)] = hookLabel(h); });
    return n;
  });

  /** [FEAT-20260828-BULKAI] สรุปเป็นข้อความว่ารอบนี้จะเขียนอะไรบ้าง */
  const aiSummary = [
    aiVendorOn ? `${t('bulk_method.ai_vendor')}: ${aiVendor || t('bulk_method.ai_default')}` : null,
    aiModelOn ? `${t('bulk_method.ai_model')}: ${aiModel.trim() || t('bulk_method.ai_default')}` : null,
  ].filter(Boolean).join(' · ');

  const applyNow = async () => {
    /* [FEAT-20260828-BULKAI] AI ไม่มี `value` ⇒ ด่านเดิมจะกันมันตกทั้งที่พร้อมส่ง
       ⚠️ หกตัวเดิมยังต้องมี `value` ครบเหมือนเดิมทุกประการ */
    if (!method || targetIds.length === 0) return;
    if (method === 'ai' ? !aiReady : value === null) return;
    setSaving(true); setError(''); setBlockedRows([]);
    try {
      if (method === 'status') await webhookService.bulkUpdateHookStatus(targetIds, value ? 1 : 0);
      // [FEAT-20260809-BULKPAYMENT] payment has its own validated endpoint — see METHODS above.
      // `value` is already a real boolean here (the step-2 buttons set true/false, never a
      // string), which matters: the BE rejects non-booleans because "false" is truthy in JS.
      else if (method === 'payment_tool_status') await webhookService.bulkUpdateHookPayment(targetIds, value);
      // [FEAT-20260821-BULKABANDON] same reason as payment: its own route, real boolean.
      else if (method === 'ignore_abandon_assist') await webhookService.bulkUpdateHookAbandon(targetIds, value);
      /* [FEAT-20260828-BULKAI] ส่งเฉพาะช่องที่ติ๊ก — ช่องที่ไม่ได้ติ๊กต้องไม่อยู่ใน
         body เลย ไม่ใช่ส่ง null ไป (นั่นคือการสั่งล้างค่าเดิม) */
      else if (method === 'ai') {
        const fields: { ai_vendor?: string | null; ai_model?: string | null } = {};
        if (aiVendorOn) fields.ai_vendor = asAiVendor(aiVendor);
        if (aiModelOn) fields.ai_model = aiModel.trim() || null;
        await webhookService.bulkUpdateHookAi(targetIds, fields);
        onApplied({
          methodLabel: t(METHOD_LABEL_KEY[method]),
          state: null,
          stateLabel: aiSummary,
          count: targetIds.length,
        });
        onClose();
        return;
      }
      else await webhookService.bulkUpdateHookSetting(targetIds, method as SettingMethodKey, value as boolean);
      onApplied({ methodLabel: t(METHOD_LABEL_KEY[method]), state: value, count: targetIds.length });
      onClose();
    } catch (e: any) {
      // The API names the OAs it refused (403 blocked[]). Keep them as STRUCTURED rows rather
      // than one joined string: the operator has to fix each named OA and retry, and a wall of
      // newline-joined text in a generic error box is far harder to act on.
      // ต้องเห็นว่า OA ไหนไม่ผ่าน และไม่ผ่านเพราะอะไร จะได้ตามแก้ทีละตัว
      if (Array.isArray(e?.blocked) && e.blocked.length > 0) setBlockedRows(e.blocked);
      setError(Array.isArray(e?.blocked) && e.blocked.length > 0 ? '' : (e?.message || t('bulk_method.failed_title')));
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const STEP_NAME: Record<StepKey, string> = {
    target: t('bulk_method.step_target'), group: t('bulk_method.step_group'),
    oa: t('bulk_method.step_oa'), method: t('bulk_method.step_method'), confirm: t('bulk_method.step_confirm'),
  };
  /* [FEAT-20260809-BULKPAYMENT] the refusal list for a 403 from PATCH /hook/payment/bulk.
     WHAT: one row per OA the backend would not enable, with the reason it gave.
     WHY : enabling payment is all-or-nothing — NOTHING was written, so the operator has to see
           exactly which OAs to fix before retrying. Collapsing this into a single error string
           throws away the only actionable part of the response.
           ต้องบอกเป็นราย OA ว่าใครไม่ผ่านและเพราะอะไร ไม่งั้นตามแก้ไม่ถูก
     HOW : `reason` is operator-facing Thai written by the backend — render it as-is, do not
           translate or prettify it here, or it will drift from what the backend actually says. */
  const blockedList = blockedRows.length > 0 && (
    <div data-testid="bm-blocked" className="rounded-lg border border-rose-200 bg-rose-50 p-3 dark:border-rose-800 dark:bg-rose-900/20">
      <div className="mb-2 flex items-center gap-2 text-sm font-bold text-rose-700 dark:text-rose-300">
        <AlertTriangle size={16} />
        {t('bulk_method.blocked_title', { count: String(blockedRows.length) })}
      </div>
      <ul className="space-y-1">
        {blockedRows.map((b, i) => (
          <li key={i} data-testid="bm-blocked-row" className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="font-bold text-rose-800 dark:text-rose-200 break-all">{b.alias || '—'}</span>
            <span className="text-rose-600 dark:text-rose-400">{b.reason || ''}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-rose-600/80 dark:text-rose-400/80">
        {t('bulk_method.blocked_hint')}
      </p>
    </div>
  );

  const valueBadge = (on: boolean) => (
    <span className={`px-2.5 py-0.5 rounded-full text-sm font-bold ${on
      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
      : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'}`}>
      {on ? t('bulk_method.value_on') : t('bulk_method.value_off')}
    </span>
  );

  return (
    <>
      <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
        {/* +30% size: max-w-4xl · h-[90vh] */}
        <div className="w-full max-w-4xl h-[90vh] flex flex-col rounded-2xl bg-white shadow-2xl dark:bg-slate-900 border border-slate-200 dark:border-slate-700">

          {/* header */}
          <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5 dark:border-slate-700">
            <div className="flex items-center gap-3 min-w-0">
              <span className="rounded-xl bg-amber-100 p-2.5 text-amber-600 dark:bg-amber-900/40"><Layers size={24} /></span>
              <div className="min-w-0">
                <h3 className="text-2xl font-black text-slate-800 dark:text-slate-100 truncate">{t('bulk_method.title')}</h3>
                <p className="text-sm text-slate-400">{STEP_NAME[step]}</p>
              </div>
            </div>
            <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><X size={22} /></button>
          </div>

          {/* step tracker — clickable back only */}
          <div className="flex items-center gap-1.5 border-b border-slate-100 px-6 py-3 text-sm dark:border-slate-800 overflow-x-auto">
            {flow.map((s, i) => (
              <React.Fragment key={s}>
                {i > 0 && <span className="text-slate-300 dark:text-slate-600">→</span>}
                <button type="button" onClick={() => jump(s)} disabled={i > idx}
                  className={`rounded-full px-3 py-1 font-semibold whitespace-nowrap transition ${
                    step === s ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                    : i < idx ? 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer'
                    : 'text-slate-300 dark:text-slate-600 cursor-not-allowed'
                  }`}>{i + 1}. {STEP_NAME[s]}</button>
              </React.Fragment>
            ))}
          </div>

          {/* body */}
          <div className="flex-1 min-h-0 overflow-auto px-6 py-5 space-y-4">

            {/* ══ STEP: target — two checkbox-style boxes (tick one) ══ */}
            {step === 'target' && (
              <div className="space-y-3">
                <p className="text-base font-bold text-slate-600 dark:text-slate-300">{t('bulk_method.target_choose')}</p>
                <button type="button" data-testid="bm-target-selected" onClick={() => { setTargetMode('selected'); setError(''); setBlockedRows([]); }}
                  className={`w-full rounded-xl border-2 p-5 text-left transition ${
                    targetMode === 'selected' ? 'border-amber-400 bg-amber-50 dark:bg-amber-900/20' : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'
                  }`}>
                  <span className="flex items-center gap-3">
                    {targetMode === 'selected' ? <CheckSquare size={22} className="text-amber-600" /> : <Square size={22} className="text-slate-400" />}
                    <span className="text-lg font-semibold text-slate-800 dark:text-slate-100">{t('bulk_method.target_selected', { count: String(preselected.length) })}</span>
                  </span>
                  {preselected.length > 0 && (
                    <span className="mt-2 flex flex-wrap gap-1.5">
                      {preselected.map((o) => (
                        <span key={o.id} className="px-2.5 py-0.5 rounded bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-200 text-sm font-medium break-all">{o.name}</span>
                      ))}
                    </span>
                  )}
                </button>
                <button type="button" data-testid="bm-target-pick" onClick={() => { setTargetMode('pick'); setError(''); setBlockedRows([]); }}
                  className={`w-full rounded-xl border-2 p-5 text-left transition ${
                    targetMode === 'pick' ? 'border-amber-400 bg-amber-50 dark:bg-amber-900/20' : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'
                  }`}>
                  <span className="flex items-center gap-3">
                    {targetMode === 'pick' ? <CheckSquare size={22} className="text-amber-600" /> : <Square size={22} className="text-slate-400" />}
                    <span className="text-lg font-semibold text-slate-800 dark:text-slate-100">{t('bulk_method.target_pick')}</span>
                  </span>
                  <span className="mt-1 block text-base text-slate-500 dark:text-slate-400">{t('bulk_method.target_pick_desc')}</span>
                </button>
              </div>
            )}

            {/* ══ STEP: group — MULTI-SELECT (tick several groups) ══ */}
            {step === 'group' && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="block text-base font-semibold text-slate-700 dark:text-slate-200">{t('bulk_method.pick_group_label')}</label>
                  <span className="text-sm font-semibold text-amber-600 dark:text-amber-400">{t('bulk_method.group_selected', { count: String(pickedGroupIds.size) })}</span>
                </div>
                <div className="relative">
                  <button type="button" data-testid="bm-group-toggle" onClick={() => setGroupOpen((o) => !o)}
                    className="w-full flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-3 text-base">
                    <span className="flex-1 min-w-0 text-left text-slate-700 dark:text-slate-200">
                      {pickedGroupIds.size ? t('bulk_method.group_selected', { count: String(pickedGroupIds.size) }) : <span className="text-slate-500 dark:text-slate-400">{t('bulk_method.pick_group')}</span>}
                    </span>
                    <ChevronDown size={18} className={`text-slate-400 transition-transform ${groupOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {groupOpen && (
                    <div className="absolute z-30 mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-xl">
                      <div className="relative p-2 border-b border-slate-100 dark:border-slate-700">
                        <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input autoFocus value={groupSearch} onChange={(e) => setGroupSearch(e.target.value)}
                          placeholder={t('bulk_method.search_group')}
                          className="w-full rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 py-2 pl-9 pr-2 text-base dark:text-slate-200" />
                      </div>
                      {/* tick several — the dropdown stays open on select */}
                      <div className="max-h-72 overflow-y-auto p-1">
                        {filteredGroups.length === 0 ? (
                          <p className="p-2 text-center text-sm text-slate-400">{t('bulk_method.no_group')}</p>
                        ) : filteredGroups.map((g) => {
                          const on = pickedGroupIds.has(g._id);
                          return (
                            <button key={g._id} type="button" data-testid={`bm-group-${g._id}`} onClick={() => toggleGroup(g._id)}
                              className={`w-full flex items-center gap-2 rounded-md px-3 py-2.5 text-left ${on ? 'bg-amber-100 dark:bg-amber-900/40' : 'hover:bg-slate-50 dark:hover:bg-slate-700'}`}>
                              {on ? <CheckSquare size={18} className="shrink-0 text-amber-600" /> : <Square size={18} className="shrink-0 text-slate-400" />}
                              <span className="min-w-0">
                                <span className={`block truncate text-base font-medium ${on ? 'text-amber-700 dark:text-amber-300' : 'text-slate-700 dark:text-slate-200'}`}>{g.group_name}</span>
                                {g.description && <span className="block truncate text-sm text-slate-400">{g.description}</span>}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
                {/* picked-group chips (removable) */}
                {pickedGroupIds.size > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {[...pickedGroupIds].map((gid) => (
                      <span key={gid} className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-200 text-sm font-medium break-all">
                        {groups.find((g) => g._id === gid)?.group_name || gid}
                        <button type="button" onClick={() => toggleGroup(gid)} className="hover:text-rose-600"><X size={13} /></button>
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-sm text-slate-400">{t('bulk_method.pick_group_hint')}</p>
              </div>
            )}

            {/* ══ STEP: oa — OAs from ALL picked groups (multi-group) ══ */}
            {step === 'oa' && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="block text-base font-semibold text-slate-700 dark:text-slate-200">{t('bulk_method.pick_oa_label')}</label>
                  <span className="text-sm font-semibold text-amber-600 dark:text-amber-400">{t('bulk_method.oa_selected', { count: String(pickedCount) })}</span>
                </div>
                <div className="relative">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input value={oaSearch} onChange={(e) => setOaSearch(e.target.value)} placeholder={t('bulk_method.search_oa')}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 py-2.5 pl-9 pr-3 text-base dark:text-slate-200" />
                </div>
                {filteredHooks.length > 0 && (
                  <button type="button" onClick={toggleAllShown}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-amber-600 dark:text-slate-400">
                    {allShownPicked ? <CheckSquare size={16} /> : <Square size={16} />} {t('bulk_method.select_all_shown')}
                  </button>
                )}
                <div className="max-h-[38vh] space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-1 dark:border-slate-700">
                  {loadingHooks ? (
                    <p className="p-3 text-center text-base text-slate-400"><Loader2 size={16} className="animate-spin inline mr-1" /> {t('bulk_method.loading')}</p>
                  ) : filteredHooks.length === 0 ? (
                    <p className="p-3 text-center text-base text-slate-400">{t('bulk_method.no_oa')}</p>
                  ) : filteredHooks.map((h) => {
                    const id = hookId(h); const on = !!pickedOa[id];
                    return (
                      <button key={id} type="button" data-testid={`bm-oa-${id}`} onClick={() => toggleOa(h)}
                        className={`w-full flex items-center gap-2 rounded-lg px-3 py-2.5 text-base text-left ${on ? 'bg-amber-100 dark:bg-amber-900/40' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
                        {on ? <CheckSquare size={18} className="shrink-0 text-amber-600" /> : <Square size={18} className="shrink-0 text-slate-400" />}
                        <span className="truncate text-slate-700 dark:text-slate-200">{hookLabel(h)}</span>
                        {h.alias && <span className="shrink-0 text-sm text-slate-400">{h.alias}</span>}
                        {h._grpName && <span className="ml-auto shrink-0 text-xs text-slate-400 rounded bg-slate-100 dark:bg-slate-700/60 px-1.5 py-0.5">{h._grpName}</span>}
                      </button>
                    );
                  })}
                </div>
                {pickedCount > 0 && (
                  <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-2.5 bg-slate-50 dark:bg-slate-800/50">
                    <div className="mb-1 text-xs font-bold uppercase text-slate-400">{t('bulk_method.oa_selected_all', { count: String(pickedCount) })}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {targetOAs.map((o) => (
                        <span key={o.id} className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-200 text-sm font-medium break-all">
                          {o.name}
                          <button type="button" onClick={() => removeOa(o.id)} className="hover:text-rose-600"><X size={13} /></button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ══ STEP: method + value (On/Off always visible) ══ */}
            {step === 'method' && (
              <div className="space-y-4">
                <div>
                  <p className="text-base font-bold text-slate-600 dark:text-slate-300 mb-2">{t('bulk_method.choose')}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {METHODS.map((m) => (
                      <button key={m.key} type="button" data-testid={`bm-method-${m.key}`} onClick={() => { setMethod(m.key); setError(''); setBlockedRows([]); }}
                        className={`flex items-center gap-3 rounded-xl border-2 p-4 text-left transition ${
                          method === m.key ? 'border-amber-400 bg-amber-50 dark:bg-amber-900/20' : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'
                        }`}>
                        <span className={method === m.key ? 'text-amber-600' : 'text-slate-400'}>{m.icon}</span>
                        <span className="text-lg font-semibold text-slate-800 dark:text-slate-100">{t(m.labelKey)}</span>
                      </button>
                    ))}
                  </div>
                </div>
                {/* [FEAT-20260828-BULKAI] AI มีขั้นเลือกค่าเป็นของตัวเอง
                    🔴 แทนที่ปุ่ม เปิด/ปิด ไม่ใช่วางเพิ่มข้าง ๆ — ปุ่มเปิด/ปิดไม่มี
                       ความหมายกับ vendor/model และการโชว์ทิ้งไว้จะเชิญให้กด
                       แล้วค่าที่กดก็ไม่ถูกส่งไปไหน = ปุ่มหลอก */}
                {method === 'ai' ? (
                  <div className="space-y-3" data-testid="bm-ai-panel">
                    <p className="text-base font-bold text-slate-600 dark:text-slate-300">{t('bulk_method.ai_choose')}</p>

                    {/* ── vendor ─────────────────────────────────────────── */}
                    <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          data-testid="bm-ai-vendor-on"
                          checked={aiVendorOn}
                          onChange={(e) => setAiVendorOn(e.target.checked)}
                          className="h-4 w-4 accent-amber-500"
                        />
                        <span className="text-base font-semibold text-slate-800 dark:text-slate-100">{t('bulk_method.ai_set_vendor')}</span>
                      </label>
                      <select
                        data-testid="bm-ai-vendor"
                        disabled={!aiVendorOn}
                        value={aiVendor}
                        onChange={(e) => setAiVendor(e.target.value)}
                        className="mt-2 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm disabled:opacity-50"
                      >
                        <option value="">{t('bulk_method.ai_pick_vendor')}</option>
                        {AI_VENDORS.map((v) => (
                          <option key={v.value} value={v.value}>{t(v.labelKey)}</option>
                        ))}
                      </select>
                    </div>

                    {/* ── model ──────────────────────────────────────────── */}
                    <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          data-testid="bm-ai-model-on"
                          checked={aiModelOn}
                          onChange={(e) => setAiModelOn(e.target.checked)}
                          className="h-4 w-4 accent-amber-500"
                        />
                        <span className="text-base font-semibold text-slate-800 dark:text-slate-100">{t('bulk_method.ai_set_model')}</span>
                      </label>
                      <input
                        type="text"
                        data-testid="bm-ai-model"
                        disabled={!aiModelOn}
                        value={aiModel}
                        onChange={(e) => setAiModel(e.target.value)}
                        placeholder={t('bulk_method.ai_model_ph')}
                        className="mt-2 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm disabled:opacity-50"
                      />
                      <p className="mt-1 text-xs text-slate-500">{t('bulk_method.ai_model_hint')}</p>
                    </div>

                    {/* 🔴 เตือน ไม่ห้าม — โมเดลมีความหมายคู่กับ vendor ของ OA นั้น
                        (ดู `hook.schema.ts:225`) · ตั้ง model อย่างเดียวให้ OA ที่ใช้
                        vendor คนละเจ้า จะไปพังตอนเรียก AI ไม่ใช่ตอนเซฟ
                        ⚠️ ห้ามเปลี่ยนเป็นการบล็อก — เคส "แก้โมเดลให้ OA ที่รู้ว่าเป็น
                           เจ้าเดียวกันหมด" เป็นเคสที่ถูกต้องและต้องทำได้ */}
                    {aiModelOn && !aiVendorOn && (
                      <p className="text-xs text-amber-600 dark:text-amber-300" data-testid="bm-ai-model-warn">
                        {t('bulk_method.ai_model_alone_warn')}
                      </p>
                    )}
                  </div>
                ) : (
                <div>
                  <p className="text-base font-bold text-slate-600 dark:text-slate-300 mb-2">{t('bulk_method.value_choose')}</p>
                  <div className="grid grid-cols-2 gap-2.5">
                    <button type="button" data-testid="bm-value-on" onClick={() => setValue(true)}
                      className={`flex items-center justify-center gap-2 px-3 py-3 rounded-xl text-lg font-bold border transition ${
                        value === true ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-2 ring-emerald-400/50'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}>
                      <Power size={18} /> {t('bulk_method.value_on')}
                    </button>
                    <button type="button" data-testid="bm-value-off" onClick={() => setValue(false)}
                      className={`flex items-center justify-center gap-2 px-3 py-3 rounded-xl text-lg font-bold border transition ${
                        value === false ? 'border-amber-500 bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-2 ring-amber-400/50'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}>
                      <Power size={18} /> {t('bulk_method.value_off')}
                    </button>
                  </div>
                </div>
                )}
              </div>
            )}

            {/* ══ STEP: confirm (review — layer 1) ══ */}
            {step === 'confirm' && (
              <div className="space-y-3">
                <p className="text-base font-bold text-slate-600 dark:text-slate-300">{t('bulk_method.confirm_review')}</p>
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
                  {targetMode === 'pick' && pickedGroupNames.length > 0 && (
                    <div className="flex items-start gap-3 px-3 py-3">
                      <span className="w-24 shrink-0 text-sm font-bold text-slate-400 uppercase">{t('bulk_method.confirm_groups', { count: String(pickedGroupNames.length) })}</span>
                      <span className="flex flex-wrap gap-1.5 min-w-0">
                        {pickedGroupNames.map((n) => (
                          <span key={n} className="px-2.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 text-sm font-medium break-all">{n}</span>
                        ))}
                      </span>
                    </div>
                  )}
                  <div className="flex items-start gap-3 px-3 py-3">
                    <span className="w-24 shrink-0 text-sm font-bold text-slate-400 uppercase">{t('bulk_method.confirm_oas', { count: String(targetOAs.length) })}</span>
                    <span className="flex flex-wrap gap-1.5 min-w-0">
                      {targetOAs.map((o) => (
                        <span key={o.id} className="px-2.5 py-0.5 rounded bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-200 text-sm font-medium break-all">{o.name}</span>
                      ))}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 px-3 py-3">
                    <span className="w-24 shrink-0 text-sm font-bold text-slate-400 uppercase">{t('bulk_method.confirm_method')}</span>
                    <span className="text-base font-semibold text-slate-700 dark:text-slate-200">{method ? t(METHOD_LABEL_KEY[method]) : ''}</span>
                    <span className="text-slate-300"><ArrowRight size={16} /></span>
                    {/* [FEAT-20260828-BULKAI] AI สรุปเป็นข้อความ ไม่ใช่ป้ายเปิด/ปิด */}
                    {method === 'ai'
                      ? <span className="text-base font-semibold text-slate-700 dark:text-slate-200" data-testid="bm-confirm-ai">{aiSummary}</span>
                      : value !== null && valueBadge(value)}
                  </div>
                </div>
                {blockedList}
                {error && (
                  <pre className="whitespace-pre-wrap rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 p-3 text-sm text-rose-700 dark:text-rose-300">{error}</pre>
                )}
              </div>
            )}
          </div>

          {/* footer */}
          <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-6 py-5 dark:border-slate-700">
            <button type="button" onClick={onClose} disabled={saving}
              className="rounded-lg border border-slate-300 px-5 py-2.5 text-base font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
              {t('common.cancel')}
            </button>
            <div className="flex gap-2">
              {idx > 0 && (
                <button type="button" onClick={goBack} disabled={saving}
                  className="rounded-lg border border-slate-300 px-5 py-2.5 text-base font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
                  {t('common.back')}
                </button>
              )}
              {step !== 'confirm' ? (
                <button type="button" data-testid="bm-next" onClick={goNext} disabled={!canNext}
                  className="rounded-lg bg-amber-600 px-6 py-2.5 text-base font-bold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-700">
                  {t('bulk_method.next')}
                </button>
              ) : (
                <button type="button" data-testid="bm-review" onClick={() => { setError(''); setConfirmOpen(true); }} disabled={targetIds.length === 0}
                  className="rounded-lg bg-amber-600 px-6 py-2.5 text-base font-bold text-white hover:bg-amber-700 disabled:opacity-40">
                  {t('bulk_method.confirm_step')}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ══ SECOND (nested) confirm layer — must press the ✓ check to apply ══ */}
      {confirmOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-7 space-y-4">
            <div className="flex flex-col items-center text-center gap-2">
              <span className="w-14 h-14 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center text-amber-600"><AlertTriangle size={28} /></span>
              <h4 className="text-xl font-black text-slate-800 dark:text-slate-100">{t('bulk_method.confirm2_title')}</h4>
              <p className="text-base text-slate-600 dark:text-slate-300">{t('bulk_method.confirm2_body', { count: String(targetIds.length) })}</p>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2">
              {targetMode === 'pick' && pickedGroupNames.length > 0 && (
                <div className="flex items-start gap-2 text-sm">
                  <span className="w-20 shrink-0 font-bold text-slate-400 uppercase">{t('bulk_method.confirm_groups', { count: String(pickedGroupNames.length) })}</span>
                  <span className="font-medium text-slate-700 dark:text-slate-200 break-all">{pickedGroupNames.join(', ')}</span>
                </div>
              )}
              <div className="flex items-center gap-2 text-base">
                <span className="w-20 shrink-0 text-sm font-bold text-slate-400 uppercase">{t('bulk_method.confirm_method')}</span>
                <span className="font-semibold text-slate-700 dark:text-slate-200">{method ? t(METHOD_LABEL_KEY[method]) : ''}</span>
                <span className="text-slate-300"><ArrowRight size={16} /></span>
                {value !== null && valueBadge(value)}
              </div>
              <div className="max-h-28 overflow-y-auto flex flex-wrap gap-1.5 pt-1">
                {targetOAs.map((o) => (
                  <span key={o.id} className="px-2.5 py-0.5 rounded bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-200 text-sm font-medium break-all">{o.name}</span>
                ))}
              </div>
            </div>
            {blockedList}
            {error && (
              <pre className="whitespace-pre-wrap rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 p-3 text-sm text-rose-700 dark:text-rose-300">{error}</pre>
            )}
            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={() => setConfirmOpen(false)} disabled={saving}
                className="rounded-lg border border-slate-300 px-5 py-2.5 text-base font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
                {t('common.cancel')}
              </button>
              <button type="button" data-testid="bm-confirm" onClick={applyNow} disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-6 py-2.5 text-lg font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                {saving ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
                {t('bulk_method.confirm_final', { count: String(targetIds.length) })}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default BulkMethodModal;
