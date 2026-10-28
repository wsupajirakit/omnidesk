/**
 * [FIX-20260904-DRIVEURL] The Drive list request, pinned in one place.
 * ===========================================================================
 * This URL was written out four times across two screens and the copies had
 * DRIFTED: the album list's copy omitted the two shared-drive flags, so a folder
 * on a Shared Drive listed fine in the modal and came back empty on the list
 * page — same album, same key, no error on either side.
 *
 * These cases exist so that cannot happen again silently.
 */
import { describe, it, expect } from 'vitest';

import {
  DRIVE_FIELDS,
  DRIVE_PAGE_SIZE,
  buildDriveListUrl,
  driveThumbnailAt800,
} from '../utils/driveListUrl';

const base = { folderId: 'folder-1', apiKey: 'KEY-1' };

describe('[DRIVEURL] what every caller must send', () => {
  it('🔴 always asks for shared-drive files', () => {
    /* 🔴 THE BUG THIS FILE EXISTS FOR. Without both flags Drive omits Shared
       Drive content and answers 200 with fewer files — nothing to see, nothing
       to debug. */
    const url = buildDriveListUrl(base);
    expect(url).toContain('supportsAllDrives=true');
    expect(url).toContain('includeItemsFromAllDrives=true');
  });

  it('asks only for images, and never for trashed files', () => {
    const q = decodeURIComponent(buildDriveListUrl(base));
    expect(q).toContain("'folder-1' in parents");
    expect(q).toContain('trashed = false');
    expect(q).toContain("mimeType contains 'image/'");
  });

  it('🔴 asks for the thumbnail field', () => {
    /* 🔴 Drop it and every gallery renders broken images off a 200 response. */
    expect(DRIVE_FIELDS).toContain('thumbnailLink');
    expect(buildDriveListUrl(base)).toContain(`fields=${DRIVE_FIELDS}`);
  });

  it('carries the key and the page size', () => {
    const url = buildDriveListUrl(base);
    expect(url).toContain('key=KEY-1');
    expect(url).toContain(`pageSize=${DRIVE_PAGE_SIZE}`);
  });

  it('🔴 appends the page token only when there is one', () => {
    /* A literal `pageToken=undefined` is a 400 from Drive, and the first page is
       exactly the call that has no token. */
    expect(buildDriveListUrl(base)).not.toContain('pageToken');
    expect(buildDriveListUrl({ ...base, pageToken: null })).not.toContain('pageToken');
    expect(buildDriveListUrl({ ...base, pageToken: 'tok-2' })).toContain('pageToken=tok-2');
  });

  it('🔴 the query is url-encoded — spaces survive, and so does the folder id', () => {
    /* ⚠️ CORRECTED AFTER THE TEST FAILED: `encodeURIComponent` does NOT escape a
       single quote — it is an unreserved character. So this asserts what the
       encoding really guarantees (the spaces and operators in the query travel
       intact) rather than a protection that does not exist. A Drive folder id is
       alphanumeric anyway; the quotes here are the query's own syntax.
       Claiming an escape that is not happening would be worse than no case. */
    const url = buildDriveListUrl({ ...base, folderId: 'folder 2' });
    expect(url).toContain('folder%202');
    expect(url).not.toContain('folder 2');
    expect(url).toContain('%20in%20parents');
  });
});

describe('[DRIVEURL] the thumbnail size rewrite', () => {
  it('🔴 lifts 220px to 800px', () => {
    /* 🔴 Without it every preview is a postage stamp, and nothing fails. */
    expect(driveThumbnailAt800('https://drive.test/x=s220')).toBe(
      'https://drive.test/x=s800',
    );
  });

  it('🔴 only rewrites the SUFFIX, not a filename that happens to contain it', () => {
    /* 🔴 A blind replace corrupts the url of a file called `photo=s220.png`. */
    expect(driveThumbnailAt800('https://drive.test/photo=s220.png')).toBe(
      'https://drive.test/photo=s220.png',
    );
  });

  it('a missing thumbnail is null, not the string "undefined"', () => {
    expect(driveThumbnailAt800(undefined)).toBeNull();
    expect(driveThumbnailAt800(null)).toBeNull();
  });
});
