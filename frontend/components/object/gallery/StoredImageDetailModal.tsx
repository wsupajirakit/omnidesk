import React from 'react';
import { Loader2, Pencil, Save, X } from 'lucide-react';

import type { ImageStorage } from '../../../types';
import { StoredMediaThumb } from './StoredMediaThumb';

/**
 * [REFACTOR-20260904-OBJFORMSPLIT] Edit one stored file's link and caption, from
 * inside the album form.
 * ===========================================================================
 * Lifted VERBATIM (§6.3 step 3): same markup, same class strings, same order.
 * It reached for nine names and has no async of its own — the save lives in the
 * form, which owns the request and the alert that follows it.
 *
 * ⚠️ `inputClass` is passed in, not re-declared: it is the form's shared field
 * style, and a private copy is how two inputs drift apart one commit later.
 *
 * ⚠️ SEPARATE FROM the list page's `ObjectImageDetailModal`, for the same reason
 * the zoom overlays are separate — they are two screens that may diverge, and
 * one component with a flag for each caller is worse than two honest ones.
 *
 * revert: paste the body back behind `{editingImage && (…)}` in
 *   `ObjectImageFormModal.tsx` and delete this file.
 */
export interface StoredImageDetailModalProps {
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

export const StoredImageDetailModal: React.FC<StoredImageDetailModalProps> = ({
  storage,
  form,
  onFormChange,
  saving,
  onSave,
  onClose,
  inputClass,
  t,
}) => (
  <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/45 backdrop-blur-sm animate-in fade-in duration-200">
    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200 animate-in zoom-in-95 duration-200">
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
              VIDEO's caption showed a broken image where the preview belongs.
              `StoredMediaThumb` already owns the image-or-video rule and reads
              the same `media_kind` column — one rule, not a third copy.
              `object-contain` is passed through: a preview must show the whole
              frame, where a grid tile crops to fill. */}
          <StoredMediaThumb
            url={storage.image_url}
            mediaKind={storage.media_kind}
            className="w-full h-full object-contain"
          />
          <div className="absolute inset-x-0 bottom-0 p-2 bg-black/60 backdrop-blur-sm">
            <p className="text-[10px] text-white/80 font-medium truncate text-center">
              {/* [UI-20260907-RANKNUMONLY] same as the grid badge: number only. */}
              {storage.priority ? `#${storage.priority}` : 'Storage Record'}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {/* [UI-20260907-HIDEDETAILLINK] The "detail link" field is HIDDEN, owner
              07/09. It stays in `form` and is still submitted unchanged, so an
              album that already has a link keeps it — this hides the input, it
              does NOT clear the value. Removing it from the form object would
              blank the stored link on the next save of every file that has one.
              ซ่อนช่อง ไม่ได้ลบค่า — ของเดิมที่มีลิงก์อยู่ต้องไม่หาย
              revert: restore the block below this comment; the label key
              `object_image.form_detail_link_label` is still in all four locales. */}

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
