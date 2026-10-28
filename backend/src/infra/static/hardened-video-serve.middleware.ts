import { extname, join, resolve } from 'node:path';

import type { NextFunction, Request, Response } from 'express';

import { VIDEO_MIME } from './video-types';

/**
 * [FEAT-20260904-OBJVIDEO] Hardened serving for `/uploads/videos/:file`.
 * ===========================================================================
 * 🔴 THIS PATH HAD NO PROTECTION AT ALL. `hardened-image-serve.middleware.ts`
 * answers `/uploads/images/:file` with an extension allow-list, an explicit
 * Content-Type and a uniform 404 — and its own comment records that everything
 * else, "videos, bank-logos, SPA", falls through to `useStaticAssets`. Inbound
 * LINE videos have been written to `public/uploads/videos` since before this
 * change, and served straight off the static handler with none of the three.
 *
 * Since the Object album is about to write ADMIN-supplied files there, that gap
 * closes first. The same three layers the image path uses, over the video table.
 *
 * ⚠️ A SIBLING FILE, NOT AN EXTENSION OF THE IMAGE ONE. Teaching the image
 * middleware about video would mean one function whose name says "image"
 * answering for both, and — worse — a single MIME table that a future edit
 * could let `.mp4` into. `IMAGE_MIME` must never gain a video entry; keeping
 * the tables and the middlewares apart is what enforces that structurally.
 *
 * ⚠️ MOUNT IT BEFORE `useStaticAssets`, exactly like the image one, or express
 * static answers first and none of this runs.
 *
 * revert: delete this file and its `app.use(...)` line in `main.ts`. Videos go
 *   back to being served by `useStaticAssets` with no allow-list.
 */

/**
 * The same three-layer filename check the image path uses, over `VIDEO_MIME`.
 * Returns the resolved absolute path when the name is safe AND an accepted
 * video, else null (which the middleware answers as a uniform 404).
 */
export function resolveSafeVideoPath(
  videosDir: string,
  rawName: unknown,
): string | null {
  /* `typeof` first: the image sibling writes `String(rawName ?? '')`, which
     eslint flags because an object would stringify to "[object Object]" and
     silently become a lookup for a file with that literal name. Only a string
     can be a filename here, so anything else is rejected outright. */
  const name = typeof rawName === 'string' ? rawName : '';

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

  // Layer 3 — accepted video extensions only (checked before touching disk).
  const ext = extname(name).toLowerCase();
  if (!VIDEO_MIME[ext]) return null;

  // Layer 2 — must resolve to exactly `<videosDir>/<basename>`.
  const filePath = resolve(videosDir, name);
  if (filePath !== join(videosDir, name)) return null;

  return filePath;
}

/**
 * Builds the Express middleware. `videosDir` defaults to the same
 * `public/uploads/videos` tree the LINE inbound path already writes to.
 */
export function buildHardenedVideoServeMiddleware(
  videosDir: string = resolve(process.cwd(), 'public', 'uploads', 'videos'),
): (req: Request, res: Response, next: NextFunction) => void {
  const VIDEOS_DIR = resolve(videosDir);

  return (req: Request, res: Response, next: NextFunction): void => {
    // Only this exact path family; everything else falls through unchanged.
    const match = /^\/uploads\/videos\/([^/]+)$/.exec(req.path);
    if (req.method !== 'GET' || !match) {
      next();
      return;
    }

    /* The SAME body for "no such file" and "not a file you may ask for", so a
       probe cannot learn what exists by reading the error. */
    const notFound = (): void => {
      res.status(404).json({ error: 'Video not found' });
    };

    const filePath = resolveSafeVideoPath(VIDEOS_DIR, match[1]);
    if (!filePath) {
      notFound();
      return;
    }

    const ext = extname(filePath).toLowerCase();
    res.set('Content-Type', VIDEO_MIME[ext]);
    res.sendFile(filePath, (err) => {
      if (err && !res.headersSent) notFound();
    });
  };
}
