import React from 'react';
import { AlertCircle, Check, Database, ExternalLink, Globe, Loader2, Maximize2, X } from 'lucide-react';

import { SHOW_LIMIT_LABELS } from './objectImageForm.constants';
import { storageOptionsFor } from './storageOptions';
import { GDriveImage } from '../gdrive/GDriveImage';
import type { ObjectImageFormData } from '../../../types';

/**
 * [REFACTOR-20260904-OBJFORMSPLIT] The album form's MEDIA step, UPPER half:
 * where the album's pictures come from, and the Google Drive picker.
 * ===========================================================================
 * Lifted VERBATIM out of `ObjectImageFormModal.tsx` (§6.3 step 3).
 *
 * 🔴 ONLY THE UPPER HALF MOVED, AND THAT WAS MEASURED, NOT ASSUMED. The MEDIA
 * step is 481 lines; this half is 182 of them, reaches 26 names and contains NO
 * inline async handler, so every dependency is a prop and nothing about timing
 * changes. The LOWER half — the Local Gallery — reaches 32 names AND embeds its
 * own async sync handler (it calls `onSubmit`, reads `syncCount`, flips
 * `setShowConfirmSync`), which makes it a §6.4 state move rather than a lift.
 * Moving both together is what failed on the first attempt at this file.
 * Measure before cutting: the upper half lifts, the lower half does not.
 *
 * ⚠️ `storageOptionsFor(formData.storage)` decides what the picker offers, and
 * its argument is the album's CURRENT storage — not the mode. `OFFER_GOOGLE_DRIVE`
 * is `false`, so Drive is offered only to an album already on Drive; a new one
 * gets local + external. It is called here rather than passed in because it is
 * pure, and passing its RESULT would let a caller offer a storage this form does
 * not support.
 *
 * revert: paste the body back at the top of the `STEP_MEDIA` entry in
 *   `ObjectImageFormModal.tsx` and delete this file.
 */
export interface ObjectFormMediaSourceProps {
  formData: ObjectImageFormData;
  errors: Record<string, string>;
  resolvedMode: 'create' | 'update' | 'view';
  handleChange: (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => void;
  inputClass: (hasError?: boolean) => string;
  /** The Drive gallery for the folder in `img_path`, owned by the parent. */
  gDriveImages: { id: string; name: string; url: string }[];
  gDriveLoading: boolean;
  gDriveLoadingMore: boolean;
  gDriveLoadingAll: boolean;
  gDriveNextToken: string | null;
  gDriveCancelRef: React.MutableRefObject<boolean>;
  onLoadMoreGDrive: () => void;
  onLoadAllGDrive: () => void;
  onUploadGDriveToServer: (driveId: string) => void;
  /** Which Drive file is mid-upload, so only its own button shows the loading spinner. */
  uploadingId: string | null;
  /**
   * The album being edited, or undefined while creating.
   *
   * ⚠️ Found by `tsc`, not by the dependency scan: this block reads
   * `initialData?.id` to decide whether a saved album exists, and a scan of the
   * component's `const` declarations cannot see a PROP. Compile first.
   */
  initialData?: { id?: string } | null;
  loading: boolean;
  getPreviewUrl: (url: string) => string;
  /* [FEAT-20261022-I18NPAGESEN] widened so a label can carry its Thai fallback — the parent passes useI18n().t */
  t: (key: string, fallbackOrVars?: string | Record<string, unknown>, vars?: Record<string, unknown>) => string;
}

export const ObjectFormMediaSource: React.FC<ObjectFormMediaSourceProps> = ({
  formData,
  errors,
  resolvedMode,
  handleChange,
  inputClass,
  gDriveImages,
  gDriveLoading,
  gDriveLoadingMore,
  gDriveLoadingAll,
  gDriveNextToken,
  gDriveCancelRef,
  onLoadMoreGDrive: handleLoadMoreGDrive,
  onLoadAllGDrive: handleLoadAllGDrive,
  onUploadGDriveToServer: handleUploadGDriveToServer,
  uploadingId,
  initialData,
  loading,
  getPreviewUrl,
  t,
}) => (
  <>
    {/* [UI-20260901-STORAGETOSTEP2] Storage, the path/folder field
        and the preview live here, not in step 1. Owner, 01/09.

        They belong beside the galleries: all four answer "where does
        this album's picture come from", leaving step 1 to say what
        the album IS — category, detail, tag. Moved verbatim, so the
        storage switch still drives which label the path field shows
        and the preview still reads the same formData.img_path.

        ⚠️ This is why the media step now exists while CREATING too.
        It used to be dropped there, correctly, because everything in
        it was a gallery and a gallery needs a saved album id. These
        three do not — and the local upload auto-saves the album and
        THEN attaches the file, so a create that could not reach its
        storage picker would be pinned to the `external` default with
        no way to say otherwise. The galleries below keep their own
        not-create gate; they are the part that genuinely needs an id.
        revert: move this block back above the basic step's `</>`. */}
      <div className="flex flex-col">
        <label className="block text-sm font-medium text-slate-500 mb-1">
          {t('object_image.form_storage_label')}
        </label>
        <select
          name="storage"
          value={formData.storage}
          onChange={handleChange}
          className={inputClass(false)}
          disabled={resolvedMode === 'view' || resolvedMode === 'update' || !!initialData}
        >
          {/* [UI-20260901-HIDEGDRIVE] Driven by storageOptionsFor, so
              an album already on Google Drive keeps showing its real
              storage instead of silently reading as "local". */}
          {storageOptionsFor(formData.storage).map((value) => (
            <option key={value} value={value}>
              {t(`object_image.storage_${value}`)}
            </option>
          ))}
        </select>
      </div>

      {/* Static Limit Labels for Create Mode
          [UI-20260901-HIDELIMITS] hidden with its edit-mode twin. */}
      {SHOW_LIMIT_LABELS && resolvedMode === 'create' && (
        <div className="md:col-span-2 flex flex-col sm:flex-row gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl mt-1">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-primary-500" />
            <span className="text-[11px] font-bold text-slate-600 uppercase tracking-tight">
              {t('object_image.limit_label_flex')}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            <span className="text-[11px] font-bold text-slate-600 uppercase tracking-tight">
              {t('object_image.limit_label_media')}
            </span>
          </div>
        </div>
      )}

      {/* Hide img_path entirely for local storage mode as it uses direct uploads or galleries */}
      {(formData.storage !== 'local' && (formData.storage === 'google_drive' || (resolvedMode !== 'create'))) && (
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-slate-500 mb-1">
            {formData.storage === 'google_drive'
              ? t('object_image.form_google_folder_id_label')
              : t('object_image.form_img_path_label')}
          </label>
          <input
            name="img_path"
            value={formData.img_path}
            onChange={handleChange}
            className={inputClass(!!errors.img_path)}
            placeholder={formData.storage === 'google_drive' ? 'FOLDER_ID' : t('object_image.form_img_path_placeholder')}
            disabled={resolvedMode === 'view'}
          />
          {formData.img_path && formData.storage !== 'google_drive' && (
            <div className="mt-3 p-2 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-center min-h-[100px] overflow-hidden">
              <img
                key={formData.img_path}
                src={getPreviewUrl(formData.img_path)}
                alt="Preview"
                className="max-h-40 object-contain rounded shadow-sm"
                referrerPolicy="no-referrer"
                loading="lazy"
                onError={(e) => {
                  if (!formData.img_path.includes('drive.google.com')) {
                    (e.target as any).src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%23cbd5e1' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect width='18' height='18' x='3' y='3' rx='2' ry='2'%3E%3C/rect%3E%3Ccircle cx='9' cy='9' r='2'%3E%3C/circle%3E%3Cpath d='m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21'%3E%3C/path%3E%3C/svg%3E";
                  }
                }}
              />
            </div>
          )}

          {formData.storage === "google_drive" && resolvedMode !== "create" && (
            <div className="mt-3 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Google Drive Gallery</span>
                {(gDriveLoading || gDriveLoadingMore || gDriveLoadingAll) && <Loader2 size={14} className="animate-spin text-primary-500" />}
              </div>

              {gDriveLoading && gDriveImages.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 bg-slate-50/50 rounded-2xl border-2 border-dashed border-primary-100 animate-in fade-in duration-700 relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-b from-primary-50/20 to-transparent" />
                  <div className="relative mb-8">
                    <div className="absolute inset-0 bg-primary-200 rounded-full blur-[40px] animate-pulse opacity-40" />
                    <Loader2 size={100} strokeWidth={1.5} className="animate-spin text-primary-500 relative z-10" />
                  </div>
                  <h4 className="text-xl font-black text-primary-900 tracking-[0.2em] uppercase mb-2 animate-pulse">{t("object_image.loading_more").split('(')[0]}</h4>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-[0.3em] max-w-[240px] text-center leading-relaxed">
                    Connecting to Google Cloud Service<br />Please wait while we sync your assets
                  </p>
                </div>
              ) : (
                <>
                  {gDriveImages.length > 0 ? (
                    <div className="flex flex-col gap-3 w-full animate-in fade-in duration-300">
                      <div className={`grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2 bg-slate-50 p-2 rounded-xl border border-slate-100 overflow-y-auto custom-scrollbar shadow-inner w-full relative transition-all max-h-[600px]`}>
                        {gDriveLoadingAll && (
                          <div className="sticky top-0 left-0 right-0 z-[60] bg-white/80 backdrop-blur-sm border-b border-primary-100 p-3 flex flex-col items-center justify-center gap-2 animate-in slide-in-from-top duration-300">
                            <div className="flex items-center gap-3">
                              <Loader2 size={24} className="animate-spin text-primary-600" />
                              <span className="text-sm font-black text-primary-900 tracking-widest uppercase">SYNCING DRIVE...</span>
                            </div>
                            <p className="text-[10px] font-bold text-primary-500 uppercase tracking-tighter">Please wait while we fetch all images</p>
                          </div>
                        )}
                        {gDriveImages.map(img => (
                          <GDriveImage
                            key={img.id}
                            id={img.id}
                            name={img.name}
                            url={img.url}
                            albumId={initialData?.id}
                            uploadingId={uploadingId}
                            onUpload={handleUploadGDriveToServer}
                          />
                        ))}
                      </div>

                      {gDriveNextToken && (
                        <div className="flex gap-2 w-full mt-2">
                          <button
                            type="button"
                            onClick={handleLoadMoreGDrive}
                            disabled={gDriveLoadingMore || gDriveLoadingAll}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg border border-primary-100 bg-primary-50/50 text-primary-700 text-xs font-bold hover:bg-primary-100 transition-all disabled:opacity-50"
                          >
                            {gDriveLoadingMore ? <Loader2 size={14} className="animate-spin" /> : `${t("object_image.load_more").split("+")[0]} (24)`}
                          </button>

                          {gDriveLoadingAll ? (
                            <button
                              type="button"
                              onClick={() => { gDriveCancelRef.current = true; }}
                              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg border border-red-100 bg-red-50 text-red-600 text-xs font-bold hover:bg-red-100 transition-all"
                            >
                              <X size={14} /> {t("object_image.stop_loading")}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={handleLoadAllGDrive}
                              disabled={gDriveLoadingMore}
                              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg border border-slate-200 bg-white text-slate-600 text-xs font-bold hover:bg-slate-50 transition-all disabled:opacity-50"
                            >
                              {t("object_image.load_all")}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ) : !gDriveLoading && formData.img_path ? (
                    <div className="bg-slate-50 p-8 rounded-xl border border-dashed border-slate-200 text-center">
                      <p className="text-sm text-slate-500 font-medium">{t('pageui.object.no_drive_images', 'ไม่พบภาพในที่อยู่นี้หรือ API Key ไม่ถูกต้อง')}</p>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          )}
        </div>
      )}
  </>
);
