/**
 * ==== [FEAT-20260805-HANDOFF] START ====
 *
 * Handoff Targets — CRUD UI for downstream handoff destinations.
 * BE is already built (gated by `handoff.manage`); this page only consumes it.
 * Structure/styling mirror pages/CustomTools.tsx (standalone resource CRUD +
 * secret has_* fields + create/edit modal + toast/pagination).
 *
 * ┌─ scope picker (the important part) ─────────────────────────────────────┐
 * │  pick a GROUP → its OAs load (GET /hook/group/:id, filterVisibleHooks)   │
 * │  each OA is a row with an on/off toggle → scope.bindings[{hook_id,enabled}]│
 * │  empty bindings = "all OA" · toggled-off OA stays listed but enabled:false │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * สิทธิ์: ต้องมี handoff.manage (เมนู + API + route guard ใช้ตัวเดียวกัน).
 * revert: delete this file + services/handoffService.ts + route in App.tsx.
 * ==== [FEAT-20260805-HANDOFF] ====
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus, RefreshCw, Search, Trash2, Edit2, Loader2, X, Send, Users,
  CheckCircle2, XCircle, ChevronDown, ChevronRight, History, ListChecks, Copy, KeyRound, Link2,
} from 'lucide-react';

import {
  handoffService, HandoffTarget, HandoffBinding, HandoffConfigField, HandoffJob,
} from '../../services/chat';
// [FEAT-20260805-HANDOFF-HOOKTAB] per-hook creds editor — same component as the hook-edit tab (2 ทาง)
import { HandoffHookCredsEditor } from '../../components/hook';
import { webhookService } from '../../services/hook';
import { groupService } from '../../services/admin';
// OA + group choices must always follow the login's permissions (same as CustomTools)
import { fetchVisibleGroups, filterVisibleHooks, VisibleGroup } from '../../services/admin';
import { ConfirmModal } from '../../components/modals';
import { AlertModal } from '../../components/modals';
import { useI18n } from '../../i18n';
import { SearchableSelect } from '../../components/common';
import { copyText } from '../../utils/copyText';

// key charset — block invalid chars at keystroke (like FlexMessageFormModal does)
const sanitizeKey = (v: string) => v.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 64);
const KEY_RE = /^[a-z0-9_-]{1,64}$/;

/** action_type dropdown labels — 0-3 wired, 4/5 reserved */
const ACTION_TYPE_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0, label: '0 = ปิด / Off' },
  { value: 1, label: '1 = ก่อน reply + ไม่ส่ง reply สลิป' },
  { value: 2, label: '2 = ก่อน reply + ส่ง reply ปกติ' },
  { value: 3, label: '3 = หลัง reply' },
  { value: 4, label: '4 = reserved' },
  { value: 5, label: '5 = reserved' },
];

/** reply_type — reserved, not wired yet (include for forward-compat) */
const REPLY_TYPE_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0, label: '0 = reserved (ยังไม่ใช้)' },
  { value: 1, label: '1 = reserved (ยังไม่ใช้)' },
  { value: 2, label: '2 = reserved (ยังไม่ใช้)' },
  { value: 3, label: '3 = reserved (ยังไม่ใช้)' },
  { value: 4, label: '4 = reserved (ยังไม่ใช้)' },
  { value: 5, label: '5 = reserved (ยังไม่ใช้)' },
];

// [FEAT-20260805-HANDOFF] match_type — RESERVED / NOT USED. The slip-flex-case filtering
// is done by `condition` (each allow_* maps 1:1 to a case below), so match_type has no UI
// and no logic. Kept as reference documentation of the 5 cases + still sent as [] for
// forward-compat. งานกรองใช้ condition · match_type สงวนไว้เฉยๆ.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const MATCH_TYPE_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 1, label: 'slip_flex_success' },
  { value: 2, label: 'slip_flex_duplicate' },
  { value: 3, label: 'slip_flex_success_not_match' },
  { value: 4, label: 'slip_flex_min_amount' },
  { value: 5, label: 'slip_flex_out_of_time' },
];

/** blank form — matches BE defaults */
const emptyForm = () => ({
  key: '',
  name: '',
  adapter: 'generic_json',
  enabled: false,
  env_tag: 'dev' as 'dev' | 'prod',
  subject_types: ['slip_verification'] as string[],
  endpoint_url: '',
  timeout_ms: 8000,
  action_type: 0,
  reply_type: 0,
  match_type: [] as number[], // [FEAT-20260805-HANDOFF] reserved multi-select
  flex_message_id: '' as string,
  result_rules_json: '[]',
  condition: {
    require_subject_success: false,
    require_verdict_tags: [] as string[],
    allow_duplicate: false,
    allow_out_of_time: false,
    allow_success_not_match: false, // เติมให้ครบ 5 เคส (map กับ slip_flex_success_not_match)
    allow_below_min_amount: false,
    min_amount: 0,
  },
  config: {} as Record<string, any>,
  // [FEAT-20260805-CHAIN] MAIN creds: auth mode + where the key comes from.
  // secret_source='custom_tool' → key มาจาก custom_tool ของ hook ที่ยิง (ไม่ต้องกรอก auth_secret)
  auth_mode: 'none' as string,
  secret_source: 'own' as 'own' | 'custom_tool',
  // secret inputs — empty = keep existing on edit
  auth_secret: '',
  auth_password: '',
  auth_client_secret: '',
  inbound_secret: '',
  inbound_password: '',
  oauth_access_token: '',
});

type FormState = ReturnType<typeof emptyForm>;

// [FEAT-20260805-CHAIN] mint ค่าเริ่มต้นตาม flow จริง (กดทีละตัว — admin เลือกเอง).
// topup = layer 2, walletpay = layer 3 · path/domain ต่างกัน · result_rules อ่าน body.status.
const mintTarget = (kind: 'topup' | 'walletpay'): FormState => {
  const base = {
    ...emptyForm(), key: kind, enabled: true, env_tag: 'dev' as const,
    subject_types: ['slip_verification'], adapter: 'generic_json', timeout_ms: 8000,
    condition: { ...emptyForm().condition, require_subject_success: true },
  };
  if (kind === 'topup') {
    // Shop-API (HMAC) · JSON · web_code หยิบจาก hook (customer_link_web_code), secret แชร์ custom_tool ได้
    // → auth.mode="hmac" ตั้งที่ BE (signer = default Shop-API เป๊ะ) · response { success: true }
    return {
      ...base,
      name: 'shop-api topup (layer 2 · Shop-API HMAC)',
      endpoint_url: 'https://topup.com/demo',
      auth_mode: 'hmac',            // Shop-API HMAC
      secret_source: 'custom_tool', // key จาก custom_tool ของ hook ที่ยิง (web_code ก็มาจาก hook)
      result_rules_json: JSON.stringify(
        [
          { path: 'success', op: 'eq', value: 'true', action: 'success' },
          { path: 'success', op: 'neq', value: 'true', action: 'fail', failure_type: 'business' },
        ],
        null,
        2
      ),
    };
  }
  // walletpay (layer 3) · multipart/form-data · ไม่มี auth/signature · ไฟล์รูปสลิป field "slip"
  // refId = transaction.statement[x].ref_id (filter provider_code="walletpay") — runner เตรียมให้ adapter
  // adapter = multipart_slip (build FormData + แทน {refId} ใน URL) · auth.mode = none
  // response success signal ยัง TBD → result_rules ว่างไว้ก่อน (any 2xx = success ชั่วคราว)
  return {
    ...base,
    name: 'walletpay (layer 3 · multipart slip · no auth)',
    adapter: 'multipart_slip',
    endpoint_url: 'https://walletpay.com/demo/api/v1/public/payin/{refId}/slip',
    auth_mode: 'none',
    secret_source: 'own',
    // multipart file field = "slip" — adapter default (ไม่ใส่ใน config: schema ไม่มี key นี้ = reject)
    result_rules_json: '[]',
  };
};

// secret fields the form handles — pair with the has_<field> flags from BE
const SECRET_FIELDS: Array<{ key: keyof FormState; has: keyof HandoffTarget; label: string }> = [
  { key: 'auth_secret', has: 'has_auth_secret', label: 'Auth Secret' },
  { key: 'auth_password', has: 'has_auth_password', label: 'Auth Password' },
  { key: 'auth_client_secret', has: 'has_auth_client_secret', label: 'Auth Client Secret' },
  { key: 'inbound_secret', has: 'has_inbound_secret', label: 'Inbound Secret' },
  { key: 'inbound_password', has: 'has_inbound_password', label: 'Inbound Password' },
  { key: 'oauth_access_token', has: 'has_oauth_access_token', label: 'OAuth Access Token' },
];

/**
 * Collapsible section — every block in the form is one of these.
 * `defaultOpen` controls the initial state (only the top block opens by default per UX).
 * State is local to the section so toggling one never disturbs another. no debt: remove
 * a section = delete its <Section>…</Section>; the component stays generic.
 */
const Section: React.FC<{
  title: React.ReactNode;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, icon, defaultOpen = false, subtitle, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  // overflow-visible when open so an inner dropdown/popover can float past the box;
  // overflow-hidden when closed keeps the rounded corners clean.
  return (
    <div className={`border border-slate-200 rounded-xl ${open ? 'overflow-visible' : 'overflow-hidden'}`}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center gap-2 px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors text-left rounded-t-xl ${open ? '' : 'rounded-b-xl'}`}>
        {open ? <ChevronDown size={16} className="text-slate-400 shrink-0" />
              : <ChevronRight size={16} className="text-slate-400 shrink-0" />}
        {icon}
        <span className="font-bold text-slate-800 text-sm">{title}</span>
        {subtitle && <span className="text-xs text-slate-400 font-normal ml-1">{subtitle}</span>}
      </button>
      {open && <div className="p-4 space-y-4 border-t border-slate-100">{children}</div>}
    </div>
  );
};

/** pretty JSON viewer with a copy button. `data` is stringified with 2-space indent. */
const JsonBlock: React.FC<{ data: any; maxH?: string }> = ({ data, maxH = 'max-h-[46vh]' }) => {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const text = React.useMemo(() => JSON.stringify(data, null, 2), [data]);
  const copy = async () => {
    // [FIX-20260830-COPYHTTP2] the raw API throws on http, so this silently did
    // nothing on every press. copyText falls back and reports the truth.
    if (!(await copyText(text))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="relative">
      <button type="button" onClick={copy}
        className="absolute top-2 right-2 z-10 flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold bg-slate-700/80 text-slate-100 hover:bg-slate-600">
        {copied ? <><CheckCircle2 size={12} />{t('pageui.handoff.tgt_00', ' คัดลอกแล้ว')}</> : <><Copy size={12} />{t('pageui.handoff.tgt_01', ' คัดลอก')}</>}
      </button>
      <pre className={`text-[12px] leading-relaxed font-mono bg-slate-900 text-slate-100 rounded-lg p-3 pt-9 overflow-auto ${maxH}`}>
{text}
      </pre>
    </div>
  );
};

export const HandoffTargets: React.FC = () => {
  /* [FEAT-20261022-I18NPAGESEN] `tr`, because `t` is the target row in this page's maps */
  const { t: tr } = useI18n();
  // top-level tab: targets CRUD | job history (both gated by handoff.manage)
  const [tab, setTab] = useState<'targets' | 'history'>('targets');

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<HandoffTarget[]>([]);
  const [search, setSearch] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [editingTarget, setEditingTarget] = useState<HandoffTarget | null>(null);
  const [saving, setSaving] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState<HandoffTarget | null>(null);
  /* [FEAT-20260805-OAPEEK] target ที่กำลังเปิดดูรายชื่อ OA · null = ปิด modal
   * ⚠️ scope.bindings เก็บแค่ hook_id ไม่มีชื่อ → ต้อง map เอง (allHooks ข้างล่าง)
   *    ใช้ getAllHooks ตัวเดิมที่มี caller อีก 13 จุด ไม่ได้เพิ่ม endpoint ใหม่ */
  const [oaPeek, setOaPeek] = useState<HandoffTarget | null>(null);
  const [allHooks, setAllHooks] = useState<any[]>([]);
  const [alert, setAlert] = useState<{ title: string; message: string; type?: 'success' | 'error' | 'info' | 'warning' } | null>(null);

  // ── config schema (dynamic; EMPTY today → render nothing) ──
  const [configSchema, setConfigSchema] = useState<HandoffConfigField[]>([]);

  // ── scope picker: MULTI group → merged OA list → per-OA toggle → bindings ──
  const [groups, setGroups] = useState<VisibleGroup[]>([]);
  // multiple groups can be picked at once; their OAs merge into one list.
  const [pickedGroupIds, setPickedGroupIds] = useState<string[]>([]);
  // per-group collapse state in the scope picker (gid → open). absent/true = open.
  const [openGroupIds, setOpenGroupIds] = useState<Record<string, boolean>>({});
  // group picker is a dropdown (compact "xxx +n" summary) — avoids a long chip row.
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  // OAs keyed by group id so unpicking a group drops exactly its rows (no stale merge).
  const [hooksByGroup, setHooksByGroup] = useState<Record<string, any[]>>({});
  const [groupHooksLoading, setGroupHooksLoading] = useState(false);
  // the working bindings map (hook_id → enabled). undefined = OA not selected.
  const [bindings, setBindings] = useState<Record<string, boolean>>({});
  // which bound hook's per-hook creds editor is open in the scope summary (hook_id or null).
  const [credsOpen, setCredsOpen] = useState<string | null>(null);

  // ==== toast + pagination (same pattern as CustomTools) ====
  const [toast, setToast] = useState<{ ok: boolean; message: string } | null>(null);
  const notify = useCallback((ok: boolean, message: string) => {
    setToast({ ok, message });
    setTimeout(() => setToast(null), ok ? 2600 : 4200);
  }, []);

  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [total, setTotal] = useState(0);
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await handoffService.listTargets({ page, limit: perPage, search });
      setItems(res.data);
      setTotal(Number(res.pagination?.total) || res.data.length);
    } finally {
      setLoading(false);
    }
  }, [search, page, perPage]);

  useEffect(() => { setPage(1); }, [search, perPage]);
  useEffect(() => { if (tab === 'targets') load(); }, [load, tab]);

  // ── ประวัติ (history) tab state — read-only job list from GET /api/handoff/jobs ──
  const [jobs, setJobs] = useState<HandoffJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobStatus, setJobStatus] = useState('');   // status filter ('' = all)
  const [jobSearch, setJobSearch] = useState('');    // search by target_key (BE-supported filter)
  const [jobPage, setJobPage] = useState(1);
  const [jobPerPage, setJobPerPage] = useState(25);
  const [jobTotal, setJobTotal] = useState(0);
  const jobTotalPages = Math.max(1, Math.ceil(jobTotal / jobPerPage));

  const loadJobs = useCallback(async () => {
    setJobsLoading(true);
    try {
      const res = await handoffService.listJobs({
        page: jobPage, limit: jobPerPage,
        status: jobStatus || undefined,
        search: jobSearch.trim() || undefined,
      });
      setJobs(res.data);
      setJobTotal(Number(res.pagination?.total) || res.data.length);
    } finally {
      setJobsLoading(false);
    }
  }, [jobPage, jobPerPage, jobStatus, jobSearch]);

  useEffect(() => { setJobPage(1); }, [jobStatus, jobSearch, jobPerPage]);
  useEffect(() => { if (tab === 'history') loadJobs(); }, [loadJobs, tab]);

  // ── job detail modal (click a history row → full raw doc, no click-outside) ──
  const [jobDetail, setJobDetail] = useState<any | null>(null);
  const [jobDetailLoading, setJobDetailLoading] = useState(false);
  // which JSON pane the detail modal shows: summary | job doc | request | response
  const [jobTab, setJobTab] = useState<'summary' | 'job' | 'request' | 'response'>('summary');
  // raw result (request+response) — loaded on demand (handoff.view_raw). null = not loaded.
  const [jobRaw, setJobRaw] = useState<any | null>(null);
  const [jobRawState, setJobRawState] = useState<'idle' | 'loading' | 'empty' | 'denied' | 'error'>('idle');
  const openJobDetail = async (job: HandoffJob) => {
    setJobDetail(job);            // show the row data immediately
    setJobRaw(null); setJobRawState('idle'); setJobTab('summary');
    setJobDetailLoading(true);
    try { setJobDetail(await handoffService.getJob(job.id)); } // then replace with full job doc
    catch { /* keep the row-level data on failure */ }
    finally { setJobDetailLoading(false); }
  };
  // switch pane; lazily load the raw result the first time request/response is opened
  const goJobTab = (t: 'summary' | 'job' | 'request' | 'response') => {
    setJobTab(t);
    if ((t === 'request' || t === 'response') && !jobRaw && jobRawState === 'idle') loadJobRaw();
  };
  const loadJobRaw = async () => {
    if (!jobDetail) return;
    setJobRawState('loading');
    try {
      const r = await handoffService.getJobResult(jobDetail._id || jobDetail.id);
      if (r === null) { setJobRawState('empty'); return; }
      setJobRaw(r); setJobRawState('idle');
    } catch (e: any) {
      // 403 from the stricter view_raw guard → tell the user they lack permission
      setJobRawState(String(e?.message || '').includes('403') ? 'denied' : 'error');
    }
  };

  // load visible groups (for the scope picker) + config schema once
  useEffect(() => {
    (async () => {
      try { setGroups(await fetchVisibleGroups()); } catch { setGroups([]); }
      try { setConfigSchema(await handoffService.getConfigSchema()); } catch { setConfigSchema([]); }
    })();
  }, []);

  // load OAs for any newly-picked group (once per group, cached in hooksByGroup)
  useEffect(() => {
    const missing = pickedGroupIds.filter((gid) => !(gid in hooksByGroup));
    if (missing.length === 0) return;
    let alive = true;
    setGroupHooksLoading(true);
    Promise.all(missing.map((gid) =>
      webhookService.getHooksByGroup(gid)
        .then((hooks) => [gid, filterVisibleHooks(hooks as any[])] as const)
        .catch(() => [gid, [] as any[]] as const)
    )).then((pairs) => {
      if (!alive) return;
      setHooksByGroup((prev) => {
        const next = { ...prev };
        pairs.forEach(([gid, hooks]) => { next[gid] = hooks; });
        return next;
      });
    }).finally(() => { if (alive) setGroupHooksLoading(false); });
    return () => { alive = false; };
  }, [pickedGroupIds, hooksByGroup]);

  // merged, de-duped OA list across all currently-picked groups (an OA can be in >1 group)
  const groupHooks = useMemo(() => {
    const seen = new Set<string>();
    const out: any[] = [];
    pickedGroupIds.forEach((gid) => {
      (hooksByGroup[gid] || []).forEach((h) => {
        const id = h?._id || h?.id;
        if (id && !seen.has(String(id))) { seen.add(String(id)); out.push(h); }
      });
    });
    return out;
  }, [pickedGroupIds, hooksByGroup]);

  const toggleGroup = (gid: string) =>
    setPickedGroupIds((p) => {
      const picking = !p.includes(gid);
      // auto-expand a group's OA panel the moment it's picked (กางเอง) so its OAs show
      // without an extra click; leave others as-is.
      if (picking) setOpenGroupIds((o) => ({ ...o, [gid]: true }));
      return picking ? [...p, gid] : p.filter((x) => x !== gid);
    });

  const openCreate = () => {
    setEditingId(null);
    setEditingTarget(null);
    setForm(emptyForm());
    setBindings({});
    setPickedGroupIds([]);
    setShowForm(true);
  };

  const openEdit = (t: HandoffTarget) => {
    setEditingId(t.id);
    setEditingTarget(t);
    setForm({
      ...emptyForm(),
      key: t.key,
      name: t.name,
      adapter: t.adapter,
      enabled: t.enabled,
      env_tag: t.env_tag,
      subject_types: t.subject_types,
      endpoint_url: t.endpoint_url,
      timeout_ms: t.timeout_ms,
      action_type: t.action_type,
      reply_type: t.reply_type,
      match_type: Array.isArray(t.match_type) ? t.match_type : [], // [FEAT-20260805-HANDOFF]
      flex_message_id: t.flex_message_id ?? '',
      result_rules_json: JSON.stringify(t.result_rules ?? [], null, 2),
      condition: { ...t.condition },
      config: { ...t.config },
      auth_mode: t.auth_mode || 'none',
      secret_source: t.secret_source === 'custom_tool' ? 'custom_tool' : 'own',
      // secrets always start blank — เว้นว่าง = ไม่แตะของเดิม (BE returns has_* only)
    });
    // rebuild the bindings map from the saved target
    const map: Record<string, boolean> = {};
    (t.scope?.bindings ?? []).forEach((b) => { if (b.hook_id) map[b.hook_id] = b.enabled; });
    setBindings(map);
    setPickedGroupIds([]);
    setShowForm(true);
  };

  // ── scope binding helpers ──
  const setBinding = (hookId: string, enabled: boolean) =>
    setBindings((p) => ({ ...p, [hookId]: enabled }));
  const removeBinding = (hookId: string) =>
    setBindings((p) => { const n = { ...p }; delete n[hookId]; return n; });

  /** working bindings as the array BE expects (empty = "all OA") */
  const bindingsArray = useMemo<HandoffBinding[]>(
    () => Object.entries(bindings).map(([hook_id, enabled]) => ({ hook_id, enabled })),
    [bindings]
  );

  // human labels for bound OAs (best-effort from the currently loaded group list)
  const hookLabel = useCallback((h: any) => h?.alias || h?.line_oa_name || h?.name || h?._id, []);

  /* [FEAT-20260805-OAPEEK] โหลด OA ทั้งหมดครั้งเดียวไว้ map hook_id → ชื่อ + กลุ่ม
   * ⚠️ ยิงตอน mount รอบเดียว ไม่ผูกกับการเปิด modal — ผู้ใช้กดดูแล้วต้องเห็นทันที
   *    ไม่ต้องรอโหลด · ตารางนี้ก็ต้องใช้ชื่อ OA ตัวแรกโชว์อยู่แล้วทุกแถว */
  useEffect(() => {
    let alive = true;
    webhookService.getAllHooks()
      .then((hs) => { if (alive) setAllHooks(Array.isArray(hs) ? hs : []); })
      .catch(() => { if (alive) setAllHooks([]); });
    return () => { alive = false; };
  }, []);

  /** hook_id → ตัว hook (จาก allHooks) */
  const hookById = useMemo(() => {
    const m: Record<string, any> = {};
    allHooks.forEach((h) => { const id = String(h?._id || h?.id || ''); if (id) m[id] = h; });
    return m;
  }, [allHooks]);

  /** ชื่อ OA ตัวแรกของ target — ใช้โชว์ในตาราง · ยังไม่รู้ชื่อก็คืน id ไปก่อน ไม่ปล่อยว่าง */
  const oaFirstLabel = useCallback((t: HandoffTarget) => {
    const first = (t.scope?.bindings ?? [])[0];
    if (!first) return '—';
    const h = hookById[String(first.hook_id)];
    return h ? hookLabel(h) : String(first.hook_id).slice(-6);
  }, [hookById, hookLabel]);

  /* [FEAT-20260805-OAPEEK] จัด OA ของ target ให้เป็นก้อนตามกลุ่ม สำหรับ modal
   * ⚠️ OA อยู่ได้หลายกลุ่ม → ให้ปรากฏในทุกกลุ่มที่มันสังกัด ไม่ใช่เลือกกลุ่มแรกให้
   *    (ผู้ใช้มองหาจากกลุ่มที่ตัวเองคุ้น การซ่อนไว้กลุ่มเดียวทำให้หาไม่เจอ)
   * ⚠️ OA ที่ resolve ไม่ได้ (ถูกลบ / ไม่มีสิทธิ์เห็น) ต้องไม่หายเงียบ — รวมไว้ท้ายสุด
   *    เพราะมันยังมีผลกับขอบเขตจริงอยู่ */
  const peekGrouped = useMemo(() => {
    if (!oaPeek) return { groups: [] as { name: string; rows: any[] }[], orphans: [] as any[] };
    const byGroup: Record<string, { name: string; rows: any[] }> = {};
    const orphans: any[] = [];
    (oaPeek.scope?.bindings ?? []).forEach((b) => {
      const h = hookById[String(b.hook_id)];
      const row = { id: String(b.hook_id), enabled: !!b.enabled, label: h ? hookLabel(h) : String(b.hook_id) };
      /* ⚠️ hook เก็บกลุ่มไว้ที่ field `group` (ค่าเดี่ยว) ไม่ใช่ `group_ids` (array)
       *    ตรวจจากข้อมูลจริงในฐานแล้ว — เดาชื่อผิดรอบแรก ทุก OA เลยตกไปกอง "ไม่ทราบกลุ่ม"
       *    รับทั้งสองแบบไว้ เผื่อ schema ขยับไปเป็น array ทีหลังจะได้ไม่พังเงียบ */
      const gids: string[] = Array.isArray(h?.group_ids) && h.group_ids.length
        ? h.group_ids.map(String)
        : (h?.group ? [String(h.group)] : []);
      if (!h || gids.length === 0) { orphans.push({ ...row, unknown: !h }); return; }
      gids.forEach((gid) => {
        const g = groups.find((x) => String(x._id) === gid);
        const name = g?.group_name || gid.slice(-6);
        if (!byGroup[gid]) byGroup[gid] = { name, rows: [] };
        byGroup[gid].rows.push(row);
      });
    });
    return {
      groups: Object.values(byGroup).sort((a, b) => a.name.localeCompare(b.name)),
      orphans,
    };
  }, [oaPeek, hookById, groups, hookLabel]);

  /* the WORKING bindings (edit modal) grouped by hook.group + resolved to hook name — for the
   * scope summary. same field logic as peekGrouped. unresolved hooks go under "ไม่ทราบกลุ่ม". */
  const boundByGroup = useMemo(() => {
    const byGroup: Record<string, { gid: string; gname: string; rows: { hook_id: string; enabled: boolean; label: string }[] }> = {};
    bindingsArray.forEach((b) => {
      const h = hookById[String(b.hook_id)];
      const row = { hook_id: String(b.hook_id), enabled: !!b.enabled, label: h ? hookLabel(h) : String(b.hook_id).slice(-6) };
      const gid = (Array.isArray(h?.group_ids) && h.group_ids.length ? String(h.group_ids[0]) : (h?.group ? String(h.group) : '')) || '__none__';
      const g = groups.find((x) => String(x._id) === gid);
      const gname = gid === '__none__' ? tr('pageui.handoff.tgt_63', 'ไม่ทราบกลุ่ม') : (g?.group_name || gid.slice(-6));
      if (!byGroup[gid]) byGroup[gid] = { gid, gname, rows: [] };
      byGroup[gid].rows.push(row);
    });
    return Object.values(byGroup).sort((a, b) => a.gname.localeCompare(b.gname));
  }, [bindingsArray, hookById, groups, hookLabel, tr]);

  const validateForm = (): string | null => {
    if (!form.name.trim()) return tr('pageui.handoff.val_name', 'กรุณากรอกชื่อ (name)');
    if (!editingId) {
      // key is immutable after create → only validated on create
      if (!KEY_RE.test(form.key)) return tr('pageui.handoff.val_key', 'key ต้องเป็น a-z 0-9 _ - ยาว 1-64 ตัว');
    }
    if (!form.env_tag) return tr('pageui.handoff.val_env', 'กรุณาเลือก env_tag (dev/prod)');
    if (form.timeout_ms > 8000) return tr('pageui.handoff.val_timeout', 'timeout_ms ต้องไม่เกิน 8000');
    // result_rules must be valid JSON array
    try {
      const parsed = JSON.parse(form.result_rules_json || '[]');
      if (!Array.isArray(parsed)) return tr('pageui.handoff.val_rules_array', 'result_rules ต้องเป็น JSON array');
    } catch {
      return tr('pageui.handoff.val_rules_json', 'result_rules JSON ไม่ถูกต้อง');
    }
    return null;
  };

  const buildPayload = (): any => {
    const result_rules = JSON.parse(form.result_rules_json || '[]');
    const payload: any = {
      name: form.name.trim(),
      adapter: form.adapter.trim() || 'generic_json',
      enabled: form.enabled,
      env_tag: form.env_tag,
      subject_types: form.subject_types,
      endpoint_url: form.endpoint_url.trim(),
      timeout_ms: Math.min(Number(form.timeout_ms) || 8000, 8000),
      action_type: Number(form.action_type) || 0,
      reply_type: Number(form.reply_type) || 0,
      match_type: Array.isArray(form.match_type) ? form.match_type : [], // [FEAT-20260805-HANDOFF] reserved
      flex_message_id: form.flex_message_id.trim() || null,
      scope: { bindings: bindingsArray },
      result_rules,
      condition: {
        ...form.condition,
        min_amount: Number(form.condition.min_amount) || 0,
      },
      config: form.config,
      // MAIN creds: auth mode + key source. custom_tool = key จาก hook.custom_tool_id ตอนยิง.
      auth: { mode: form.auth_mode || 'none' },
      secret_source: form.secret_source === 'custom_tool' ? 'custom_tool' : 'own',
    };
    // key only on create (immutable afterwards)
    if (!editingId) payload.key = form.key;
    // secrets: only send non-empty (เว้นว่าง = ไม่แตะของเดิม)
    SECRET_FIELDS.forEach(({ key }) => {
      const v = String(form[key] ?? '').trim();
      if (v) payload[key] = v;
    });
    return payload;
  };

  const save = async () => {
    const err = validateForm();
    if (err) { setAlert({ title: tr('pageui.handoff.check_input', 'ตรวจสอบข้อมูล'), message: err, type: 'warning' }); return; }

    setSaving(true);
    try {
      const payload = buildPayload();
      if (editingId) {
        await handoffService.updateTarget(editingId, payload);
      } else {
        await handoffService.createTarget(payload);
      }
      setShowForm(false);
      notify(true, editingId ? tr('pageui.handoff.saved_named', 'บันทึก "{name}" แล้ว', { name: form.name }) : tr('pageui.handoff.created_named', 'สร้าง "{name}" แล้ว', { name: form.name }));
      await load();
    } catch (e: any) {
      setAlert({ title: tr('pageui.handoff.save_failed', 'บันทึกไม่สำเร็จ'), message: e?.message || tr('pageui.handoff.error_generic', 'เกิดข้อผิดพลาด'), type: 'error' });
      notify(false, tr('pageui.handoff.save_failed', 'บันทึกไม่สำเร็จ'));
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    const name = confirmDelete.name;
    try {
      await handoffService.deleteTarget(confirmDelete.id);
      setConfirmDelete(null);
      notify(true, tr('pageui.handoff.deleted_named', 'ลบ "{name}" แล้ว', { name }));
      await load();
    } catch (e: any) {
      setConfirmDelete(null);
      setAlert({ title: tr('pageui.handoff.delete_failed', 'ลบไม่สำเร็จ'), message: e?.message || tr('pageui.handoff.error_generic', 'เกิดข้อผิดพลาด'), type: 'error' });
      notify(false, tr('pageui.handoff.delete_failed', 'ลบไม่สำเร็จ'));
    }
  };

  const filtered = useMemo(() => items, [items]);

  return (
    <div className="p-6 space-y-6">
      {/* ── header card (theme เดียวกับ Handoff History / Webhook Logs) ── */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 bg-dark-800 border border-dark-700 rounded-xl px-4 py-4 shadow-lg shadow-black/20">
        <div className="flex items-center gap-2">
          <Send className="text-indigo-600" size={22} />
          <div>
            <p className="text-sm text-slate-500">handoff · targets</p>
            <h3 className="text-xl font-semibold text-slate-900">Handoff Targets</h3>
          </div>
        </div>
        {tab === 'targets' && (
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={tr('pageui.handoff.search_name_key_ph', 'ค้นหาชื่อ / key')}
                className="pl-9 pr-3 py-2 text-sm rounded-lg border border-dark-600 bg-dark-800 text-slate-900 w-56 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <button onClick={load} className="p-2 border border-dark-600 bg-dark-800 rounded-lg hover:bg-dark-700 text-slate-600">
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={openCreate}
              className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 text-white text-sm font-bold rounded-lg hover:bg-indigo-700"
            >
              <Plus size={16} />{tr('pageui.handoff.tgt_02', ' สร้าง Target')}
            </button>
          </div>
        )}
      </div>

      {/* ── tabs: Targets | ประวัติ ── */}
      <div className="flex items-center gap-1 border-b border-slate-200">
        {/* รายการ Target = tab เดิม */}
        <button onClick={() => setTab('targets')}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold border-b-2 -mb-px transition-colors ${
            tab === 'targets' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}>
          <ListChecks size={15} />{tr('pageui.handoff.tgt_03', ' รายการ Target')}
        </button>
        {/* [FEAT-20260806-HISTORY] ปุ่มประวัติเปิดหน้าเมนูใหม่ (เหมือนกดจากเมนูประวัติ handoff) แทน tab inline */}
        <button onClick={() => { window.location.href = '/#/handoff-history'; }}
          className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold border-b-2 border-transparent text-slate-400 hover:text-slate-600 transition-colors">
          <History size={15} />{tr('pageui.handoff.tgt_04', ' ประวัติ handoff')}
        </button>
        {/* [FEAT-20260805-CHAIN] ลำดับ step (topup→walletpay) อยู่ที่หน้า Chains ไม่ใช่หน้านี้ → ปุ่มพาไป.
            HashRouter: บังคับทั้ง path(/) + hash(#/handoff-chains) กันเคส path ค้างผิด */}
        <button onClick={() => { window.location.href = '/#/handoff-chains'; }}
          className="ml-auto flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold text-emerald-700 hover:text-emerald-800">
          <ListChecks size={15} />{tr('pageui.handoff.tgt_05', ' จัดการ Chain (ลำดับ topup→walletpay) →')}
        </button>
      </div>

      {/* ══════════ TARGETS TAB ══════════ */}
      {tab === 'targets' && (<>
      {/* ── table ── */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left px-4 py-3 font-bold">{tr('pageui.handoff.tgt_06', 'ชื่อ / key')}</th>
                <th className="text-left px-4 py-3 font-bold">{tr('pageui.handoff.tgt_07', 'ปลายทาง')}</th>
                <th className="text-center px-4 py-3 font-bold">action</th>
                <th className="text-center px-4 py-3 font-bold">OA</th>
                <th className="text-center px-4 py-3 font-bold">{tr('pageui.handoff.tgt_08', 'สถานะ')}</th>
                <th className="text-right px-4 py-3 font-bold">{tr('pageui.handoff.tgt_09', 'จัดการ')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                  <Loader2 className="animate-spin inline mr-2" size={16} />{tr('pageui.handoff.tgt_10', ' กำลังโหลด…')}
                </td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                  {tr('pageui.handoff.tgt_11', 'ยังไม่มี target — กด "สร้าง Target" เพื่อเริ่ม')}
                </td></tr>
              ) : filtered.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3">
                    <div className="font-bold text-slate-800">{t.name}</div>
                    <div className="text-xs text-slate-400 font-mono">{t.key}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600 font-mono max-w-[240px] truncate">{t.endpoint_url || '—'}</td>
                  <td className="px-4 py-3 text-center">
                    <span className="px-2 py-0.5 bg-slate-100 rounded text-xs font-bold">{t.action_type}</span>
                  </td>
                  {/* [FEAT-20260805-OAPEEK] ชื่อ OA ตัวแรก + "+n" · กดแล้วเปิด modal ดูทั้งหมด
                      เดิมโชว์แค่ "3/5" ซึ่งบอกจำนวนแต่ไม่บอกว่าเป็น OA ไหน ต้องเปิดฟอร์มแก้ไข
                      ถึงจะรู้ · ตอนนี้เห็นชื่อตัวแรกทันที ที่เหลือกดดูได้โดยไม่ต้องเข้าโหมดแก้ไข */}
                  <td className="px-4 py-3 text-center text-xs">
                    {t.scope.bindings.length === 0 ? (
                      <span className="text-slate-400">{tr('pageui.handoff.tgt_12', 'ทุก OA')}</span>
                    ) : (
                      <button type="button" onClick={() => setOaPeek(t)}
                        title={tr('pageui.handoff.view_scope_oas', 'ดู OA ทั้งหมดในขอบเขตนี้')}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 text-slate-700 font-semibold transition-colors max-w-[190px]">
                        <span className="truncate">{oaFirstLabel(t)}</span>
                        {t.scope.bindings.length > 1 && (
                          <span className="shrink-0 px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-bold">
                            +{t.scope.bindings.length - 1}
                          </span>
                        )}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${t.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
                      {t.enabled ? tr('pageui.handoff.state_on', 'เปิด') : tr('pageui.handoff.state_off', 'ปิด')}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openEdit(t)} title={tr('pageui.handoff.edit', 'แก้ไข')}
                        className="p-1.5 rounded hover:bg-sky-50 text-sky-600"><Edit2 size={15} /></button>
                      <button onClick={() => setConfirmDelete(t)} title={tr('pageui.handoff.delete', 'ลบ')}
                        className="p-1.5 rounded hover:bg-rose-50 text-rose-600"><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* pagination — same pattern as CustomTools */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-slate-200 dark:border-slate-700 text-[13px]">
          <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
            <span>{tr('pageui.handoff.tgt_13', 'แสดง')}</span>
            <select
              value={perPage}
              onChange={(e) => setPerPage(Number(e.target.value))}
              className="px-2 py-1 border border-slate-200 dark:border-slate-600 rounded bg-white dark:bg-slate-800 font-bold"
            >
              {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <span>{tr('pageui.handoff.tgt_14', 'ต่อหน้า')}</span>
            <span className="ml-2">{total === 0 ? tr('pageui.handoff.no_items', 'ไม่มีรายการ') : tr('pageui.handoff.total_items', 'ทั้งหมด {n} รายการ', { n: total })}</span>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              className="px-3 py-1 rounded border border-slate-200 dark:border-slate-600 font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-800">
              {tr('pageui.handoff.tgt_15', 'ก่อนหน้า')}
            </button>
            <span className="text-slate-500 dark:text-slate-400">{tr('pageui.handoff.tgt_16', 'หน้า ')}{page} / {totalPages}</span>
            <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
              className="px-3 py-1 rounded border border-slate-200 dark:border-slate-600 font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-800">
              {tr('pageui.handoff.tgt_17', 'ถัดไป')}
            </button>
          </div>
        </div>
      </div>
      </>)}

      {/* ══════════ ประวัติ (HISTORY) TAB ══════════ */}
      {tab === 'history' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 flex-wrap">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input value={jobSearch} onChange={(e) => setJobSearch(e.target.value)}
                placeholder={tr('pageui.handoff.search_target_key_ph', 'ค้นหา target key')}
                className="pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg w-56" />
            </div>
            <select value={jobStatus} onChange={(e) => setJobStatus(e.target.value)}
              className="px-3 py-2 text-sm border border-slate-200 rounded-lg">
              <option value="">{tr('pageui.handoff.tgt_18', 'ทุกสถานะ')}</option>
              {['queued', 'sending', 'success', 'failed', 'cancelled'].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <button onClick={loadJobs} className="p-2 border border-slate-200 rounded-lg hover:bg-slate-50">
              <RefreshCw size={16} className={jobsLoading ? 'animate-spin' : ''} />
            </button>
            <span className="text-xs text-slate-400 ml-1">{tr('pageui.handoff.tgt_19', 'อ่านอย่างเดียว · จำกัดขอบเขตตาม OA ของคุณ · คลิกแถวเพื่อดูรายละเอียด')}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left px-4 py-3 font-bold">target</th>
                  <th className="text-left px-4 py-3 font-bold">subject</th>
                  <th className="text-center px-4 py-3 font-bold">{tr('pageui.handoff.tgt_20', 'สถานะ')}</th>
                  <th className="text-center px-4 py-3 font-bold">{tr('pageui.handoff.tgt_21', 'ครั้งที่')}</th>
                  <th className="text-left px-4 py-3 font-bold">{tr('pageui.handoff.tgt_22', 'เมื่อ')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {jobsLoading ? (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                    <Loader2 className="animate-spin inline mr-2" size={16} />{tr('pageui.handoff.tgt_23', ' กำลังโหลด…')}
                  </td></tr>
                ) : jobs.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                    {tr('pageui.handoff.tgt_24', 'ยังไม่มีประวัติ handoff')}
                  </td></tr>
                ) : jobs.map((j) => (
                  <tr key={j.id} onClick={() => openJobDetail(j)}
                    className="hover:bg-indigo-50/50 cursor-pointer" title={tr('pageui.handoff.view_full_detail', 'ดูรายละเอียดแบบเต็ม')}>
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">{j.target_key || '—'}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      <div>{j.subject_type || '—'}</div>
                      {j.subject_id && <div className="text-slate-400 font-mono truncate max-w-[200px]">{j.subject_id}</div>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                        j.status === 'success' ? 'bg-emerald-100 text-emerald-700'
                        : j.status === 'failed' ? 'bg-rose-100 text-rose-700'
                        : j.status === 'cancelled' ? 'bg-slate-200 text-slate-500'
                        : 'bg-amber-100 text-amber-700'
                      }`}>{j.status || '—'}</span>
                    </td>
                    <td className="px-4 py-3 text-center text-xs text-slate-600">{j.attempt ?? 0}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {j.created_at ? new Date(j.created_at).toLocaleString('th-TH') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* job pagination + per-page */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-slate-200 text-[13px]">
            <div className="flex items-center gap-2 text-slate-500">
              <span>{tr('pageui.handoff.tgt_25', 'แสดง')}</span>
              <select value={jobPerPage} onChange={(e) => setJobPerPage(Number(e.target.value))}
                className="px-2 py-1 border border-slate-200 rounded bg-white font-bold">
                {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <span>{tr('pageui.handoff.tgt_26', 'ต่อหน้า')}</span>
              <span className="ml-2">{jobTotal === 0 ? tr('pageui.handoff.no_items', 'ไม่มีรายการ') : tr('pageui.handoff.total_items', 'ทั้งหมด {n} รายการ', { n: jobTotal })}</span>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setJobPage((p) => Math.max(1, p - 1))}
                disabled={jobPage <= 1 || jobsLoading}
                className="px-3 py-1 rounded border border-slate-200 font-bold disabled:opacity-40 hover:bg-slate-50">{tr('pageui.handoff.tgt_27', 'ก่อนหน้า')}</button>
              <span className="text-slate-500">{tr('pageui.handoff.tgt_28', 'หน้า ')}{jobPage} / {jobTotalPages}</span>
              <button type="button" onClick={() => setJobPage((p) => Math.min(jobTotalPages, p + 1))}
                disabled={jobPage >= jobTotalPages || jobsLoading}
                className="px-3 py-1 rounded border border-slate-200 font-bold disabled:opacity-40 hover:bg-slate-50">{tr('pageui.handoff.tgt_29', 'ถัดไป')}</button>
            </div>
          </div>
        </div>
      )}

      {/* toast */}
      {toast && (
        <div className={`fixed top-24 left-1/2 -translate-x-1/2 z-[120] px-5 py-3 rounded-xl shadow-2xl flex items-center gap-3 border backdrop-blur-md ${
          toast.ok ? 'bg-emerald-600 border-emerald-400/30 text-white' : 'bg-rose-600 border-rose-400/30 text-white'
        }`}>
          {toast.ok ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
          <span className="text-sm font-bold">{toast.message}</span>
        </div>
      )}

      {/* ── create / edit form ── */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-[80] flex items-start justify-center overflow-y-auto p-6">
          <div className="bg-white rounded-2xl w-full max-w-[1050px] my-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="font-black text-slate-800">{editingId ? tr('pageui.handoff.edit_target', 'แก้ไข Handoff Target') : tr('pageui.handoff.create_target', 'สร้าง Handoff Target')}</h2>
              <div className="flex items-center gap-2">
                {/* [FEAT-20260805-CHAIN] mint ค่าเริ่มต้น — กดทีละตัว admin เลือกเอง (topup/walletpay) */}
                {!editingId && (<>
                  <span className="text-xs text-slate-400">{tr('pageui.handoff.tgt_30', 'ใช้ค่าเริ่มต้น:')}</span>
                  <button type="button" onClick={() => setForm(mintTarget('topup'))}
                    className="px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-bold hover:bg-indigo-100">topup</button>
                  <button type="button" onClick={() => setForm(mintTarget('walletpay'))}
                    className="px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-bold hover:bg-indigo-100">walletpay</button>
                </>)}
                <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
              </div>
            </div>

            <div className="p-6 space-y-4 max-h-[76vh] overflow-y-auto">
              {/* enabled — moved to the very top per UX (master on/off is read first) */}
              <label className="flex items-center gap-3 cursor-pointer px-4 py-3 rounded-xl border border-emerald-200 bg-emerald-50/60">
                <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                  className="w-5 h-5 accent-emerald-600" />
                <span className="text-sm font-bold text-slate-800">{tr('pageui.handoff.tgt_31', 'เปิดใช้งาน (enabled)')}</span>
                <span className="text-xs text-slate-400">{tr('pageui.handoff.tgt_32', 'สวิตช์หลักของ target นี้ · ค่าเริ่มต้นปิด')}</span>
              </label>

              {/* ══ Section 1: ข้อมูลหลัก — the only block open by default ══ */}
              <Section title={tr('pageui.handoff.sec_main', 'ข้อมูลหลัก')} defaultOpen>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-slate-600 mb-1">
                    key * {editingId && <span className="text-slate-400 font-normal">{tr('pageui.handoff.tgt_33', '(แก้ไม่ได้หลังสร้าง)')}</span>}
                  </label>
                  <input
                    value={form.key}
                    disabled={!!editingId}
                    onChange={(e) => setForm({ ...form, key: sanitizeKey(e.target.value) })}
                    placeholder="a-z 0-9 _ - (1-64)"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono disabled:bg-slate-100 disabled:text-slate-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-600 mb-1">{tr('pageui.handoff.tgt_34', 'ชื่อ (name) *')}</label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-bold text-slate-600 mb-1">adapter</label>
                  <input value={form.adapter} onChange={(e) => setForm({ ...form, adapter: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono" />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-600 mb-1">env_tag *</label>
                  <select value={form.env_tag} onChange={(e) => setForm({ ...form, env_tag: e.target.value as 'dev' | 'prod' })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg">
                    <option value="dev">dev</option>
                    <option value="prod">prod</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-600 mb-1">timeout_ms (≤ 8000)</label>
                  <input type="number" max={8000} value={form.timeout_ms}
                    onChange={(e) => setForm({ ...form, timeout_ms: Math.min(Number(e.target.value) || 8000, 8000) })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-600 mb-1">subject_types</label>
                  <input value={form.subject_types.join(', ')}
                    onChange={(e) => setForm({ ...form, subject_types: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                    placeholder="slip_verification"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-600 mb-1">endpoint_url</label>
                <input value={form.endpoint_url} onChange={(e) => setForm({ ...form, endpoint_url: e.target.value })}
                  placeholder="https://…"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono" />
              </div>

              {/* [FEAT-20260805-CHAIN] MAIN creds รวมกับ endpoint หลัก: auth mode + ที่มา key + secret หลัก.
                  key source 'custom_tool' = แต่ละ hook ที่ยิงใช้ key จาก custom_tool ของตัวเอง (hook.custom_tool_id)
                  → ไม่ต้องกรอก secret ตรงนี้. per-hook override (enabled) ยังชนะค่านี้เสมอ. */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                <div>
                  <label className="block text-sm font-bold text-slate-600 mb-1">auth mode</label>
                  <SearchableSelect value={form.auth_mode} onChange={(v) => setForm({ ...form, auth_mode: v })}
                    options={['none', 'hmac', 'bearer', 'apikey', 'basic'].map((m) => ({ value: m, label: m }))} />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-600 mb-1">{tr('pageui.handoff.tgt_35', 'ที่มาของ key (main)')}</label>
                  <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden bg-white w-full">
                    <button type="button" onClick={() => setForm({ ...form, secret_source: 'own' })}
                      className={`flex-1 px-3 py-2 text-xs font-bold flex items-center justify-center gap-1.5 ${form.secret_source === 'own' ? 'bg-primary-500 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                      <KeyRound size={13} />{tr('pageui.handoff.tgt_36', ' key ตัวเอง')}
                    </button>
                    <button type="button" onClick={() => setForm({ ...form, secret_source: 'custom_tool' })}
                      title={tr('pageui.handoff.key_from_tool_tip', 'แต่ละ hook ใช้ key จาก custom_tool ของ hook นั้น (hook.custom_tool_id)')}
                      className={`flex-1 px-3 py-2 text-xs font-bold flex items-center justify-center gap-1.5 border-l border-slate-300 ${form.secret_source === 'custom_tool' ? 'bg-primary-500 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                      <Link2 size={13} />{tr('pageui.handoff.tgt_37', ' จาก custom tool')}
                    </button>
                  </div>
                </div>
              </div>

              {form.secret_source === 'custom_tool' ? (
                <div className="flex items-start gap-2 p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs">
                  <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                  <span>{tr('pageui.handoff.tgt_38', 'key ดึงจาก ')}<b>custom_tool</b>{tr('pageui.handoff.tgt_39', ' ของแต่ละ hook ที่ยิง (hook.custom_tool_id → api_key) — ไม่ต้องกรอก secret ที่นี่. ')}{form.auth_mode === 'hmac' && <>{tr('pageui.handoff.tgt_40', 'web_code ก็มาจาก hook เช่นกัน.')}</>}</span>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-bold text-slate-600 mb-1">
                    secret / API key (main)
                    {editingId && <span className="text-slate-400 font-normal"> ({editingTarget?.has_auth_secret ? tr('pageui.handoff.secret_set', 'ตั้งไว้แล้ว · เว้น = ไม่เปลี่ยน') : tr('pageui.handoff.secret_unset', 'ยังไม่ตั้ง')})</span>}
                  </label>
                  <input type="password" autoComplete="new-password" value={String(form.auth_secret ?? '')}
                    onChange={(e) => setForm({ ...form, auth_secret: e.target.value })}
                    placeholder={editingTarget?.has_auth_secret ? tr('pageui.handoff.secret_ph', '•••••• (เว้น = ไม่เปลี่ยน)') : ''}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono" />
                  {form.auth_mode === 'hmac' && <p className="mt-1 text-xs text-slate-500">{tr('pageui.handoff.tgt_41', 'hmac (Shop-API): web_code มาจาก hook เสมอ · ตรงนี้ตั้งแค่ secret.')}</p>}
                </div>
              )}
              </Section>

              {/* ══ Section 2: dispatch & inject point (routing) ══ */}
              <Section title={tr('pageui.handoff.sec_send', 'การส่ง & Inject Point')} subtitle="action_type · reply_type">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-slate-600 mb-1">action_type</label>
                  <SearchableSelect value={String(form.action_type)} onChange={(v) => setForm({ ...form, action_type: Number(v) })}
                    options={ACTION_TYPE_OPTIONS.map((o) => ({ value: String(o.value), label: tr(`pageui.handoff.action_type_${o.value}`, o.label) }))} />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-600 mb-1">
                    reply_type <span className="text-slate-400 font-normal">{tr('pageui.handoff.tgt_42', '(reserved — ยังไม่ wired)')}</span>
                  </label>
                  <SearchableSelect value={String(form.reply_type)} onChange={(v) => setForm({ ...form, reply_type: Number(v) })}
                    options={REPLY_TYPE_OPTIONS.map((o) => ({ value: String(o.value), label: tr(`pageui.handoff.reply_type_${o.value}`, o.label) }))} />
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-600 mb-1">
                  flex_message_id <span className="text-slate-400 font-normal">(reserved — optional)</span>
                </label>
                <input value={form.flex_message_id} onChange={(e) => setForm({ ...form, flex_message_id: e.target.value })}
                  placeholder={tr('pageui.handoff.optional_ph', '(เว้นว่างได้)')}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono" />
              </div>

              {/* match_type — RESERVED, not used. The slip-flex-case filtering is done by
                  `condition` (Section 4), which is wired and covers all 5 cases. This field
                  is kept in the payload (sent as []) for forward-compat but hidden from the
                  UI so operators aren't offered two overlapping filters. งานกรองใช้ condition. */}
              <p className="text-[13px] text-slate-400">
                match_type: <span className="font-mono">reserved</span>{tr('pageui.handoff.tgt_43', ' — ยังไม่ใช้ · การกรองตามเคสสลิปทำที่ “เงื่อนไข (condition)” ด้านล่าง')}
              </p>
              </Section>

              {/* ══ Section 3: ขอบเขต OA (scope) — MULTI-group picker ══ */}
              <Section title={tr('pageui.handoff.sec_scope', 'ขอบเขต OA (scope)')} icon={<Users size={15} className="text-indigo-600 shrink-0" />}
                subtitle={bindingsArray.length === 0 ? tr('pageui.handoff.tgt_12', 'ทุก OA') : `${bindingsArray.length} OA`}>
                <p className="text-[13px] text-slate-400">
                  {bindingsArray.length === 0
                    ? tr('pageui.handoff.scope_none_hint', 'ยังไม่ได้เลือก OA → ใช้กับ "ทุก OA" (all OA) · เลือกได้หลายกลุ่มพร้อมกัน แล้วเปิดสวิตช์ OA ที่ต้องการเพื่อจำกัดขอบเขต')
                    : tr('pageui.handoff.scope_off_hint', 'OA ที่ปิดสวิตช์จะยังอยู่ในลิสต์ (เก็บ config ไว้) แต่ enabled:false')}
                </p>

                {/* group multi-select — DROPDOWN with a compact "name +n" summary so a long
                    group list doesn't stretch the form. click a row to toggle the group. */}
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative">
                    <button type="button" onClick={() => setGroupPickerOpen((o) => !o)}
                      className="flex items-center gap-2 px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 hover:border-indigo-400 min-w-[200px]">
                      <span className="flex-1 text-left text-slate-700 dark:text-slate-200 truncate">
                        {pickedGroupIds.length === 0
                          ? <span className="text-slate-500 dark:text-slate-400">{tr('pageui.handoff.tgt_44', '— เลือกกลุ่ม —')}</span>
                          : (() => {
                              const first = groups.find((g) => g._id === pickedGroupIds[0])?.group_name || pickedGroupIds[0];
                              const extra = pickedGroupIds.length - 1;
                              return <>{first}{extra > 0 && <span className="text-indigo-600 font-bold"> +{extra}</span>}</>;
                            })()}
                      </span>
                      <ChevronDown size={16} className={`text-slate-400 transition-transform ${groupPickerOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {groupPickerOpen && (
                      // panel grows sideways in columns of ≤10 rows so many groups don't run
                      // off the bottom; both axes scroll (vertical within a column, horizontal
                      // across columns). กลุ่มเยอะ = ออกข้าง เลื่อนได้ทั้งแนวตั้ง/นอน.
                      <div className="absolute z-20 mt-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg shadow-xl max-w-[min(640px,90vw)]">
                        {/* panel header — select all / clear all (group-level) */}
                        <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-700">
                          <button type="button" onClick={() => setPickedGroupIds(groups.map((g) => g._id))}
                            className="text-[11px] font-bold text-indigo-600 hover:underline">{tr('pageui.handoff.tgt_45', 'เลือกทั้งหมด')}</button>
                          <span className="text-slate-300">·</span>
                          <button type="button" onClick={() => setPickedGroupIds([])}
                            className="text-[11px] font-bold text-slate-500 hover:underline">{tr('pageui.handoff.tgt_46', 'ล้างทั้งหมด')}</button>
                        </div>
                        {groups.length === 0 ? (
                          <p className="p-3 text-center text-sm text-slate-400 w-64">{tr('pageui.handoff.tgt_47', 'ไม่มีกลุ่มที่คุณมีสิทธิ์')}</p>
                        ) : (
                          // grid-flow-col with 7 rows → fills a column top-to-bottom, then wraps right
                          <div className="overflow-auto max-h-[300px] max-w-[min(640px,90vw)] p-1">
                            <div className="grid grid-flow-col grid-rows-[repeat(7,minmax(0,auto))] auto-cols-[220px] gap-x-1">
                              {groups.map((g) => {
                                const on = pickedGroupIds.includes(g._id);
                                return (
                                  <button key={g._id} type="button" onClick={() => toggleGroup(g._id)}
                                    className="flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-slate-50 dark:hover:bg-slate-700 rounded">
                                    <input type="checkbox" checked={on} readOnly className="w-4 h-4 accent-indigo-600 pointer-events-none shrink-0" />
                                    <span className="flex-1 text-slate-700 dark:text-slate-200 truncate">{g.group_name}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {pickedGroupIds.length > 0 && (
                    <span className="text-xs text-slate-400">{pickedGroupIds.length}{tr('pageui.handoff.tgt_48', ' กลุ่ม')}</span>
                  )}
                  {/* explicit close button — large, wide, orange (per UX) */}
                  {groupPickerOpen && (
                    <button type="button" onClick={() => setGroupPickerOpen(false)}
                      className="flex items-center justify-center gap-1.5 px-6 py-2.5 rounded-lg text-sm font-bold text-white bg-orange-500 hover:bg-orange-600 shadow-sm shadow-orange-500/20">
                      <X size={16} />{tr('pageui.handoff.tgt_49', ' ปิด')}
                    </button>
                  )}
                  {groupHooksLoading && <Loader2 size={16} className="animate-spin text-slate-400" />}

                  {/* collapse/expand ALL group boxes at once */}
                  {pickedGroupIds.length > 1 && (
                    <div className="flex items-center gap-1 ml-auto">
                      <button type="button"
                        onClick={() => setOpenGroupIds(Object.fromEntries(pickedGroupIds.map((id) => [id, true])))}
                        className="text-[11px] font-bold text-indigo-600 hover:underline">{tr('pageui.handoff.tgt_50', 'เปิดทั้งหมด')}</button>
                      <span className="text-slate-300">·</span>
                      <button type="button"
                        onClick={() => setOpenGroupIds(Object.fromEntries(pickedGroupIds.map((id) => [id, false])))}
                        className="text-[11px] font-bold text-slate-500 hover:underline">{tr('pageui.handoff.tgt_51', 'พับทั้งหมด')}</button>
                    </div>
                  )}
                </div>

                {/* per-group collapsible blocks — laid out in 2 columns so many groups don't
                    stack into one tall column. each box: its own expand/collapse + select-all/
                    clear-all; OAs inside wrap in a 2-col grid with capped-height scroll. */}
                {pickedGroupIds.length > 0 && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 items-start">
                    {pickedGroupIds.map((gid) => {
                      const g = groups.find((x) => x._id === gid);
                      const hooks = hooksByGroup[gid] || [];
                      const open = openGroupIds[gid] !== false; // default open
                      const idsIn = hooks.map((h) => String(h._id || h.id));
                      const selCount = idsIn.filter((id) => id in bindings).length;
                      return (
                        <div key={gid} className="border border-slate-200 rounded-lg overflow-hidden">
                          {/* group header — collapse toggle + select/clear all for this group */}
                          <div className="flex items-center gap-2 px-3 py-2 bg-slate-50">
                            <button type="button" onClick={() => setOpenGroupIds((p) => ({ ...p, [gid]: !(p[gid] !== false) }))}
                              className="flex items-center gap-1.5 flex-1 text-left">
                              {open ? <ChevronDown size={15} className="text-slate-400" /> : <ChevronRight size={15} className="text-slate-400" />}
                              <span className="font-bold text-sm text-slate-700">{g?.group_name || gid}</span>
                              <span className="text-xs text-slate-400">({selCount}/{idsIn.length})</span>
                            </button>
                            <button type="button" onClick={() => idsIn.forEach((id) => setBinding(id, true))}
                              className="text-[11px] font-bold text-indigo-600 hover:underline">{tr('pageui.handoff.tgt_52', 'เลือกทั้งหมด')}</button>
                            <span className="text-slate-300">·</span>
                            <button type="button" onClick={() => idsIn.forEach((id) => removeBinding(id))}
                              className="text-[11px] font-bold text-slate-500 hover:underline">{tr('pageui.handoff.tgt_53', 'ล้าง')}</button>
                          </div>
                          {/* OA grid — 2 columns, capped height with vertical scroll when many */}
                          {open && (
                            <div className="p-2">
                              {hooks.length === 0 ? (
                                <p className="p-2 text-center text-sm text-slate-400">
                                  {groupHooksLoading ? tr('pageui.handoff.loading', 'กำลังโหลด…') : tr('pageui.handoff.no_oa_in_group', 'ไม่มี OA ที่คุณมีสิทธิ์ในกลุ่มนี้')}
                                </p>
                              ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-[280px] overflow-y-auto">
                                  {hooks.map((h) => {
                                    const id = String(h._id || h.id);
                                    const selected = id in bindings;
                                    const on = bindings[id];
                                    return (
                                      <div key={id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg border border-slate-100 hover:bg-slate-50 min-w-0">
                                        <input type="checkbox" checked={selected}
                                          onChange={(e) => e.target.checked ? setBinding(id, true) : removeBinding(id)}
                                          className="w-4 h-4 accent-indigo-600 shrink-0" title={tr('pageui.handoff.pick_oa_tip', 'เลือก OA นี้เข้าขอบเขต')} />
                                        <span className="text-sm text-slate-700 flex-1 truncate">{hookLabel(h)}</span>
                                        {selected && (
                                          <button type="button" onClick={() => setBinding(id, !on)}
                                            className={`px-2 py-0.5 rounded text-[11px] font-bold shrink-0 ${on ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
                                            {on ? tr('pageui.handoff.state_on', 'เปิด') : tr('pageui.handoff.state_off', 'ปิด')}
                                          </button>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* summary of all bindings (across groups) so nothing is hidden when switching group.
                    grouped by hook.group + shows the hook NAME (via hookById, not just the picked
                    group) + per-hook creds editor writing to the SAME override store as hook-edit. */}
                {bindingsArray.length > 0 && (
                  <div className="rounded-lg bg-slate-50 border border-slate-200 p-2 space-y-2">
                    <p className="text-[13px] font-bold text-slate-600">{tr('pageui.handoff.tgt_54', 'hook ที่ผูกไว้ (')}{bindingsArray.length}{tr('pageui.handoff.tgt_55', ') · ตั้ง creds แยกต่อ hook ได้')}</p>
                    {/* per-hook creds เขียนผูกกับ target_key ที่ IMMUTABLE — ตั้งได้ต่อเมื่อ target บันทึกแล้ว
                        (create mode: key ยังแก้ได้ → กันเขียน override ค้างกับ key ที่จะเปลี่ยน/ยังไม่มี target) */}
                    {!editingId && (
                      <p className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                        {tr('pageui.handoff.tgt_56', 'บันทึก target ก่อน แล้วจึงตั้ง creds แยกต่อ hook ได้ (creds ผูกกับ key ของ target)')}
                      </p>
                    )}
                    {boundByGroup.map(({ gid, gname, rows }) => (
                      <div key={gid} className="rounded-lg border border-slate-200 bg-white overflow-hidden">
                        <div className="px-2.5 py-1.5 bg-slate-100 text-[12px] font-bold text-slate-600">{gname} <span className="text-slate-400">({rows.length})</span></div>
                        <div className="divide-y divide-slate-100">
                          {rows.map((r) => (
                            <div key={r.hook_id} className="px-2.5 py-2">
                              <div className="flex items-center gap-2">
                                <span className={`inline-block w-2 h-2 rounded-full ${r.enabled ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                                <span className="text-[13px] font-bold text-slate-800 flex-1 truncate">{r.label}</span>
                                {editingId && editingTarget?.key && (
                                  <button type="button" onClick={() => setCredsOpen((s) => (s === r.hook_id ? null : r.hook_id))}
                                    className="text-[12px] font-bold text-primary-600 hover:text-primary-500 flex items-center gap-1">
                                    <KeyRound size={13} /> creds {credsOpen === r.hook_id ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                  </button>
                                )}
                                <button type="button" onClick={() => removeBinding(r.hook_id)} className="text-slate-400 hover:text-rose-600" title={tr('pageui.handoff.remove', 'เอาออก')}><X size={13} /></button>
                              </div>
                              {editingId && editingTarget?.key && credsOpen === r.hook_id && (
                                <div className="mt-2">
                                  {/* targetKey = editingTarget.key (immutable saved key) ไม่ใช่ form.key ที่แก้ได้ */}
                                  <HandoffHookCredsEditor hookId={r.hook_id} targetKey={editingTarget.key} hasCustomTool={!!hookById[r.hook_id]?.custom_tool_id} compact />
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              {/* ══ Section 4: เงื่อนไข (condition) — the single, wired case filter ══
                  Each allow_* maps 1:1 to a slip-flex case (มาแทน match_type ที่ reserved):
                  success=require_subject_success · duplicate · success_not_match · min_amount · out_of_time */}
              <Section title={tr('pageui.handoff.sec_condition', 'เงื่อนไข (condition)')} subtitle={tr('pageui.handoff.sec_condition_sub', 'ตัวกรองเคสสลิป (ครอบทั้ง 5 เคส)')}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                  {([
                    ['require_subject_success', 'ต้องตรวจสลิปผ่านก่อน (success)'],
                    ['allow_duplicate', 'อนุญาตซ้ำ (duplicate)'],
                    ['allow_success_not_match', 'อนุญาตบัญชีไม่ตรง (success_not_match)'],
                    ['allow_below_min_amount', 'อนุญาตต่ำกว่ายอดขั้นต่ำ (min_amount)'],
                    ['allow_out_of_time', 'อนุญาตนอกเวลา (out_of_time)'],
                  ] as Array<[keyof typeof form.condition, string]>).map(([k, label]) => (
                    <label key={k} className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={!!form.condition[k]}
                        onChange={(e) => setForm({ ...form, condition: { ...form.condition, [k]: e.target.checked } })}
                        className="w-4 h-4 accent-indigo-600" />
                      <span className="text-slate-700">{tr(`pageui.handoff.cond_${k}`, label)}</span>
                    </label>
                  ))}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
                  <div>
                    <label className="block text-sm font-bold text-slate-600 mb-1">min_amount</label>
                    <input type="number" value={form.condition.min_amount}
                      onChange={(e) => setForm({ ...form, condition: { ...form.condition, min_amount: Number(e.target.value) || 0 } })}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-600 mb-1">require_verdict_tags</label>
                    <input value={form.condition.require_verdict_tags.join(', ')}
                      onChange={(e) => setForm({ ...form, condition: { ...form.condition, require_verdict_tags: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) } })}
                      placeholder={tr('pageui.handoff.tags_ph', 'tag1, tag2 (เว้นว่างได้)')}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono" />
                  </div>
                </div>
              </Section>

              {/* ══ Section 5: result_rules (อ่านผลลัพธ์จากปลายทาง · JSON) ══ */}
              <Section title="result_rules" subtitle={tr('pageui.handoff.sec_rules_sub', 'กติกาอ่านผล success/fail จากปลายทาง · JSON array')}>
                <p className="text-[13px] text-slate-400">
                  {tr('pageui.handoff.tgt_57', 'เว้นเป็น ')}<span className="font-mono">[]</span>{tr('pageui.handoff.tgt_58', ' = ใช้ค่าเริ่มต้น (2xx = success) · custom เองได้ทีละข้อ')}
                </p>
                <textarea value={form.result_rules_json} rows={4}
                  onChange={(e) => setForm({ ...form, result_rules_json: e.target.value })}
                  className="w-full px-3 py-2 text-[13px] font-mono border border-slate-200 rounded-lg resize-y" />
              </Section>

              {/* ══ Section 6: ความลับ (secrets) — empty = keep existing ══ */}
              <Section title={tr('pageui.handoff.sec_secrets', 'ความลับ (secrets)')} subtitle={tr('pageui.handoff.sec_secrets_sub', 'เว้นว่าง = ไม่แตะของเดิม · auth_secret หลักย้ายไปกล่องข้อมูลหลักแล้ว')}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {SECRET_FIELDS.filter(({ key }) => key !== 'auth_secret').map(({ key, has, label }) => {
                    const isSet = editingTarget ? !!editingTarget[has] : false;
                    return (
                      <div key={key}>
                        <label className="block text-sm font-bold text-slate-600 mb-1">
                          {label}
                          {editingId && (
                            <span className="text-slate-400 font-normal">
                              {' '}({isSet ? tr('pageui.handoff.secret_set', 'ตั้งไว้แล้ว · เว้น = ไม่เปลี่ยน') : tr('pageui.handoff.secret_unset', 'ยังไม่ตั้ง')})
                            </span>
                          )}
                        </label>
                        <input type="password" autoComplete="new-password"
                          value={String(form[key] ?? '')}
                          onChange={(e) => setForm({ ...form, [key]: e.target.value } as any)}
                          placeholder={isSet ? tr('pageui.handoff.secret_ph', '•••••• (เว้น = ไม่เปลี่ยน)') : ''}
                          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono" />
                      </div>
                    );
                  })}
                </div>
              </Section>

              {/* ══ Section 7: dynamic config (registry) — hidden when schema empty ══ */}
              {configSchema.length > 0 && (
                <Section title="config" subtitle={tr('pageui.handoff.sec_config_sub', 'ฟิลด์จาก registry (config-schema)')}>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {configSchema.map((f) => {
                      const label = f.label?.th || f.label?.en || f.key;
                      const val = form.config[f.key] ?? f.default ?? '';
                      const setVal = (v: any) => setForm({ ...form, config: { ...form.config, [f.key]: v } });
                      return (
                        <div key={f.key}>
                          <label className="block text-sm font-bold text-slate-600 mb-1">{label}</label>
                          {f.type === 'boolean' ? (
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input type="checkbox" checked={!!form.config[f.key]}
                                onChange={(e) => setVal(e.target.checked)} className="w-4 h-4 accent-indigo-600" />
                              <span className="text-sm text-slate-600">{label}</span>
                            </label>
                          ) : f.type === 'number' ? (
                            <input type="number" min={f.min} max={f.max} value={val}
                              onChange={(e) => setVal(Number(e.target.value))}
                              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
                          ) : f.type === 'enum' ? (
                            <select value={val} onChange={(e) => setVal(e.target.value)}
                              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg">
                              {(f.options || []).map((o) => (
                                <option key={String(o.value)} value={o.value}>{o.label ?? String(o.value)}</option>
                              ))}
                            </select>
                          ) : (
                            <input value={val} onChange={(e) => setVal(e.target.value)}
                              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </Section>
              )}
            </div>

            <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-200">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm border border-slate-200 rounded-lg">{tr('pageui.handoff.tgt_59', 'ยกเลิก')}</button>
              <button onClick={save} disabled={saving}
                className="px-4 py-2 text-sm bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                {saving ? <Loader2 size={15} className="animate-spin inline" /> : tr('pageui.handoff.save', 'บันทึก')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ [FEAT-20260805-OAPEEK] ดูรายชื่อ OA ในขอบเขต — อ่านอย่างเดียว ══
          WHY  ตารางโชว์ได้แค่ชื่อเดียว + "+n" · กดแล้วต้องเห็นครบโดยไม่ต้องเข้าโหมดแก้ไข
               (เข้าฟอร์มแก้ไขเพื่อ "ดู" เฉย ๆ เสี่ยงเผลอกดบันทึกทับ)
          ⚠️ ขนาดกลาง max-w-2xl ไม่ใช่เล็ก — รายชื่อแบ่งเป็นคอลัมน์ตามกลุ่ม ถ้าแคบไปจะอ่านยาก
          ⚠️ ตัวลิสต์มี scroll ของตัวเอง (max-h) กัน OA เยอะแล้ว modal ยาวทะลุจอ
          revert: ลบบล็อกนี้ + state oaPeek/allHooks + helper peekGrouped/oaFirstLabel
                  + คืนเซลล์ OA ในตารางเป็นข้อความ n/m */}
      {oaPeek && (
        // no click-outside close — ปิดได้เฉพาะปุ่มกากบาท/ปิด (กันปิดพลาดตอนดูรายชื่อ OA)
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-200">
              <div className="min-w-0">
                <h3 className="font-extrabold text-slate-800 truncate">{tr('pageui.handoff.tgt_60', 'OA ในขอบเขต')}</h3>
                <p className="text-xs text-slate-500 truncate">
                  {oaPeek.name} · <span className="font-mono">{oaPeek.key}</span>
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 text-xs font-bold">
                  {(oaPeek.scope?.bindings ?? []).filter((b) => b.enabled).length}
                  /{(oaPeek.scope?.bindings ?? []).length}{tr('pageui.handoff.tgt_61', ' เปิด')}
                </span>
                <button type="button" onClick={() => setOaPeek(null)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><X size={18} /></button>
              </div>
            </div>

            {/* ⚠️ scroll อยู่ที่ตัวลิสต์ ไม่ใช่ทั้ง modal — หัวข้อกับปุ่มปิดต้องค้างอยู่เสมอ */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {peekGrouped.groups.length === 0 && peekGrouped.orphans.length === 0 ? (
                <p className="text-center text-sm text-slate-400 py-6">{tr('pageui.handoff.tgt_62', 'ไม่มี OA ในขอบเขตนี้')}</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {peekGrouped.groups.map((g) => (
                    <div key={g.name} className="border border-slate-200 rounded-xl overflow-hidden">
                      <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-slate-600 truncate">{g.name}</span>
                        <span className="text-[11px] text-slate-400 shrink-0">{g.rows.length}</span>
                      </div>
                      <div className="max-h-44 overflow-y-auto divide-y divide-slate-100">
                        {g.rows.map((r) => (
                          <div key={`${g.name}-${r.id}`} className="flex items-center gap-2 px-3 py-1.5">
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${r.enabled ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                            <span className={`text-[13px] truncate ${r.enabled ? 'text-slate-700' : 'text-slate-400 line-through'}`}>
                              {r.label}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}

                  {/* OA ที่ไม่รู้กลุ่ม / ถูกลบ — ต้องเห็น ไม่ใช่หายเงียบ เพราะยังมีผลกับขอบเขตจริง */}
                  {peekGrouped.orphans.length > 0 && (
                    <div className="border border-amber-200 rounded-xl overflow-hidden">
                      <div className="px-3 py-2 bg-amber-50 border-b border-amber-100 flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-amber-700 truncate">{tr('pageui.handoff.tgt_63', 'ไม่ทราบกลุ่ม')}</span>
                        <span className="text-[11px] text-amber-500 shrink-0">{peekGrouped.orphans.length}</span>
                      </div>
                      <div className="max-h-44 overflow-y-auto divide-y divide-amber-50">
                        {peekGrouped.orphans.map((r) => (
                          <div key={`orphan-${r.id}`} className="flex items-center gap-2 px-3 py-1.5">
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${r.enabled ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                            <span className={`text-[13px] truncate ${r.enabled ? 'text-slate-700' : 'text-slate-400 line-through'}`}
                                  title={r.unknown ? tr('pageui.handoff.oa_unknown_tip', 'OA นี้ถูกลบ หรือคุณไม่มีสิทธิ์เห็น') : undefined}>
                              {r.label}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-between gap-3">
              <span className="text-[11px] text-slate-400">
                {tr('pageui.handoff.tgt_64', 'จุดเขียว = เปิดใช้ · ขีดฆ่า = ปิดไว้ (ยังเก็บ config)')}
              </span>
              <button type="button" onClick={() => setOaPeek(null)}
                className="px-4 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold">
                {tr('pageui.handoff.tgt_65', 'ปิด')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── job detail modal — full raw doc · no click-outside (ปิดได้เฉพาะปุ่ม) ── */}
      {jobDetail && (
        <div className="fixed inset-0 z-[90] bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-200">
              <div>
                <h3 className="font-black text-slate-800 flex items-center gap-2">
                  <History size={17} className="text-indigo-600" />{tr('pageui.handoff.tgt_66', ' รายละเอียด handoff job')}
                  {jobDetailLoading && <Loader2 size={14} className="animate-spin text-slate-400" />}
                </h3>
                <p className="text-xs text-slate-400 font-mono mt-0.5">{jobDetail._id || jobDetail.id}</p>
              </div>
              <button type="button" onClick={() => setJobDetail(null)}
                className="p-2 rounded-lg hover:bg-slate-100 text-slate-400"><X size={18} /></button>
            </div>

            {/* tab bar — สรุป / job document / request / response */}
            <div className="flex items-center gap-1 px-5 pt-3 border-b border-slate-200">
              {([
                ['summary', 'สรุป'],
                ['job', 'Job Document'],
                ['request', 'Request (ที่ยิงไป)'],
                ['response', 'Response (ที่ได้กลับ)'],
              ] as Array<['summary' | 'job' | 'request' | 'response', string]>).map(([key, label]) => (
                <button key={key} onClick={() => goJobTab(key)}
                  className={`px-3 py-2 text-xs font-bold border-b-2 -mb-px transition-colors ${
                    jobTab === key ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-400 hover:text-slate-600'
                  }`}>{tr(`pageui.handoff.jobtab_${key}`, label)}</button>
              ))}
            </div>

            <div className="p-5 overflow-y-auto flex-1">
              {/* สรุป — quick grid of the fields operators read first */}
              {jobTab === 'summary' && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                  {([
                    ['target_key', jobDetail.target_key],
                    ['status', jobDetail.status],
                    ['attempt', jobDetail.attempt],
                    ['subject_type', jobDetail.subject_type],
                    ['subject_id', jobDetail.subject_id],
                    ['hook_id', jobDetail.hook_id ?? tr('pageui.handoff.all_oa_null', '(ทุก OA / null)')],
                    ['job_ref', jobDetail.job_ref],
                    ['created_at', jobDetail.created_at && new Date(jobDetail.created_at).toLocaleString('th-TH')],
                    ['updated_at', jobDetail.updated_at && new Date(jobDetail.updated_at).toLocaleString('th-TH')],
                  ] as Array<[string, any]>).map(([k, v]) => (
                    <div key={k} className="min-w-0">
                      <div className="text-[11px] font-bold text-slate-400 uppercase">{k}</div>
                      <div className="text-slate-700 font-mono text-xs break-all">{v == null || v === '' ? '—' : String(v)}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* full job document (attempts + result_meta + everything) */}
              {jobTab === 'job' && <JsonBlock data={jobDetail} />}

              {/* request / response — from the raw result doc (loaded on tab open) */}
              {(jobTab === 'request' || jobTab === 'response') && (
                <div className="space-y-2">
                  {jobRawState === 'loading' && (
                    <p className="text-sm text-slate-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" />{tr('pageui.handoff.tgt_67', ' กำลังโหลด raw…')}</p>
                  )}
                  {jobRawState === 'empty' && <p className="text-sm text-slate-400">{tr('pageui.handoff.tgt_68', 'ยังไม่มี result บันทึก (job อาจยังไม่ถูกยิง / ยังไม่มี response)')}</p>}
                  {jobRawState === 'denied' && <p className="text-sm text-rose-500">{tr('pageui.handoff.tgt_69', 'ไม่มีสิทธิ์ดู raw (ต้องมี handoff.view_raw)')}</p>}
                  {jobRawState === 'error' && (
                    <p className="text-sm text-rose-500">
                      {tr('pageui.handoff.tgt_70', 'โหลด raw ไม่สำเร็จ · ')}<button onClick={loadJobRaw} className="underline font-bold">{tr('pageui.handoff.tgt_71', 'ลองใหม่')}</button>
                    </p>
                  )}
                  {jobRaw && jobTab === 'request' && (
                    jobRaw.request
                      ? <JsonBlock data={jobRaw.request} />
                      : <p className="text-sm text-slate-400">{tr('pageui.handoff.tgt_72', 'ไม่มีข้อมูล request (job นี้อาจถูกยิงก่อนเพิ่มการเก็บ request)')}</p>
                  )}
                  {jobRaw && jobTab === 'response' && (
                    jobRaw.final
                      ? <JsonBlock data={jobRaw.final} />
                      : <p className="text-sm text-slate-400">{tr('pageui.handoff.tgt_73', 'ไม่มีข้อมูล response')}</p>
                  )}
                </div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-slate-200 flex justify-end">
              <button type="button" onClick={() => setJobDetail(null)}
                className="px-4 py-2 text-sm border border-slate-200 rounded-lg font-bold hover:bg-slate-50">{tr('pageui.handoff.tgt_74', 'ปิด')}</button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <ConfirmModal
          isOpen={true}
          title={tr('pageui.handoff.delete_target_title', 'ลบ Handoff Target')}
          message={tr('pageui.handoff.delete_target_msg', 'ลบ "{name}" ใช่ไหม? (soft delete)', { name: confirmDelete.name })}
          type="danger"
          onConfirm={doDelete}
          onClose={() => setConfirmDelete(null)}
        />
      )}

      {alert && (
        <AlertModal isOpen={true} title={alert.title} message={alert.message} type={alert.type || 'error'} onClose={() => setAlert(null)} />
      )}
    </div>
  );
};
// ==== [FEAT-20260805-HANDOFF] END ====
