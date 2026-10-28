/**
 * [FEAT-20260904-OBJVIDEO] The multer `fileFilter` for the video upload route.
 * ===========================================================================
 * Mirrors `image-upload-filter.ts` deliberately, including its reasoning: an
 * allowed extension alone proves nothing, so the browser-declared `mimetype`
 * must agree with what that extension is supposed to be. A `shell.php` renamed
 * `.mp4`, or an `.mp4` announced as `text/html`, fails HERE rather than at
 * serve time.
 *
 * 🔴 A SEPARATE FILTER, NOT A WIDENED IMAGE ONE. Widening `imageUploadFilter`
 * would let a video through the image route, and that route's `destination` is
 * `public/uploads/images` — the file would land in the image tree with the
 * image cap applied. Two routes, two filters, two directories.
 * ห้ามปนกับรูป — คนละ filter คนละโฟลเดอร์
 *
 * ⚠️ NO MIME ALIAS HERE. The image filter forgives `image/jpg`, which is not a
 * real type, because browsers and older clients have always sent it for `.jpg`
 * and legacy accepted anything. `video/mp4` has no such history — every client
 * that can produce an mp4 announces it correctly, so an exact match is the
 * whole rule and a mismatch is a finding rather than a compatibility problem.
 *
 * revert: delete this file and the route that installs it.
 */

/**
 * [FIX-20260904-UPLOAD400] The rule now lives in `upload-gate.ts`; this file is
 * the video family's description of itself. What used to be here was the same
 * algorithm as the image filter, written a second time.
 *
 * 🔴 SHARING THE RULE IS NOT WIDENING THE ROUTE. The point of the comment above
 * still holds exactly: this filter has its own table, its own route, its own
 * multer destination and its own byte cap. An `.mp4` still cannot reach
 * `public/uploads/images`, and `IMAGE_MIME` still contains no video entry.
 * Videos must never mix with images: the RULE is shared, the storage is not.
 *
 * ⚠️ NO MIME ALIAS, unlike images. The image side forgives `image/jpg` because
 * browsers have always sent it; `video/mp4` has no such history, so an exact
 * match is the whole rule and a mismatch is a finding, not a compatibility
 * problem. Passing no `aliases` is what says that.
 */

import { makeUploadFilter } from './upload-gate';
import { VIDEO_MIME } from './video-types';

export const videoUploadFilter = makeUploadFilter({
  family: 'video',
  errorName: 'UnsupportedVideoTypeError',
  table: VIDEO_MIME,
});
