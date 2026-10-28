/**
 * [FEAT-20260904-OBJVIDEO] The video upload filter and the video serve path.
 * ===========================================================================
 * Two rules are being defended, and both have an image sibling that already
 * learned them the hard way:
 *
 *  1. an allowed extension is NOT enough — the declared MIME must agree, or a
 *     renamed file walks in (`image-upload-filter.ts` records that hole)
 *  2. the serve path answers only names it can vouch for, with ONE 404 shape,
 *     so a probe cannot learn what exists from the error
 *
 * 🔴 AND ONE RULE ABOUT THE TABLES THEMSELVES: `IMAGE_MIME` must never gain a
 * video entry. That is what keeps an `.mp4` out of `public/uploads/images`.
 * ห้ามปนกับรูป
 */
import { join } from 'node:path';

import {
  IMAGE_MIME,
  resolveSafeImagePath,
} from '@/infra/static/hardened-image-serve.middleware';
import { resolveSafeVideoPath } from '@/infra/static/hardened-video-serve.middleware';
import {
  VIDEO_MIME,
  VIDEO_MAX_BYTES,
  isAcceptedVideoExt,
} from '@/infra/static/video-types';
import { videoUploadFilter } from '@/infra/static/video-upload-filter';

const VIDEOS = '/srv/public/uploads/videos';
const IMAGES = '/srv/public/uploads/images';

/** Runs the multer filter and reports what it decided. */
const filter = (
  originalname: string,
  mimetype: string,
): { accepted: boolean; error: string | null } => {
  let accepted = false;
  let error: Error | null = null;
  videoUploadFilter({}, { originalname, mimetype }, (e, ok) => {
    error = e;
    accepted = ok;
  });
  return { accepted, error: error ? (error as Error).name : null };
};

describe('[OBJVIDEO] the two tables stay apart', () => {
  it('🔴 IMAGE_MIME holds no video — this is what keeps mp4 out of uploads/images', () => {
    for (const type of Object.values(IMAGE_MIME)) {
      expect(type.startsWith('image/')).toBe(true);
    }
    expect(IMAGE_MIME['.mp4']).toBeUndefined();
  });

  it('VIDEO_MIME holds no image, and mp4 is in it', () => {
    for (const type of Object.values(VIDEO_MIME)) {
      expect(type.startsWith('video/')).toBe(true);
    }
    expect(VIDEO_MIME['.mp4']).toBe('video/mp4');
  });

  it('the cap is 50 MB — the number the owner set, in one place', () => {
    expect(VIDEO_MAX_BYTES).toBe(50 * 1024 * 1024);
  });

  it('isAcceptedVideoExt is case-insensitive', () => {
    expect(isAcceptedVideoExt('.MP4')).toBe(true);
    expect(isAcceptedVideoExt('.mov')).toBe(false);
  });
});

describe('[OBJVIDEO] videoUploadFilter', () => {
  it('accepts a real mp4', () => {
    expect(filter('clip.mp4', 'video/mp4')).toEqual({
      accepted: true,
      error: null,
    });
  });

  it('🔴 refuses an mp4 whose declared MIME does not match', () => {
    /* The whole reason the filter reads mimetype at all: `shell.php` renamed
       `.mp4`, or an `.mp4` announced as text/html, must fail at upload rather
       than at serve time. */
    expect(filter('clip.mp4', 'text/html').accepted).toBe(false);
    expect(filter('clip.mp4', 'image/png').accepted).toBe(false);
  });

  it('🔴 refuses an image — the video route is not a second image route', () => {
    expect(filter('photo.png', 'image/png').accepted).toBe(false);
  });

  it('refuses an unlisted container, and names the extension in the error', () => {
    const r = filter('clip.mov', 'video/quicktime');
    expect(r.accepted).toBe(false);
    expect(r.error).toBe('UnsupportedVideoTypeError');
  });

  it('a missing filename is refused, not crashed on', () => {
    expect(filter('', 'video/mp4').accepted).toBe(false);
  });
});

describe('[OBJVIDEO] resolveSafeVideoPath', () => {
  it('resolves a plain accepted name inside the videos dir', () => {
    expect(resolveSafeVideoPath(VIDEOS, 'a.mp4')).toBe(join(VIDEOS, 'a.mp4'));
  });

  it('🔴 refuses traversal, separators and NUL', () => {
    for (const bad of ['../secret.mp4', 'a/b.mp4', 'a\\b.mp4', 'a\0.mp4', '']) {
      /* jest's expect takes one argument — the name goes in the message
         instead so a failure still says WHICH input slipped through. */
      expect(`${bad} -> ${resolveSafeVideoPath(VIDEOS, bad)}`).toBe(
        `${bad} -> null`,
      );
    }
  });

  it('🔴 refuses an extension outside the table — including an image', () => {
    /* Before this middleware existed, `/uploads/videos/x.html` was answered by
       express static with no allow-list at all. */
    expect(resolveSafeVideoPath(VIDEOS, 'x.html')).toBeNull();
    expect(resolveSafeVideoPath(VIDEOS, 'x.png')).toBeNull();
  });

  it('🔴 the image resolver still refuses a video, and vice versa', () => {
    /* The two paths must not become interchangeable by accident. */
    expect(resolveSafeImagePath(IMAGES, 'a.mp4')).toBeNull();
    expect(resolveSafeVideoPath(VIDEOS, 'a.png')).toBeNull();
  });
});
