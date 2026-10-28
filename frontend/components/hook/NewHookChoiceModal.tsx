/* ==== [FEAT-20260805-NEWHOOKCHOICE] "สร้างใหม่" — wizard 4 ขั้น ====
 *   Step 1  เลือกทาง:  OA เว็บใหม่ (ไม่มีกลุ่มเดิม)  |  OA ภายใต้กลุ่มเว็บเดิม
 *           - "เว็บใหม่" → จบที่ step 1 เปิด create เปล่า (dynamic label, ไม่มี step ถัดไป)
 *   Step 2  เลือก group (แสดง description ของ group ด้วย)
 *   Step 3  เลือกวิธี:  clone จาก OA เดิม  |  กรอกใหม่เองใต้ group นี้
 *           - "กรอกใหม่" → จบที่ step 3 เปิด create + ล็อก group
 *   Step 4  เลือก OA source (เฉพาะวิธี clone) — โชว์ domain badge กดลิงก์ได้ + ย่อชื่อ
 *
 * ⚠️ แค่ "เลือกทาง" แล้ว navigate — ไม่ยิง API. "เว็บใหม่" = create ปกติเป๊ะ ไม่กระทบของเดิม.
 * revert: ลบไฟล์นี้ + คืน handleCreate เดิมใน WebhookList.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { X, Search, Loader2, Plus, Copy, ChevronDown, PencilLine, ExternalLink } from 'lucide-react';
import { webhookService } from '../../services/hook';
import { fetchVisibleGroups, filterVisibleHooks, VisibleGroup } from '../../services/admin';
import { useI18n } from '../../i18n';

interface HookLike {
  _id?: string; id?: string; alias?: string;
  display_name?: string; line_oa_name?: string; company_name?: string;
  domain_name?: string | null;
}
const hookId = (h: HookLike) => String(h?._id || h?.id || '');
const hookLabel = (h: HookLike) => h?.display_name || h?.line_oa_name || h?.company_name || h?.alias || hookId(h);

// domain shown as a small badge; truncated to ~15 chars on desktop, tighter on mobile
// (max-w + truncate handles the responsive % automatically). normalize to a clickable href.
const domainHref = (d: string) => (/^https?:\/\//i.test(d) ? d : `https://${d}`);
const shortDomain = (d: string) => (d.length > 15 ? d.slice(0, 15) + '…' : d);

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCreateBlank: () => void;                       // create เปล่า (เว็บใหม่)
  onCreateFromSource: (sourceId: string, provisionHandoff?: boolean) => void;  // clone/:id (+ opt-in handoff provision)
  onCreateInGroup: (groupId: string) => void;      // create + ล็อก group
}

type Path = 'blank' | 'existing_group';
type Method = 'clone' | 'fresh';

export const NewHookChoiceModal: React.FC<Props> = ({ isOpen, onClose, onCreateBlank, onCreateFromSource, onCreateInGroup }) => {
  const { t } = useI18n();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [path, setPath] = useState<Path>('blank');
  const [method, setMethod] = useState<Method>('clone');

  const [groups, setGroups] = useState<VisibleGroup[]>([]);
  const [pickedGroupId, setPickedGroupId] = useState('');
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupSearch, setGroupSearch] = useState('');

  const [hooks, setHooks] = useState<HookLike[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [sourceId, setSourceId] = useState('');
  // [FEAT-20260806-CLONE-PROVISION] opt-in: also carry source OA's handoff bindings to the new OA.
  // default OFF → create-from-clone stays a plain field-copy (seamless).
  const [provisionHandoff, setProvisionHandoff] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setStep(1); setPath('blank'); setMethod('clone');
    setPickedGroupId(''); setGroupOpen(false); setGroupSearch('');
    setHooks([]); setSearch(''); setSourceId(''); setProvisionHandoff(false);
  }, [isOpen]);

  useEffect(() => {
    if (path !== 'existing_group' || groups.length) return;
    fetchVisibleGroups().then(setGroups).catch(() => setGroups([]));
  }, [path, groups.length]);

  // load OAs of the picked group only when the source list is actually shown (step 4)
  useEffect(() => {
    if (!pickedGroupId || method !== 'clone') return;
    let alive = true; setLoading(true); setSourceId('');
    webhookService.getHooksByGroup(pickedGroupId)
      .then((hs) => { if (alive) setHooks(filterVisibleHooks(hs as any[])); })
      .catch(() => { if (alive) setHooks([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [pickedGroupId, method]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return hooks;
    return hooks.filter((h) => `${hookLabel(h)} ${h.alias || ''} ${h.domain_name || ''}`.toLowerCase().includes(q));
  }, [hooks, search]);

  const filteredGroups = useMemo(() => {
    const q = groupSearch.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) => `${g.group_name} ${g.description || ''}`.toLowerCase().includes(q));
  }, [groups, groupSearch]);
  const pickedGroup = groups.find((g) => g._id === pickedGroupId);

  if (!isOpen) return null;

  // ── transitions ──
  const goFromStep1 = () => { if (path === 'blank') onCreateBlank(); else setStep(2); };
  const goFromStep2 = () => { if (pickedGroupId) setStep(3); };
  const goFromStep3 = () => { if (method === 'fresh') { if (pickedGroupId) onCreateInGroup(pickedGroupId); } else setStep(4); };
  const finish = () => { if (sourceId) onCreateFromSource(sourceId, provisionHandoff); };

  const showTracker = path === 'existing_group';
  // clicking a step in the tracker jumps back (only to steps already reachable)
  const reachable = (n: number) => n <= step;
  const jump = (n: 1 | 2 | 3 | 4) => { if (reachable(n)) setStep(n); };

  const stepNames: Record<number, string> = {
    1: t('new_hook.step_choose'), 2: t('new_hook.step_group'),
    3: t('new_hook.step_method'), 4: t('new_hook.step_source'),
  };
  const trackerItem = (n: 1 | 2 | 3 | 4) => (
    <button type="button" onClick={() => jump(n)} disabled={!reachable(n)}
      className={`rounded-full px-2.5 py-0.5 font-semibold whitespace-nowrap transition ${
        step === n ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
        : reachable(n) ? 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer'
        : 'text-slate-300 dark:text-slate-600 cursor-not-allowed'
      }`}>{n}. {stepNames[n]}</button>
  );

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
      {/* +50% size: max-w-2xl · h-[85vh] */}
      <div className="w-full max-w-2xl h-[85vh] flex flex-col rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
        {/* header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-700">
          <div className="flex items-center gap-3">
            <span className="rounded-xl bg-emerald-100 p-2 text-emerald-600 dark:bg-emerald-900/40"><Plus size={22} /></span>
            <div>
              <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100">{t('new_hook.title')}</h3>
              <p className="text-xs text-slate-400">{stepNames[step]}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><X size={20} /></button>
        </div>

        {/* clickable step tracker — only on the multi-step path */}
        {showTracker && (
          <div className="flex items-center gap-2 border-b border-slate-100 px-6 py-2.5 text-sm dark:border-slate-800 overflow-x-auto">
            {trackerItem(1)}<span className="text-slate-300">→</span>
            {trackerItem(2)}<span className="text-slate-300">→</span>
            {trackerItem(3)}
            {method === 'clone' && (<><span className="text-slate-300">→</span>{trackerItem(4)}</>)}
          </div>
        )}

        {/* body */}
        <div className="flex-1 min-h-0 overflow-auto px-6 py-5 space-y-3">
          {/* ══ STEP 1: choose path ══ */}
          {step === 1 && (<>
            {([
              ['blank', <Plus size={20} key="i" />, t('new_hook.blank'), t('new_hook.blank_desc')],
              ['existing_group', <Copy size={20} key="i" />, t('new_hook.from_source'), t('new_hook.from_source_desc')],
            ] as Array<[Path, React.ReactNode, string, string]>).map(([key, icon, label, desc]) => (
              <button key={key} type="button" onClick={() => setPath(key)}
                className={`w-full flex items-start gap-3 rounded-xl border-2 p-4 text-left transition ${
                  path === key ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20' : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'
                }`}>
                <span className={`mt-0.5 ${path === key ? 'text-emerald-600' : 'text-slate-400'}`}>{icon}</span>
                <span className="min-w-0">
                  <span className="block font-semibold text-slate-800 dark:text-slate-100">{label}</span>
                  <span className="block text-sm text-slate-500 dark:text-slate-400">{desc}</span>
                </span>
              </button>
            ))}
            <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400 space-y-1">
              <p><b className="text-slate-700 dark:text-slate-200">{t('new_hook.blank')}</b> = {t('new_hook.note_blank')}</p>
              <p><b className="text-slate-700 dark:text-slate-200">{t('new_hook.from_source')}</b> = {t('new_hook.note_from_source')}</p>
            </div>
          </>)}

          {/* ══ STEP 2: pick group (with description) ══ */}
          {step === 2 && (
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">{t('new_hook.pick_group_label')}</label>
              <div className="relative">
                <button type="button" onClick={() => setGroupOpen((o) => !o)}
                  className="w-full flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm">
                  <span className="flex-1 min-w-0 text-left">
                    {pickedGroup ? (
                      <>
                        <span className="block truncate text-slate-700 dark:text-slate-200 font-medium">{pickedGroup.group_name}</span>
                        {pickedGroup.description && <span className="block truncate text-xs text-slate-400">{pickedGroup.description}</span>}
                      </>
                    ) : <span className="text-slate-500 dark:text-slate-400">{t('new_hook.pick_group')}</span>}
                  </span>
                  <ChevronDown size={16} className={`text-slate-400 transition-transform ${groupOpen ? 'rotate-180' : ''}`} />
                </button>
                {groupOpen && (
                  <div className="absolute z-30 mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-xl">
                    <div className="relative p-2 border-b border-slate-100 dark:border-slate-700">
                      <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input autoFocus value={groupSearch} onChange={(e) => setGroupSearch(e.target.value)}
                        placeholder={t('new_hook.search_group')}
                        className="w-full rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 py-1.5 pl-8 pr-2 text-sm dark:text-slate-200" />
                    </div>
                    <div className="max-h-60 overflow-y-auto p-1">
                      {filteredGroups.length === 0 ? (
                        <p className="p-2 text-center text-xs text-slate-400">{t('new_hook.no_group')}</p>
                      ) : filteredGroups.map((g) => (
                        <button key={g._id} type="button"
                          onClick={() => { setPickedGroupId(g._id); setGroupOpen(false); setGroupSearch(''); }}
                          className={`w-full rounded-md px-3 py-2 text-left ${g._id === pickedGroupId ? 'bg-emerald-100 dark:bg-emerald-900/40' : 'hover:bg-slate-50 dark:hover:bg-slate-700'}`}>
                          <span className={`block truncate text-sm font-medium ${g._id === pickedGroupId ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-700 dark:text-slate-200'}`}>{g.group_name}</span>
                          {g.description && <span className="block truncate text-xs text-slate-400">{g.description}</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <p className="text-xs text-slate-400">{t('new_hook.pick_group_hint')}</p>
            </div>
          )}

          {/* ══ STEP 3: pick method ══ */}
          {step === 3 && (
            <div className="space-y-3">
              {([
                ['clone', <Copy size={20} key="i" />, t('new_hook.method_clone'), t('new_hook.method_clone_desc')],
                ['fresh', <PencilLine size={20} key="i" />, t('new_hook.method_fresh'), t('new_hook.method_fresh_desc')],
              ] as Array<[Method, React.ReactNode, string, string]>).map(([key, icon, label, desc]) => (
                <button key={key} type="button" onClick={() => setMethod(key)}
                  className={`w-full flex items-start gap-3 rounded-xl border-2 p-4 text-left transition ${
                    method === key ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20' : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'
                  }`}>
                  <span className={`mt-0.5 ${method === key ? 'text-emerald-600' : 'text-slate-400'}`}>{icon}</span>
                  <span className="min-w-0">
                    <span className="block font-semibold text-slate-800 dark:text-slate-100">{label}</span>
                    <span className="block text-sm text-slate-500 dark:text-slate-400">{desc}</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* ══ STEP 4: pick source OA (clone only) — domain badge + link ══ */}
          {step === 4 && (
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">{t('new_hook.pick_source_label')}</label>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('new_hook.search_source')}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 py-2 pl-9 pr-3 text-sm dark:text-slate-200" />
              </div>
              <div className="max-h-[46vh] space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-1 dark:border-slate-700">
                {loading ? (
                  <p className="p-3 text-center text-sm text-slate-400"><Loader2 size={14} className="animate-spin inline mr-1" /> {t('new_hook.loading')}</p>
                ) : filtered.length === 0 ? (
                  <p className="p-3 text-center text-sm text-slate-400">{t('new_hook.no_source')}</p>
                ) : filtered.map((h) => {
                  const id = hookId(h);
                  const on = sourceId === id;
                  const dom = (h.domain_name || '').trim();
                  return (
                    <div key={id}
                      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${on ? 'bg-emerald-100 dark:bg-emerald-900/40' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
                      <button type="button" onClick={() => setSourceId(id)} className="flex flex-1 min-w-0 items-center gap-2 text-left">
                        <input type="radio" checked={on} readOnly className="h-4 w-4 accent-emerald-500 pointer-events-none shrink-0" />
                        <span className="truncate text-slate-700 dark:text-slate-200">{hookLabel(h)}</span>
                        {h.alias && <span className="shrink-0 text-xs text-slate-400">{h.alias}</span>}
                      </button>
                      {/* domain badge — white bg, theme-safe, clickable → new tab */}
                      {dom && (
                        <a href={domainHref(dom)} target="_blank" rel="noopener noreferrer" title={dom}
                          onClick={(e) => e.stopPropagation()}
                          className="shrink-0 inline-flex items-center gap-1 max-w-[45%] sm:max-w-[160px] rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-0.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:border-emerald-400 hover:text-emerald-600 dark:hover:text-emerald-400">
                          <span className="truncate">{shortDomain(dom)}</span>
                          <ExternalLink size={11} className="shrink-0" />
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* [FEAT-20260806-CLONE-PROVISION] opt-in: carry the source's handoff bindings too.
                  default OFF = plain clone. show only once a source is picked. */}
              {sourceId && (
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-indigo-200 bg-indigo-50/60 p-3 dark:border-indigo-700/50 dark:bg-indigo-900/20">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-indigo-500"
                    checked={provisionHandoff}
                    onChange={(e) => setProvisionHandoff(e.target.checked)} />
                  <span className="text-sm text-slate-700 dark:text-slate-200">
                    <b className="text-indigo-700 dark:text-indigo-300">{t('new_hook.provision_handoff_label')}</b>
                    <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">{t('new_hook.provision_handoff_hint')}</span>
                  </span>
                </label>
              )}
            </div>
          )}
        </div>

        {/* footer */}
        <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-6 py-4 dark:border-slate-700">
          <button type="button" onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
            {t('common.cancel')}
          </button>
          <div className="flex gap-2">
            {step > 1 && (
              <button type="button" onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3 | 4)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
                {t('common.back')}
              </button>
            )}
            {step === 1 && (
              <button type="button" onClick={goFromStep1}
                className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-bold text-white hover:bg-emerald-700">
                {path === 'blank' ? t('new_hook.create_blank_cta') : t('common.next')}
              </button>
            )}
            {step === 2 && (
              <button type="button" disabled={!pickedGroupId} onClick={goFromStep2}
                className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-700 dark:disabled:text-slate-500">
                {t('common.next')}
              </button>
            )}
            {step === 3 && (
              <button type="button" onClick={goFromStep3}
                className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-bold text-white hover:bg-emerald-700">
                {method === 'clone' ? t('common.next') : t('new_hook.create_fresh_cta')}
              </button>
            )}
            {step === 4 && (
              <button type="button" disabled={!sourceId} onClick={finish}
                className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-700 dark:disabled:text-slate-500">
                {t('new_hook.create_from_source_cta')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default NewHookChoiceModal;
