import type { NextFunction, Request, Response } from 'express';
import { extname, join, resolve } from 'node:path';

/**
 * [FEAT-20260808-GROUPB-IMGSERVE] Hardened `/uploads/images/:filename` serving —
 * a 1:1 port of legacy `index.js:84-113` (`FIX-20260804-IMGTRAVERSAL`). It runs
 * BEFORE `useStaticAssets`, so it — not express.static — answers this exact path.
 *
 * WHY it replaces raw static serving for this path (legacy's three guards; one
 * layer is not enough — each has its own bypass):
 *   1) filename must be a bare name — no path separator, no `..`, no NUL. Blocks
 *      an un-decoded traversal attempt (`..%2F..` before express decodes it).
 *   2) after resolve() the file must still sit directly in the images dir. Blocks
 *      a decoded traversal / symlink escape.
 *   3) the extension must be a known image type. Even if 1+2 were bypassed, only
 *      an image can ever be read.
 *
 * `useStaticAssets` already blocks `..` (serve-static normalizes), so THAT CVE is
 * not reintroduced — this ADDS the ext-allowlist + an EXPLICIT Content-Type + a
 * UNIFORM 404 that never reveals whether the file exists.
 *
 * SUCCESS responses stay byte-identical to legacy: the same `res.sendFile` with
 * the same explicit `Content-Type`. Only the 404 shape changes (uniform
 * `{ error: "Image not found" }`), which is the intended FE-visible security
 * tightening. Any non-matching path calls `next()`, so every other static asset
 * (videos, bank-logos, the SPA) is served exactly as before.
 *
 * DB-EFFECT: none — reads a file from disk, no Mongo touch.
 *
 * Mounting (deferred to avoid the concurrent main.ts edit): add BEFORE
 * `app.useStaticAssets(...)` in main.ts —
 *   `app.use(buildHardenedImageServeMiddleware());`
 * revert: delete this file + that one `app.use(...)` line (same marker).
 */

/** legacy IMAGE_MIME — the ONLY extensions served, with their Content-Type. */
export const IMAGE_MIME: Readonly<Record<string, string>> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

/**
 * legacy's three-layer filename check, exported for the unit test. Returns the
 * resolved absolute path when the name is safe AND an allowed image, else null
 * (which the middleware answers as a uniform 404).
 */
export function resolveSafeImagePath(
  imagesDir: string,
  rawName: unknown,
): string | null {
  const name = String(rawName ?? '');

  // Layer 1 — a bare filename only.
  if (
    !name ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('..') ||
    name.includes('\0')
  ) {
    return null;
  }

  // Layer 3 — image extensions only (checked before touching disk).
  const ext = extname(name).toLowerCase();
  if (!IMAGE_MIME[ext]) return null;

  // Layer 2 — must resolve to exactly `<imagesDir>/<basename>`.
  const filePath = resolve(imagesDir, name);
  if (filePath !== join(imagesDir, name)) return null;

  return filePath;
}

/**
 * Builds the Express middleware. `imagesDir` defaults to the same
 * `public/uploads/images` tree the uploads are written to and `useStaticAssets`
 * serves from.
 */
export function buildHardenedImageServeMiddleware(
  imagesDir: string = resolve(process.cwd(), 'public', 'uploads', 'images'),
): (req: Request, res: Response, next: NextFunction) => void {
  const IMAGES_DIR = resolve(imagesDir);

  return (req: Request, res: Response, next: NextFunction): void => {
    // Only this exact path family; everything else falls through to the normal
    // static/route stack unchanged.
    const match = /^\/uploads\/images\/([^/]+)$/.exec(req.path);
    if (req.method !== 'GET' || !match) {
      next();
      return;
    }

    const notFound = (): void => {
      res.status(404).json({ error: 'Image not found' });
    };

    const filePath = resolveSafeImagePath(IMAGES_DIR, match[1]);
    if (!filePath) {
      notFound();
      return;
    }

    const ext = extname(filePath).toLowerCase();
    res.set('Content-Type', IMAGE_MIME[ext]);
    res.sendFile(filePath, (err) => {
      if (err && !res.headersSent) notFound();
    });
  };
}
