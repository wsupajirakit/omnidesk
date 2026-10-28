/**
 * [REFACTOR-20260904-OBJLISTSPLIT] Edit one stored file's link and caption.
 * ===========================================================================
 * Lifted VERBATIM out of `ObjectImageList.tsx` (§6.3 step 3): same markup, same
 * class strings, same order.
 *
 * 🔴 THE FORM STATE STAYED IN THE PAGE. `editDetailForm` and its setter arrive
 * as props rather than moving here, because the page is what SAVES them — the
 * request, the alert and the gallery reload all live there. Moving the state
 * would split one save across two files for nothing: the state belongs with
 * whoever saves it.
 *
 * ⚠️ `inputClass` is passed in, not re-declared. It is the page's shared field
 * style; a private copy here is how two inputs drift apart one commit later.
 *
 * ⚠️ The backdrop closes the dialog and the panel stops propagation — without
 * the second handler, clicking a field closes the dialog you are typing in.
 *
 * revert: paste the body back behind `{editingImageStorage && (…)}` in
 *   `ObjectImageList.tsx` and delete this file.
 */
import React from 'react';
import { Loader2, Pencil, Save, X } from 'lucide-react';

import type { ImageStorage } from '../../../types';
import { StoredMediaThumb } from '../../../components/object/gallery/StoredMediaThumb';

export interface ObjectImageDetailModalProps {
  /** The stored file being edited. The parent renders this only when set. */
  storage: ImageStorage;
  form: { detail_link: string; detail_text: string };
  onFormChange: React.Dispatch<
    React.SetStateAction<{ detail_link: string; detail_text: string }>
  >;
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
  inputClass: (hasError?: boolean) => string;
  t: (key: string) => string;
}

export const ObjectImageDetailModal: React.FC<ObjectImageDetailModalProps> = ({
  storage,
  form,
  onFormChange,
  saving,
  onSave,
  onClose,
  inputClass,
  t,
}) => (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/45 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200 animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-slate-50/50">
          <h4 className="font-bold text-slate-800 flex items-center gap-2">
            <Pencil size={16} className="text-primary-600" />
            {t('object_image.edit_image_details')}
          </h4>
          <button 
            onClick={() => onClose()}
            className="p-1 hover:bg-slate-200 rounded-full transition-colors"
          >
            <X size={20} className="text-slate-400" />
          </button>
        </div>

        <div className="p-6 flex flex-col gap-5">
          <div className="aspect-video w-full rounded-xl overflow-hidden border border-slate-200 bg-slate-100 relative group">
            {/* [FIX-20260904-DETAILVIDEO] Was a bare <img>, so editing a stored
                VIDEO's caption showed a broken image. Same fix as the form's
                twin (`components/object/gallery/StoredImageDetailModal.tsx`) —
                both were missed on the day video shipped. */}
            <StoredMediaThumb
              url={storage.image_url}
              mediaKind={storage.media_kind}
              className="w-full h-full object-contain"
            />
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                {t('object_image.form_detail_link_label')}
              </label>
              <input 
                type="text"
                value={form.detail_link}
                onChange={(e) => onFormChange(prev => ({ ...prev, detail_link: e.target.value }))}
                className={inputClass(false)}
                placeholder="https://example.com/..."
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                {t('object_image.form_detail_text_label')}
              </label>
              <input 
                type="text"
                value={form.detail_text}
                onChange={(e) => onFormChange(prev => ({ ...prev, detail_text: e.target.value }))}
                className={inputClass(false)}
                placeholder={t('object_image.form_detail_text_placeholder')}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 p-4 bg-slate-50 border-t border-slate-100">
          <button
            onClick={() => onClose()}
            className="px-4 py-2 text-sm font-bold text-slate-500 hover:text-slate-700 transition-colors"
            disabled={saving}
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="px-6 py-2 bg-primary-600 text-white rounded-xl text-sm font-bold hover:bg-primary-500 transition-all shadow-lg shadow-primary-500/20 flex items-center gap-2 disabled:opacity-50"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {t('common.save')}
          </button>
        </div>
      </div>
    </div>
);
