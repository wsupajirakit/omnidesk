import { buildApiError } from './apiClient';
import type { ApiError } from '../types';

/**
 * [FEAT-20260904-UPLOADPROGRESS] Upload a file and report how far it got, with a
 * way to stop it.
 * ===========================================================================
 *
 * ### Why this exists instead of `authFetch`
 *
 * 🔴 `fetch` CANNOT REPORT UPLOAD PROGRESS. Its `ReadableStream` request bodies
 * are download-side only in every browser that ships today, so "0% … done" is
 * the best it can do — which is exactly what an admin staring at a 50 MB clip
 * does not need. `XMLHttpRequest` still owns `upload.onprogress`, so the upload
 * leg uses XHR and everything else keeps using `authFetch`.
 * fetch cannot measure the upload leg; only XHR can.
 *
 * ### What it deliberately shares rather than re-implements
 *
 * · the error shape — `buildApiError` from `apiClient.ts`, so a failed upload
 *   raises the same `ApiError` (same message precedence, `.status`,
 *   `.rawResponse`) as any other call and callers need no special case
 * · the credential — auth rides an HttpOnly cookie, so `withCredentials = true`
 *   is the whole of it. There is no Bearer header to attach any more, and
 *   inventing one here would be a second, wrong copy of that decision
 *
 * ⚠️ IT IS NOT ROUTED THROUGH THE API CIRCUIT BREAKER, ON PURPOSE. The breaker
 * exists to stop a storm of small failing calls; an upload is one deliberate
 * user action, and a breaker opened by unrelated traffic would refuse a file the
 * admin just picked. A failed upload also must not count towards opening it.
 *
 * ### Progress is a REPORT, not a promise of success
 *
 * `upload.onprogress` fires as bytes leave the browser. Reaching 100% means the
 * request body was sent — NOT that the server accepted it. The server can still
 * answer 400 (wrong type) or 413 (too big) afterwards, so the caller must keep
 * showing "finishing…" until the promise settles rather than declaring victory
 * at 100%. 100% means sent, not accepted.
 *
 * revert: delete this file and call `authFetch` with the FormData again. The
 *   uploads work exactly as before, minus the bar and the cancel button.
 */

/** One progress tick. `percent` is 0-100, integer, and never exceeds 100. */
export interface UploadProgress {
  loaded: number;
  /** 0 when the browser cannot compute it (no Content-Length on the body). */
  total: number;
  percent: number;
}

export interface UploadOptions {
  /** Called as bytes leave the browser. Never called after the promise settles. */
  onProgress?: (progress: UploadProgress) => void;
  /** Used in the error message, exactly like `handleApiResponse`'s label. */
  actionLabel: string;
}

export interface UploadHandle<T> {
  /** Resolves with the parsed body, or rejects with an `ApiError`. */
  promise: Promise<T>;
  /**
   * Stop the upload. The promise then rejects with an error whose `name` is
   * `'AbortError'`, so a caller can tell "the admin cancelled" from "it broke"
   * and stay silent for the first. A cancel is not a failure; tell them apart.
   */
  cancel: () => void;
}

/** Marks the rejection a cancel produces. Callers branch on this, not on text. */
export const isUploadAbort = (error: unknown): boolean =>
  error instanceof Error && error.name === 'AbortError';

const buildAbortError = (): Error => {
  const error = new Error('upload cancelled');
  error.name = 'AbortError';
  return error;
};

/**
 * The minimal `Response` stand-in `buildApiError` reads. Only `status` and
 * `statusText` are touched there; building a real `Response` would mean copying
 * the body a second time for nothing.
 */
const responseLike = (xhr: XMLHttpRequest): Response =>
  ({ status: xhr.status, statusText: xhr.statusText }) as Response;

export function uploadWithProgress<T>(
  url: string,
  body: FormData,
  { onProgress, actionLabel }: UploadOptions,
): UploadHandle<T> {
  const xhr = new XMLHttpRequest();
  let settled = false;

  const promise = new Promise<T>((resolve, reject) => {
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      fn();
    };

    xhr.upload.onprogress = (event): void => {
      if (settled || !onProgress) return;
      /* `lengthComputable` is false for a body whose size the browser does not
         know. Reporting a percentage there would be a made-up number, so the
         total is passed through as 0 and the caller shows an indeterminate bar. */
      const total = event.lengthComputable ? event.total : 0;
      const percent =
        total > 0 ? Math.min(100, Math.floor((event.loaded / total) * 100)) : 0;
      onProgress({ loaded: event.loaded, total, percent });
    };

    xhr.onload = (): void => {
      finish(() => {
        const raw = xhr.responseText ?? '';
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(buildApiError(responseLike(xhr), raw, actionLabel));
          return;
        }
        try {
          resolve((raw ? JSON.parse(raw) : {}) as T);
        } catch {
          /* A 2xx whose body is not JSON is still a success for every caller
             here; they read fields off it and would find none. Resolving with an
             empty object matches `handleApiResponse`, which does the same. */
          resolve({} as T);
        }
      });
    };

    /* A network-level failure. `xhr.status` is 0, so the message comes from the
       label rather than from a body that does not exist. */
    xhr.onerror = (): void =>
      finish(() =>
        reject(
          buildApiError(responseLike(xhr), '', actionLabel) as ApiError,
        ),
      );

    xhr.ontimeout = xhr.onerror;
    xhr.onabort = (): void => finish(() => reject(buildAbortError()));

    xhr.open('POST', url);
    /* The auth cookie is HttpOnly; this is the entire credential. */
    xhr.withCredentials = true;
    xhr.setRequestHeader('Accept', 'application/json');
    /* ⚠️ Content-Type is NOT set: the browser has to add the multipart boundary
       itself, and setting it by hand produces a body the server cannot parse. */
    xhr.send(body);
  });

  return {
    promise,
    cancel: (): void => {
      if (!settled) xhr.abort();
    },
  };
}
