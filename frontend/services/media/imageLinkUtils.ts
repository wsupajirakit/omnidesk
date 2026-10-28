/* ==== [FEAT-20260804-COPYIMGLINK] The "may this link be copied" rule ==========
 * 🔒 AUTO lane — to_dev_auto / to_prod_auto
 *
 * ⭐ THE ONLY OWNER OF THIS RULE.
 *    Used in two places: the album list page (`useObjectImageAlerts`) and the
 *    album modal (`ObjectImageFormModal`).
 *    ⚠️ Let either write its own copy and a fix lands in one and misses the
 *    other — the twin-panel trap this file exists to prevent.
 *
 * 🔴 WHY CHECK AT ALL: the button puts a url straight from the row onto the
 *    clipboard. Unchecked, a value that is not media at all — or a path that
 *    climbs out of the upload folder — gets handed to someone else to open.
 *
 * 🔴 [FIX-20260904-COPYVIDEO] IT USED TO ACCEPT IMAGES ONLY, so copying a
 *    stored VIDEO always answered "this is not a directly-openable image link".
 *    The rule was written before the album held video and was never revisited:
 *    videos live under `/uploads/videos/` with `.mp4`, so they failed BOTH the
 *    directory test and the extension test. A video link is exactly as safe to
 *    copy as an image link — same read-only static mount, same hardened serve,
 *    same 404 shape — so the fix is to allow the video table too, not to loosen
 *    the check. คัดลอกลิงก์วิดีโอได้แล้ว
 * ============================================================================ */
import {
  IMAGE_UPLOAD_TYPES,
  VIDEO_UPLOAD_TYPES,
} from '../../components/object/gallery/uploadKind';

/**
 * Where each kind is served from, and which extensions are valid there.
 *
 * 🔴 BUILT FROM THE UPLOAD TABLES, NOT RETYPED. Those tables are already
 * drift-guarded against the server's own `IMAGE_MIME` / `VIDEO_MIME`, so a
 * container added on the server reaches this rule for free. A hand-written
 * regex here is what went stale last time — it listed the image extensions of
 * the day and silently stopped matching reality.
 *
 * ⚠️ THE TWO DIRECTORIES MUST STAY SEPARATE, matching the server: a video is
 * never served from `/uploads/images/`, so accepting one there would bless a
 * path the server does not actually answer.
 */
const COPYABLE_MOUNTS: readonly { prefix: string; extensions: readonly string[] }[] = [
  { prefix: '/uploads/images/', extensions: Object.keys(IMAGE_UPLOAD_TYPES) },
  { prefix: '/uploads/videos/', extensions: Object.keys(VIDEO_UPLOAD_TYPES) },
];

/**
 * Is this a link to a file we actually serve, and therefore safe to copy?
 *
 * Conditions, all required: under one of the upload mounts · no `..` · an
 * extension that mount really serves.
 *
 * ⚠️ The name says "image" for history — it is the media rule now. Renaming it
 * touches both call sites and their tests; kept as one job, not smuggled into
 * a bug fix.
 */
export const isSafeImageLink = (url: string): boolean => {
  try {
    const u = new URL(url, window.location.origin);
    if (u.pathname.includes('..')) return false;
    return COPYABLE_MOUNTS.some(
      ({ prefix, extensions }) =>
        u.pathname.startsWith(prefix) &&
        extensions.some((ext) => u.pathname.toLowerCase().endsWith(ext)),
    );
  } catch {
    return false;
  }
};
