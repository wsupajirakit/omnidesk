import React from 'react';
import { AlertCircle, Check, ChevronDown, Copy, Loader2, Tag, X } from 'lucide-react';

import { copyText } from '../../../utils/copyText';
/* The switch that decides whether the response-type control is on screen at all
   — the same constant the parent reads, not a copy of its value. */
import {
  SHOW_MEDIA_LIMIT_WARNING,
  SHOW_RESPONSE_TYPE,
} from './objectImageForm.constants';
import type { ObjectCategory, ObjectImageFormData, ImageStorage } from '../../../types';

/**
 * [REFACTOR-20260904-OBJFORMSPLIT] The album form's BASIC step: which categories
 * the album belongs to, its detail line, and its matching tags.
 * ===========================================================================
 * Lifted VERBATIM out of `ObjectImageFormModal.tsx` (§6.3 step 3): class strings
 * and element order byte-identical.
 *
 * 🔴 FIFTEEN NAMES CROSSED, ALL AS PROPS — including `categoryRef`, which is the
 * parent's `useRef`. It is passed rather than re-created here because the parent
 * owns the outside-click effect that closes this dropdown; a ref created in this
 * file would point at a node that effect never watches, and the dropdown would
 * simply stop closing. The ref must be the one that effect watches.
 *
 * ⚠️ THE CATEGORY PICKER IS READ-ONLY OUTSIDE CREATE. An album's category cannot
 * change after it exists, so the button is disabled and styled as such rather
 * than hidden — the admin still needs to SEE which category it is in.
 *
 * ⚠️ The COPY button writes the tags as `[[[tag]]]`, which is the shape the bot
 * matches on. It is not decoration and it is covered by a test that presses it.
 *
 * revert: paste the body back into the `STEP_BASIC` entry of the steps array in
 *   `ObjectImageFormModal.tsx` and delete this file.
 */
export interface ObjectFormBasicStepProps {
  formData: ObjectImageFormData;
  onFormChange: React.Dispatch<React.SetStateAction<ObjectImageFormData>>;
  errors: Record<string, string>;
  resolvedMode: 'create' | 'update' | 'view';
  categories: ObjectCategory[];
  /** Already narrowed to this album's categories by the parent. */
  selectedCategories: ObjectCategory[];
  fetchingOptions: boolean;
  isCategoryDropdownOpen: boolean;
  onCategoryDropdownToggle: (open: boolean) => void;
  /** The parent's ref — see the note above; do NOT create one here. */
  categoryRef: React.RefObject<HTMLDivElement>;
  /** Stored files, read only to warn before a change that would orphan them. */
  serverImages: ImageStorage[];
  handleChange: (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => void;
  inputClass: (hasError?: boolean) => string;
  showAlert: (
    title: string,
    message: string,
    type?: 'success' | 'error' | 'info',
  ) => void;
  /* [FEAT-20261022-I18NPAGESEN] widened so a label can carry its Thai fallback — the parent passes useI18n().t */
  t: (key: string, fallbackOrVars?: string | Record<string, unknown>, vars?: Record<string, unknown>) => string;
}

export const ObjectFormBasicStep: React.FC<ObjectFormBasicStepProps> = ({
  formData,
  onFormChange: setFormData,
  errors,
  resolvedMode,
  categories,
  selectedCategories,
  fetchingOptions,
  isCategoryDropdownOpen,
  onCategoryDropdownToggle: setIsCategoryDropdownOpen,
  categoryRef,
  serverImages,
  handleChange,
  inputClass,
  showAlert,
  t,
}) => (
  <>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

      <div className="relative" ref={categoryRef}>
        <label className="block text-sm font-medium text-slate-500 mb-1">
          {t('object_image.form_categories_label')}
        </label>
        <button
          type="button"
          onClick={() => resolvedMode === 'create' && setIsCategoryDropdownOpen(!isCategoryDropdownOpen)}
          disabled={resolvedMode !== 'create'}
          className={`${inputClass(!!errors.categories)} flex flex-wrap gap-2 min-h-[44px] justify-between items-center text-left ${resolvedMode !== 'create' ? 'bg-slate-50 opacity-80 cursor-not-allowed' : ''}`}
        >
          <div className="flex flex-wrap gap-1.5 flex-1 min-w-0 py-0.5">
            {selectedCategories.length > 0 ? (
              selectedCategories.map(cat => (
                <span key={cat.id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-primary-50 text-primary-700 text-xs font-medium rounded-full border border-primary-100">
                  {cat.name}
                  {resolvedMode === 'create' && (
                    <X
                      size={12}
                      className="hover:text-primary-900 cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFormData(prev => ({ ...prev, categories: [] }));
                      }}
                    />
                  )}
                </span>
              ))
            ) : (
              <span className="text-slate-400">{t('common.search_placeholder')}</span>
            )}
          </div>
          <ChevronDown size={16} className={`shrink-0 transition-transform ${isCategoryDropdownOpen ? 'rotate-180' : ''}`} />
        </button>
        {isCategoryDropdownOpen && resolvedMode !== 'view' && (
          <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-xl max-h-60 overflow-y-auto custom-scrollbar p-2">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-2 px-1">
              <span className="text-[10px] font-bold uppercase text-slate-400">{t('object_image.form_categories_label')}</span>
            </div>
            {fetchingOptions ? (
              <div className="p-2 text-center text-sm text-slate-400">Loading...</div>
            ) : categories.length === 0 ? (
              <div className="p-2 text-center text-sm text-slate-400">No categories</div>
            ) : (
              categories.map(cat => {
                const id = cat._id || cat.id;
                const selected = formData.categories.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setFormData(prev => ({ ...prev, categories: [id] }));
                      setIsCategoryDropdownOpen(false);
                    }}
                    className={`w-full flex items-center gap-2 p-2 rounded-md text-sm transition-colors ${selected ? 'bg-primary-50 text-primary-700' : 'hover:bg-slate-50 text-slate-700'
                      }`}
                  >
                    <div className={`w-4 h-4 border transition-colors flex items-center justify-center ${selected ? 'bg-primary-600 border-primary-600 rounded-full' : 'border-slate-300 bg-white rounded-full'
                      }`}>
                      {selected && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                    </div>
                    {cat.name}
                  </button>
                );
              })
            )}
          </div>
        )}
        {errors.categories && (
          <div className="flex items-center gap-1 mt-1 text-red-500 text-xs">
            <AlertCircle size={12} />
            <span>{t('object_image.form_categories_label')} {t('common.required')}</span>
          </div>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-500 mb-1">
          {t('object_image.form_detail_label')}
        </label>
        <textarea
          name="detail"
          value={formData.detail}
          onChange={handleChange}
          className={`${inputClass(!!errors.detail)} h-12 py-2 resize-none`}
          placeholder={t('object_image.form_detail_placeholder')}
          disabled={resolvedMode === 'view'}
        />
        {errors.detail && (
          <div className="flex items-center gap-1 mt-1 text-red-500 text-xs">
            <AlertCircle size={12} />
            <span>{errors.detail}</span>
          </div>
        )}
      </div>

      {/* [UI-20260901-FIXMEDIA] Response type is pinned to `media`
          and the picker is hidden. Owner, 01/09.

          ONLY THE CONTROL IS GONE. `response_type` is still a real
          field: it is in the form state, in the payload, in the DTO
          and in the schema, and the runtime still branches on it
          (`webhook.service.ts` sends a flex carousel when an album
          says `flex`). Albums already stored as `flex` keep working
          and keep their value — nothing rewrites them, because this
          modal only sends what its form holds and its form loads what
          the album has.

          New albums get `media` from DEFAULT_FORM, which is what the
          default already was.

          revert (restore the picker): delete the SHOW_RESPONSE_TYPE
          flag and this conditional; the block below is unchanged.
          revert (also unpin new albums): nothing else to do — the
          default was already `media`. */}
      {SHOW_RESPONSE_TYPE && (
      <div className="flex flex-col">
        <div className="flex justify-between items-center mb-1">
          <div className="flex items-center gap-2">
            <label className="block text-sm font-medium text-slate-500">
              {t('object_image.form_response_type_label')}
            </label>
            <div className="flex items-center gap-1.5 px-2 py-0.5 bg-slate-100 rounded text-[10px] font-bold text-slate-400 uppercase tracking-tighter">

            </div>
          </div>
          {/* [UI-20260904-HIDEMEDIAWARN] gated with its twin below. */}
          {SHOW_MEDIA_LIMIT_WARNING &&
            formData.response_type === 'media' &&
            serverImages.length > 5 && (
              <span className="text-[10px] font-bold text-red-500 animate-pulse">
                {t('object_image.media_limit_warning')}
              </span>
            )}
          {formData.response_type === 'flex' && serverImages.length > 10 && (
            <span className="text-[10px] font-bold text-red-500 animate-pulse">
              {t('object_image.flex_limit_warning')}
            </span>
          )}
        </div>
        <select
          name="response_type"
          value={formData.response_type}
          onChange={handleChange}
          className={`${inputClass(!!errors.response_type)} w-full`}
          disabled={resolvedMode === 'view'}
        >
          <option value="media">{t('object_image.response_type_media')}</option>
          <option value="flex">{t('object_image.response_type_flex')}</option>
        </select>
      </div>
      )}

      {/* [UI-20260901-FIXMEDIA] The over-limit warning still has to be
          reachable with the picker hidden — five is a real ceiling and
          silently exceeding it is what the warning exists to stop.
          [UI-20260904-HIDEMEDIAWARN] …and the owner has now asked for that
          sentence to go. The reasoning above is kept rather than deleted: it
          records why the message was made reachable here in the first place, so
          whoever flips the flag back knows this site is not optional. */}
      {SHOW_MEDIA_LIMIT_WARNING &&
        !SHOW_RESPONSE_TYPE &&
        serverImages.length > 5 && (
          <p className="text-[10px] font-bold text-red-500 animate-pulse">
            {t('object_image.media_limit_warning')}
          </p>
        )}

      {/* Consolidated Tags Select/Manage - HIDDEN IN CREATE */}
      {resolvedMode !== 'create' && (
        <div className="flex flex-col">
          <label className="block text-sm font-medium text-slate-500 mb-1">
            {t('object_image.form_matching_tag_label')}
          </label>
          <div className="flex flex-col gap-2 p-2 bg-slate-50 border border-slate-200 rounded-xl shadow-inner min-h-[44px] justify-center">
            {(formData.matching_tag && formData.matching_tag.length > 0) ? (
              <div className="flex flex-wrap gap-1.5 items-center">
                <div className="flex flex-wrap gap-1.5 flex-1">
                  {formData.matching_tag.map((tag, idx) => (
                    <span key={idx} className="group inline-flex items-center gap-1 text-[11px] font-black text-primary-700 bg-primary-50 px-2 py-0.5 rounded border border-primary-100 transition-all hover:bg-primary-100 uppercase tracking-tight">
                      [[[ {tag} ]]]
                      {/* X Button removed for both Edit and View as requested */}
                    </span>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const tagStr = (formData.matching_tag || []).map(t => `[[[${t}]]]`).join(' ');
                    // [FIX-20260830-COPYHTTP2] the alert follows the real result
                    void copyText(tagStr).then((ok) =>
                      ok
                        ? showAlert(t('common.success'), t('pageui.object.tag_copied', 'คัดลอก Tag แล้ว: {tag}', { tag: tagStr }), 'success')
                        : showAlert(t('common.error_title'), t('common.copy_failed_message'), 'error'),
                    );
                  }}
                  className="p-1.5 text-primary-600 hover:bg-primary-50 rounded-lg transition-colors border border-primary-100 bg-white shadow-sm flex items-center gap-1 text-[9px] font-black uppercase tracking-tighter shrink-0"
                >
                  <Copy size={12} />
                  COPY
                </button>
              </div>
            ) : (
              <div className="text-center py-1 opacity-20">
                <p className="text-[9px] font-black uppercase tracking-widest">No tags selected</p>
              </div>
            )}
          </div>
        </div>
      )}


    </div>
  </>
);
