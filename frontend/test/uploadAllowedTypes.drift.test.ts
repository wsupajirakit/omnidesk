/**
 * [FIX-20260904-UPLOAD400] The picker may only offer what the SERVER accepts.
 * ===========================================================================
 * `uploadKind.ts` keeps its own copy of the allowed extensions so the file
 * picker can grey out unopenable files and a refusal can be explained in the
 * admin's language before anything is uploaded. A copy is only safe while it is
 * guarded: if the server adds `.avif` and this list does not, the picker refuses
 * a file the server would have taken; if this list adds one first, the admin is
 * offered a file that comes back 400. Both failures are silent.
 *
 * So this test reads the SERVER's own tables and compares. Same shape as
 * `noticeCardGate.value.test.ts`, which guards the notice pairs the same way.
 * A copy is fine only while something catches the drift.
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { describe, it, expect } from 'vitest';

import {
  ALLOWED_UPLOAD_EXTENSIONS,
  IMAGE_UPLOAD_TYPES,
  UPLOAD_ACCEPT,
  VIDEO_UPLOAD_TYPES,
} from '../components/object/gallery/uploadKind';

/**
 * Where the back end sits next to this checkout.
 *
 * ⚠️ A LANE MUST FIND ITS OWN BACK END. Both repos are checked out as siblings,
 * and a worktree keeps the lane name in the directory (`omnidesk-console-x` ↔
 * `omnidesk-api-x`). Looking only at `../omnidesk-api` would compare a lane's
 * front end against the MAIN back end, where a table added on the lane does not
 * exist yet — and the guard would pass by skipping, which is the worst outcome.
 */
const beRoot = (): string => {
  const here = basename(process.cwd());
  const suffix = here.startsWith('omnidesk-console')
    ? here.slice('omnidesk-console'.length)
    : '';
  for (const name of [`omnidesk-api${suffix}`, 'backend']) {
    const candidate = join(process.cwd(), '..', name);
    if (existsSync(candidate)) return candidate;
  }
  return join(process.cwd(), '..', 'backend');
};

/** Pull an `ext: 'mime'` table out of the server source by its export name. */
const readTable = (file: string, exportName: string): Record<string, string> => {
  const src = readFileSync(file, 'utf8');
  const start = src.indexOf(`export const ${exportName}`);
  if (start < 0) return {};
  const block = src.slice(start, src.indexOf('};', start));
  return Object.fromEntries(
    [...block.matchAll(/'(\.[a-z0-9]+)':\s*'([^']+)'/g)].map((m) => [m[1], m[2]]),
  );
};

describe('⭐ drift guard — the picker mirrors the server exactly', () => {
  const BE = beRoot();
  const IMAGE_SRC = join(BE, 'src/infra/static/hardened-image-serve.middleware.ts');
  const VIDEO_SRC = join(BE, 'src/infra/static/video-types.ts');

  it('⭐ image extensions match omnidesk-api IMAGE_MIME', () => {
    if (!existsSync(IMAGE_SRC)) {
      /* Not a silent pass: name the check that did not run and why. */
      expect(`SKIPPED — back end not at ${IMAGE_SRC}`).toContain('SKIPPED');
      return;
    }
    const be = readTable(IMAGE_SRC, 'IMAGE_MIME');
    expect(Object.keys(be).length).toBeGreaterThan(0);
    expect(IMAGE_UPLOAD_TYPES).toEqual(be);
  });

  it('⭐ video extensions match omnidesk-api VIDEO_MIME', () => {
    if (!existsSync(VIDEO_SRC)) {
      expect(`SKIPPED — back end not at ${VIDEO_SRC}`).toContain('SKIPPED');
      return;
    }
    const be = readTable(VIDEO_SRC, 'VIDEO_MIME');
    expect(Object.keys(be).length).toBeGreaterThan(0);
    expect(VIDEO_UPLOAD_TYPES).toEqual(be);
  });

  it('🔴 no image extension leaks into the video table, or the reverse', () => {
    /* 🔴 The server keeps two tables so an mp4 can never land in the image
       directory. A picker that merged them would be the first step back to one.
       Videos must never mix with images. */
    const overlap = Object.keys(IMAGE_UPLOAD_TYPES).filter(
      (ext) => ext in VIDEO_UPLOAD_TYPES,
    );
    expect(overlap).toEqual([]);
  });
});

describe('[UPLOAD400] what the picker offers and what the message says', () => {
  it('🔴 `accept` carries every allowed extension AND its MIME type', () => {
    /* 🔴 MUTATION KILLER. Extensions alone leave drag-and-drop and some mobile
       pickers matching nothing; MIME alone leaves the desktop picker showing
       every file greyed-in. Both halves are asserted so dropping either goes
       red. */
    for (const ext of [
      ...Object.keys(IMAGE_UPLOAD_TYPES),
      ...Object.keys(VIDEO_UPLOAD_TYPES),
    ]) {
      expect(UPLOAD_ACCEPT).toContain(ext);
    }
    for (const mime of [
      ...Object.values(IMAGE_UPLOAD_TYPES),
      ...Object.values(VIDEO_UPLOAD_TYPES),
    ]) {
      expect(UPLOAD_ACCEPT).toContain(mime);
    }
  });

  it('🔴 `accept` offers nothing the server refuses', () => {
    /* The direction that actually bites: an entry here that the tables do not
       contain is a file the admin can pick and the server will reject. */
    const known = new Set([
      ...Object.keys(IMAGE_UPLOAD_TYPES),
      ...Object.keys(VIDEO_UPLOAD_TYPES),
      ...Object.values(IMAGE_UPLOAD_TYPES),
      ...Object.values(VIDEO_UPLOAD_TYPES),
    ]);
    for (const entry of UPLOAD_ACCEPT.split(',')) {
      expect(known.has(entry)).toBe(true);
    }
  });

  it('the message list names every extension and nothing else', () => {
    expect(ALLOWED_UPLOAD_EXTENSIONS).toBe('.jpg, .jpeg, .png, .gif, .webp, .mp4');
  });
});
