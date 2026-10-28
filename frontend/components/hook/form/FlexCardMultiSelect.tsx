/**
 * ==== [FEAT-20260811-HOOKFORMSPLIT] extracted from HookFormModal.tsx ====
 *
 * FlexCardMultiSelect — a fully self-contained picker (its own open/modal/
 * click-outside state; the parent only passes templates + picked + onChange, and
 * a copy-toast callback). It was already a standalone component defined inside the
 * 5,600-line parent; moving it to its own file removes ~135 lines with ZERO change
 * to how the parent uses it (still `<FlexCardMultiSelect …/>` at two call sites).
 *
 * ⚠️ Body moved VERBATIM — DOM byte-identical (proven by test snapshots). Do not
 * tidy the markup. 🚫 KEEP HookFormModal THIN — new self-contained components go
 * in their own file, never inlined into the parent. อย่า inline component กลับเข้าไฟล์แม่.
 *
 * revert: paste this component back above HookHandoffTab in HookFormModal and
 * drop the import + this file.
 */
import React, { useState, useRef, useEffect } from 'react';
import { Check, ChevronDown, Copy, Eye, Info, X } from 'lucide-react';
import { FlexMessageEntry } from '../../../types';
import { copyText } from '../../../utils/copyText';
import { useI18n } from '../../../i18n';

export const FlexCardMultiSelect: React.FC<{
  label: string;
  hint: string;
  emptyText: string;
  placeholder: string;
  tagModalTitle: string;
  tagModalFooter: string;
  templates: FlexMessageEntry[];
  picked: string[];
  onChange: (ids: string[]) => void;
  isViewMode: boolean;
  onCopyToast: (message: string, type: 'success' | 'error') => void;
  copyFailMsg: string;
}> = ({ label, hint, emptyText, placeholder, tagModalTitle, tagModalFooter, templates, picked, onChange, isViewMode, onCopyToast, copyFailMsg }) => {
  // `tr`, not `t`: `setAll` maps the templates as `t`
  const { t: tr } = useI18n();
  const [open, setOpen] = useState(false);
  const [showTagModal, setShowTagModal] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const pickedTpls = templates.filter(t => picked.includes(t.id));
  const allPicked = templates.length > 0 && pickedTpls.length === templates.length;
  const toggleId = (id: string) => {
    if (isViewMode) return;
    onChange(picked.includes(id) ? picked.filter(x => x !== id) : [...picked, id]);
  };
  const setAll = (on: boolean) => {
    if (isViewMode) return;
    onChange(on ? templates.map(t => t.id) : []);
  };
  const summary = pickedTpls.length === 0
    ? placeholder
    : `${pickedTpls[0].name}${pickedTpls.length > 1 ? `  +${pickedTpls.length - 1}` : ''}`;

  return (
    <div ref={ref} className="relative">
      <div className="flex items-center justify-between mb-1 gap-2">
        <label className="block text-sm font-medium text-slate-500">{label}</label>
        {templates.length > 0 && (
          <button
            type="button"
            onClick={() => setShowTagModal(true)}
            className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary-50 text-primary-600 hover:bg-primary-100 border border-primary-200 text-[11px] font-bold transition-all"
          >
            <Eye size={13} />
            {tr('pageui.hookform.flex_tag_info', 'ดูข้อมูล tag flex')}
          </button>
        )}
      </div>
      {templates.length === 0 ? (
        <p className="text-xs text-slate-500/80 border border-dashed border-dark-600 rounded-lg px-3 py-3">{emptyText}</p>
      ) : (
        <>
          <button
            type="button"
            disabled={isViewMode}
            onClick={() => setOpen(o => !o)}
            className={`w-full rounded-lg border border-dark-600 bg-white px-3 py-2 text-sm flex items-center justify-between text-left ${isViewMode ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <span className={`truncate ${pickedTpls.length === 0 ? 'text-slate-400' : 'text-slate-900 font-medium'}`}>{summary}</span>
            <ChevronDown size={16} className={`ml-2 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
          {open && !isViewMode && (
            <div className="absolute z-20 mt-1 w-full rounded-lg border border-dark-600 bg-white shadow-lg">
              <div className="flex items-center justify-between px-3 py-2 border-b border-dark-700 text-xs">
                <button type="button" onClick={() => setAll(true)} className="text-primary-600 hover:text-primary-500 font-medium disabled:opacity-40" disabled={allPicked}>{tr('pageui.hookform.select_all', 'เลือกทั้งหมด')}</button>
                <button type="button" onClick={() => setAll(false)} className="text-slate-500 hover:text-slate-700 font-medium disabled:opacity-40" disabled={pickedTpls.length === 0}>{tr('pageui.hookform.clear_selected', 'ล้างที่เลือก')}</button>
              </div>
              <div className="max-h-56 overflow-y-auto custom-scrollbar divide-y divide-dark-700">
                {templates.map(tpl => {
                  const checked = picked.includes(tpl.id);
                  return (
                    <button type="button" key={tpl.id} onClick={() => toggleId(tpl.id)} className="flex w-full items-center gap-3 px-3 py-2 text-sm text-left hover:bg-slate-100">
                      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? 'bg-primary-500 border-primary-500' : 'border-slate-300 bg-white'}`}>
                        {checked && <Check size={12} className="text-white" />}
                      </span>
                      <span className="text-slate-900 font-medium truncate">{tpl.name}</span>
                      {tpl.flex_tag && <span className="ml-auto text-[10px] font-mono text-slate-500 shrink-0">{`[[[${tpl.flex_tag}]]]`}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
      <p className="mt-1 text-xs text-slate-500/80">{hint}</p>

      {showTagModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={() => setShowTagModal(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white shadow-xl overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2"><Info size={16} className="text-primary-500" />{tagModalTitle}</h3>
              <button type="button" onClick={() => setShowTagModal(false)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto custom-scrollbar divide-y divide-slate-100">
              {templates.map(tpl => {
                const tagText = tpl.flex_tag ? `[[[${tpl.flex_tag}]]]` : null;
                return (
                  <div key={tpl.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-slate-800 truncate">{tpl.name}</div>
                      <div className="text-xs font-mono text-slate-500 truncate">{tagText ?? tr('pageui.hookform.no_tag_yet', '— ยังไม่มี tag —')}</div>
                    </div>
                    {tagText && (
                      <button
                        type="button"
                        onClick={() => {
                          /* [FIX-20260830-COPYHTTP2] the raw API is UNDEFINED on http,
                             so `.writeText` threw a TypeError before any promise
                             existed — `.catch` never ran and the click handler blew
                             up. copyText always returns a promise. */
                          void copyText(tagText).then((ok) =>
                            ok
                              ? onCopyToast(tr('pageui.hookform.copied_tag', 'คัดลอก {tag} แล้ว', { tag: tagText }), 'success')
                              : onCopyToast(copyFailMsg, 'error'),
                          );
                        }}
                        className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200 text-xs font-bold transition-all"
                      >
                        <Copy size={13} />{tr('pageui.hookform.copy', 'คัดลอก')}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="px-5 py-3 border-t border-slate-100 text-[11px] text-slate-400">{tagModalFooter}</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FlexCardMultiSelect;
