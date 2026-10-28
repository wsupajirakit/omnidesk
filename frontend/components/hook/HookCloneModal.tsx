/* ==== [FEAT-20260804-HOOKCLONE] คัดลอกการตั้งค่า OA ต้นแบบ → OA ปลายทางหลายตัว ====
 * 🔒 สาย AUTO — to_dev_auto / to_prod_auto
 *
 * ลำดับหน้าจอ (ตามที่เจ้าของงานสั่ง):
 *   ขั้น 1  เลือกแท็บ → ติ๊กของอ่อนไหว (ถ้าต้องการ) → เลือก OA ปลายทาง
 *   ขั้น 2  สรุปให้อ่านอีกรอบ + ต้องติ๊กช่องยืนยันก่อนถึงกดได้ (ยืนยันสองชั้น)
 *
 * ⚠️ รายชื่อแท็บ/จำนวน field ดึงจาก BE (GET /hook/field-tabs) ทุกครั้ง
 *    ห้าม hardcode ที่นี่เด็ดขาด — ของจริงอยู่ที่ src/config/hookFieldTabs.js
 * ⚠️ ปลายทางโชว์เฉพาะ OA "กลุ่มเดียวกับต้นแบบ" · BE กันซ้ำอีกชั้นอยู่แล้ว
 *    (กัน 2 ชั้นตั้งใจ — หน้าจอกันให้ไม่พลาด, BE กันไม่ให้ยิงตรงข้ามกลุ่มได้)
 * revert: ลบไฟล์นี้ + ปุ่มใน WebhookList + 2 เมธอดใน webhookService
 */
import React, { useEffect, useMemo, useState } from 'react';
import { X, Copy, Loader2, AlertTriangle, ShieldAlert, Check, Search, ChevronDown, ChevronRight, Users } from 'lucide-react';
import { fieldsPayload, tabState, tickTab, toggleField, untickTab, type FieldPick } from './cloneFieldPick';
import { webhookService } from '../../services/hook';
import { fetchVisibleGroups, filterVisibleHooks, VisibleGroup } from '../../services/admin';
import { useI18n } from '../../i18n';

interface HookLike {
  _id?: string;
  id?: string;
  alias?: string;
  line_oa_name?: string;
  company_name?: string;
  group?: any;
  group_id?: string;
}

/** ช่องหนึ่งช่องในแท็บ — BE ส่ง label_key มาให้ FE แปลเอง (จะได้ตรงกับฟอร์มจริง) */
interface FieldItem {
  field: string;
  label_key: string;
}

interface FieldTab {
  key: string;
  label_th: string;
  label_en: string;
  field_count: number;
  sensitive_fields: string[];
  // [FEAT-20260804-CLONEEXPAND] รายชื่อช่องสำหรับกางดู · optional เผื่อ BE รุ่นเก่า
  fields?: FieldItem[];
  sensitive_field_items?: FieldItem[];
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  source: HookLike | null;
  /** OA ทั้งหมดที่หน้า list มีอยู่แล้ว — ไม่ต้องยิงซ้ำ */
  allHooks: HookLike[];
  /** [FEAT-20260804-CLONEEXPAND] ชื่อกลุ่มของ OA ต้นแบบ (หน้า list แปลง id→ชื่อ ให้แล้ว) */
  sourceGroupName?: string;
  onDone?: (summary: { success: number; failed: number }) => void;
}

const hookId = (h: HookLike) => String(h?._id || h?.id || '');
/** อ่าน group id ให้ได้ทั้งแบบ populate (object) และแบบ id ล้วน */
const groupIdOf = (h: HookLike): string => {
  const g: any = h?.group;
  if (g && typeof g === 'object') return String(g._id || g.id || '');
  return String(g || h?.group_id || '');
};
const hookLabel = (h: HookLike) =>
  h?.line_oa_name || h?.company_name || h?.alias || hookId(h);

export const HookCloneModal: React.FC<Props> = ({
  isOpen, onClose, source, allHooks, onDone, sourceGroupName,
}) => {
  const { t, locale } = useI18n();
  const [step, setStep] = useState<1 | 2>(1);
  const [tabs, setTabs] = useState<FieldTab[]>([]);
  const [loadingTabs, setLoadingTabs] = useState(false);
  /* [FEAT-20260822-CLONEFIELDS] what is ticked, per tab, per field. A tab ticked
     whole = all its fields (the old meaning); the operator can untick single
     fields ("เอาแค่ doc"). `selectedTabs` is DERIVED so every existing use below
     (secrets, the ai flag, step 2) keeps reading the same shape it always did.
     Rules + payload live in cloneFieldPick.ts (pure, pinned). */
  const [pick, setPick] = useState<FieldPick>({});
  const pickable = useMemo(() => tabs.map((tb) => ({ key: tb.key, fields: (tb.fields || []).map((f) => f.field) })), [tabs]);
  const pickableOf = (key: string) => pickable.find((p) => p.key === key) ?? { key, fields: [] };
  const selectedTabs = useMemo(() => pickable.filter((p) => (pick[p.key]?.length ?? 0) > 0).map((p) => p.key), [pick, pickable]);
  const setSelectedTabs = (next: string[]) => setPick(next.reduce<FieldPick>((acc, k) => tickTab(acc, pickableOf(k)), {}));
  const [selectedSecrets, setSelectedSecrets] = useState<string[]>([]);
  const [targets, setTargets] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  // [FEAT-20260804-CLONEEXPAND] แท็บที่กางดูรายชื่อช่องอยู่ (แยกจาก "แท็บที่เลือกคัดลอก")
  const [expandedTabs, setExpandedTabs] = useState<string[]>([]);
  const [confirmChecked, setConfirmChecked] = useState(false);
  // [FEAT-20260806-CLONE-PROVISION] opt-in: also share the source's handoff chain/target bindings
  // onto each target OA. default OFF → clone stays pure field-copy (เดิมเป๊ะ · seamless).
  const [provisionHandoff, setProvisionHandoff] = useState(false);
  /* [P2-20260813] Clone the AI vendor WITHOUT its key. Default off, because a
     vendor without its key is an OA that answers nothing — the BE carries the
     key along unless this is ticked, and clears the target's key when it is. */
  const [aiVendorWithoutKey, setAiVendorWithoutKey] = useState(false);
  // [FEAT-20260806-CLONE-GRANT] opt-in: grant each cloned OA to its group's users (same as create hook).
  const [forceGrant, setForceGrant] = useState(false);
  // [FEAT-20260805-CLONE-CONFIRMEXPAND] show the field-label list on the confirm step
  const [confirmExpand, setConfirmExpand] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // [FEAT-20260806-CHAIN] post-clone warnings (web_code share / handoff creds ที่ต้องกรอกเอง)
  const [postWarnings, setPostWarnings] = useState<string[] | null>(null);
  // [FIX-20260822-NOTICEHARDEN] the panel's title depends on whether anything
  // was REFUSED (❌) or merely worth checking (⚠️), and the count alert is held
  // until the panel closes so it cannot cover it.
  const [postFailed, setPostFailed] = useState(false);
  const [pendingDone, setPendingDone] = useState<{ success: number; failed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // [FEAT-20260805-CLONE-XGROUP] cross-group destination picker (opt-in, additive).
  // OFF = original same-group list (no debt). ON = pick any group the login can see →
  // expand → pick OAs, exactly like the handoff scope picker. เลือกข้ามกลุ่มตามสิทธิ์.
  const [crossGroup, setCrossGroup] = useState(false);
  const [groups, setGroups] = useState<VisibleGroup[]>([]);
  const [pickedGroupIds, setPickedGroupIds] = useState<string[]>([]);
  const [openGroupIds, setOpenGroupIds] = useState<Record<string, boolean>>({});
  const [hooksByGroup, setHooksByGroup] = useState<Record<string, HookLike[]>>({});
  const [xgLoading, setXgLoading] = useState(false);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);

  // เปิดโมดัลใหม่ = ล้างของเก่าทุกครั้ง ⚠️ กันค่าค้างจากรอบก่อน (โดยเฉพาะ "ของอ่อนไหว")
  useEffect(() => {
    if (!isOpen) return;
    setStep(1);
    setSelectedTabs([]);
    setSelectedSecrets([]);
    setTargets([]);
    setSearch('');
    setExpandedTabs([]);
    setConfirmChecked(false);
    setProvisionHandoff(false);
    setAiVendorWithoutKey(false);
    setForceGrant(false);
    setConfirmExpand(false);
    setError(null);
    setCrossGroup(false);
    setPickedGroupIds([]);
    setOpenGroupIds({});
    setHooksByGroup({});
    setGroupPickerOpen(false);
    /* ⚠️ the post-clone panel is state too: without these three a modal closed
       by its parent would reopen showing the PREVIOUS run's refusals. */
    setPostWarnings(null);
    setPostFailed(false);
    setPendingDone(null);
    setLoadingTabs(true);
    webhookService.getHookFieldTabs()
      .then((r) => setTabs(r.tabs || []))
      .catch((e) => setError(e?.message || String(e)))
      .finally(() => setLoadingTabs(false));
  }, [isOpen]);

  // load visible groups the first time cross-group mode is switched on
  useEffect(() => {
    if (!crossGroup || groups.length) return;
    fetchVisibleGroups().then(setGroups).catch(() => setGroups([]));
  }, [crossGroup, groups.length]);

  // load OAs for newly-picked groups (cached per group), like the handoff picker
  useEffect(() => {
    const missing = pickedGroupIds.filter((gid) => !(gid in hooksByGroup));
    if (missing.length === 0) return;
    let alive = true;
    setXgLoading(true);
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
    }).finally(() => { if (alive) setXgLoading(false); });
    return () => { alive = false; };
  }, [pickedGroupIds, hooksByGroup]);

  const toggleGroup = (gid: string) =>
    setPickedGroupIds((p) => {
      const picking = !p.includes(gid);
      if (picking) setOpenGroupIds((o) => ({ ...o, [gid]: true })); // auto-expand on pick
      return picking ? [...p, gid] : p.filter((x) => x !== gid);
    });

  const srcGroup = source ? groupIdOf(source) : '';

  /* ปลายทางที่เลือกได้ = กลุ่มเดียวกับต้นแบบ และไม่ใช่ตัวเอง */
  const candidates = useMemo(() => {
    if (!source) return [];
    const sid = hookId(source);
    return (allHooks || []).filter(
      (h) => hookId(h) !== sid && groupIdOf(h) === srcGroup && !!srcGroup
    );
  }, [allHooks, source, srcGroup]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((h) =>
      `${hookLabel(h)} ${h.alias || ''}`.toLowerCase().includes(q)
    );
  }, [candidates, search]);

  // resolve a selected target id → its hook, from EITHER source (same-group candidates
  // or cross-group fetched lists). used by the step-2 summary so cross-group targets
  // still show their name. รวมรายชื่อจากทั้งสองโหมดเพื่อโชว์ชื่อปลายทางให้ถูก.
  const targetHookById = useMemo(() => {
    const map = new Map<string, HookLike>();
    candidates.forEach((h) => map.set(hookId(h), h));
    Object.values(hooksByGroup).forEach((list) => list.forEach((h) => map.set(hookId(h), h)));
    return map;
  }, [candidates, hooksByGroup]);

  /* [FIX-20260822-NOTICEHARDEN] ── how a REFUSED target is put into words ──
   * ⚠️ TWO TRAPS LIVE HERE, both found by review, both invisible on the happy
   * path:
   *  1. `t()` answers with the KEY ITSELF when a translation is missing
   *     (`i18n/index.tsx`), so `t(...) || fallback` NEVER falls back — a
   *     template-literal lookup prints `hook_clone.fail_x` on the operator's
   *     screen. The table below uses LITERAL keys and falls back on the map,
   *     not on `t`. คำแปลหาย = ต้องได้ reason ดิบ ไม่ใช่ชื่อ key.
   *  2. `test/i18nKeyCoverage.value.test.ts` only sees keys written as plain
   *     quoted strings in the call; a key reached through a backtick is
   *     unguarded — the day someone deletes it from a locale file, the suite
   *     stays green and the UI breaks. (That scanner reads comments too: do
   *     not write an example call here, it becomes a "missing key".)
   * 3 ใน 4 reason ของ BE ไม่ส่ง `alias` มาด้วย (มีแค่ notice_cards_incomplete)
   * ⇒ ถ้าเชื่อ alias อย่างเดียว แอดมินจะเห็น ObjectId ดิบ หาไม่เจอว่า OA ไหน. */
  const failText = (reason?: string): string => {
    const table: Record<string, string> = {
      notice_cards_incomplete: t('hook_clone.fail_notice_cards_incomplete'),
      not_found: t('hook_clone.fail_not_found'),
      forbidden: t('hook_clone.fail_forbidden'),
      different_group: t('hook_clone.fail_different_group'),
    };
    return (reason && table[reason]) || reason || t('hook_clone.fail_generic');
  };
  /** the OA's own name when the BE sent one, otherwise the name the picker
   *  already showed for that id — the raw id only when nothing else exists. */
  const targetName = (r: { alias?: string; hook_id: string }): string => {
    if (r.alias) return r.alias;
    const h = targetHookById.get(r.hook_id);
    return h ? hookLabel(h) : r.hook_id;
  };

  const tabLabel = (tb: FieldTab) => (locale === 'th' ? tb.label_th : tb.label_en);

  /* ของอ่อนไหวที่ "โผล่ให้ติ๊กได้" = เฉพาะของแท็บที่เลือกไว้
   * ⚠️ ตรงกับกฎ BE เป๊ะ (ติ๊กไว้แต่ไม่เลือกแท็บ = ไม่คัดลอก) */
  const availableSecrets = useMemo(
    () => tabs.filter((tb) => selectedTabs.includes(tb.key))
      .flatMap((tb) => {
        const itemMap = new Map((tb.sensitive_field_items || []).map((it) => [it.field, it.label_key]));
        return tb.sensitive_fields.map((f) => ({
          field: f,
          tab: tb,
          labelKey: itemMap.get(f) || `hook_form.${f}`,
        }));
      }),
    [tabs, selectedTabs]
  );

  // เอาแท็บออก = ของอ่อนไหวของแท็บนั้นต้องหลุดการติ๊กด้วย (ไม่ให้ค้างเงียบ ๆ)
  useEffect(() => {
    const allowed = new Set(availableSecrets.map((s) => s.field));
    setSelectedSecrets((prev) => prev.filter((f) => allowed.has(f)));
  }, [availableSecrets]);

  const fieldCount = useMemo(
    () => tabs.filter((tb) => selectedTabs.includes(tb.key))
      // [FEAT-20260822-CLONEFIELDS] count what is TICKED, not the tab's total
      .reduce((n, tb) => n + (pick[tb.key]?.length ?? tb.field_count), 0) + selectedSecrets.length,
    [tabs, selectedTabs, selectedSecrets, pick]
  );

  const canGoStep2 = selectedTabs.length > 0 && targets.length > 0 && !loadingTabs;

  const toggle = (arr: string[], v: string) =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  const submit = async () => {
    if (!source || !confirmChecked || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await webhookService.cloneHookSettings(hookId(source), {
        target_ids: targets,
        // [FEAT-20260822-CLONEFIELDS] `fields` rides along ONLY when a tab is partial;
        // a whole-tab clone sends exactly the request it always sent.
        ...fieldsPayload(pick, pickable),
        include_secrets: selectedSecrets,
        // only ask BE to allow other groups when the user is in cross-group mode
        ...(crossGroup ? { allow_cross_group: true } : {}),
        // [FEAT-20260806-CLONE-PROVISION] opt-in handoff bindings share (gated · never-throw on BE)
        ...(provisionHandoff ? { provision_handoff: true } : {}),
        // [P2-20260813] vendor-only clone; BE clears the target key to null.
        // ⚠️ Guarded on the AI tab: the checkbox only RENDERS when that tab is
        //    selected, so without this an operator who ticks it and then removes
        //    the tab sends the flag with no way to see or untick it — clearing
        //    the target's key on a clone that never touched AI. Same reason the
        //    effect above prunes selectedSecrets. ติ๊กแล้วเอาแท็บออก = ต้องไม่ค้าง.
        ...(selectedTabs.includes('ai') && aiVendorWithoutKey
          ? { ai_vendor_without_key: true }
          : {}),
        // [FEAT-20260806-CLONE-GRANT] opt-in: grant each cloned OA to its group's users
        ...(forceGrant ? { force_grant: true } : {}),
      });
      // [FEAT-20260806-CHAIN] collect per-OA warnings (web_code share + handoff creds) → show, don't
      // silently close. operator must SEE what got shared / what still needs to be filled in.
      const warns: string[] = [];
      // [FIX-20260822-NOTICEHARDEN] whether ANY target was refused — it decides
      // the panel's own title, and it defers the count alert (see below).
      let failed = false;
      for (const r of res.results || []) {
        const who = r.alias || r.hook_id;
        /* [FIX-20260822-NOTICEHARDEN] A TARGET THE BE SKIPPED MUST SAY WHY.
           The clone route has always answered per target with `{ok, reason}`
           (`not_found` · `different_group` · `forbidden`), but this modal only
           counted them — the operator saw "failed: 1" and had to guess which
           OA and what for. The notice card gate added a reason that will
           actually happen in daily use: a clone that would leave a notice
           toggle ON without every card that side needs is refused for THAT OA
           alone, and the rest of the batch still clones. Same panel as the
           warnings, same "show, don't silently close" rule.
           ⚠️ `detail` is BE wording (English) and is appended only when the BE
           sent one — never invented here. ปลายทางที่ถูกข้าม ต้องบอกเหตุผล. */
        if (r.ok === false) {
          failed = true;
          warns.push(`${targetName(r)}: ${failText(r.reason)}${r.detail ? ` (${r.detail})` : ''}`);
        }
        if (r.web_code_shared_with) warns.push(`${who}: ${t('hook_clone.warn_web_code_shared', { name: r.web_code_shared_with })}`);
        // [FEAT-20261016-SLIPGUARDLOAN] BE held this OA's slip provider — its key was not ticked (BE hook-clone/slip-pair.ts)
        if (r.slip_provider_held_without_key) warns.push(`${who}: ${t('hook_clone.warn_slip_provider_held')}`);
        for (const w of r.handoff?.warnings || []) warns.push(`${who}: ${w}`);
      }
      /* [FIX-20260822-NOTICEHARDEN] THE COUNT ALERT WAITS FOR THE PANEL.
         `onDone` makes the list page raise a full-screen alert (z-130) over
         this panel (z-80) in the same tick, so the operator had to dismiss
         "ok:0 / fail:1" before they could read WHY. When there is something to
         read, the summary is handed over on close instead — the list still
         refreshes, one moment later. ตัวเลขต้องไม่บังเหตุผล. */
      const summary = { success: res.success, failed: res.failed };
      if (warns.length) {
        setPostFailed(failed);
        setPostWarnings(warns);
        setPendingDone(summary);
      } else {
        onDone?.(summary);
        onClose();
      }
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen || !source) return null;

  // [FEAT-20260806-CHAIN] warnings panel — shown after a clone that shared web_code / needs creds.
  if (postWarnings) {
    return (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
        <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl dark:bg-slate-900 overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-amber-200 bg-amber-50 dark:bg-amber-900/20">
            {/* [FIX-20260822-NOTICEHARDEN] a refusal is not a "warning": when a
                target was SKIPPED the panel says so, otherwise it stays the
                amber check-this panel it has always been. */}
            <span className="text-amber-600 text-lg">{postFailed ? '❌' : '⚠️'}</span>
            <h3 className="font-bold text-slate-800 dark:text-slate-100">{(postFailed ? t('hook_clone.fail_title') : t('hook_clone.warnings_title')) || 'โปรดตรวจสอบ (warnings)'}</h3>
          </div>
          <ul className="p-5 space-y-2 max-h-[60vh] overflow-auto text-sm text-slate-700 dark:text-slate-300">
            {postWarnings.map((w, i) => (
              <li key={i} className="flex gap-2"><span className="text-amber-500 shrink-0">•</span><span className="break-words">{w}</span></li>
            ))}
          </ul>
          <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-700 flex justify-end">
            {/* the deferred count alert fires here — after the operator has read
                the panel, never on top of it. */}
            <button onClick={() => { setPostWarnings(null); setPostFailed(false); if (pendingDone) { onDone?.(pendingDone); setPendingDone(null); } onClose(); }}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700">{t('common.close') || 'ปิด'}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-3xl h-[85vh] max-h-[92vh] flex flex-col rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
        {/* หัวโมดัล */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-700">
          <div className="flex items-center gap-3">
            <span className="rounded-xl bg-emerald-100 p-2 text-emerald-600 dark:bg-emerald-900/40">
              <Copy size={20} />
            </span>
            <div>
              <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100">
                {t('hook_clone.title')}
              </h3>
              {/* [FEAT-20260804-CLONEEXPAND] โชว์ชื่อกลุ่มของ OA ต้นแบบด้วย
                  ⚠️ ปลายทางถูกจำกัดให้อยู่กลุ่มเดียวกันเสมอ ผู้ใช้ควรเห็นว่ากำลังทำงานในกลุ่มไหน */}
              <p className="text-sm text-slate-500">
                {t('hook_clone.from')}: <b className="text-slate-700 dark:text-slate-300">{hookLabel(source)}</b>
                {sourceGroupName && (
                  <>
                    {' · '}
                    <span className="text-slate-400">{t('hook_clone.group')}: </span>
                    <b className="text-slate-700 dark:text-slate-300">{sourceGroupName}</b>
                  </>
                )}
              </p>
            </div>
          </div>
          {/* ปุ่ม × ขวาบนเอาออก — ใช้ปุ่มยกเลิกใน footer อย่างเดียว (กันสับสน) */}
        </div>

        {/* ตัวบอกขั้นตอน */}
        <div className="flex items-center gap-2 border-b border-slate-100 px-6 py-2.5 text-sm dark:border-slate-800">
          <span className={`rounded-full px-2 py-0.5 font-semibold ${step === 1
            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
            : 'bg-slate-100 text-slate-400 dark:bg-slate-800'}`}>
            1. {t('hook_clone.step_select')}
          </span>
          <span className="text-slate-300">→</span>
          <span className={`rounded-full px-2 py-0.5 font-semibold ${step === 2
            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
            : 'bg-slate-100 text-slate-400 dark:bg-slate-800'}`}>
            2. {t('hook_clone.step_confirm')}
          </span>
        </div>

        <div className="flex-1 min-h-0 overflow-auto px-6 py-4">
          {error && (
            <div className="mb-3 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {step === 1 ? (
            <>
              {/* ── เลือกแท็บ ── */}
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-base font-bold text-slate-700 dark:text-slate-200">
                  {t('hook_clone.pick_tabs')}
                </h4>
                {tabs.length > 0 && (
                  <div className="flex items-center gap-2 text-sm">
                    <button type="button" onClick={() => setSelectedTabs(tabs.map((tb) => tb.key))}
                      className="font-semibold text-emerald-600 hover:underline">{t('hook_clone.select_all')}</button>
                    <span className="text-slate-300">·</span>
                    <button type="button" onClick={() => setSelectedTabs([])}
                      className="font-semibold text-slate-500 hover:underline">{t('hook_clone.clear_all')}</button>
                  </div>
                )}
              </div>
              {loadingTabs ? (
                <div className="flex items-center gap-2 py-4 text-sm text-slate-500">
                  <Loader2 size={16} className="animate-spin" /> {t('hook_clone.loading')}
                </div>
              ) : (
                /* [FEAT-20260804-CLONEEXPAND] กางดูได้ว่าแท็บนี้มีช่องอะไรบ้าง
                   ⚠️ ปุ่มกางแยกจาก checkbox — กดดูรายชื่อได้โดย "ไม่ติ๊กเลือก" โดยไม่ตั้งใจ
                      (ถ้าเอา onClick ไปไว้บน label เดียวกัน กดดูทีเดียวจะติ๊กไปด้วย)
                   ⚠️ label ของแต่ละช่องแปลจาก label_key ที่ BE ส่งมา = ตรงกับฟอร์มจริง */
                <div className="mb-5 grid gap-2 sm:grid-cols-2">
                  {tabs.map((tb) => {
                    const open = expandedTabs.includes(tb.key);
                    const items = tb.fields || [];
                    return (
                      <div key={tb.key}
                        className={`rounded-xl border transition ${selectedTabs.includes(tb.key)
                          ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20'
                          : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'}`}>
                        <div className="flex items-center gap-3 p-3">
                          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                            <input type="checkbox" className="h-5 w-5 shrink-0 accent-emerald-500"
                              checked={selectedTabs.includes(tb.key)}
                              ref={(el) => { if (el) el.indeterminate = tabState(pick, pickableOf(tb.key)) === 'partial'; }}
                              onChange={() => setPick((p) => selectedTabs.includes(tb.key) ? untickTab(p, tb.key) : tickTab(p, pickableOf(tb.key)))} />
                            <div className="min-w-0">
                              <div className="truncate text-base font-semibold text-slate-700 dark:text-slate-200">
                                {tabLabel(tb)}
                              </div>
                              <div className="text-sm text-slate-500">
                                {tabState(pick, pickableOf(tb.key)) === 'partial'
                                  ? `${pick[tb.key]?.length ?? 0} / ${tb.field_count} ${t('hook_clone.fields')}`
                                  : `${tb.field_count} ${t('hook_clone.fields')}`}
                              </div>
                            </div>
                          </label>
                          {items.length > 0 && (
                            <button type="button"
                              onClick={() => setExpandedTabs((p) => toggle(p, tb.key))}
                              className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                              title={t('hook_clone.expand_hint')}
                            >
                              {open ? t('hook_clone.collapse') : t('hook_clone.expand')}
                              <ChevronDown size={14}
                                className={`transition-transform ${open ? 'rotate-180' : ''}`} />
                            </button>
                          )}
                        </div>
                        {open && items.length > 0 && (
                          <ul className="max-h-52 overflow-y-auto border-t border-slate-200 px-3 py-2 dark:border-slate-700">
                            {/* [FEAT-20260822-CLONEFIELDS] each field is its own tick. Ticking one on
                                an unticked tab ticks the tab with ONLY that field; unticking the
                                last one unticks the tab. */}
                            {items.map((it) => {
                              const on = (pick[tb.key] ?? []).includes(it.field);
                              return (
                                <li key={it.field}
                                  className="flex items-center gap-2 py-1 text-sm text-slate-600 dark:text-slate-300">
                                  <input type="checkbox" className="h-4 w-4 shrink-0 accent-emerald-500"
                                    checked={on}
                                    onChange={() => setPick((p) => toggleField(p, pickableOf(tb.key), it.field))} />
                                  <span className="min-w-0 flex-1 break-words">{t(it.label_key)}</span>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ── ของอ่อนไหว: ติ๊กก่อนเลือกปลายทาง (ตามที่สั่ง) ── */}
              {availableSecrets.length > 0 && (
                <div className="mb-5 rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-700/60 dark:bg-amber-900/20">
                  <div className="mb-2 flex items-center gap-2 text-base font-bold text-amber-800 dark:text-amber-300">
                    <ShieldAlert size={16} /> {t('hook_clone.secrets_title')}
                  </div>
                  <p className="mb-2 text-sm text-amber-700 dark:text-amber-400">
                    {t('hook_clone.secrets_hint')}
                  </p>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {availableSecrets.map(({ field, tab, labelKey }) => (
                      <label key={field} className="flex cursor-pointer items-center gap-2 text-sm">
                        <input type="checkbox" className="h-4 w-4 accent-amber-500 shrink-0"
                          checked={selectedSecrets.includes(field)}
                          onChange={() => setSelectedSecrets((p) => toggle(p, field))} />
                        <span className="font-semibold text-amber-950 dark:text-amber-100">
                          {t(labelKey)}
                        </span>
                        <code className="rounded bg-white px-1 py-0.5 font-mono text-[11px] text-amber-800/80 dark:bg-slate-800 dark:text-amber-300">
                          ({field})
                        </code>
                        <span className="text-amber-700 dark:text-amber-400 text-xs">({tabLabel(tab)})</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* ── เลือก OA ปลายทาง (destination OAs) ── */}
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-base font-bold text-slate-700 dark:text-slate-200">
                  {t('hook_clone.pick_targets')}
                  {/* required marker in cross-group mode until at least one OA is picked */}
                  {crossGroup && targets.length === 0 && (
                    <span className="ml-1 text-red-500" title={t('hook_clone.required')}>*</span>
                  )}
                  <span className="ml-2 text-sm font-normal text-slate-500">({targets.length})</span>
                </h4>
                {/* mode toggle — same group (default) vs any group by permission (opt-in) */}
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-500 cursor-pointer">
                  <input type="checkbox" className="h-4 w-4 accent-emerald-500"
                    checked={crossGroup}
                    onChange={(e) => { setCrossGroup(e.target.checked); setTargets([]); }} />
                  {t('hook_clone.cross_group')}
                </label>
              </div>

              {!crossGroup ? (
                /* ══ same-group (original) ══ */
                <>
                  <div className="mb-2 flex items-center justify-end">
                    {candidates.length > 0 && (
                      <button type="button"
                        onClick={() => setTargets(targets.length === filtered.length ? [] : filtered.map(hookId))}
                        className="text-sm font-semibold text-emerald-600 hover:underline">
                        {targets.length === filtered.length ? t('hook_clone.clear_all') : t('hook_clone.select_all')}
                      </button>
                    )}
                  </div>
                  {candidates.length === 0 ? (
                    <div className="rounded-lg bg-slate-50 p-4 text-center text-sm text-slate-500 dark:bg-slate-800">
                      {t('hook_clone.no_targets')}
                    </div>
                  ) : (
                    <>
                      <div className="relative mb-2">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input value={search} onChange={(e) => setSearch(e.target.value)}
                          placeholder={t('hook_clone.search_placeholder')}
                          className="w-full rounded-lg border border-slate-200 py-2.5 pl-9 pr-3 text-base dark:border-slate-700 dark:bg-slate-800" />
                      </div>
                      <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                        {filtered.map((h) => (
                          <label key={hookId(h)}
                            className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800">
                            <input type="checkbox" className="h-4 w-4 accent-emerald-500"
                              checked={targets.includes(hookId(h))}
                              onChange={() => setTargets((p) => toggle(p, hookId(h)))} />
                            <span className="truncate text-base text-slate-700 dark:text-slate-200">{hookLabel(h)}</span>
                            {h.alias && <span className="ml-auto shrink-0 text-sm text-slate-400">{h.alias}</span>}
                          </label>
                        ))}
                      </div>
                    </>
                  )}
                </>
              ) : (
                /* ══ cross-group: pick groups (by permission) → expand → pick OAs ══ */
                <div className="space-y-2">
                  <p className="text-[13px] text-slate-500 dark:text-slate-400">{t('hook_clone.cross_group_hint')}</p>
                  {targets.length === 0 && (
                    <p className="text-[13px] font-semibold text-red-500">* {t('hook_clone.required_targets')}</p>
                  )}
                  {/* group dropdown — compact "name +n" */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="relative">
                      <button type="button" onClick={() => setGroupPickerOpen((o) => !o)}
                        className="flex items-center gap-2 px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 hover:border-emerald-400 min-w-[200px]">
                        <span className="flex-1 text-left text-slate-700 dark:text-slate-200 truncate">
                          {pickedGroupIds.length === 0
                            ? <span className="text-slate-500 dark:text-slate-400">{t('hook_clone.pick_group')}</span>
                            : (() => {
                                const first = groups.find((g) => g._id === pickedGroupIds[0])?.group_name || pickedGroupIds[0];
                                const extra = pickedGroupIds.length - 1;
                                return <>{first}{extra > 0 && <span className="text-emerald-600 font-bold"> +{extra}</span>}</>;
                              })()}
                        </span>
                        <ChevronDown size={16} className={`text-slate-400 transition-transform ${groupPickerOpen ? 'rotate-180' : ''}`} />
                      </button>
                      {groupPickerOpen && (
                        <div className="absolute z-20 bottom-full mb-1 left-0 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl max-w-[min(640px,90vw)]">
                          <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-700">
                            <button type="button" onClick={() => setPickedGroupIds(groups.map((g) => g._id))}
                              className="text-[11px] font-bold text-emerald-600 hover:underline">{t('hook_clone.select_all')}</button>
                            <span className="text-slate-300">·</span>
                            <button type="button" onClick={() => setPickedGroupIds([])}
                              className="text-[11px] font-bold text-slate-500 hover:underline">{t('hook_clone.clear_all')}</button>
                          </div>
                          {groups.length === 0 ? (
                            <p className="p-3 text-center text-sm text-slate-400 w-64">{t('hook_clone.no_groups')}</p>
                          ) : (
                            <div className="overflow-auto max-h-[300px] max-w-[min(640px,90vw)] p-1">
                              <div className="grid grid-flow-col grid-rows-[repeat(7,minmax(0,auto))] auto-cols-[220px] gap-x-1">
                                {groups.map((g) => {
                                  const on = pickedGroupIds.includes(g._id);
                                  return (
                                    <button key={g._id} type="button" onClick={() => toggleGroup(g._id)}
                                      className="flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-slate-50 dark:hover:bg-slate-700 rounded">
                                      <input type="checkbox" checked={on} readOnly className="w-4 h-4 accent-emerald-500 pointer-events-none shrink-0" />
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
                    {pickedGroupIds.length > 0 && <span className="text-xs text-slate-400">{pickedGroupIds.length} {t('hook_clone.groups_unit')}</span>}
                    {groupPickerOpen && (
                      <button type="button" onClick={() => setGroupPickerOpen(false)}
                        className="flex items-center justify-center gap-1.5 px-6 py-2.5 rounded-lg text-sm font-bold text-white bg-orange-500 hover:bg-orange-600">
                        <X size={16} /> {t('common.close')}
                      </button>
                    )}
                    {xgLoading && <Loader2 size={16} className="animate-spin text-slate-400" />}
                  </div>

                  {/* per-group OA boxes — 2 columns, each collapsible, OA grid wraps + scrolls */}
                  {pickedGroupIds.length > 0 && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 items-start">
                      {pickedGroupIds.map((gid) => {
                        const g = groups.find((x) => x._id === gid);
                        const sid = source ? hookId(source) : '';
                        const hooks = (hooksByGroup[gid] || []).filter((h) => hookId(h) !== sid); // never the source itself
                        const open = openGroupIds[gid] !== false;
                        const idsIn = hooks.map((h) => hookId(h));
                        const selCount = idsIn.filter((id) => targets.includes(id)).length;
                        return (
                          <div key={gid} className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                            <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-800">
                              <button type="button" onClick={() => setOpenGroupIds((p) => ({ ...p, [gid]: !(p[gid] !== false) }))}
                                className="flex items-center gap-1.5 flex-1 text-left">
                                {open ? <ChevronDown size={15} className="text-slate-400" /> : <ChevronRight size={15} className="text-slate-400" />}
                                <span className="font-bold text-sm text-slate-700 dark:text-slate-200">{g?.group_name || gid}</span>
                                <span className="text-xs text-slate-400">({selCount}/{idsIn.length})</span>
                              </button>
                              <button type="button" onClick={() => setTargets((p) => Array.from(new Set([...p, ...idsIn])))}
                                className="text-[11px] font-bold text-emerald-600 hover:underline">{t('hook_clone.select_all')}</button>
                              <span className="text-slate-300">·</span>
                              <button type="button" onClick={() => setTargets((p) => p.filter((id) => !idsIn.includes(id)))}
                                className="text-[11px] font-bold text-slate-500 hover:underline">{t('hook_clone.clear_all')}</button>
                            </div>
                            {open && (
                              <div className="p-2">
                                {hooks.length === 0 ? (
                                  <p className="p-2 text-center text-sm text-slate-400">
                                    {xgLoading ? t('hook_clone.loading') : t('hook_clone.no_targets')}
                                  </p>
                                ) : (
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-[280px] overflow-y-auto">
                                    {hooks.map((h) => (
                                      <label key={hookId(h)}
                                        className="flex items-center gap-2 px-2 py-1.5 rounded-lg border border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 min-w-0 cursor-pointer">
                                        <input type="checkbox" className="h-4 w-4 accent-emerald-500 shrink-0"
                                          checked={targets.includes(hookId(h))}
                                          onChange={() => setTargets((p) => toggle(p, hookId(h)))} />
                                        <span className="text-sm text-slate-700 dark:text-slate-200 flex-1 truncate">{hookLabel(h)}</span>
                                        {h.alias && <span className="shrink-0 text-xs text-slate-400">{h.alias}</span>}
                                      </label>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            /* ══ ขั้น 2: อ่านสรุปแล้วติ๊กยืนยัน ══ */
            <>
              <div className="mb-4 rounded-xl border border-red-300 bg-red-50 p-4 dark:border-red-700/60 dark:bg-red-900/20">
                <div className="mb-1 flex items-center gap-2 text-sm font-bold text-red-700 dark:text-red-300">
                  <AlertTriangle size={16} /> {t('hook_clone.warn_title')}
                </div>
                <p className="text-xs text-red-700 dark:text-red-300">
                  {t('hook_clone.warn_body')}
                </p>
              </div>

              <dl className="mb-4 space-y-3 text-sm">
                <div>
                  <dt className="mb-1 text-xs font-semibold text-slate-500">{t('hook_clone.from')}</dt>
                  <dd className="font-semibold text-slate-800 dark:text-slate-100">{hookLabel(source)}</dd>
                </div>
                <div>
                  <dt className="mb-1 text-xs font-semibold text-slate-500">
                    {t('hook_clone.tabs_to_copy')}
                  </dt>
                  <dd className="flex flex-wrap gap-1.5">
                    {tabs.filter((tb) => selectedTabs.includes(tb.key)).map((tb) => (
                      <span key={tb.key}
                        className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                        {tabLabel(tb)}
                      </span>
                    ))}
                  </dd>
                </div>
                {selectedSecrets.length > 0 && (
                  <div>
                    <dt className="mb-1 text-xs font-semibold text-amber-600">
                      {t('hook_clone.secrets_included')}
                    </dt>
                    <dd className="flex flex-wrap gap-1.5">
                      {selectedSecrets.map((f) => {
                        const secItem = tabs.flatMap((tb) => tb.sensitive_field_items || []).find((it) => it.field === f);
                        const label = secItem?.label_key ? t(secItem.label_key) : (t(`hook_form.${f}`) || f);
                        return (
                          <span key={f}
                            className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                            {label}
                            <code className="font-mono text-[10px] text-amber-600 dark:text-amber-400">({f})</code>
                          </span>
                        );
                      })}
                    </dd>
                  </div>
                )}

                {/* [FEAT-20260805-CLONE-CONFIRMEXPAND] expandable field list per selected tab —
                    shows LABELS only (no real values/creds). BE still clones the actual data;
                    this is just "what fields will be copied". โชว์แค่ชื่อ label ไม่โชว์ค่าจริง. */}
                <div>
                  <button type="button"
                    onClick={() => setConfirmExpand((v) => !v)}
                    className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
                    {confirmExpand ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    {t('hook_clone.confirm_expand')}
                  </button>
                  {confirmExpand && (
                    <div className="mt-2 space-y-2">
                      {tabs.filter((tb) => selectedTabs.includes(tb.key)).map((tb) => {
                        const items = tb.fields || [];
                        // sensitive labels that were actually ticked (shown separately, amber)
                        const secItems = (tb.sensitive_field_items || []).filter((it) => selectedSecrets.includes(it.field));
                        return (
                          <div key={tb.key} className="rounded-lg border border-slate-200 dark:border-slate-700 p-2">
                            <div className="text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">{tabLabel(tb)}</div>
                            <div className="flex flex-wrap gap-1">
                              {items.length === 0 ? (
                                <span className="text-[11px] text-slate-400">{tb.field_count} {t('hook_clone.fields')}</span>
                              ) : items.filter((it) => (pick[tb.key] ?? []).includes(it.field)).map((it) => (
                                <span key={it.field}
                                  className="rounded bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                  {t(it.label_key)}
                                </span>
                              ))}
                              {secItems.map((it) => (
                                <span key={it.field}
                                  className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                                  🔒 {t(it.label_key)}
                                </span>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div>
                  <dt className="mb-1 text-xs font-semibold text-slate-500">
                    {t('hook_clone.targets_count').replace('{n}', String(targets.length))}
                  </dt>
                  <dd className="max-h-32 space-y-0.5 overflow-y-auto rounded-lg bg-slate-50 p-2 dark:bg-slate-800">
                    {targets.map((id) => {
                      const h = targetHookById.get(id);
                      return (
                        <div key={id} className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200">
                          <Check size={12} className="text-emerald-500" /> {h ? hookLabel(h) : id}
                        </div>
                      );
                    })}
                  </dd>
                </div>
              </dl>

              {/* ⭐ ยืนยันชั้นที่สอง — ต้องติ๊กเองถึงจะกดปุ่มได้ */}
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border-2 border-slate-300 p-3 dark:border-slate-600">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-red-500"
                  checked={confirmChecked}
                  onChange={(e) => setConfirmChecked(e.target.checked)} />
                <span className="text-sm text-slate-700 dark:text-slate-200">
                  {t('hook_clone.confirm_check')
                    .replace('{n}', String(targets.length))
                    .replace('{f}', String(fieldCount))}
                </span>
              </label>

              {/* [FEAT-20260806-CLONE-PROVISION] opt-in: carry handoff bindings too.
                  default OFF = clone = field-copy ล้วน. เปิดเมื่อ OA ปลายทางต้องรับ payment flow ต่อ. */}
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-indigo-200 bg-indigo-50/60 p-3 dark:border-indigo-700/50 dark:bg-indigo-900/20">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-indigo-500"
                  checked={provisionHandoff}
                  onChange={(e) => setProvisionHandoff(e.target.checked)} />
                <span className="text-sm text-slate-700 dark:text-slate-200">
                  <b className="text-indigo-700 dark:text-indigo-300">{t('hook_clone.provision_handoff_label')}</b>
                  <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">{t('hook_clone.provision_handoff_hint')}</span>
                </span>
              </label>

              {/* [P2-20260813] AI tab only: the vendor and its key are a bound
                  pair on the BE. Ticking this takes the vendor alone and leaves
                  the target waiting for an admin to enter a key. */}
              {selectedTabs.includes('ai') && (
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-700/50 dark:bg-amber-900/20">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-amber-500"
                    checked={aiVendorWithoutKey}
                    onChange={(e) => setAiVendorWithoutKey(e.target.checked)} />
                  <span className="text-sm text-slate-700 dark:text-slate-200">
                    <b className="text-amber-700 dark:text-amber-300">{t('hook_clone.ai_vendor_without_key')}</b>
                    <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                      {aiVendorWithoutKey
                        ? t('hook_clone.ai_vendor_without_key_hint')
                        : t('hook_clone.ai_vendor_key_note')}
                    </span>
                  </span>
                </label>
              )}

              {/* [FEAT-20260806-CLONE-GRANT] grant each cloned OA to its group's users (like create hook). */}
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-700/50 dark:bg-emerald-900/20">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-emerald-500"
                  checked={forceGrant}
                  onChange={(e) => setForceGrant(e.target.checked)} />
                <span className="text-sm text-slate-700 dark:text-slate-200">
                  <b className="text-emerald-700 dark:text-emerald-300">{t('hook_clone.force_grant_label')}</b>
                  <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">{t('hook_clone.force_grant_hint')}</span>
                </span>
              </label>
            </>
          )}
        </div>

        {/* ปุ่มล่าง */}
        <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-6 py-4 dark:border-slate-700">
          <span className="text-xs text-slate-500">
            {selectedTabs.length > 0 && `${fieldCount} ${t('hook_clone.fields')}`}
          </span>
          <div className="flex gap-2">
            {step === 2 && (
              <button type="button" onClick={() => setStep(1)} disabled={submitting}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
                {t('common.back')}
              </button>
            )}
            {/* ยกเลิก — ใส่ border ให้เด่นขึ้น */}
            <button type="button" onClick={onClose} disabled={submitting}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
              {t('common.cancel')}
            </button>
            {step === 1 ? (
              <button type="button" disabled={!canGoStep2} onClick={() => setStep(2)}
                className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-bold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-700 dark:disabled:text-slate-500">
                {t('common.next')}
              </button>
            ) : (
              <button type="button" disabled={!confirmChecked || submitting} onClick={submit}
                className="flex items-center gap-2 rounded-lg bg-red-600 px-5 py-2 text-sm font-bold text-white shadow-sm hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-700 dark:disabled:text-slate-500">
                {submitting && <Loader2 size={14} className="animate-spin" />}
                {t('hook_clone.do_clone')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default HookCloneModal;
