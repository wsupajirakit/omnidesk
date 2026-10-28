/**
 * [FEAT-20260904-OBJVIDEO] `planVideoDownscale` — the whole shrink decision, as
 * arithmetic.
 * ===========================================================================
 * The rule is pure so it can be tested without a browser or a codec, exactly
 * like `planDownscale` next door. What is being defended:
 *
 *  · the ORDER of the checks, which is the contract — a later rule must never
 *    be reachable when an earlier one already answered
 *  · FAIL OPEN on anything unreadable: a video whose metadata never loaded is
 *    uploaded as-is rather than blocked, because the server cap is the backstop
 *  · the numbers live in ONE object, and 50 MB is the one the owner set
 *
 * 🔴 AND THE HONESTY RULE. `compressImage` on the server silently no-ops when
 * `sharp` is missing — a ceiling the code does not enforce. Everything here
 * returns a reason so a caller can say "not shrunk, and here is why" instead of
 * implying success. ย่อไม่ได้ต้องบอก ห้ามเงียบ
 */
import { describe, it, expect } from 'vitest';

import {
  planVideoDownscale,
  exceedsVideoCap,
  VIDEO_DOWNSCALE,
  type VideoDownscaleConfig,
} from '../utils/videoDownscale';

const MB = 1024 * 1024;
const mp4 = (sizeMb: number) => ({ type: 'video/mp4', size: sizeMb * MB });
const dim = (height: number) => ({ width: (height * 16) / 9, height });

describe('[OBJVIDEO] the config is the only place the numbers live', () => {
  it('🔴 the cap is 50 MB — the number the owner set', () => {
    /* ⚠️ This MUST match `VIDEO_MAX_BYTES` in omnidesk-api. A larger number here
       means the admin waits for an upload the server was always going to
       refuse; a smaller one means the browser gives up early. */
    expect(VIDEO_DOWNSCALE.maxBytes).toBe(50 * 1024 * 1024);
  });

  it('mp4 is handled, and the list is what decides', () => {
    expect(VIDEO_DOWNSCALE.containers).toContain('video/mp4');
  });
});

describe('[OBJVIDEO] planVideoDownscale — order of the checks', () => {
  it('🔴 switched off short-circuits everything below it', () => {
    const off: VideoDownscaleConfig = { ...VIDEO_DOWNSCALE, enabled: false };
    /* A file that would fail every later rule must still come back `disabled`,
       which is what proves the switch is checked FIRST. */
    const p = planVideoDownscale({ type: 'text/plain', size: 999 * MB }, dim(0), off);
    expect(p).toEqual({ action: 'skip', height: 0, reason: 'disabled' });
  });

  it('a non-video is never touched', () => {
    const p = planVideoDownscale({ type: 'image/png', size: 40 * MB }, dim(1080));
    expect(p.action).toBe('skip');
    expect(p.reason).toBe('not-a-video');
  });

  it('a container we do not handle is passed through, not refused here', () => {
    /* Refusing is the SERVER's job (`videoUploadFilter`). This side only
       declines to re-encode something it does not understand. */
    const p = planVideoDownscale(
      { type: 'video/quicktime', size: 40 * MB },
      dim(1080),
    );
    expect(p.reason).toBe('unsupported-container');
  });

  it('a small file is left alone even when it is tall', () => {
    /* Re-encoding a small clip costs quality and saves nothing, so the byte
       check comes BEFORE the pixel box. */
    const p = planVideoDownscale(mp4(2), dim(2160));
    expect(p.action).toBe('skip');
    expect(p.reason).toBe('already-small');
  });

  it('🔴 unreadable dimensions FAIL OPEN — the upload is never blocked', () => {
    /* A browser that could not read metadata must not cost the admin the
       upload; the server cap is what bounds it. */
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const p = planVideoDownscale(mp4(30), { width: 100, height: bad });
      expect(p.action).toBe('skip');
      expect(p.reason).toBe('unknown-dimensions');
    }
  });

  it('🔴 a SMALL file with unreadable dimensions is "already-small", not "unknown"', () => {
    /* 🔴 THE CASE THAT PINS THE ORDER, and the reason it exists: the first
       version of this suite had no input where the byte check and the
       dimension check disagree, so moving one past the other changed nothing
       and a reordering mutation SURVIVED. Every other case here gives the same
       answer in either order — this one does not.
       ⇒ small enough is decided BEFORE dimensions are consulted, so a tiny clip
         is skipped for the honest reason even when its metadata never loaded. */
    const p = planVideoDownscale({ type: 'video/mp4', size: 1 * MB }, dim(0));
    expect(p.reason).toBe('already-small');
  });

  it('a tall heavy clip shrinks to the box', () => {
    const p = planVideoDownscale(mp4(30), dim(1080));
    expect(p).toEqual({
      action: 'shrink',
      height: VIDEO_DOWNSCALE.maxHeight,
      reason: 'over-box',
    });
  });

  it('a short heavy clip inside the box re-encodes at its own height', () => {
    const p = planVideoDownscale(mp4(30), dim(480));
    expect(p).toEqual({ action: 'shrink', height: 480, reason: 'over-bytes' });
  });

  it('exactly at skipBelowBytes is still "already small"', () => {
    /* Boundary: `<=`, so the file on the line is not re-encoded. */
    const p = planVideoDownscale(
      { type: 'video/mp4', size: VIDEO_DOWNSCALE.skipBelowBytes },
      dim(1080),
    );
    expect(p.reason).toBe('already-small');
  });
});

describe('[OBJVIDEO] exceedsVideoCap', () => {
  it('answers the SERVER question, not the shrink question', () => {
    /* Separate on purpose: "is shrinking worth it" and "will this be refused"
       are different, and a caller wants to say so before posting 60 MB. */
    expect(exceedsVideoCap(50 * MB)).toBe(false);
    expect(exceedsVideoCap(50 * MB + 1)).toBe(true);
  });
});
