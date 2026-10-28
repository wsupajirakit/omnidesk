/**
 * [FEAT-20260901-UPLOADDOWNSCALE] Shrink an image in the browser before it is
 * uploaded to image storage.
 *
 * WHY HERE AND NOT ON THE SERVER. The backend already owns a resizer —
 * `omnidesk-api/src/common/utils/image-processor.ts` (`compressImage`) — but it
 * calls `require('sharp')` at RUNTIME and `sharp` is deliberately not a
 * dependency there. That file records the decision (24/08): installing `sharp`
 * would silently wake the dormant branch on the INBOUND LINE image path, which
 * feeds the QR pre-scan used by slip verification, whose hit rate was measured
 * on untouched originals. Doing the work in the browser reaches the upload leg
 * and nothing else — the slip path never sees a byte of this.
 *
 * SCOPE — the upload-to-storage leg only. Owner, 01/09. This runs on the
 * dashboard image-storage upload (`imageStorageService.uploadDashboard`) and
 * nowhere else. It must not be wired into the chat composer, the inbound
 * webhook path, or any flow that carries a customer's own photo.
 *
 * The file is split in two on purpose:
 *   · `planDownscale` — pure. Decides skip-vs-resize and the target box from
 *     numbers alone, so every rule below is testable without a browser.
 *   · `downscaleImageFile` — the pixels. Needs canvas, so it is the thin half.
 *
 * revert: delete this file and drop the `downscaleImageFile` call in
 * `services/media/imageStorageService.ts:uploadDashboard`. Nothing else imports
 * it; uploads go back to sending the original bytes.
 */

/**
 * The knobs. Change these numbers freely — they are the whole configuration
 * surface and nothing outside this object decides how much an image shrinks.
 *
 * ตั้งค่าย่อรูปได้อิสระตรงนี้ที่เดียว
 */
export interface ImageDownscaleConfig {
  enabled: boolean;
  maxWidth: number;
  maxHeight: number;
  quality: number;
  outputType: string;
  skipBelowBytes: number;
  passthroughTypes: readonly string[];
}

export const IMAGE_DOWNSCALE: ImageDownscaleConfig = {
  /** The master switch. `false` sends every file exactly as the admin picked
   *  it — same bytes, same name, same type — as if this file did not exist.
   *  It is checked before anything else, so turning it off cannot leave a
   *  half-applied rule behind. ปิดสวิตช์นี้ = กลับไปเหมือนเดิมทั้งหมด */
  enabled: true,
  /** Longest edge allowed, in pixels. A larger image is scaled to fit inside
   *  this box; aspect ratio is always preserved. */
  maxWidth: 1600,
  maxHeight: 1600,
  /** Re-encode quality, 0..1, for the lossy output type. */
  quality: 0.85,
  /** What the shrunk file is written as. */
  outputType: 'image/jpeg',
  /** Files at or below this many bytes are sent untouched. Re-encoding a small
   *  image usually costs quality and saves nothing. */
  skipBelowBytes: 300 * 1024,
  /** Types that must never be re-encoded: an animated GIF would lose every
   *  frame after the first, and an SVG is not a raster image at all. */
  passthroughTypes: ['image/gif', 'image/svg+xml'],
};

export interface DownscalePlan {
  /** `skip` = upload the original file unchanged. */
  action: 'skip' | 'resize';
  /** Target pixel box. Equal to the source dimensions when only the byte size
   *  triggered the re-encode. Meaningless when `action` is `skip`. */
  width: number;
  height: number;
  /** Why, in one word — carried so a caller (or a test) can assert the reason
   *  rather than infer it from the numbers. */
  reason:
    | 'disabled'
    | 'not-an-image'
    | 'passthrough-type'
    | 'already-small'
    | 'unknown-dimensions'
    | 'over-box'
    | 'over-bytes';
}

/**
 * The whole decision, as arithmetic. No File, no canvas, no DOM.
 *
 * Order matters and is the contract:
 *   0. switched off               → skip (nothing below is consulted)
 *   1. not an image at all        → skip (the input is not ours to touch)
 *   2. gif / svg                  → skip (re-encoding destroys them)
 *   3. small enough already       → skip (re-encoding would only lose quality)
 *   4. dimensions unreadable      → skip (fail open: never block an upload)
 *   5. outside the pixel box      → resize to fit inside it
 *   6. inside the box but heavy   → re-encode at the same dimensions
 */
export function planDownscale(
  file: { type: string; size: number },
  dimensions: { width: number; height: number },
  cfg: ImageDownscaleConfig = IMAGE_DOWNSCALE,
): DownscalePlan {
  const { width: srcW, height: srcH } = dimensions;
  const box = { action: 'skip' as const, width: srcW, height: srcH };

  if (!cfg.enabled) {
    return { ...box, reason: 'disabled' };
  }
  if (!file.type.startsWith('image/')) {
    return { ...box, reason: 'not-an-image' };
  }
  if (cfg.passthroughTypes.includes(file.type)) {
    return { ...box, reason: 'passthrough-type' };
  }
  if (file.size <= cfg.skipBelowBytes) {
    return { ...box, reason: 'already-small' };
  }
  /* A browser that could not decode the image reports 0×0. Sending the original
     is the safe direction to be wrong in: the admin's upload still succeeds. */
  if (!(srcW > 0) || !(srcH > 0)) {
    return { ...box, reason: 'unknown-dimensions' };
  }

  const scale = Math.min(cfg.maxWidth / srcW, cfg.maxHeight / srcH);
  if (scale < 1) {
    return {
      action: 'resize',
      /* round, not floor: a 1601px edge must not land on 1599. Clamped at 1 so
         an extreme aspect ratio can never produce a zero-width canvas. */
      width: Math.max(1, Math.round(srcW * scale)),
      height: Math.max(1, Math.round(srcH * scale)),
      reason: 'over-box',
    };
  }

  return { action: 'resize', width: srcW, height: srcH, reason: 'over-bytes' };
}

/** Swap the extension so the stored filename matches the bytes inside it. */
function renameForOutput(name: string, outputType: string): string {
  const ext = outputType === 'image/png' ? 'png' : 'jpg';
  const base = name.replace(/\.[^./\\]+$/, '');
  return `${base || 'image'}.${ext}`;
}

/**
 * Read a File's pixel dimensions. Resolves to 0×0 rather than rejecting, so the
 * caller's single "skip" path covers every failure — a browser without
 * `createImageBitmap`, a corrupt file, and a non-image all land in one place.
 */
async function readDimensions(
  file: File,
): Promise<{ width: number; height: number }> {
  try {
    if (typeof createImageBitmap !== 'function') return { width: 0, height: 0 };
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close?.();
    return size;
  } catch {
    return { width: 0, height: 0 };
  }
}

/**
 * Downscale `file` per `cfg`, or return it untouched.
 *
 * ⚠️ NEVER THROWS AND NEVER RETURNS SOMETHING WORSE. Any failure — no canvas,
 * a decode error, a browser that refuses `toBlob` — returns the original File,
 * because an admin trying to attach an image cares more that it uploads than
 * that it shrank. The one other guard is on the result: if the re-encoded blob
 * came out LARGER than the source (which happens with flat graphics), the
 * original wins.
 */
export async function downscaleImageFile(
  file: File,
  cfg: ImageDownscaleConfig = IMAGE_DOWNSCALE,
): Promise<File> {
  /* Cheap rejections first — these need no decode at all, so a .pdf or a small
     photo never pays for a bitmap. */
  const early = planDownscale(file, { width: 1, height: 1 }, cfg);
  if (early.action === 'skip' && early.reason !== 'unknown-dimensions') {
    return file;
  }

  const dimensions = await readDimensions(file);
  const plan = planDownscale(file, dimensions, cfg);
  if (plan.action === 'skip') return file;

  try {
    const canvas = document.createElement('canvas');
    canvas.width = plan.width;
    canvas.height = plan.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;

    const bitmap = await createImageBitmap(file);
    ctx.drawImage(bitmap, 0, 0, plan.width, plan.height);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), cfg.outputType, cfg.quality);
    });
    if (!blob || blob.size >= file.size) return file;

    return new File([blob], renameForOutput(file.name, cfg.outputType), {
      type: cfg.outputType,
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
}
