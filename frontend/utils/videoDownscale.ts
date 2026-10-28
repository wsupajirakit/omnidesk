/**
 * [FEAT-20260904-OBJVIDEO] Shrink a video in the browser before it is uploaded
 * to Object storage.
 *
 * WHY HERE AND NOT ON THE SERVER — the same answer `imageDownscale.ts` gives
 * for images, and it holds harder for video. There is no `ffmpeg` in
 * `omnidesk-api`: not on the machine, not in `package.json`, not in the
 * Dockerfile. Adding one would put a transcoder on the container that also
 * answers the LINE webhook, and a transcode pegs a core for the length of the
 * clip. Doing the work in the browser reaches the upload leg and nothing else.
 *
 * SCOPE — the upload-to-storage leg only, by the owner's instruction on 04/09.
 * This runs on the dashboard video upload and nowhere else. It must not be
 * wired into the chat composer, the inbound webhook path, or the LINE reply
 * path.
 *
 * The file is split in two on purpose, mirroring its image sibling:
 *   · `planVideoDownscale` — pure. Decides skip-vs-shrink from numbers alone,
 *     so every rule below is testable without a browser or a codec.
 *   · `downscaleVideoFile` — the encoder. Needs WebCodecs, so it is the thin
 *     half, and it FAILS OPEN: a browser that cannot encode uploads the
 *     original rather than blocking the admin.
 *
 * 🔴 IT NEVER CLAIMS TO HAVE SHRUNK SOMETHING IT DID NOT. `compressImage` on
 * the server has a dormant branch that silently no-ops when `sharp` is missing,
 * and that shape — a ceiling the code does not enforce — is what this avoids by
 * returning the reason alongside the file: say so, never stay silent.
 *
 * ⚠️ THE SERVER STILL DECIDES. `VIDEO_MAX_BYTES` (50 MB) is enforced by the
 * upload route's multer limit in `omnidesk-api`. What happens here is UX: it
 * keeps a large file from being sent at all. A client that skips this code
 * entirely still cannot exceed the cap.
 *
 * revert: delete this file and the `downscaleVideoFile` call in
 * `services/media/imageStorageService.ts:uploadDashboardVideo`. Uploads go back
 * to sending the original bytes, and the server cap still holds. To keep the
 * rule but stop all re-encoding, flip `VIDEO_ENCODER_CONFIG.enabled` in
 * `utils/video/encoderRegistry.ts` instead — one line, same outcome.
 */
import { encodeVideo, selectVideoEncoder } from './video/encoderRegistry';

/**
 * The knobs. Change these numbers freely — they are the whole configuration
 * surface and nothing outside this object decides how much a video shrinks.
 *
 * Every video-shrink setting lives here and nowhere else.
 */
export interface VideoDownscaleConfig {
  /** The master switch. `false` sends every file exactly as picked. */
  enabled: boolean;
  /** Tallest edge allowed, in pixels. Aspect ratio is always preserved. */
  maxHeight: number;
  /** Target video bitrate, bits per second, for the re-encode. */
  bitrate: number;
  /**
   * The ceiling, in bytes. Owner, 04/09: **50 MB, adjustable — this line.**
   * ⚠️ It MUST match `VIDEO_MAX_BYTES` in `omnidesk-api/src/infra/static/
   * video-types.ts`, which is the one that actually refuses. A smaller number
   * here only means the browser gives up earlier; a LARGER one means the admin
   * waits for an upload the server was always going to reject.
   */
  maxBytes: number;
  /** Files at or below this many bytes are sent untouched. */
  skipBelowBytes: number;
  /**
   * Containers this may handle. Everything else is passed through untouched —
   * the server's own filter is what refuses it.
   * Adding a container is one line.
   */
  containers: readonly string[];
}

export const VIDEO_DOWNSCALE: VideoDownscaleConfig = {
  enabled: true,
  maxHeight: 720,
  bitrate: 2_000_000,
  maxBytes: 50 * 1024 * 1024,
  skipBelowBytes: 5 * 1024 * 1024,
  containers: ['video/mp4'],
};

export interface VideoDownscalePlan {
  /** `skip` = upload the original file unchanged. */
  action: 'skip' | 'shrink';
  /** Target height. Equal to the source height when only bytes triggered it. */
  height: number;
  /** Why, in one word — so a caller or a test can assert the reason. */
  reason:
    | 'disabled'
    | 'not-a-video'
    | 'unsupported-container'
    | 'already-small'
    | 'unknown-dimensions'
    | 'over-box'
    | 'over-bytes';
}

/**
 * The whole decision, as arithmetic. No File, no codec, no DOM.
 *
 * Order matters and is the contract:
 *   0. switched off              → skip (nothing below is consulted)
 *   1. not a video at all        → skip (the input is not ours to touch)
 *   2. container we do not handle→ skip (the server's filter refuses it)
 *   3. small enough already      → skip (re-encoding costs quality for nothing)
 *   4. dimensions unreadable     → skip (fail open: never block an upload)
 *   5. taller than the box       → shrink to the box
 *   6. inside the box but heavy  → re-encode at the same height
 */
export function planVideoDownscale(
  file: { type: string; size: number },
  dimensions: { width: number; height: number },
  cfg: VideoDownscaleConfig = VIDEO_DOWNSCALE,
): VideoDownscalePlan {
  const srcH = dimensions.height;
  const base = { action: 'skip' as const, height: srcH };

  if (!cfg.enabled) return { ...base, reason: 'disabled' };
  if (!file.type.startsWith('video/')) return { ...base, reason: 'not-a-video' };
  if (!cfg.containers.includes(file.type)) {
    return { ...base, reason: 'unsupported-container' };
  }
  if (file.size <= cfg.skipBelowBytes) {
    return { ...base, reason: 'already-small' };
  }
  /* Fail OPEN. A video whose metadata never loaded is uploaded as-is: the
     server cap is the backstop, and blocking on a read we could not make would
     turn a slow browser into a broken feature. */
  if (!Number.isFinite(srcH) || srcH <= 0) {
    return { ...base, reason: 'unknown-dimensions' };
  }
  if (srcH > cfg.maxHeight) {
    return { action: 'shrink', height: cfg.maxHeight, reason: 'over-box' };
  }
  return { action: 'shrink', height: srcH, reason: 'over-bytes' };
}

/**
 * Would the server refuse this file outright?
 *
 * Kept separate from the plan because it answers a different question: the plan
 * says whether shrinking is worth attempting, this says whether the result can
 * be uploaded at all. A caller shows the admin a message rather than posting 60
 * MB and reading a 413 back.
 */
export function exceedsVideoCap(
  size: number,
  cfg: VideoDownscaleConfig = VIDEO_DOWNSCALE,
): boolean {
  return size > cfg.maxBytes;
}

/**
 * Can this browser re-encode video at all?
 *
 * [FEAT-20260904-OBJVIDEO] Delegates to the registry rather than sniffing an API
 * here. The earlier version checked `globalThis.VideoEncoder`, which was the
 * WRONG question twice over: WebCodecs' `VideoEncoder` emits an H.264 elementary
 * stream and cannot produce the `.mp4` the server accepts without a muxer, and a
 * browser can be perfectly able to encode through a different engine while
 * having no `VideoEncoder` at all. The registry answers "is there an engine that
 * is enabled, supported here, and produces a file the upload route accepts",
 * which is the only question the caller cares about.
 * Ask the right question: is there a usable engine, not which API exists.
 */
export function canEncodeVideo(): boolean {
  return selectVideoEncoder() !== null;
}

export interface VideoDownscaleResult {
  /** What to upload — the shrunk file, or the original when nothing was done. */
  file: File;
  /** Whether the bytes actually changed, and why not when they did not. */
  shrunk: boolean;
  reason: VideoDownscalePlan['reason'] | 'no-encoder' | 'encode-failed';
}

/**
 * Shrink `file` if the plan says so and the browser can.
 *
 * 🔴 THE RETURN CARRIES THE REASON, ALWAYS. The caller can then say "uploaded
 * as-is, this browser cannot re-encode" instead of implying a shrink happened.
 * That is the whole difference from the server-side compressor this replaces.
 *
 * ⚠️ WebCodecs is Chrome/Edge. Firefox and Safari take the `no-encoder` branch
 * and upload the original, which the 50 MB server cap still bounds.
 */
export async function downscaleVideoFile(
  file: File,
  cfg: VideoDownscaleConfig = VIDEO_DOWNSCALE,
): Promise<VideoDownscaleResult> {
  const dimensions = await readVideoDimensions(file);
  const plan = planVideoDownscale(file, dimensions, cfg);

  if (plan.action === 'skip') {
    return { file, shrunk: false, reason: plan.reason };
  }
  if (!canEncodeVideo()) {
    return { file, shrunk: false, reason: 'no-encoder' };
  }

  try {
    const out = await encodeToHeight(file, plan.height, cfg.bitrate);
    /* A "shrink" that grew the file is not a shrink. Keep the original. */
    return out && out.size < file.size
      ? { file: out, shrunk: true, reason: plan.reason }
      : { file, shrunk: false, reason: 'encode-failed' };
  } catch {
    return { file, shrunk: false, reason: 'encode-failed' };
  }
}

/**
 * Read a video's pixel size without decoding it.
 *
 * Resolves to zeroes rather than rejecting: `planVideoDownscale` treats that as
 * `unknown-dimensions` and skips, which is the fail-open path.
 */
async function readVideoDimensions(
  file: File,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement('video');
    const done = (width: number, height: number): void => {
      URL.revokeObjectURL(url);
      resolve({ width, height });
    };
    el.preload = 'metadata';
    el.onloadedmetadata = () => done(el.videoWidth, el.videoHeight);
    el.onerror = () => done(0, 0);
    el.src = url;
  });
}

/**
 * The encoder half — now one line, because the engines live behind a contract.
 *
 * [FEAT-20260904-OBJVIDEO] This used to `return null` with a note saying the
 * real pipeline was still to come. It now hands the job to `utils/video/`,
 * where the registry picks whichever engine is enabled and supported.
 *
 * 🔴 THE FUNCTION STAYS, rather than the rule calling `encodeVideo` directly.
 * It is the seam: the rule speaks in (file, height, bitrate) and knows nothing
 * about registries, and the registry knows nothing about skip-vs-shrink. Adding
 * an engine touches neither side: adding one never edits the rule.
 *
 * ⚠️ Still returns `null` when it cannot produce a file; the caller then
 * uploads the original and reports `encode-failed`. It never throws its way out
 * of an upload — `encodeVideo` swallows a backend's throw for exactly that.
 */
async function encodeToHeight(
  file: File,
  height: number,
  bitrate: number,
): Promise<File | null> {
  return encodeVideo({ file, height, bitrate });
}
