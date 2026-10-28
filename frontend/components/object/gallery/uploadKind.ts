import { exceedsVideoCap, VIDEO_DOWNSCALE } from '../../../utils/videoDownscale';

/**
 * [FEAT-20260904-OBJVIDEO] Which uploader does this dropped file belong to, and
 * may it be sent at all?
 *
 * The Local Gallery has ONE drop target but TWO destinations behind it: images
 * go to `/api/image-storage/dashboard` and land in `public/uploads/images`,
 * videos go to `dashboard-video` and land in `public/uploads/videos`. The two
 * must never cross — that separation is the whole point on the server side —
 * so the decision is made once, here, rather than inline in a handler.
 *
 * ⚠️ PURE ON PURPOSE. No File API, no fetch, no state: the routing rule and the
 * size verdict are arithmetic over `type` and `size`, which is what makes them
 * testable without a browser.
 *
 * 🔴 THE SIZE CHECK IS A COURTESY, NOT THE RULE. `VIDEO_MAX_BYTES` on the server
 * is what actually refuses; answering `tooLarge` here just stops the admin
 * waiting on an upload that was always going to come back 413.
 * The real ceiling is the server's; this only saves a pointless wait.
 *
 * revert: delete this file and route on `file.type.startsWith('image/')` inline
 *   in `handleLocalFileUpload`.
 */
/**
 * [FIX-20260904-UPLOAD400] What the server accepts, mirrored for the browser.
 *
 * 🔴 THIS IS A MIRROR, NOT THE RULE. The server's `IMAGE_MIME` and `VIDEO_MIME`
 * decide; these tables exist so the file picker can show only openable files and
 * so a refusal can be explained in the admin's own language before a byte is
 * uploaded. `test/uploadAllowedTypes.drift.test.ts` reads the SERVER files and
 * fails if the two ever disagree — which is the only thing that makes keeping a
 * copy here safe. A copy is allowed only while something catches the drift.
 *
 * Adding an extension: add it on the SERVER first, then here, then the drift
 * test goes green again. Doing it the other way round offers the admin a file
 * the server will refuse.
 */
export const IMAGE_UPLOAD_TYPES: Readonly<Record<string, string>> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

export const VIDEO_UPLOAD_TYPES: Readonly<Record<string, string>> = {
  '.mp4': 'video/mp4',
};

/**
 * `image/jpg` is not a registered type, but browsers still report it for some
 * `.jpg` files — the server forgives exactly this one, so the picker must too,
 * or a real photo is refused before it is ever sent.
 */
const MIME_ALIASES: Readonly<Record<string, string>> = {
  'image/jpg': 'image/jpeg',
};

/**
 * The `accept` attribute for the file input.
 *
 * ⚠️ EXTENSIONS **AND** MIME TYPES, both. Extensions are what macOS/Windows use
 * to grey out files in the picker; MIME types are what a drag-and-drop and some
 * mobile pickers match on. Listing only one of the two lets unopenable files
 * stay selectable. Built from the tables so it can never list something the
 * server refuses.
 */
export const UPLOAD_ACCEPT = [
  ...Object.keys(IMAGE_UPLOAD_TYPES),
  ...Object.keys(VIDEO_UPLOAD_TYPES),
  ...new Set([
    ...Object.values(IMAGE_UPLOAD_TYPES),
    ...Object.values(VIDEO_UPLOAD_TYPES),
  ]),
].join(',');

/** The list an admin reads in a refusal message: `.jpg, .jpeg, … , .mp4`. */
export const ALLOWED_UPLOAD_EXTENSIONS = [
  ...Object.keys(IMAGE_UPLOAD_TYPES),
  ...Object.keys(VIDEO_UPLOAD_TYPES),
].join(', ');

export type UploadKind = 'image' | 'video' | 'unsupported';

export interface UploadDecision {
  kind: UploadKind;
  /** Only ever true for a video — images keep their own separate 10 MB cap. */
  tooLarge: boolean;
}

/**
 * Decide from the browser-reported type alone.
 *
 * ⚠️ An unknown or empty type is `unsupported`, NOT "image by default". The old
 * drop handler tested `startsWith('image/')` and silently ignored anything else,
 * which is fine while there is one destination and wrong once there are two —
 * a dropped `.mov` would vanish with no message at all.
 */
export function pickUploadKind(file: {
  type: string;
  size: number;
}): UploadDecision {
  const type = (file.type || '').toLowerCase();

  if (type.startsWith('image/')) {
    /* [FIX-20260904-UPLOAD400] An image type the SERVER refuses is refused
       here too. It used to be "any image/*", so a `.bmp` or a `.svg` was sent,
       travelled the whole upload, and came back as a server error the admin
       could do nothing with. The tables above are the same five the server
       serves; `image/jpg` is forgiven exactly as it is there. */
    const canonical = MIME_ALIASES[type] ?? type;
    if (!Object.values(IMAGE_UPLOAD_TYPES).includes(canonical)) {
      return { kind: 'unsupported', tooLarge: false };
    }
    return { kind: 'image', tooLarge: false };
  }

  if (type.startsWith('video/')) {
    /* Containers the server will not accept are refused here too, so the
       message says "not supported" rather than letting the upload fail with a
       generic error. The list lives in ONE place. */
    if (!VIDEO_DOWNSCALE.containers.includes(type)) {
      return { kind: 'unsupported', tooLarge: false };
    }
    return { kind: 'video', tooLarge: exceedsVideoCap(file.size) };
  }

  return { kind: 'unsupported', tooLarge: false };
}
