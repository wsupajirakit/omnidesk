/**
 * 🔴 NO CALLER SINCE 07/09 — KEPT ON PURPOSE, READ BEFORE EDITING.
 * [FEAT-20260907-OBJUPLOADSTEP] This hook drives the Google Drive gallery inside
 * `ObjectImagePreviewModal`: first page, load-more, load-all and stop. The only
 * thing that ever opened that dialog was the album thumbnail in the list, and on
 * 07/09 that click was repointed at the edit form's media step. The
 * page still calls `useGDrivePreview()`, but `fetchGDrivePreview` is now invoked
 * by nothing.
 *
 * It is KEPT for possible future use rather than deleted, so this note is the
 * marker. It is dead weight until either the dialog gets
 * an entry point again or the pair is retired together — leaving it unmarked is
 * what would make it a trap for the next reader.
 *
 * Its tests are parked alongside it in `test/objectImageListDrive.dom.test.tsx`.
 */
import { useCallback, useRef, useState } from 'react';

import { buildDriveListUrl, driveThumbnailAt800 } from '../../../utils/driveListUrl';
import { imageStorageService } from '../../../services/media';
import type { ImageStorage, ObjectImage } from '../../../types';

/**
 * [REFACTOR-20260904-OBJLISTSPLIT] The album preview's data: our own stored
 * files, plus the Google Drive gallery and its paging.
 * ===========================================================================
 *
 * ### Why this is a §6.4 STATE MOVE and not a markup lift
 *
 * Nine `useState`s, two `useRef`s and three handlers left the page TOGETHER,
 * because they are one feature and splitting them would leave half a machine on
 * each side. That changes when renders and effects happen, so §6.4 allows it
 * only behind interaction tests written FIRST — `test/objectImageListDrive.dom
 * .test.tsx` (5 cases) presses the real controls: first page, load-more
 * appending rather than replacing, load-all looping until the token runs out,
 * no controls without a token, and a failed call leaving the dialog usable.
 * Move the state as one unit, never half of it, and only behind tests that
 * press the real controls first.
 *
 * ### What was NOT carried over
 *
 * 🔴 `gDrivePreviewTotal` is gone. It was declared, never read and never set —
 * dead in the whole repo, verified by grep before the move. Carrying it into a
 * new file would have been importing a debt and calling it a refactor.
 * ⚠️ Its removal is the ONE behaviour-neutral deletion here; everything else is
 * byte-identical to what the page ran.
 *
 * ### Two things inside that look odd and are deliberate
 *
 * ⚠️ `fetch` talks to googleapis DIRECTLY from the browser, so the category's
 * api key travels to the client. That is pre-existing and untouched — moving it
 * here does not make it worse, and pretending otherwise by "fixing" it inside a
 * refactor would hide a security decision inside a tidy-up.
 * ⚠️ `load all` sleeps 1000 ms between pages on purpose (Drive rate limits), and
 * reads its cancel flag from a REF rather than state — a state read inside that
 * loop would be the value captured when the loop started, so cancel would never
 * be seen. Turning that ref into state is the classic way to break this.
 *
 * revert: paste the three handlers and the state block back into
 *   `ObjectImageList.tsx` and delete this file.
 */
export interface GDrivePreviewState {
  /** Files this album has on OUR server. */
  serverPreviewImages: ImageStorage[];
  serverPreviewLoading: boolean;
  /** The Drive gallery, page by page. */
  gDrivePreviewImages: { id: string; name: string; url: string }[];
  gDrivePreviewLoading: boolean;
  gDrivePreviewLoadingMore: boolean;
  gDrivePreviewLoadingAll: boolean;
  gDrivePreviewNextToken: string | null;
  /** Open the preview for an album: loads our files, then Drive's first page. */
  fetchGDrivePreview: (img: ObjectImage, pageToken?: string) => Promise<void>;
  handleLoadMoreGDrivePreview: () => Promise<void>;
  handleLoadAllGDrivePreview: () => Promise<void>;
  /** Stop a running "load all" — read from a ref, see the note above. */
  cancelLoadAll: () => void;
  /** Clear the Drive list when the dialog closes. */
  resetGDrivePreview: () => void;
  /**
   * Re-read OUR stored files for one album, without touching the Drive list.
   *
   * 🔴 IT EXISTS BECAUSE `handleSaveImageDetail` NEEDS IT. That handler lives in
   * the page — it saves a caption and then refreshes the grid — and it called
   * `setServerPreviewImages` directly before this move. Exporting the raw setter
   * instead would let any caller put anything in this list, including a stale
   * array from another album; this asks the same question the hook asks itself.
   * ⚠️ `tsc` is what found this caller — a name-level grep saw the reads inside
   * the moved block and not the one outside it. Compile first, not last.
   */
  refreshServerImages: (objectImageId: string) => Promise<void>;
}

/**
 * @param categories the album categories, which carry the Drive api key. The
 *   page owns them (it lists them for the filter bar), so they are passed in
 *   rather than fetched again here — a second fetch would double the request on
 *   every mount and the gallery would still render, so nothing would look wrong.
 */
export function useGDrivePreview(
  categories: { id: string; api_key?: string }[],
): GDrivePreviewState {
  const [gDrivePreviewImages, setGDrivePreviewImages] = useState<{id: string, name: string, url: string}[]>([]);
  const [gDrivePreviewLoading, setGDrivePreviewLoading] = useState(false);
  const [gDrivePreviewLoadingMore, setGDrivePreviewLoadingMore] = useState(false);
  const [gDrivePreviewLoadingAll, setGDrivePreviewLoadingAll] = useState(false);
  const [gDrivePreviewNextToken, setGDrivePreviewNextToken] = useState<string | null>(null);
  const gDrivePreviewCancelRef = useRef(false);
  const currentGDriveImageRef = useRef<ObjectImage | null>(null);

  const [serverPreviewImages, setServerPreviewImages] = useState<ImageStorage[]>([]);
  const [serverPreviewLoading, setServerPreviewLoading] = useState(false);

  // GDrive Preview Loading Logic (Paginated)
  const fetchGDrivePreview = useCallback(async (img: ObjectImage, pageToken?: string) => {
    if (!img.id) return;
    currentGDriveImageRef.current = img;
    const isInitial = !pageToken;
    if (isInitial) {
      setGDrivePreviewLoading(true);
      setServerPreviewLoading(true);
      setGDrivePreviewImages([]);
      setServerPreviewImages([]); // Clear previous server images
      setGDrivePreviewNextToken(null);
      
      // Fetch Server Images first
      try {
        const serverData = await imageStorageService.list(img.id);
        setServerPreviewImages(serverData);
      } catch (err) {
        console.error('Failed to fetch server images', err);
      } finally {
        setServerPreviewLoading(false);
      }
    } else {
      setGDrivePreviewLoadingMore(true);
    }
    
    gDrivePreviewCancelRef.current = false;
    
    try {
      const firstCat = img.categories?.[0];
      const catId = typeof firstCat === 'object' ? (firstCat as any).id || (firstCat as any)._id : firstCat;
      const category = categories.find(c => c.id === catId || (c as any)._id === catId);
      const apiKey = category?.api_key || (typeof firstCat === 'object' ? (firstCat as any).api_key : undefined);
      
      if (!apiKey) throw new Error('API Key missing');

      // Best Practice: Specific query for images and pagination
      const listUrl = buildDriveListUrl({
        folderId: img.img_path,
        apiKey,
        pageToken,
      });
      
      const res = await fetch(listUrl);
      if (!res.ok) throw new Error(`List failed: ${res.status}`);
      const data = await res.json();
      
      const newImages = (data.files || []).map((f: any) => ({ 
        id: f.id, 
        name: f.name, 
        url: driveThumbnailAt800(f.thumbnailLink)
      }));

      setGDrivePreviewImages(prev => isInitial ? newImages : [...prev, ...newImages]);
      setGDrivePreviewNextToken(data.nextPageToken || null);
      
      // We don't have total count in Drive API list easily unless we count all, 
      // but we can estimate or just show relative numbers.
    } catch (err) {
      console.error('GDrive Preview Error:', err);
    } finally {
      setGDrivePreviewLoading(false);
      setGDrivePreviewLoadingMore(false);
    }
  }, [categories]);

  const handleLoadMoreGDrivePreview = async () => {
    if (!gDrivePreviewNextToken || gDrivePreviewLoadingMore || !currentGDriveImageRef.current) return;
    await fetchGDrivePreview(currentGDriveImageRef.current, gDrivePreviewNextToken);
  };

  const handleLoadAllGDrivePreview = async () => {
    if (!gDrivePreviewNextToken || gDrivePreviewLoadingAll || !currentGDriveImageRef.current) return;
    gDrivePreviewCancelRef.current = false;
    setGDrivePreviewLoadingAll(true);
    try {
      let currentToken = gDrivePreviewNextToken;
      while (currentToken && !gDrivePreviewCancelRef.current) {
        // Fetch next page
        const firstCat = currentGDriveImageRef.current.categories?.[0];
        const catId = typeof firstCat === 'object' ? (firstCat as any).id || (firstCat as any)._id : firstCat;
        const category = categories.find(c => c.id === catId || (c as any)._id === catId);
        const apiKey = category?.api_key || (typeof firstCat === 'object' ? (firstCat as any).api_key : undefined);
        
        const listUrl = buildDriveListUrl({
          folderId: currentGDriveImageRef.current.img_path,
          apiKey,
          pageToken: currentToken,
        });
        
        const res = await fetch(listUrl);
        if (!res.ok) break;
        const data = await res.json();
        
        const newImages = (data.files || []).map((f: any) => ({ 
          id: f.id, 
          name: f.name, 
          url: driveThumbnailAt800(f.thumbnailLink)
        }));

        setGDrivePreviewImages(prev => [...prev, ...newImages]);
        currentToken = data.nextPageToken || null;
        setGDrivePreviewNextToken(currentToken);

        if (currentToken && !gDrivePreviewCancelRef.current) {
          await new Promise(r => setTimeout(r, 1000)); // Standard cooling delay
        }
      }
    } finally {
      setGDrivePreviewLoadingAll(false);
      gDrivePreviewCancelRef.current = false;
    }
  };

  return {
    serverPreviewImages,
    serverPreviewLoading,
    gDrivePreviewImages,
    gDrivePreviewLoading,
    gDrivePreviewLoadingMore,
    gDrivePreviewLoadingAll,
    gDrivePreviewNextToken,
    fetchGDrivePreview,
    handleLoadMoreGDrivePreview,
    handleLoadAllGDrivePreview,
    cancelLoadAll: () => {
      gDrivePreviewCancelRef.current = true;
    },
    resetGDrivePreview: () => setGDrivePreviewImages([]),
    refreshServerImages: async (objectImageId: string) => {
      try {
        setServerPreviewImages(await imageStorageService.list(objectImageId));
      } catch (err) {
        /* Same shape as the initial load: the dialog stays open with whatever it
           had, rather than emptying because a refresh failed. */
        console.error('Failed to refresh server images', err);
      }
    },
  };
}
