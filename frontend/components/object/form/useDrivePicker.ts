import { useEffect, useRef, useState } from 'react';

import { imageStorageService } from '../../../services/media';
import { buildDriveListUrl, driveThumbnailAt800 } from '../../../utils/driveListUrl';
import type { ObjectCategory, ObjectImageFormData } from '../../../types';

/**
 * [REFACTOR-20260904-FORMHOOKS] The album form's Google Drive picker: the
 * gallery it shows, the paging, and the two ways its files reach our storage.
 * ===========================================================================
 *
 * ### Why this is one unit (§6.4)
 *
 * Nine pieces of state, one ref and five members moved TOGETHER, because they
 * are one feature: the debounced list effect fills the gallery, load-more and
 * load-all extend it, and the two import paths push those files to our server
 * and ask the caller to reload its own list. Splitting them would leave half a
 * machine on each side of the seam.
 *
 * 🔴 IT NEEDS SIX THINGS FROM THE FORM, AND THAT IS THE WHOLE COUPLING. The
 * album being edited (`formData`), the categories that carry the api key, the
 * caller's stored-file reloader, its "busy" flag, its alert, and `t`. Everything
 * else the block touched was its own state, which is why this is worth moving:
 * the modal loses 157 lines and gains a six-argument call.
 *
 * ### Two behaviours that look like accidents and are not
 *
 * ⚠️ THE LIST CALL IS DEBOUNCED BY 500 ms. `img_path` is typed into by hand, so
 * without it every keystroke is a Drive request. A test that waits less than
 * that sees nothing and proves nothing — that cost a false "mutation survived"
 * already.
 * ⚠️ LOAD-ALL READS ITS CANCEL FLAG FROM A REF. A `useState` there would be
 * captured when the loop started, so pressing stop could never be seen; the
 * loop also sleeps 1000 ms between pages because Drive rate-limits.
 *
 * revert: paste these five members and the state block back into
 *   `ObjectImageFormModal.tsx` and delete this file. No call site changes shape.
 */

/** One tile in the Drive picker. */
interface GDriveTile {
  id: string;
  name: string;
  url: string | null;
}

/** The subset of a Drive file this screen reads. */
interface DriveFile {
  id: string;
  name: string;
  thumbnailLink?: string | null;
}

/**
 * [REFACTOR-20260904-DRIVEFETCH] One Drive page: fetch it, and shape what came
 * back into the tiles this modal renders.
 *
 * 🔴 IT REPLACES THREE IDENTICAL COPIES in this file — the initial load, load
 * more, and load all — which had already drifted once at the url level (the
 * shared-drive flags) before `buildDriveListUrl` was introduced. Three copies of
 * a mapping is also why a mutation on one of them proved nothing about the path
 * a test walks: the test went through a different copy.
 *
 * ⚠️ It is a module-level function on purpose: it touches no state and no props,
 * so it cannot accidentally capture a stale `formData`. The callers own every
 * `setState` and every error message, because those genuinely differ — one
 * clears the gallery on failure, one warns, one aborts a loop.
 */
async function fetchDrivePage(
  folderId: string,
  apiKey: string,
  pageToken?: string | null,
): Promise<{ images: GDriveTile[]; nextToken: string | null } | null> {
  const res = await fetch(buildDriveListUrl({ folderId, apiKey, pageToken }));
  /* ⚠️ `res.ok` WAS ONLY CHECKED IN ONE of the three copies (load-all). The other
     two called `.json()` on a 401/403 body and carried on with whatever parsed —
     usually `{error:…}`, which has no `files` and therefore looked like "an
     empty folder" rather than "your api key was rejected". Checking it here
     gives all three the strictest of the three behaviours, which is the only
     safe direction when merging copies that disagree. */
  if (!res.ok) return null;
  const data = await res.json();
  /* No `files` key at all means Drive refused the query — the caller decides
     whether that empties the gallery or just stops paging. */
  if (!data.files) return null;
  return {
    images: (data.files as DriveFile[]).map((f) => ({
      id: f.id,
      name: f.name,
      url: driveThumbnailAt800(f.thumbnailLink),
    })),
    nextToken: (data.nextPageToken as string) || null,
  };
}

/** What the picker needs from the form it lives in. */
export interface DrivePickerDeps {
  formData: ObjectImageFormData;
  categories: ObjectCategory[];
  /** Reload the album's stored files — owned by the form, not by this hook. */
  fetchServerImages: (recordId: string) => Promise<void>;
  /** The form's shared "an upload is running" flag. */
  setIsUploadingLocal: (busy: boolean) => void;
  showAlert: (
    title: string,
    message: string,
    type?: 'success' | 'error' | 'info',
  ) => void;
  /* [FEAT-20261022-I18NPAGESEN] widened so a label can carry its Thai fallback — the parent passes useI18n().t */
  t: (key: string, fallbackOrVars?: string | Record<string, unknown>, vars?: Record<string, unknown>) => string;
  /** The album being edited, or undefined while creating. */
  initialData?: { id?: string } | null;
  /** Saves an unsaved album silently and returns its new id.
   *  ⚠️ `Promise<string | void>`, taken from the modal's own prop type — the
   *  resolved value IS the new album id, and `void` is a save that produced
   *  none, which every caller here must treat as "abort". */
  onSubmit: (data: ObjectImageFormData, silent?: boolean) => Promise<string | void>;
}

export function useDrivePicker({
  formData,
  categories,
  fetchServerImages,
  setIsUploadingLocal,
  showAlert,
  t,
  initialData,
  onSubmit,
}: DrivePickerDeps) {
  const [gDriveImages, setGDriveImages] = useState<{ id: string, name: string, url: string | null }[]>([]);
  const [gDriveLoading, setGDriveLoading] = useState(false);
  const [gDriveLoadingMore, setGDriveLoadingMore] = useState(false);
  const [gDriveLoadingAll, setGDriveLoadingAll] = useState(false);
  const [gDriveNextToken, setGDriveNextToken] = useState<string | null>(null);
  const gDriveCancelRef = useRef(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [syncCount, setSyncCount] = useState<{ current: number, total: number } | null>(null);
  const [showConfirmSync, setShowConfirmSync] = useState(false);

  const handleUploadGDriveToServer = async (drive_id: string) => {
    if (!initialData?.id) return;
    setUploadingId(drive_id);
    try {
      await imageStorageService.uploadExternal(initialData.id, { drive_id });
      await fetchServerImages(initialData.id);
    } catch (error) {
      console.error('Failed to upload GDrive image to server', error);
    } finally {
      setUploadingId(null);
    }
  };

  useEffect(() => {
    if (formData.storage !== 'google_drive' || !formData.img_path || formData.categories.length === 0) {
      setGDriveImages([]);
      return;
    }

    const fetchGDrive = async (pageToken?: string) => {
      const isInitial = !pageToken;
      if (isInitial) {
        setGDriveLoading(true);
        setGDriveImages([]);
        setGDriveNextToken(null);
      } else {
        setGDriveLoadingMore(true);
      }

      try {
        const catId = formData.categories[0];
        const category = categories.find(c => c.id === catId || (c as any)._id === catId);
        const apiKey = category?.api_key;

        if (!apiKey) {
          if (isInitial) setGDriveImages([]);
          return;
        }

        const page = await fetchDrivePage(formData.img_path, apiKey, pageToken);
        /* Drive refused the query: on the FIRST page that means show nothing,
           on a later page it means simply stop — the gallery keeps what it has. */
        if (!page) {
          if (isInitial) setGDriveImages([]);
          return;
        }

        setGDriveImages(prev =>
          isInitial ? page.images : [...prev, ...page.images],
        );
        setGDriveNextToken(page.nextToken);
      } catch (error) {
        console.error('GDrive fetch error:', error);
      } finally {
        setGDriveLoading(false);
        setGDriveLoadingMore(false);
      }
    };

    const timer = setTimeout(fetchGDrive, 500);
    return () => clearTimeout(timer);
  }, [formData.storage, formData.img_path, formData.categories, categories]);

  const handleLoadMoreGDrive = async () => {
    if (!gDriveNextToken || gDriveLoadingMore || gDriveLoadingAll) return;
    const catId = formData.categories[0];
    const category = categories.find(c => c.id === catId || (c as any)._id === catId);
    const apiKey = category?.api_key;
    if (!apiKey) return;

    setGDriveLoadingMore(true);
    try {
      const page = await fetchDrivePage(
        formData.img_path,
        apiKey,
        gDriveNextToken,
      );
      if (!page) return;

      setGDriveImages(prev => [...prev, ...page.images]);
      setGDriveNextToken(page.nextToken);
    } catch (err) {
      console.warn('Load more error:', err);
    } finally {
      setGDriveLoadingMore(false);
    }
  };

  const handleLoadAllGDrive = async () => {
    if (!gDriveNextToken || gDriveLoadingAll || gDriveLoadingMore) return;
    gDriveCancelRef.current = false;
    setGDriveLoadingAll(true);
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    try {
      let currentToken = gDriveNextToken;
      const catId = formData.categories[0];
      const category = categories.find(c => c.id === catId || (c as any)._id === catId);
      const apiKey = category?.api_key;
      if (!apiKey) return;

      while (currentToken && !gDriveCancelRef.current) {
        const page = await fetchDrivePage(
          formData.img_path,
          apiKey,
          currentToken,
        );
        /* A refused page stops the loop rather than emptying what is already on
           screen — the admin keeps the pages that did arrive. */
        if (!page) break;

        setGDriveImages(prev => [...prev, ...page.images]);
        currentToken = page.nextToken;
        setGDriveNextToken(currentToken);

        if (currentToken && !gDriveCancelRef.current) {
          await sleep(1000); // Cool down delay for best practice
        }
      }
    } finally {
      setGDriveLoadingAll(false);
      gDriveCancelRef.current = false;
    }
  };

  const handleSyncDriveConfirmed = async () => {
    if (gDriveImages.length === 0 || !initialData?.id) return;
    setShowConfirmSync(false);
    setIsUploadingLocal(true);
    setSyncCount({ current: 0, total: gDriveImages.length });

    const firstCatId = formData.categories[0];
    const category = categories.find(c => c.id === firstCatId || (c as any)._id === firstCatId);
    const apiKey = category?.api_key;

    try {
      for (let i = 0; i < gDriveImages.length; i++) {
        const img = gDriveImages[i];
        setSyncCount({ current: i + 1, total: gDriveImages.length });

        await imageStorageService.uploadExternal(initialData.id!, {
          drive_id: img.id,
          api_key: apiKey
        });

        // Update gallery in real-time so user sees progress
        await fetchServerImages(initialData.id!);

        // Random delay 2-4s per request as requested
        const delay = Math.floor(Math.random() * 2000) + 2000;
        await new Promise(r => setTimeout(r, delay));
      }
      await fetchServerImages(initialData.id!);
      showAlert(t('common.success'), t('pageui.object.sync_done', 'Sync เรียบร้อยแล้ว ({n} รูป)', { n: gDriveImages.length }), 'success');
    } catch (error) {
      console.error('Batch upload error', error);
      showAlert(t('common.error_title'), t('pageui.object.sync_some_failed', 'เกิดข้อผิดพลาดในการอัปโหลดบางรูป'), 'error');
    } finally {
      setIsUploadingLocal(false);
      setSyncCount(null);
    }
  };

  return {
    gDriveImages,
    setGDriveImages,
    gDriveLoading,
    gDriveLoadingMore,
    gDriveLoadingAll,
    gDriveNextToken,
    gDriveCancelRef,
    uploadingId,
    syncCount,
    showConfirmSync,
    setShowConfirmSync,
    handleUploadGDriveToServer,
    handleLoadMoreGDrive,
    handleLoadAllGDrive,
    handleSyncDriveConfirmed,
  };
}
