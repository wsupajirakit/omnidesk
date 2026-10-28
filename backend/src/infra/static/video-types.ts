/**
 * [FEAT-20260904-OBJVIDEO] What counts as a video here — the table and the cap.
 * ===========================================================================
 * The Object album must hold video as well as images (owner, 04/09). This file
 * is the single place that answers "which containers do we accept, and how big
 * may one be", so adding another container is ONE entry and changing the
 * ceiling is ONE number.
 *
 * 🔴 IT IS A SEPARATE TABLE FROM `IMAGE_MIME`, ON PURPOSE, AND THEY MUST NEVER
 *    MERGE. `IMAGE_MIME` is what the image upload filter and the image serve
 *    middleware allow; putting `.mp4` in it would let a video be written into
 *    `public/uploads/images` and served as an image. The owner's line was
 *    explicit: ที่เก็บ vdo ห้ามปนกับรูป.
 *
 * ⚠️ WHY IT LIVES IN `infra/static/` AND NOT IN A NEW FOLDER. The design note
 *    for this task proposed `content/media-kind/`. That was wrong on second
 *    look: `infra/static/` already groups exactly this role — the MIME table,
 *    the multer filter and the hardened serve middleware for uploaded files.
 *    §7 rule 2 says place a file with an existing sibling directory for its
 *    role, and inventing a second home would split one concern across two
 *    modules. The design note has been corrected rather than followed.
 *
 * revert: delete this file, the video filter and the video serve middleware
 *   beside it, plus the video upload route. Images are untouched by all of it.
 */

/**
 * The ONLY video extensions this service accepts and serves, with the
 * Content-Type each is answered with.
 *
 * Adding a container = one line here. Nothing else in the flow hard-codes an
 * extension: the filter, the serve middleware and the upload route all read
 * this table. เพิ่มสกุลใหม่ = เติมบรรทัดเดียว
 *
 * mp4 is first because it is what the owner asked for and what LINE and every
 * browser play without a plugin.
 */
export const VIDEO_MIME: Readonly<Record<string, string>> = {
  '.mp4': 'video/mp4',
};

/**
 * The largest video this service will store, in bytes.
 *
 * Owner, 04/09: **50 MB, adjustable** — this line is the adjustment. The image
 * route's own 10 MB cap is separate and untouched.
 *
 * 🔴 THIS IS THE RULE, NOT THE HINT. The dashboard also shrinks a video in the
 * browser before uploading (that is where the compression happens at all —
 * there is no ffmpeg on this service), but a client can be old, patched, or
 * simply not this dashboard. The server refusing at this number is what makes
 * the ceiling real. เพดานจริงอยู่ที่ server ฝั่งเบราว์เซอร์เป็นแค่ UX
 */
export const VIDEO_MAX_BYTES = 50 * 1024 * 1024;

/** Is this extension one we accept as a video? Lower-cased, dot included. */
export function isAcceptedVideoExt(ext: string): boolean {
  return Object.prototype.hasOwnProperty.call(VIDEO_MIME, ext.toLowerCase());
}
