/* [FE] [FEAT-20260816-MULTIIMG] — Ctrl+V image(s) into the composer, up to the
 * free slots the caller has left (5 minus what is already staged).
 *
 * Supersedes the single-image [FEAT-20260816-PASTEIMAGE] contract of earlier
 * today — the composer now stages up to 5, so the helper returns an ARRAY.
 * The rules that matter:
 *   1. images in the clipboard come back as Files, IN ORDER, capped at `max`
 *   2. a TEXT paste returns [] — the caller must then do NOTHING and let the
 *      browser paste the text; intercepting an ordinary paste is how a chat
 *      box breaks in the way operators hate most
 *   3. every returned File gets a distinct stamped name (screenshots all
 *      arrive as "image.png"; two pastes must stay distinguishable in logs)
 *
 * revert: delete together with utils/imageTransfer.ts.
 */
import { describe, it, expect } from 'vitest';

import { readFileSync } from 'fs';
import { join } from 'path';

import { imageFilesFromPaste } from '../utils/imageTransfer';
/* [REFACTOR-20260905-CUSTPROV] this reads the page PLUS the files it was split
   into. The composer and the right-hand panels moved out of TicketChat.tsx to
   components/chat/{chat-input,ticket-detail}; the code this spec pins moved
   with them, so the read follows the code. Every assertion below is unchanged
   — see test/ticketChatSource.ts for the file list and the one caveat. */
import { ticketChatSource } from './ticketChatSource';

const fileItem = (type: string, name = 'image.png') => ({
  kind: 'file',
  type,
  getAsFile: () => new File(['x'], name, { type }),
});
const textItem = { kind: 'string', type: 'text/plain', getAsFile: () => null };

const paste = (items: unknown[]) => ({ clipboardData: { items } }) as never;

describe('imageFilesFromPaste', () => {
  it('a pasted screenshot comes back as [one image File] with a stamped name', () => {
    const files = imageFilesFromPaste(paste([fileItem('image/png')]), 5);
    expect(files).toHaveLength(1);
    expect(files[0].type).toBe('image/png');
    expect(files[0].name).toMatch(/^paste-\d+-1\.png$/);
  });

  it('a plain text paste returns [] — the default paste must proceed', () => {
    expect(imageFilesFromPaste(paste([textItem]), 5)).toEqual([]);
  });

  it('an empty or missing clipboard returns [], never throws', () => {
    expect(imageFilesFromPaste(paste([]), 5)).toEqual([]);
    expect(imageFilesFromPaste({ clipboardData: null } as never, 5)).toEqual([]);
    expect(imageFilesFromPaste({ clipboardData: {} } as never, 5)).toEqual([]);
  });

  it('a non-image file (e.g. a PDF) returns []', () => {
    expect(
      imageFilesFromPaste(paste([fileItem('application/pdf', 'doc.pdf')]), 5),
    ).toEqual([]);
  });

  it('mixed clipboard (text + image, the common browser case) still finds the image', () => {
    const files = imageFilesFromPaste(paste([textItem, fileItem('image/jpeg')]), 5);
    expect(files).toHaveLength(1);
    expect(files[0].type).toBe('image/jpeg');
    expect(files[0].name).toMatch(/\.jpeg$/);
  });

  it('several images come back IN ORDER with distinct stamped names', () => {
    const files = imageFilesFromPaste(
      paste([
        fileItem('image/png', 'a.png'),
        fileItem('image/jpeg', 'b.jpg'),
        fileItem('image/png', 'c.png'),
      ]),
      5,
    );
    expect(files.map((f) => f.type)).toEqual([
      'image/png',
      'image/jpeg',
      'image/png',
    ]);
    const names = files.map((f) => f.name);
    expect(new Set(names).size).toBe(3);
    expect(names[0]).toMatch(/-1\.png$/);
    expect(names[1]).toMatch(/-2\.jpeg$/);
    expect(names[2]).toMatch(/-3\.png$/);
  });

  it('respects `max` — 3 images but only 2 free slots → the first 2', () => {
    const files = imageFilesFromPaste(
      paste([
        fileItem('image/png', 'a.png'),
        fileItem('image/jpeg', 'b.jpg'),
        fileItem('image/png', 'c.png'),
      ]),
      2,
    );
    expect(files).toHaveLength(2);
    expect(files[1].type).toBe('image/jpeg');
  });

  it('max 0 (tray already full) → [] so the default paste proceeds untouched', () => {
    expect(imageFilesFromPaste(paste([fileItem('image/png')]), 0)).toEqual([]);
  });

  it('svg+xml gets a clean extension', () => {
    const files = imageFilesFromPaste(paste([fileItem('image/svg+xml', 'x.svg')]), 5);
    expect(files[0].name).toMatch(/\.svg$/);
  });
});

describe('the composer wiring (source pin — the page is too heavy to mount)', () => {
  const src = ticketChatSource()
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  it('the textarea listens for paste', () => {
    expect(src).toContain('onPaste={onComposerPaste}');
  });

  it('taken images are staged, and only then is the default paste suppressed', () => {
    const body = src.slice(
      src.indexOf('const onComposerPaste'),
      src.indexOf('};', src.indexOf('const onComposerPaste')),
    );
    expect(body).toContain('imageFilesFromPaste(e,');
    expect(body).toContain('if (files.length === 0) return;');
    expect(body).toContain('e.preventDefault();');
    expect(body).toContain('stageImages(files);');
  });

  it('both entrances share ONE staging seam — the picker calls stageImages too', () => {
    const picker = src.slice(
      src.indexOf('const onPickImage'),
      src.indexOf('};', src.indexOf('const onPickImage')),
    );
    expect(picker).toContain('stageImages(');
  });

  it('the file picker accepts multiple files', () => {
    // pin on the RAW source: the comment-stripping regex above would eat
    // `accept="image/*" multiple ...` (the `/*` inside the mime glob opens a
    // fake block comment)
    const raw = ticketChatSource();
    const inputIdx = raw.indexOf('ref={fileRef}');
    expect(inputIdx).toBeGreaterThan(-1);
    const inputTag = raw.slice(inputIdx, raw.indexOf('/>', inputIdx));
    expect(inputTag).toContain('multiple');
  });
});
