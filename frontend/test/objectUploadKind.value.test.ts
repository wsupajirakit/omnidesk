/**
 * [FEAT-20260904-OBJVIDEO] `pickUploadKind` — one drop target, two destinations.
 * ===========================================================================
 * An image goes to `/api/image-storage/dashboard` and lands in
 * `public/uploads/images`; a video goes to `dashboard-video` and lands in
 * `public/uploads/videos`. Routing the wrong one is not a cosmetic bug — it
 * puts an mp4 in the image tree, which is the single thing the server side was
 * built to prevent: videos must never mix with images.
 */
import { describe, it, expect } from 'vitest';

import { pickUploadKind } from '../components/object/gallery/uploadKind';
import { VIDEO_DOWNSCALE } from '../utils/videoDownscale';

const MB = 1024 * 1024;

describe('[OBJVIDEO] pickUploadKind', () => {
  it('an image routes to the image uploader', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
      expect(pickUploadKind({ type, size: 1 * MB })).toEqual({
        kind: 'image',
        tooLarge: false,
      });
    }
  });

  it('🔴 an image is NEVER called too large here', () => {
    /* Images keep their own 10 MB cap on their own route. Answering `tooLarge`
       for one would block an upload this rule has no business judging. */
    expect(pickUploadKind({ type: 'image/png', size: 900 * MB }).tooLarge).toBe(
      false,
    );
  });

  it('an mp4 routes to the video uploader', () => {
    expect(pickUploadKind({ type: 'video/mp4', size: 10 * MB })).toEqual({
      kind: 'video',
      tooLarge: false,
    });
  });

  it('🔴 a video over the cap is flagged BEFORE it is sent', () => {
    /* The server enforces the same ceiling and would answer 413 after the whole
       file had uploaded. Saying so first is the only difference. */
    const d = pickUploadKind({ type: 'video/mp4', size: 51 * MB });
    expect(d.kind).toBe('video');
    expect(d.tooLarge).toBe(true);
  });

  it('exactly at the cap is allowed — the boundary is not off by one', () => {
    expect(
      pickUploadKind({ type: 'video/mp4', size: VIDEO_DOWNSCALE.maxBytes })
        .tooLarge,
    ).toBe(false);
  });

  it('🔴 a video container the server refuses is refused here too', () => {
    /* `.mov` would upload, be rejected by `videoUploadFilter`, and surface as a
       generic failure. Naming it here is what lets the UI say why. */
    expect(pickUploadKind({ type: 'video/quicktime', size: 1 * MB }).kind).toBe(
      'unsupported',
    );
  });

  it('🔴 an unknown or empty type is UNSUPPORTED, not image-by-default', () => {
    /* The old drop handler tested `startsWith("image/")` and silently ignored
       everything else. With one destination that was harmless; with two it
       means a dropped file vanishes with no message. */
    for (const type of ['', 'application/pdf', 'text/html', 'application/zip']) {
      expect(pickUploadKind({ type, size: 1 * MB }).kind).toBe('unsupported');
    }
  });

  it('the type check is case-insensitive', () => {
    expect(pickUploadKind({ type: 'VIDEO/MP4', size: 1 * MB }).kind).toBe(
      'video',
    );
  });
});

/**
 * [FIX-20260904-UPLOAD400] An image the SERVER refuses is refused here too.
 *
 * The rule used to be "any `image/*` is an image". A `.bmp` or a `.svg` was
 * therefore uploaded in full and came back as a server error the admin could do
 * nothing with — and until 04/09 that error was a 500, so it read as a system
 * fault rather than a wrong file. A wrong pick must be caught before upload.
 */
describe('[UPLOAD400] only the five image types the server serves', () => {
  it.each(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])(
    '%s is an image',
    (type) => {
      expect(pickUploadKind({ type, size: 1 * MB }).kind).toBe('image');
    },
  );

  it('🔴 image/jpg — the non-standard type browsers still send — is accepted', () => {
    /* 🔴 MUTATION KILLER. The server forgives this exact alias; dropping it
       here would refuse real photos before they were ever sent, which is worse
       than the bug this change fixes. */
    expect(pickUploadKind({ type: 'image/jpg', size: 1 * MB }).kind).toBe('image');
  });

  it('🔴 an image type outside the table is UNSUPPORTED', () => {
    /* 🔴 MUTATION KILLER. Every case that existed before this one passed with
       the old "any image/*" rule, so none of them measured the table at all.
       `image/svg+xml` is the one that matters most: it is scriptable, and the
       server has refused it since 18/08. */
    for (const type of ['image/bmp', 'image/svg+xml', 'image/tiff', 'image/avif']) {
      expect(pickUploadKind({ type, size: 1 * MB }).kind).toBe('unsupported');
    }
  });
});
