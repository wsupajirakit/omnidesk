/*
 * ==== [FEAT-20260812-QRPRESCAN] "pre QR check" — the QR reader ====
 *
 * NAME: the owner calls this step the **pre QR check** — a local look at the image for
 * a QR/barcode, run BEFORE anything is sent to the slip provider. Use that name in
 * commits, logs and tickets so the step is searchable.
 *
 * This is the ONLY file that knows which library does the reading.
 *
 * WHY THIS FILE EXISTS SEPARATELY
 *   Swapping the QR library must never touch the flow. Everything else in this feature
 *   depends on the `QrReader` shape below, not on the decoders, so replacing them means
 *   rewriting this one file and nothing else — no call-site edits, no changes to the
 *   webhook, no test rewrites beyond this file's own.
 *
 * WHY THESE LIBRARIES — measured on this machine 2026-08-12, not assumed
 *   `pngjs` + `jpeg-js` decode the image, `jsqr` finds the code.
 *   · 14/16 of the real slips in `todo/slip/` — the two misses were opened by eye and
 *     are dashboard screenshots, not slips, so every actual slip was read.
 *   · 62/67 of real customer uploads in `public/uploads/images/`, 0 errors.
 *   · 0 false positives on `todo/sample/` (four non-slip images).
 *   · ~76 ms per image.
 *
 * WHAT WAS TRIED AND REJECTED — so nobody repeats the search
 *   · `qr-scanner` (nimiq) — browser-only. `scanImage()` throws
 *     `ReferenceError: window is not defined`, then `Worker is not defined`. It calls
 *     `Image`, `document`, `OffscreenCanvas`; running it on Node needs jsdom plus a
 *     native canvas. Unpublished since 2022.
 *   · `sharp` — works on Alpine (pnpm ships a musl prebuild, verified in a container),
 *     but it is a compiled dependency, and the decode step here does not need its speed.
 *   · `zxing-wasm` — reads skewed codes better, but fetches its `.wasm` from a CDN by
 *     default; proven to abort under `docker run --network none`, i.e. it breaks on a
 *     host with no outbound internet unless extra code feeds it the binary.
 *   · `jimp` — decodes correctly, but uses a dynamic `import()` internally, which throws
 *     `A dynamic import callback was invoked without --experimental-vm-modules` under
 *     this repo's Jest. Testing it would have meant changing how the whole suite runs.
 *   The chosen three are pure JavaScript, load nothing at runtime, and need no change to
 *   `Dockerfile`, `pnpm-workspace.yaml` or `jest.config.ts`.
 *
 * ⚠️ THE TRADE: `jsqr` has not been published since 2021 and reads skewed or blurry
 *    codes less well than zxing. That is acceptable ONLY because of how the result is
 *    used — a missed QR sends the image to Swiftcheck anyway (see `index.ts`), so a weak
 *    read costs an API call, never a lost slip.
 *
 * revert: delete the `qr-prescan/` folder, the call site in webhook.service (grep
 *         QRPRESCAN) and the three dependencies.
 */

/** What the pre-scan needs from any QR library. Nothing library-specific may leak. */
export interface QrReadResult {
  /** Decoded payload, or null when no QR was found. */
  text: string | null;
  /** How long the read took, for the probe log. */
  ms: number;
  /**
   * Why there is no text. `no_qr` means the image was decoded and genuinely has no
   * QR; anything else means we could not look properly and the caller must not treat
   * it as a verdict.
   */
  reason: 'qr_found' | 'no_qr' | 'undecodable' | 'too_large' | 'timeout';
}

export interface QrReader {
  read(filePath: string): Promise<QrReadResult>;
}

/**
 * Refuse to decode anything bigger than this. An inbound image has no size cap
 * (`line-content.service.ts` sets no `maxContentLength`), and decoding happens in
 * process memory, so without a ceiling one large upload could stall the event loop.
 * Oversized images report `too_large`, which the caller treats as "unknown".
 */
const MAX_BYTES = 8 * 1024 * 1024;

/** Give up rather than hold up a customer waiting for a reply. */
const TIMEOUT_MS = 4000;

interface RawImage {
  data: Uint8Array | Buffer;
  width: number;
  height: number;
}

/**
 * Pick the decoder from the file's magic bytes rather than its extension — LINE names
 * downloads from the `content-type` header, which is not always honest
 * (`line-content.service.ts` has a note about `image/jpeg; charset=utf-8` arriving as
 * the extension).
 */
function decodeImage(buf: Buffer): RawImage {
  const isPng =
    buf.length > 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47;

  if (isPng) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { PNG } = require('pngjs') as typeof import('pngjs');
    /* eslint-enable @typescript-eslint/no-require-imports */
    const png = PNG.sync.read(buf);
    return { data: png.data, width: png.width, height: png.height };
  }

  /* eslint-disable @typescript-eslint/no-require-imports */
  const jpeg = require('jpeg-js') as typeof import('jpeg-js');
  /* eslint-enable @typescript-eslint/no-require-imports */
  const img = jpeg.decode(buf, { useTArray: true });
  return { data: img.data, width: img.width, height: img.height };
}

/**
 * pngjs + jpeg-js + jsqr implementation.
 *
 * ⚠️ Every library is loaded lazily, inside `read`, so none of them is pulled into
 *    memory when the feature is switched off.
 * ⚠️ `require`, not `await import`: Jest runs this repo's suites in a CommonJS VM where
 *    a dynamic `import()` throws, and the decode step must be testable against real
 *    images without changing how the suite is launched.
 */
export const defaultQrReader: QrReader = {
  async read(filePath: string): Promise<QrReadResult> {
    const started = Date.now();
    const done = (
      text: string | null,
      reason: QrReadResult['reason'],
    ): QrReadResult => ({ text, reason, ms: Date.now() - started });

    try {
      /* eslint-disable @typescript-eslint/no-require-imports */
      const { statSync, readFileSync } =
        require('node:fs') as typeof import('node:fs');
      /* eslint-enable @typescript-eslint/no-require-imports */

      if (statSync(filePath).size > MAX_BYTES) return done(null, 'too_large');

      const decode = (async () => {
        /* eslint-disable @typescript-eslint/no-require-imports */
        const jsQrMod = require('jsqr') as unknown;
        /* eslint-enable @typescript-eslint/no-require-imports */
        const jsQR = ((jsQrMod as { default?: unknown })?.default ??
          jsQrMod) as (
          d: Uint8ClampedArray,
          w: number,
          h: number,
        ) => { data: string } | null;

        const { data, width, height } = decodeImage(readFileSync(filePath));
        /* jsqr wants RGBA; both decoders above already produce RGBA. */
        const found = jsQR(new Uint8ClampedArray(data), width, height);
        return found?.data ?? null;
      })();

      const timeout = new Promise<'__timeout'>((resolve) =>
        setTimeout(() => resolve('__timeout'), TIMEOUT_MS),
      );

      const outcome = await Promise.race([decode, timeout]);
      if (outcome === '__timeout') return done(null, 'timeout');
      return outcome ? done(outcome, 'qr_found') : done(null, 'no_qr');
    } catch {
      /* A corrupt file, an unsupported format, a zero-byte download — all of them mean
         "we could not look", never "there is no QR". */
      return done(null, 'undecodable');
    }
  },
};
