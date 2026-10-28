/**
 * [FEAT-20260918-HOOKTRANS] Chat Translation Settings for Hook Form
 * ============================================================================
 * WHAT: Settings for chat translation attached to this OA:
 *   - `translate_lang`: Primary/default language for translating chat messages in this OA.
 *     Stored as string code or null (when unspecified / follow default).
 *   - `auto_translate`: Whether automatic chat translation is enabled for this OA.
 *     Stored as boolean (default false).
 *
 * Placed in its own file to respect the 400-line ratchet ceiling (dev-local §6.1).
 * revert: delete this file and remove its mount in AiVendorSelect.tsx.
 */

import React from 'react';
import { Languages } from 'lucide-react';
import type { HookFormTabCtx } from './hookFormTabCtx';
import {
  TRANSLATE_LANGUAGES,
  asTranslateLanguage,
} from '../../../../config/translateLanguages';

export const HookTranslateFields: React.FC<{ ctx: HookFormTabCtx }> = ({ ctx }) => {
  const { formData, setFormData, isViewMode, t, inputClass } = ctx;

  return (
    <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-50/60 p-5 rounded-2xl border border-slate-200">
      <div className="md:col-span-2 flex items-center gap-2 text-sm font-bold text-slate-700 border-b border-slate-200 pb-2">
        <Languages size={16} className="text-blue-600" />
        <span>{t('hook_form.translate_section_title')}</span>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-600 mb-1">
          {t('hook_form.translate_lang')}
        </label>
        <select
          disabled={isViewMode}
          name="translate_lang"
          value={formData.translate_lang || ''}
          onChange={(e) => {
            const next = asTranslateLanguage(e.target.value);
            setFormData((prev: Record<string, unknown>) => ({
              ...prev,
              translate_lang: next,
            }));
          }}
          className={inputClass(false, 'bg-white')}
        >
          <option value="">{t('hook_form.translate_lang_default')}</option>
          {TRANSLATE_LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {t(l.labelKey)}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-slate-500/80">
          {t('hook_form.translate_lang_hint')}
        </p>
      </div>

      <div className="flex flex-col justify-start">
        <label className="block text-sm font-medium text-slate-600 mb-1">
          {t('hook_form.auto_translate')}
        </label>
        <label className="inline-flex w-fit items-center gap-2.5 cursor-pointer mt-1 group">
          <input
            type="checkbox"
            disabled={isViewMode}
            name="auto_translate"
            checked={Boolean(formData.auto_translate)}
            onChange={(e) => {
              const checked = e.target.checked;
              setFormData((prev: Record<string, unknown>) => ({
                ...prev,
                auto_translate: checked,
              }));
            }}
            className="accent-primary-500 rounded w-5 h-5 cursor-pointer"
          />
          <span className="text-sm text-slate-700 select-none font-medium">
            {t('hook_form.auto_translate_toggle')}
          </span>
        </label>
        <p className="mt-1.5 text-xs text-slate-500/80">
          {t('hook_form.auto_translate_hint')}
        </p>
      </div>
    </div>
  );
};
