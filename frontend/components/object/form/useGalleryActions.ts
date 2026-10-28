import { useState } from 'react';

import { imageStorageService } from '../../../services/media';
import { isUploadAbort } from '../../../services/uploadWithProgress';
import type { ImageStorage, ObjectCategory, ObjectImageFormData } from '../../../types';
import { VIDEO_DOWNSCALE } from '../../../utils/videoDownscale';
import {
  ALLOWED_UPLOAD_EXTENSIONS,
  pickUploadKind,
} from '../gallery/uploadKind';
import type { UploadPhase } from '../gallery/UploadProgressPanel';

/**
 * [REFACTOR-20260904-FORMHOOKS] Everything the Local Gallery DOES: put a file
 * on our server, import one from a url, reorder, delete, and edit a caption.
 * ===========================================================================
 *
 * ### Why these six moved together (§6.4)
 *
 * They are the write side of one panel, and they share its state: the busy
 * flag, the progress card, the drag index, the pending delete, the row being
 * captioned. Splitting them would leave a handler on one side of the seam and
 * the flag it flips on the other.
 *
 * 🔴 TEN PIECES OF STATE TRAVELLED WITH THEM AND ONLY SIX NAMES ARE REAL
 * DEPENDENCIES — the album, its categories, the stored-file list and its
 * reloader, the alert, and `t`. That ratio is the argument for the move; when it
 * is the other way round, moving the block only relocates the coupling.
 *
 * ### Three rules in here that look like details and are not
 *
 * ⚠️ AN UNSAVED ALBUM IS SAVED SILENTLY FIRST. There is no id to attach a file
 * to otherwise, and `onSubmit(formData, true)` — the `true` — is what stops a
 * dialog appearing mid-drop. A save that returns nothing MUST abort: uploading
 * against `undefined` writes a file the album can never see.
 * ⚠️ A CANCELLED UPLOAD IS SILENT. The admin pressed stop and knows; an error
 * box on top of that reads as "it broke as well". Everything else still shouts.
 * ⚠️ `priority` IS the order the bot serves the files in. The reorder is a
 * write, not an animation, and dropping a tile on itself must write nothing.
 *
 * revert: paste these six members and their state back into
 *   `ObjectImageFormModal.tsx` and delete this file.
 */
export interface GalleryActionsDeps {
  formData: ObjectImageFormData;
  categories: ObjectCategory[];
  /** The album's stored files — read to resolve a drag index to an id. */
  serverImages: ImageStorage[];
  fetchServerImages: (recordId: string) => Promise<void>;
  showAlert: (
    title: string,
    message: string,
    type?: 'success' | 'error' | 'info',
  ) => void;
  t: (key: string, vars?: Record<string, unknown>) => string;
  initialData?: { id?: string } | null;
  /** ⚠️ `Promise<string | void>`, taken from the modal's own prop type — the
   *  resolved value IS the new album id, and `void` is a save that produced
   *  none, which every caller here must treat as "abort". */
  onSubmit: (data: ObjectImageFormData, silent?: boolean) => Promise<string | void>;
}

export function useGalleryActions({
  formData,
  categories,
  serverImages,
  fetchServerImages,
  showAlert,
  t,
  initialData,
  onSubmit,
}: GalleryActionsDeps) {
  const [isUploadingLocal, setIsUploadingLocal] = useState(false);
  const [uploadState, setUploadState] = useState<{
    file: File;
    kind: 'image' | 'video';
    phase: UploadPhase;
    percent: number;
    cancel?: () => void;
  } | null>(null);
  const [draggedItemIndex, setDraggedItemIndex] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [deleteStorageId, setDeleteStorageId] = useState<string | null>(null);
  const [editingImage, setEditingImage] = useState<ImageStorage | null>(null);
  const [editDetailForm, setEditDetailForm] = useState({ detail_link: '', detail_text: '' });
  /**
   * [FEAT-20260907-INLINEDETAIL] Which tile has its detail open for editing on
   * the strip, by id, or `null`.
   *
   * 🔴 A SEPARATE MARKER FROM `editingImage`, ON PURPOSE. `editingImage` is what
   *    opens the full dialog — reusing it would pop that dialog open at the same
   *    time as the inline field. One state per surface.
   */
  const [inlineDetailId, setInlineDetailId] = useState<string | null>(null);
  const [savingDetail, setSavingDetail] = useState(false);

  const handleLocalFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    let finalId = initialData?.id;

    if (!finalId) {
      // Seamless Auto-Save for new records during local upload
      setIsUploadingLocal(true);
      try {
        const newId = await onSubmit(formData, true);
        if (newId) {
          finalId = newId;
        } else {
          throw new Error("Failed to auto-save");
        }
      } catch (error) {
        setIsUploadingLocal(false);
        return;
      }
    }

    setIsUploadingLocal(true);
    try {
      /* [FEAT-20260904-OBJVIDEO] One drop target, two destinations. An image
         goes to `dashboard` and lands in public/uploads/images; a video goes to
         `dashboard-video` and lands in public/uploads/videos. The rule that
         picks lives in `gallery/uploadKind.ts` so it can be tested on its own.
         ⚠️ The image branch below is BYTE-IDENTICAL to what shipped before. */
      const decision = pickUploadKind(file);

      if (decision.kind === 'unsupported') {
        /* [FIX-20260904-UPLOAD400] Name the extensions, do not describe them.
           "รองรับรูปภาพ" was true and useless: the admin who just picked a .bmp
           thought a .bmp was a รูปภาพ. The list comes from the same tables the
           picker's `accept` is built from, so the sentence can never promise
           something the server refuses. บอกสกุลไปตรง ๆ */
        showAlert(
          t('common.error_title'),
          t('object_image.upload_unsupported_type', {
            allowed: ALLOWED_UPLOAD_EXTENSIONS,
          }),
          'error',
        );
        return;
      }
      if (decision.tooLarge) {
        /* Said BEFORE sending: the server enforces the same ceiling and would
           answer 413 after the whole file had gone up.
           ⚠️ The limit is INTERPOLATED from `VIDEO_DOWNSCALE.maxBytes`, not
           typed into the sentence. It read "50 MB" in Thai only, so raising the
           cap left two translations quietly lying about the real number. */
        showAlert(
          t('common.error_title'),
          t('object_image.upload_video_too_large', {
            limit: `${Math.round(VIDEO_DOWNSCALE.maxBytes / (1024 * 1024))} MB`,
          }),
          'error',
        );
        return;
      }

      /* [FEAT-20260904-UPLOADPROGRESS] One controls object for both kinds — the
         panel does not care which route the bytes take. */
      setUploadState({ file, kind: decision.kind, phase: 'shrinking', percent: 0 });
      const controls = {
        onPhase: (phase: UploadPhase) =>
          setUploadState((prev) => (prev ? { ...prev, phase, percent: 0 } : prev)),
        onProgress: ({ percent }: { percent: number }) =>
          setUploadState((prev) => (prev ? { ...prev, percent } : prev)),
        onStart: (cancel: () => void) =>
          setUploadState((prev) => (prev ? { ...prev, cancel } : prev)),
      };

      if (decision.kind === 'video') {
        /* [FEAT-20260904-OBJVIDEO] Owner, 04/09: NO alert on a video upload that
           worked.
           The removed one fired on `!shrunk` and said "this browser cannot
           shrink video", but `shrunk:false` has EIGHT causes in
           `downscaleVideoFile` and only `no-encoder` was that one. The common
           case is `already-small` — a file under 5 MB that was never meant to be
           re-encoded — so the admin read a defect where the rule had worked
           exactly as designed. An upload that succeeded says so by the file
           appearing in the gallery; whether the bytes were re-encoded on the way
           is our business, not theirs. Failures still shout, below.
           `reason` is still returned by the service for logging or a future
           per-reason message — nothing upstream was removed. */
        await imageStorageService.uploadDashboardVideo(finalId, file, controls);
      } else {
        await imageStorageService.uploadDashboard(finalId, file, controls);
      }
      await fetchServerImages(finalId);
    } catch (error) {
      /* 🔴 A CANCEL IS NOT A FAILURE. The admin pressed stop and already knows;
         an error dialog on top of that reads as "it broke as well". Everything
         else still shouts. ยกเลิกเอง = เงียบ · พังจริง = ต้องบอก */
      if (isUploadAbort(error)) {
        setUploadState(null);
        setIsUploadingLocal(false);
        if (e.target) e.target.value = '';
        return;
      }
      console.error('Failed to upload file to dashboard', error);
      showAlert(t('common.error_title'), t('object_image.upload_failed'), 'error');
    } finally {
      setUploadState(null);
      setIsUploadingLocal(false);
      if (e.target) e.target.value = ''; // Reset input
    }
  };

  const handleImportUrlToServer = async (): Promise<void> => {
let finalId = initialData?.id;

if (!finalId) {
  setIsUploadingLocal(true);
  try {
    const newId = await onSubmit(formData, true);
    if (newId) {
      finalId = newId;
    } else {
      throw new Error("Failed to auto-save");
    }
  } catch (error) {
    setIsUploadingLocal(false);
    return;
  }
}

setIsUploadingLocal(true);
try {
  const firstCatId = formData.categories[0];
  const category = categories.find(c => c.id === firstCatId || (c as any)._id === firstCatId);
  const apiKey = category?.api_key;

  await imageStorageService.uploadExternal(finalId, {
    url: formData.img_path,
    api_key: apiKey
  });
  await fetchServerImages(finalId);
  showAlert(t('common.success'), t('object_image.import_ok'), 'success');
} catch (error) {
  console.error('External sync error', error);
  showAlert(t('common.error_title'), t('object_image.import_failed'), 'error');
} finally {
  setIsUploadingLocal(false);
}
  };

  const handleReorderStoredFile = async (
    e: React.DragEvent,
    index: number,
  ): Promise<void> => {
e.preventDefault();
if (draggedItemIndex === null || draggedItemIndex === index) return;

const movedId = serverImages[draggedItemIndex].id;
const newPos = index + 1;

try {
  await imageStorageService.update(movedId, { priority: newPos });
  if (initialData?.id) await fetchServerImages(initialData.id);
} catch (error) {
  console.error('Priority update failed', error);
} finally {
  setDraggedItemIndex(null);
}
  };

  const handleDeleteStorage = (id: string) => {
    if (!initialData?.id) return;
    setDeleteStorageId(id);
  };

  const handleDeleteStorageConfirmed = async () => {
    if (!deleteStorageId || !initialData?.id) return;
    try {
      await imageStorageService.delete(deleteStorageId);
      await fetchServerImages(initialData.id);
      /* [FIX-20260904-I18NGALLERY] "รูปภาพ" → "ไฟล์": the same button deletes a
         stored VIDEO, and it said "image deleted" either way. */
      showAlert(t('common.success'), t('object_image.file_deleted'), 'success');
    } catch (error) {
      console.error('Failed to delete stored file', error);
      showAlert(t('common.error_title'), t('object_image.file_delete_failed'), 'error');
    } finally {
      setDeleteStorageId(null);
    }
  };

  /**
   * [FEAT-20260907-INLINEDETAIL] The ONE save path for a stored file's detail.
   *
   * Two callers reach it: the full dialog, and the inline editor on the tile's
   * rank strip. It is one function rather than two because everything after the
   * request — refetch the album, report success, report failure — has to stay
   * identical, and a second copy is where "the dialog refreshes but the inline
   * one does not" comes from.
   *
   * `id`/`payload` default to the dialog's own state, so the dialog's call site
   * is unchanged.
   */
  const saveDetail = async (
    id?: string,
    payload?: { detail_link?: string; detail_text?: string },
  ): Promise<void> => {
    const targetId = id ?? editingImage?.id;
    if (!targetId) return;
    setSavingDetail(true);
    try {
      await imageStorageService.update(targetId, payload ?? editDetailForm);
      if (initialData?.id) await fetchServerImages(initialData.id);
      /* [FIX-20260904-I18NGALLERY] The `|| 'ไทย'` fallbacks are gone. They were
         dead for `save_success` (the key exists in both locales) and ALIVE for
         `save_error`, which was missing from th.json — so a Thai admin read a
         hardcoded string while an English one read the key. The key is now in
         both files; a fallback here would only hide the next gap. */
      showAlert(t('common.success'), t('common.save_success'), 'success');
      setEditingImage(null);
      setInlineDetailId(null);
    } catch (error) {
      console.error('Failed to save stored file detail', error);
      showAlert(t('common.error_title'), t('common.save_error'), 'error');
    } finally {
      setSavingDetail(false);
    }
  };

  /** The dialog's call site, unchanged: no arguments, uses its own state. */
  const handleSaveImageDetail = async (): Promise<void> => saveDetail();

  return {
    isUploadingLocal,
    setIsUploadingLocal,
    uploadState,
    draggedItemIndex,
    setDraggedItemIndex,
    isDragging,
    setIsDragging,
    deleteStorageId,
    setDeleteStorageId,
    editingImage,
    setEditingImage,
    editDetailForm,
    setEditDetailForm,
    inlineDetailId,
    setInlineDetailId,
    savingDetail,
    handleLocalFileUpload,
    handleImportUrlToServer,
    handleReorderStoredFile,
    handleDeleteStorage,
    handleDeleteStorageConfirmed,
    handleSaveImageDetail,
    saveDetail,
  };
}
