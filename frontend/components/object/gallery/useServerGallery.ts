import { useState } from 'react';

import { imageStorageService } from '../../../services/media';
import type { ImageStorage } from '../../../types';

/**
 * [REFACTOR-20260904-OBJFORMSPLIT] The album's files on OUR server: the list,
 * whether it is loading, and the one way to reload it.
 * ===========================================================================
 *
 * ### Why exactly this much moved, and not the whole gallery
 *
 * The Local Gallery block is 289 lines and reaches 30 names. It looked like one
 * unit; it is not. `fetchServerImages` has **six callers OUTSIDE the block** —
 * the form's submit, the delete confirmation, the per-file detail save, the
 * Drive import, and two mount effects. `serverImages` is read outside it too,
 * by the media step above.
 *
 * 🔴 SO MOVING "THE GALLERY" WOULD HAVE MOVED A SHARED DEPENDENCY INTO A LEAF.
 * Those six callers would then have to reach up into a component they do not
 * own. What is genuinely one unit is the LIST ITSELF plus its single loader —
 * that is what lives here, and every caller asks it the same way.
 * Something six callers share belongs in the middle, not under one leaf.
 *
 * ### What deliberately stayed behind
 *
 * The three async handlers (upload, import-from-url, drag-to-reorder) stay in
 * the modal: each one reaches `onSubmit`, `formData` or `categories`, which are
 * the FORM's, not the gallery's. Dragging them here would pull the form's state
 * along behind them.
 *
 * ⚠️ A failed reload keeps the list it already had rather than emptying it. An
 * empty gallery reads as "this album has no files", which is a different and
 * much more alarming statement than "the refresh did not answer".
 *
 * revert: paste the three members back into `ObjectImageFormModal.tsx` and
 *   delete this file. Every call site keeps the same names.
 */
export interface ServerGallery {
  serverImages: ImageStorage[];
  serverImagesLoading: boolean;
  /** Reload one album's stored files. Safe to call with an empty id (no-op). */
  fetchServerImages: (recordId: string) => Promise<void>;
  /**
   * Empty the list when the form switches to a NEW album.
   *
   * 🔴 IT EXISTS BECAUSE THE MODAL ALREADY DID THIS. Opening the form without an
   * `initialData` used to call `setServerImages([])` directly; without an
   * explicit clear, the next new album would open showing the PREVIOUS album's
   * files — which look like its own. `tsc` found that call site; a scan of the
   * gallery block never would, because it lives in a mount effect far above it.
   * ⚠️ Exporting the raw setter instead would let any caller put an arbitrary
   * list here, including another album's.
   */
  clearServerImages: () => void;
}

export function useServerGallery(): ServerGallery {
  const [serverImages, setServerImages] = useState<ImageStorage[]>([]);
  const [serverImagesLoading, setServerImagesLoading] = useState(false);

  const fetchServerImages = async (recordId: string): Promise<void> => {
    if (!recordId) return;
    setServerImagesLoading(true);
    try {
      const data = await imageStorageService.list(recordId);
      setServerImages(data);
    } catch (error) {
      console.error('Failed to fetch server images', error);
    } finally {
      setServerImagesLoading(false);
    }
  };

  return {
    serverImages,
    serverImagesLoading,
    fetchServerImages,
    clearServerImages: () => setServerImages([]),
  };
}
