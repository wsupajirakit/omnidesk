import { API_BASE_URL, authFetch, handleApiResponse } from '../apiClient';
import {
  uploadWithProgress,
  type UploadProgress,
} from '../uploadWithProgress';
import { ImageStorage } from '../../types';
import { downscaleImageFile } from '../../utils/imageDownscale';
import { downscaleVideoFile } from '../../utils/videoDownscale';

/**
 * [FEAT-20260904-UPLOADPROGRESS] What a caller may watch and stop.
 *
 * 🔴 `onStart` EXISTS BECAUSE THE HANDLE DOES NOT YET. Both uploads shrink the
 * file BEFORE any request is opened — for a video that is a real-time encode and
 * can run for minutes — so there is nothing to cancel at call time. The cancel
 * function is handed back the moment bytes actually start moving.
 *
 * ⚠️ `onPhase` is not decoration: during `shrinking` no request exists, so no
 * percentage exists either. A bar that sat at 0% for two minutes would read as
 * a hung upload. The caller must say which phase it is in.
 * While shrinking there is no request and therefore no percentage; the phase
 * has to be reported honestly instead.
 */
export interface UploadControls {
  onProgress?: (progress: UploadProgress) => void;
  onPhase?: (phase: 'shrinking' | 'uploading') => void;
  /** Called once, with the function that stops the transfer. */
  onStart?: (cancel: () => void) => void;
}

export const imageStorageService = {
  list: async (object_image_id: string): Promise<ImageStorage[]> => {
    const response = await authFetch(`${API_BASE_URL}/api/image-storage?object_image_id=${object_image_id}`, {
      method: 'GET'
    });
    // The spec says "ดึงรายการทั้งหมด" and response example shows an object but the name is "List Image Storages"
    // Usually these list endpoints return an array or { data: [] }
    const res = await handleApiResponse<any>(response, 'list image storage');
    return Array.isArray(res) ? res : res.data || [];
  },

  /**
   * [FEAT-20260901-UPLOADDOWNSCALE] The shrink happens HERE, not in the modal.
   *
   * This is the only entrance to the upload-to-storage leg (one caller:
   * `components/object/ObjectImageFormModal.tsx:handleLocalFileUpload`), so
   * putting it here means a future second caller cannot forget it. The size
   * rules and the on/off switch all live in `utils/imageDownscale.ts`.
   *
   * `downscaleImageFile` never throws and returns the original File on any
   * failure or when switched off, so this line cannot break an upload.
   *
   * revert: drop the one `await` below and send `file` straight through.
   */
  uploadDashboard: async (
    object_image_id: string,
    file: File,
    controls: UploadControls = {},
  ): Promise<ImageStorage> => {
    controls.onPhase?.('shrinking');
    const upload = await downscaleImageFile(file);

    const formData = new FormData();
    formData.append('object_image_id', object_image_id);
    formData.append('image', upload);

    /* [FEAT-20260904-UPLOADPROGRESS] XHR, not `authFetch`: only XHR can report
       how far the body has gone. The error shape is identical either way. */
    controls.onPhase?.('uploading');
    const handle = uploadWithProgress<ImageStorage>(
      `${API_BASE_URL}/api/image-storage/dashboard`,
      formData,
      { onProgress: controls.onProgress, actionLabel: 'upload image to dashboard' },
    );
    controls.onStart?.(handle.cancel);
    return handle.promise;
  },

  /**
   * [FEAT-20260904-OBJVIDEO] The video twin of `uploadDashboard`.
   *
   * 🔴 A SEPARATE CALL, NOT A FLAG. It posts to a different route
   * (`dashboard-video`) under a different field name (`video`), because the
   * server side has its own multer destination, cap and filter — that is what
   * keeps an mp4 out of `public/uploads/images`.
   *
   * ⚠️ The result carries WHETHER the file was actually shrunk and why not, so
   * the caller can tell the admin the truth instead of implying a shrink.
   */
  uploadDashboardVideo: async (
    object_image_id: string,
    file: File,
    controls: UploadControls = {},
  ): Promise<{ storage: ImageStorage; shrunk: boolean; reason: string }> => {
    /* ⚠️ THIS PHASE IS THE SLOW ONE. The browser encoder runs in REAL TIME —
       a 40-second clip takes about 40 seconds — and no request exists yet, so
       there is no percentage to show and nothing to cancel. Say `shrinking` and
       let the UI show what it is waiting for. */
    controls.onPhase?.('shrinking');
    const out = await downscaleVideoFile(file);

    const formData = new FormData();
    formData.append('object_image_id', object_image_id);
    formData.append('video', out.file);

    controls.onPhase?.('uploading');
    const handle = uploadWithProgress<ImageStorage>(
      `${API_BASE_URL}/api/image-storage/dashboard-video`,
      formData,
      { onProgress: controls.onProgress, actionLabel: 'upload video to dashboard' },
    );
    controls.onStart?.(handle.cancel);
    const storage = await handle.promise;
    return { storage, shrunk: out.shrunk, reason: out.reason };
  },

  uploadExternal: async (object_image_id: string, payload: { url?: string; drive_id?: string; api_key?: string }): Promise<ImageStorage> => {
    const response = await authFetch(`${API_BASE_URL}/api/image-storage/external`, {
      method: 'POST',
      body: JSON.stringify({
        object_image_id,
        ...payload
      }),
      headers: {
        'Content-Type': 'application/json'
      }
    });
    return handleApiResponse<ImageStorage>(response, 'upload external image');
  },

  delete: async (id: string): Promise<void> => {
    const response = await authFetch(`${API_BASE_URL}/api/image-storage/${id}`, {
      method: 'DELETE'
    });
    if (response.status !== 204) {
      await handleApiResponse<void>(response, 'delete image storage');
    }
  },

  update: async (id: string, payload: { priority?: number; detail_link?: string; detail_text?: string }): Promise<ImageStorage> => {
    const response = await authFetch(`${API_BASE_URL}/api/image-storage/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
      headers: {
        'Content-Type': 'application/json'
      }
    });
    return handleApiResponse<ImageStorage>(response, 'update image storage');
  }
};
