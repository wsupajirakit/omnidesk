import React from 'react';
import { HelpCircle } from 'lucide-react';

import type { HookFormTabCtx } from './hookFormTabCtx';

/**
 * [FEAT-20260909-AITABVENDORSPLIT] Gemini's four generation knobs.
 * ===========================================================================
 * Temperature, Top K, Top P and the thinking budget. Every one of them is a
 * GEMINI value — DeepSeek has no `top_k` at all and its transport logs the knob
 * as ignored — so they belong inside the Gemini box beside Gemini's model and
 * Gemini's key, not floating in a row of their own under both vendors.
 *
 * 🔴 MOVED, NOT REWRITTEN. The markup is the block that stood in
 *    `HookAiTab.tsx` lines 137-216, carried across whole and dedented. One
 *    class changed: the outer wrapper dropped `md:col-span-2`, which existed to
 *    span HookAiTab's two-column grid and means nothing inside a vendor box.
 *    Retyping four sliders, three help modals and the three-state thinking
 *    control by hand is how a `??` default or a `.toFixed(1)` quietly changes.
 *
 * 🟢 It also SHRINKS `HookAiTab.tsx`, which is on the max-lines waiver — a list
 *    the eslint config says may only ever shrink and must never gain a name.
 *
 * ⚠️ `gemini_thinking_budget` here is the MAIN lane's, the one the reply path
 *    has always read. Only its display moved; `request-credentials.ts` still
 *    reads the same column by the same name. The translate lane's separate
 *    budget lives in `AiReasoningFields.tsx`.
 *
 * revert: paste the block back into `HookAiTab.tsx` after `<AiVendorSelect/>`,
 *         restoring `md:col-span-2`, and delete this file.
 */
export const GeminiKnobsFields: React.FC<{ ctx: HookFormTabCtx }> = ({ ctx }) => {
  const { formData, setFormData, isViewMode, t, handleChange, setHelpModal } = ctx;
  return (
    /* [FEAT-20260909-AITABVENDORSPLIT] A titled section, first inside the Gemini
       box — owner, 09/09. It reuses `reasoning_group_main`, the SAME heading the
       DeepSeek box gives its main-lane knobs, so one wording names one lane on
       both sides of the screen. It sits BEFORE the translate-only budget,
       because it governs the lane that answers customers. */
    <div className="md:col-span-2">
      <span className="block text-xs font-semibold text-slate-500 mb-2">
        {t('hook_form.reasoning_group_main')}
      </span>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="flex flex-col gap-2">
              <label className="flex justify-between text-sm font-medium text-slate-500">
                <span className="flex items-center gap-1">
                  {t('hook_form.gemini_temperature')}
                  <button type="button" onClick={() => setHelpModal({ isOpen: true, title: t('hook_form.gemini_temperature'), message: t('hook_form.gemini_temperature_help') })} className="text-blue-500/60 hover:text-blue-500"><HelpCircle size={14} /></button>
                </span>
                <span className="text-primary-500 font-mono">{(formData.gemini_temperature ?? 0.5).toFixed(1)}</span>
              </label>
              {/* [FIX-20260802-SEEKBAR] เดิมใช้ appearance-none + bg-* utility อย่างเดียว
                  ราง track (pseudo-element) ไม่ถูกสไตล์ → บาง browser render ราง
                  โปร่งใส มองไม่เห็นขีดเลย เห็นแต่หัวจับเขียว
                  แก้: ใช้คลาส .range-slider ใน index.css ที่กำหนด track+thumb ครบทุก vendor
                  (ทั้ง 3 ตัว) ใช้ modal เดียวกันทั้ง create/edit
                  revert: ดู marker เดียวกันใน index.css */}
              <input type="range" min="0" max="1" step="0.1" disabled={isViewMode} name="gemini_temperature" value={formData.gemini_temperature ?? 0.5} onChange={handleChange} className="range-slider" />
            </div>
            <div className="flex flex-col gap-2">
              <label className="flex justify-between text-sm font-medium text-slate-500">
                <span className="flex items-center gap-1">
                  {t('hook_form.gemini_top_k')}
                  <button type="button" onClick={() => setHelpModal({ isOpen: true, title: t('hook_form.gemini_top_k'), message: t('hook_form.gemini_top_k_help') })} className="text-blue-500/60 hover:text-blue-500"><HelpCircle size={14} /></button>
                </span>
                <span className="text-primary-500 font-mono">{formData.gemini_top_k ?? 20}</span>
              </label>
              <input type="range" min="1" max="100" step="1" disabled={isViewMode} name="gemini_top_k" value={formData.gemini_top_k ?? 20} onChange={handleChange} className="range-slider" />
            </div>
            <div className="flex flex-col gap-2">
              <label className="flex justify-between text-sm font-medium text-slate-500">
                <span className="flex items-center gap-1">
                  {t('hook_form.gemini_top_p')}
                  <button type="button" onClick={() => setHelpModal({ isOpen: true, title: t('hook_form.gemini_top_p'), message: t('hook_form.gemini_top_p_help') })} className="text-blue-500/60 hover:text-blue-500"><HelpCircle size={14} /></button>
                </span>
                <span className="text-primary-500 font-mono">{(formData.gemini_top_p ?? 0.9).toFixed(1)}</span>
              </label>
              <input type="range" min="0" max="1" step="0.1" disabled={isViewMode} name="gemini_top_p" value={formData.gemini_top_p ?? 0.9} onChange={handleChange} className="range-slider" />
            </div>
            {/* [FEAT-20260802-THINKHOOK] Thinking ต่อ hook — select (ปิด/Dynamic/เปิด) · เปิด = โผล่ช่องกรอก 1-24576 */}
            <div className="flex flex-col gap-2">
              <label className="flex justify-between text-sm font-medium text-slate-500">
                <span className="flex items-center gap-1">
                  {t('hook_form.thinking_label')}
                  <button type="button" onClick={() => setHelpModal({ isOpen: true, title: t('hook_form.thinking_label'), message: t('hook_form.thinking_help') })} className="text-blue-500/60 hover:text-blue-500"><HelpCircle size={14} /></button>
                </span>
                <span className="text-primary-500 font-mono">
                  {Number(formData.gemini_thinking_budget ?? 0) === 0 ? t('hook_form.thinking_state_off') : Number(formData.gemini_thinking_budget) === -1 ? t('hook_form.thinking_state_auto') : `${formData.gemini_thinking_budget}`}
                </span>
              </label>
              <select
                disabled={isViewMode}
                value={Number(formData.gemini_thinking_budget ?? 0) === 0 ? 'off' : Number(formData.gemini_thinking_budget) === -1 ? 'dynamic' : 'custom'}
                onChange={(e) => {
                  const m = e.target.value;
                  setFormData(prev => ({
                    ...prev,
                    gemini_thinking_budget: m === 'off' ? 0 : m === 'dynamic' ? -1
                      : (Number(prev.gemini_thinking_budget) > 0 ? Number(prev.gemini_thinking_budget) : 2048),
                  }));
                }}
                className="w-full bg-dark-800 border border-dark-600 rounded-lg py-2 px-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent cursor-pointer disabled:opacity-60"
              >
                <option value="off">{t('hook_form.thinking_opt_off')}</option>
                <option value="dynamic">{t('hook_form.thinking_opt_dynamic')}</option>
                <option value="custom">{t('hook_form.thinking_opt_custom')}</option>
              </select>
              {Number(formData.gemini_thinking_budget) > 0 && (
                <input
                  type="number" min={1} max={24576} step={1} disabled={isViewMode}
                  value={formData.gemini_thinking_budget}
                  onChange={(e) => {
                    const raw = parseInt(e.target.value, 10);
                    const clamped = Number.isFinite(raw) ? Math.max(1, Math.min(24576, raw)) : 1;
                    setFormData(prev => ({ ...prev, gemini_thinking_budget: clamped }));
                  }}
                  placeholder="1 - 24576"
                  className="w-full bg-dark-800 border border-dark-600 rounded-lg py-2 px-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:opacity-60"
                />
              )}
            </div>
      </div>
    </div>
  );
};

export default GeminiKnobsFields;
