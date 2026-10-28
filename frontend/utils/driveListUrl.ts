/**
 * [FIX-20260904-DRIVEURL] One builder for every Google Drive "list a folder"
 * request.
 * ===========================================================================
 *
 * ### Why it exists — a real defect, not tidiness
 *
 * The same URL was written out FOUR times: three inside `ObjectImageFormModal`
 * (first page, load-more, load-all) and once in the album list's
 * `useGDrivePreview`. They were not identical, and the difference was silent:
 *
 *   modal      … &supportsAllDrives=true&includeItemsFromAllDrives=true
 *   list page  … (neither)
 *
 * 🔴 WITHOUT THOSE TWO FLAGS DRIVE OMITS SHARED-DRIVE FILES ENTIRELY. A folder
 * on a Shared Drive therefore listed its images in the album modal and came back
 * EMPTY on the album list's preview — same album, same key, same folder, two
 * answers, no error either side. That is what four copies of one request buys.
 *
 * ### What it deliberately does not do
 *
 * No client, no wrapper, no retry policy. It builds a string. The callers keep
 * owning their own `fetch`, their own error handling and their own state,
 * because those genuinely differ (one paginates into a gallery, the other into a
 * picker). Only the thing that must never differ lives here.
 */

/** Page size Drive is asked for. One page is one "load more" press. */
export const DRIVE_PAGE_SIZE = 24;

/**
 * Fields Drive is asked to return.
 *
 * ⚠️ `thumbnailLink` is the one that matters: it arrives at 220px and every
 * caller rewrites it to 800px. Dropping it from this list gives every gallery
 * broken images with a perfectly successful response.
 */
export const DRIVE_FIELDS = 'nextPageToken,files(id,name,mimeType,thumbnailLink)';

export interface DriveListParams {
  /** The Drive folder id — the album's `img_path`. */
  folderId: string;
  /** The api key from the album's first category. */
  apiKey: string;
  /** Continuation token, when asking for a page after the first. */
  pageToken?: string | null;
}

/**
 * Build the "list the images in this folder" request.
 *
 * 🔴 `supportsAllDrives` AND `includeItemsFromAllDrives` are both required, and
 * both are the reason this function exists. Drive treats a Shared Drive as
 * invisible unless the caller says it can handle one; the omission does not
 * fail, it returns fewer files.
 * ⚠️ `trashed = false` keeps deleted files out — Drive returns them otherwise,
 * and they render as broken thumbnails the admin cannot explain.
 */
export function buildDriveListUrl({
  folderId,
  apiKey,
  pageToken,
}: DriveListParams): string {
  const q = `'${folderId}' in parents and trashed = false and mimeType contains 'image/'`;
  const url =
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}` +
    `&key=${apiKey}` +
    `&fields=${DRIVE_FIELDS}` +
    `&pageSize=${DRIVE_PAGE_SIZE}` +
    `&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  return pageToken ? `${url}&pageToken=${pageToken}` : url;
}

/**
 * Drive hands back a 220px thumbnail; every gallery here wants 800px.
 *
 * ⚠️ The suffix is only replaced at the END of the url. A blind
 * `replace('=s220', …)` would also hit a file whose NAME contains that text.
 */
export function driveThumbnailAt800(thumbnailLink?: string | null): string | null {
  return thumbnailLink ? thumbnailLink.replace(/=s220$/, '=s800') : null;
}
