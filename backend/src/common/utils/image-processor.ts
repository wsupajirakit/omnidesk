import { Logger } from '@nestjs/common';
import { existsSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { extname } from 'node:path';

const MAX_SIZE_BYTES = 0.9 * 1024 * 1024; // 921,600 Bytes

const logger = new Logger('ImageProcessor');

/**
 * [FIX-20260824-COMPRESSTRUTH] One notice per process, not per image.
 *
 * `sharp` is absent, so EVERY file above the cap takes the failure branch —
 * and inbound phone photos are routinely 1-4 MB, so a per-image warning would
 * be a warning per image. A single line at the first failure says the thing
 * that actually needs saying ("compression is not running at all"), and says it
 * where someone reading the boot log will see it. Same shape as the one-shot
 * notices elsewhere in this repo.
 */
let sharpMissingNoticed = false;

export interface CompressImageResult {
  processed?: boolean;
  size?: number;
  error?: string;
}

/**
 * Resizes/compresses an image to stay under 0.9 MB using `sharp`, overwriting
 * the original file in place.
 *
 * ⚠️ [FIX-20260824-COMPRESSTRUTH] AS SHIPPED TODAY, THE COMPRESSION HALF NEVER
 * RUNS. `sharp` is not a dependency of this project — it is in neither
 * `package.json` nor `node_modules`, and `qr-prescan/qr-reader.adapter.ts:29-31`
 * records why: native modules were evaluated for the QR path and rejected, so
 * pure-JS decoders were chosen instead. Nothing has ever installed it here.
 *
 * What that means for each size, precisely:
 *   · file ≤ 0.9 MB → returns `{ processed: false, size }` and never reaches
 *     `require('sharp')`. Correct, and unchanged by any of this.
 *   · file > 0.9 MB → reaches `require('sharp')`, throws, and returns
 *     `{ error: 'Image processing failed: "sharp" package is not installed' }`.
 *
 * So the files that NEED shrinking are exactly the files that do not get it.
 * Both callers absorb the `{ error }` into a size fallback and store the raw
 * byte count, which is honest — the row matches the file on disk — but it means
 * no ceiling is enforced anywhere.
 *
 * ⚠️ Read this before designing around a 0.9 MB assumption. `slip-flow.service`
 * reads the whole file and base64-encodes it (×1.33 in memory) on the paid
 * verification path; that code is only safe at the sizes this function was
 * supposed to guarantee and does not.
 *
 * This comment is the fix. The function is deliberately left as it is: adding
 * `sharp` would change the bytes fed to the QR pre-scan, whose hit rate was
 * measured on originals, and to the topup leg that re-attaches the file — that
 * is a decision with its own evidence, not a dependency bump. Owner, 24/08:
 * stop the code claiming a ceiling it does not enforce; do not add `sharp`.
 * โค้ดเคยโฆษณาเพดาน 0.9 MB ที่ไม่เคยทำงานจริง — แก้คำโฆษณา ไม่ใช่แก้พฤติกรรม.
 */
export async function compressImage(
  filePath: string,
): Promise<CompressImageResult> {
  try {
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const stats = statSync(filePath);
    if (stats.size <= MAX_SIZE_BYTES) {
      return { processed: false, size: stats.size };
    }

    const ext = extname(filePath).toLowerCase();
    const tempPath = `${filePath}_tmp${ext || '.jpg'}`;

    let sharpModule: unknown;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      sharpModule = require('sharp');
    } catch {
      /* [FIX-20260824-COMPRESSTRUTH] Say it out loud, once. Before this the
       * failure was silent all the way out: the throw below is caught by this
       * function's own catch, turned into `{ error }`, and both callers fold
       * that into `processed.size || rawSize` — so nothing anywhere reported
       * that the cap was not being applied. */
      if (!sharpMissingNoticed) {
        sharpMissingNoticed = true;
        logger.warn(
          '[COMPRESS] "sharp" is not installed — image compression is NOT ' +
            'running. Every file above 0.9 MB is stored at its original size. ' +
            'This notice is printed once per process.',
        );
      }
      throw new Error(
        'Image processing failed: "sharp" package is not installed',
      );
    }

    const sharp = sharpModule as (input: string) => {
      png: (opts: { compressionLevel: number; quality: number }) => {
        toFile: (path: string) => Promise<unknown>;
      };
      jpeg: (opts: { quality: number; mozjpeg: boolean }) => {
        toFile: (path: string) => Promise<unknown>;
      };
      resize: (opts: {
        width: number;
        height: number;
        fit: string;
        withoutEnlargement: boolean;
      }) => {
        jpeg: (opts: { quality: number; mozjpeg: boolean }) => {
          toFile: (path: string) => Promise<unknown>;
        };
      };
    };

    const pipeline = sharp(filePath);

    if (ext === '.png') {
      await pipeline.png({ compressionLevel: 9, quality: 80 }).toFile(tempPath);
    } else {
      await pipeline.jpeg({ quality: 80, mozjpeg: true }).toFile(tempPath);
    }

    let newStats = statSync(tempPath);

    if (newStats.size > MAX_SIZE_BYTES) {
      await sharp(filePath)
        .resize({
          width: 1920,
          height: 1920,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 70, mozjpeg: true })
        .toFile(tempPath);
      newStats = statSync(tempPath);
    }

    unlinkSync(filePath);
    renameSync(tempPath, filePath);

    return { processed: true, size: newStats.size };
  } catch (error) {
    return { error: (error as Error).message };
  }
}
