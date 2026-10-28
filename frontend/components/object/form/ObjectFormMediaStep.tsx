import React from 'react';
import {
  Database,
  Image as ImageIcon,
  Link2 as LinkIcon,
  Loader2,
  Maximize2,
  Pencil,
  Trash2,
  Upload,
} from 'lucide-react';

import type { ImageStorage, ObjectImageFormData } from '../../../types';
import { GalleryHeader } from '../gallery/GalleryHeader';
import { MediaKindBadge } from '../gallery/MediaKindBadge';
import type { ZoomedMedia } from '../gallery/StoredImageZoom';
import { StoredMediaThumb } from '../gallery/StoredMediaThumb';
import { UploadProgressPanel } from '../gallery/UploadProgressPanel';
import { UploaderCaption } from '../gallery/UploaderCaption';
import { UPLOAD_ACCEPT } from '../gallery/uploadKind';
/* [FEAT-20260907-GALLERYINCREMENTAL] how many stored files may be drawn yet */
import { useIncrementalReveal } from '../gallery/useIncrementalReveal';
/* [FEAT-20260907-INLINEDETAIL] the caption editor that lives on the rank strip */
import { StoredDetailInlineEdit } from '../gallery/StoredDetailInlineEdit';
import { SHOW_LIMIT_LABELS } from './objectImageForm.constants';
import { ObjectFormMediaSource } from './ObjectFormMediaSource';
import type { useDrivePicker } from './useDrivePicker';
import type { useGalleryActions } from './useGalleryActions';

/**
 * [REFACTOR-20260904-FORMHOOKS] The album form's MEDIA step: where the pictures
 * come from, and the gallery of the ones we already hold.
 * ===========================================================================
 * Lifted VERBATIM out of `ObjectImageFormModal.tsx` (§6.3 step 3).
 *
 * 🔴 IT TAKES THE TWO HOOK RESULTS WHOLE, NOT 33 SEPARATE PROPS. The JSX reads
 * 24 values from `useGalleryActions`/`useDrivePicker` and 9 from the form. Spread
 * flat that is a 33-argument component nobody can call correctly; passed as the
 * two objects they already are, it is a seam that says what it means — this pane
 * renders the gallery feature and the Drive feature.
 * ⚠️ The types are taken with `ReturnType<typeof …>` so they cannot drift from
 * the hooks: add a field there and it is visible here with no edit.
 *
 * ⚠️ NOTHING WAS RE-WIRED. Every handler is still the hook's, every piece of
 * state still lives where it did, and this file holds none of its own.
 *
 * revert: paste the body back into the `STEP_MEDIA` entry of the steps array in
 *   `ObjectImageFormModal.tsx` and delete this file.
 */
export interface ObjectFormMediaStepProps {
  formData: ObjectImageFormData;
  resolvedMode: 'create' | 'update' | 'view';
  initialData?: { id?: string } | null;
  serverImages: ImageStorage[];
  /** The wizard's error map and its change handler — the source picker uses both. */
  errors: Record<string, string>;
  handleChange: (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => void;
  /** True while the form itself is saving. */
  loading: boolean;
  serverImagesLoading: boolean;
  gallery: ReturnType<typeof useGalleryActions>;
  drive: ReturnType<typeof useDrivePicker>;
  inputClass: (hasError?: boolean) => string;
  getPreviewUrl: (url: string) => string;
  copyImageLink: (url: string) => void;
  /* [FIX-20260904-ZOOMVIDEO] Takes the kind too — the tile knows it, the
     overlay needs it, and only this call site can carry it across. */
  setZoomedImage: (media: ZoomedMedia | null) => void;
  /* [UI-20260907-LOADMOREGUIDE] widened to the REAL `t` signature
     (`i18n/index.tsx:17`) — the load-more guide interpolates a count. It was
     narrowed to key-only here, which is a subset, so no caller changes. */
  /* [FEAT-20261022-I18NPAGESEN] widened so a label can carry its Thai fallback — the parent passes useI18n().t */
  t: (key: string, fallbackOrVars?: string | Record<string, unknown>, vars?: Record<string, unknown>) => string;
}

export const ObjectFormMediaStep: React.FC<ObjectFormMediaStepProps> = ({
  formData,
  resolvedMode,
  initialData,
  serverImages,
  serverImagesLoading,
  errors,
  handleChange,
  loading,
  gallery,
  drive,
  inputClass,
  getPreviewUrl,
  copyImageLink,
  setZoomedImage,
  t,
}) => {
  /* [FEAT-20260907-GALLERYINCREMENTAL] five per row, do not draw
     the whole album, and pull the next batch in when the scroll reaches the end.
     ⚠️ This component had no body — it was an arrow returning JSX directly. It
        gained one ONLY to hold this hook; nothing else about it moved. */
  const reveal = useIncrementalReveal(serverImages.length);

  return (
  <>
    <ObjectFormMediaSource
      formData={formData}
      errors={errors}
      resolvedMode={resolvedMode}
      handleChange={handleChange}
      inputClass={inputClass}
      gDriveImages={drive.gDriveImages}
      gDriveLoading={drive.gDriveLoading}
      gDriveLoadingMore={drive.gDriveLoadingMore}
      gDriveLoadingAll={drive.gDriveLoadingAll}
      gDriveNextToken={drive.gDriveNextToken}
      gDriveCancelRef={drive.gDriveCancelRef}
      onLoadMoreGDrive={drive.handleLoadMoreGDrive}
      onLoadAllGDrive={drive.handleLoadAllGDrive}
      onUploadGDriveToServer={drive.handleUploadGDriveToServer}
      uploadingId={drive.uploadingId}
      initialData={initialData}
      loading={loading}
      getPreviewUrl={getPreviewUrl}
      t={t}
    />

    {/* Server Storage Gallery (Local Gallery)
        ==================================================
        Shown only once the album exists: `resolvedMode !== 'create'`
        AND it has an id or a path. An unsaved album has nothing to
        attach files to, which is also why the upload handler's
        "auto-save first" branch is UNREACHABLE from here — probed
        04/09, and left in place because the handler is shared.

        🔴 KNOWN AND NOT FIXED — read before "tidying" this block:

        · it is still ~238 lines nested up to 19 levels deep. It was
          NOT extracted, and that is a measured decision: it reaches 30
          names in this component, so lifting it means passing ~30
          props — the same complexity in a new file. Moving a mess is
          not removing one.
        · what WOULD make it liftable is pulling its remaining handlers
          (`gallery.handleLocalFileUpload`, `gallery.handleImportUrlToServer`,
          `gallery.handleReorderStoredFile`, `gallery.handleDeleteStorage`) into a hook
          of this form's own, so the panel needs data and callbacks
          rather than half the component. That is its own piece of work
          and needs its own tests first (§6.4).
        · the two async handlers it used to hold INLINE are already
          named above — that was the part that could be improved
          without moving anything.

        ⚠️ Its behaviour is covered by `test/objectLocalGalleryActions
        .dom.test.tsx` (upload · import · drag-reorder) and
        `objectLocalGallery.dom.test.tsx` (what it renders). Anything
        done to this block must keep both green. */}
    {(resolvedMode !== 'create' && (initialData?.id || !!formData.img_path)) && (
      <div className="flex flex-col gap-4">
        {/* Limit Labels for Edit Mode
            [UI-20260901-HIDELIMITS] hidden with its create-mode twin. */}
        {SHOW_LIMIT_LABELS && (
        <div className="flex flex-wrap gap-2 sm:gap-4 px-4 py-2 border-l-4 border-primary-500 bg-primary-50/30 rounded-r-xl">
          <div className="flex items-center gap-2">
             <span className="text-[10px] sm:text-xs font-black text-primary-700 uppercase tracking-widest leading-none">
               {t('object_image.limit_label_flex')}
             </span>
          </div>
          <div className="h-3 w-px bg-primary-200 hidden sm:block" />
          <div className="flex items-center gap-2">
             <span className="text-[10px] sm:text-xs font-black text-amber-700 uppercase tracking-widest leading-none">
               {t('object_image.limit_label_media')}
             </span>
          </div>
        </div>
        )}

        <div className="bg-slate-50/50 p-4 rounded-2xl border border-slate-200 flex flex-col gap-4 animate-in fade-in duration-500">
          {/* [FIX-20260904-GALLERYHEADERROW] the caption and the
              dropzone used to be SIBLINGS in one `justify-between`
              row, so the row laid them side by side and the dashed
              box ran over the words. The caption is its own block
              above the box now; the wrapper below is a plain column.
              revert: put both back in one justify-between row. */}
          <GalleryHeader />
          <div className="flex flex-col gap-3">

          {/* [FEAT-20260904-UPLOADPROGRESS] Sits ABOVE the dropzone, so
              the file being uploaded is the first thing in the panel
              rather than something the admin has to scroll for. It is
              rendered only while an upload is in flight. */}
          {gallery.uploadState && (
            <UploadProgressPanel
              file={gallery.uploadState.file}
              kind={gallery.uploadState.kind}
              phase={gallery.uploadState.phase}
              percent={gallery.uploadState.percent}
              onCancel={gallery.uploadState.cancel}
              t={t}
            />
          )}

          {formData.storage === 'local' ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                gallery.setIsDragging(true);
              }}
              onDragLeave={() => gallery.setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                gallery.setIsDragging(false);
                const file = e.dataTransfer.files[0];
                /* [FEAT-20260904-OBJVIDEO] video is dropped the same
                   way; the handler routes it. */
                if (file && (file.type.startsWith('image/') || file.type.startsWith('video/'))) {
                  gallery.handleLocalFileUpload({ target: { files: [file] } } as any);
                }
              }}
              className={`flex-1 transition-all ${gallery.isDragging ? 'scale-[1.01]' : ''}`}
            >
              {/* [UI-20260901-BIGDROP] A real drop TARGET, not a strip.
                  It was `py-2`: about 36px tall, which is a hard thing
                  to aim a dragged file at and reads as a button rather
                  than a place to drop something. Now it is a panel with
                  its own icon, headline and hint, and the whole area is
                  the target — the drag handlers already sat on the
                  wrapper, so nothing about the behaviour changed.
                  revert: restore the single-row label above. */}
              <label className="cursor-pointer group block">
                <input type="file" className="hidden" accept={UPLOAD_ACCEPT} onChange={gallery.handleLocalFileUpload} disabled={gallery.isUploadingLocal} />
                <div className={`flex flex-col items-center justify-center gap-3 px-6 py-10 rounded-2xl text-center transition-all border-2 border-dashed shadow-sm ${gallery.isDragging
                  ? 'bg-primary-50 border-primary-500 scale-[1.01]'
                  : 'bg-white border-primary-100 hover:border-primary-400 hover:bg-slate-50/60'
                  }`}>
                  <div className={`flex h-14 w-14 items-center justify-center rounded-full transition-all ${gallery.isDragging
                    ? 'bg-primary-500/15 text-primary-600'
                    : 'bg-slate-100 text-slate-400 group-hover:bg-primary-500/10 group-hover:text-primary-500'
                    }`}>
                    {gallery.isUploadingLocal
                      ? <Loader2 size={26} className="animate-spin" />
                      : <Upload size={26} className={gallery.isDragging ? 'animate-bounce' : ''} />}
                  </div>

                  <div className="flex flex-col gap-1">
                    <span className={`text-sm font-bold ${gallery.isDragging ? 'text-primary-700' : 'text-slate-700'}`}>
                      {gallery.isUploadingLocal
                        ? t('object_image.drop_uploading')
                        : gallery.isDragging
                          ? t('object_image.drop_release')
                          : t('object_image.drop_title')}
                    </span>
                    {/* The size rule is not decoration: the browser
                        downscales before upload, so saying so here is
                        what stops "why is my 4000px photo smaller". */}
                    <span className="text-[11px] text-slate-400">
                      {t('object_image.drop_hint')}
                    </span>
                  </div>
                </div>
              </label>
            </div>
          ) : (
            <>
              {formData.storage === 'google_drive' ? (
                <button
                  type="button"
                  onClick={() => {
                    if (drive.gDriveImages.length === 0) return;
                    drive.setShowConfirmSync(true);
                  }}
                  disabled={gallery.isUploadingLocal || drive.gDriveImages.length === 0}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-500 transition-all shadow-lg shadow-blue-500/20 active:scale-95 disabled:opacity-50"
                >
                  {gallery.isUploadingLocal ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      {drive.syncCount ? `SYNCING ${drive.syncCount.current}/${drive.syncCount.total}` : 'SYNCING...'}
                    </>
                  ) : (
                    <>
                      <Database size={14} />
                      SYNC DRIVE TO SERVER
                    </>
                  )}
                </button>
              ) : formData.storage === 'external' && formData.img_path ? (
                <button
                  type="button"
                  onClick={() => void gallery.handleImportUrlToServer()}
                  disabled={gallery.isUploadingLocal || !formData.img_path}
                  className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-xl text-xs font-bold hover:bg-amber-500 transition-all shadow-lg shadow-amber-500/20 active:scale-95 disabled:opacity-50"
                >
                  {gallery.isUploadingLocal ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />}
                  IMPORT URL TO SERVER
                </button>
              ) : null}
            </>
          )}
        </div>

        {serverImagesLoading ? (
          <div className="flex flex-col items-center justify-center py-10"><Loader2 size={24} className="animate-spin text-primary-500/30" /></div>
        ) : serverImages.length > 0 ? (
          /* [FEAT-20260907-GALLERYINCREMENTAL] FIVE per row (owner, 07/09) — one
             count at every width, not 4/5/6 stepping by breakpoint, because the
             owner asked for five and a responsive ladder would only be five on
             one screen size.
             ⚠️ `rootRef` goes on THIS box: it is the thing that scrolls, and the
                sentinel below is measured against it, not against the page. */
          <div
            ref={reveal.rootRef}
            /* [UI-20260907-GRIDGUTTER] the tiles must not sit flush
               against each other. The original `gap-2` (8px) read as one solid
               block once the row went to five: the tiles got narrower while the
               gutter stayed the same size.
               ⚠️ THE AXES ARE NOT EQUAL, ON PURPOSE. `gap-x-6` (24px) and
                  `gap-y-8` (32px). The tiles are `aspect-square`, so an equal gap
                  reads as tighter between rows than between columns — the eye
                  compares the gutter against the edge it runs along, and a square
                  tile gives the vertical gutter a longer edge. The larger row gap
                  is what makes the two look the same.
                  ⚠️ Tailwind writes these as `calc(var(--spacing) * n)` with
                     `--spacing: .25rem`, verified in the built CSS — a missing
                     variable would drop the whole declaration and silently give
                     `gap: 0`, which is what "the gutter is not applied" looks
                     like. It is applied.
                  If it is ever tuned again, this one class is the only place. */
            className="grid grid-cols-5 gap-x-6 gap-y-8 max-h-[500px] overflow-y-auto custom-scrollbar p-3"
          >
            {serverImages.slice(0, reveal.visibleCount).map((img, index) => (
              <div
                key={img.id}
                className={`aspect-square bg-white rounded-xl border border-slate-200 overflow-hidden group/server relative ring-offset-2 hover:ring-2 hover:ring-primary-500 transition-all shadow-sm cursor-move ${gallery.draggedItemIndex === index ? 'opacity-50 ring-2 ring-primary-500 scale-95' : ''}`}
                draggable={resolvedMode !== 'view'}
                onDragStart={() => gallery.setDraggedItemIndex(index)}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(e) => void gallery.handleReorderStoredFile(e, index)}
                onDragEnd={() => gallery.setDraggedItemIndex(null)}
              >
                {/* [FEAT-20260904-OBJVIDEO] image or video, from `media_kind` alone */}
                <StoredMediaThumb url={img.image_url} mediaKind={img.media_kind} />
                <MediaKindBadge mediaKind={img.media_kind} />
                {/* [FEAT-20260904-UPLOADEDBY] who uploaded it — a name
                    the server resolved, never an id. */}
                <UploaderCaption name={img.created_by_name} />
                <div className="absolute inset-0 bg-black/0 group-hover/server:bg-black/40 transition-all flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setZoomedImage({
                        url: img.image_url,
                        mediaKind: img.media_kind,
                      })
                    }
                    className="p-1.5 bg-primary-600 text-white rounded-lg opacity-0 group-hover/server:opacity-100 transition-all hover:bg-primary-500 hover:scale-110 shadow-lg"
                    title="Zoom Preview"
                  >
                    <Maximize2 size={12} />
                  </button>

                  {/* [FEAT-20260804-COPYIMGLINK] คัดลอกลิงก์ "รายภาพ"
                      📌 ย้ายมาจากหน้า list เพราะ 1 อัลบั้มมีหลายภาพ
                         ปุ่มที่หน้า list คัดลอกได้แค่ภาพแรก (first_thumb)
                         ภาพที่ 2, 3, ... เลยไม่มีทางคัดลอกได้เลย
                      ⚠️ โชว์ทั้งโหมดดูและโหมดแก้ไข (ไม่เหมือนปุ่มแก้/ลบ ที่เฉพาะ update)
                      ⚠️ ตรวจว่าเป็นลิงก์รูปจริงก่อนคัดลอก — กันหลุดไป path อื่น
                      revert: ลบปุ่มนี้ + copyImageLink ในไฟล์นี้ */}
                  <button
                    type="button"
                    onClick={() => copyImageLink(img.image_url)}
                    className="p-1.5 bg-emerald-600 text-white rounded-lg opacity-0 group-hover/server:opacity-100 transition-all hover:bg-emerald-500 hover:scale-110 shadow-lg"
                    title={t('object_image.copy_link_title')}
                  >
                    <LinkIcon size={12} />
                  </button>

                  {(resolvedMode === 'update') && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          gallery.setEditingImage(img);
                          gallery.setEditDetailForm({
                            detail_link: img.detail_link || '',
                            detail_text: img.detail_text || ''
                          });
                        }}
                        className="p-1.5 bg-amber-600 text-white rounded-lg opacity-0 group-hover/server:opacity-100 transition-all hover:bg-amber-500 hover:scale-110 shadow-lg"
                        title="Edit Details"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => gallery.handleDeleteStorage(img.id)}
                        className="p-1.5 bg-red-600 text-white rounded-lg opacity-0 group-hover/server:opacity-100 transition-all hover:bg-red-500 hover:scale-110 shadow-lg"
                        title={t('pageui.object.delete_from_server', 'ลบออกจาก Server')}
                      >
                        <Trash2 size={12} />
                      </button>
                    </>
                  )}
                </div>
                {/* [UI-20260907-RANKNUMONLY] The badge reads "#1", "#2" … The word
                    "RANK" was dropped: the number is the whole message and the
                    label took half the strip.
                    [UI-20260907-RANKDETAIL] The file's own detail text follows it
                    when there is one, so a tile can be told apart without opening
                    it — five across leaves the picture too small to identify by
                    sight alone.
                    ⚠️ `truncate` + `min-w-0` on the text, not on the strip: the
                       number must never be the part that gets cut, so it sits in
                       a `shrink-0` span and only the detail gives way.
                    ⚠️ `normal-case` on the detail. The strip is `uppercase`, which
                       is right for "#1" and wrong for a sentence somebody typed.
                    ⚠️ `title` carries the full text — the strip is one line and a
                       long detail is unreadable without it. */}
                <div className="absolute top-0 left-0 right-0 flex items-center justify-center gap-1.5 px-1 py-1 bg-primary-600/90 text-center text-[11px] text-white font-black backdrop-blur-sm border-b border-primary-400 z-10 shadow-sm uppercase tracking-tighter">
                  <span className="shrink-0">#{index + 1}</span>
                  {gallery.inlineDetailId === img.id ? (
                    /* [FEAT-20260907-INLINEDETAIL] the shortcut: edit the caption
                       here instead of opening the whole detail dialog. It saves
                       through the SAME `saveDetail` that dialog uses. */
                    <StoredDetailInlineEdit
                      initialText={img.detail_text || ''}
                      saving={gallery.savingDetail}
                      onSave={(text) =>
                        void gallery.saveDetail(img.id, { detail_text: text })
                      }
                      onCancel={() => gallery.setInlineDetailId(null)}
                    />
                  ) : (
                    <>
                      {img.detail_text ? (
                        <span
                          className="min-w-0 truncate font-bold normal-case opacity-90"
                          title={img.detail_text}
                        >
                          {img.detail_text}
                        </span>
                      ) : null}
                      {/* Editing is an update-mode action, like the pencil in the
                          hover overlay — a read-only visit must not offer it. */}
                      {resolvedMode === 'update' && (
                        <button
                          type="button"
                          data-testid={`inline-detail-open-${img.id}`}
                          onClick={() => gallery.setInlineDetailId(img.id)}
                          title={t('object_image.edit_detail_inline')}
                          aria-label={t('object_image.edit_detail_inline')}
                          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-white/70 transition-colors hover:bg-white/25 hover:text-white"
                        >
                          <Pencil size={10} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
            {/* [FEAT-20260907-GALLERYINCREMENTAL] the end-of-list marker. Scrolling
                it into view reveals the next chunk — no button, as required.
                ⚠️ `col-span-full` so it sits on its own row instead of stealing a
                   cell from the five-wide grid and shifting every tile after it.
                ⚠️ Rendered ONLY while something is still held back; an observer
                   left watching a permanently visible element would keep firing
                   `grow()` for nothing. */}
            {reveal.hasMore && (
              /* [UI-20260907-LOADMOREGUIDE] The marker SAYS something now. Owner,
                 07/09: with a hundred images the grid has to grow, and a silent
                 6px spacer gave no sign that more was coming — the album just
                 looked like it ended at twenty. It still loads by itself; this is
                 a signpost, not a button.
                 ⚠️ It also reports HOW MANY are still held back, so the number is
                    the proof the rest exists rather than a spinner that could be
                    hiding a stuck state. */
              <div
                ref={reveal.sentinelRef}
                data-testid="obj-gallery-more"
                className="col-span-full flex items-center justify-center gap-2 py-3 text-[11px] font-bold uppercase tracking-widest text-slate-400"
              >
                <Loader2 size={14} className="animate-spin opacity-60" />
                {t('object_image.gallery_loading_more', {
                  count: serverImages.length - reveal.visibleCount,
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="py-10 bg-white/50 rounded-xl border border-dashed border-slate-200 text-center">
            <div className="flex flex-col items-center gap-2 opacity-30">
              <ImageIcon size={32} />
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">No local images yet</p>
            </div>
          </div>
        )}
        </div>
      </div>
    )}
  </>
  );
};
