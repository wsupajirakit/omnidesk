/**
 * [FEAT-20260901-UPLOADDOWNSCALE] The rules that decide how much an uploaded
 * image shrinks.
 *
 * `planDownscale` is pure arithmetic, so every rule is pinned here without a
 * browser. The pixel half (`downscaleImageFile`) has no canvas in jsdom; what
 * IS asserted about it is the promise this feature rests on — that a failure
 * hands back the original File rather than blocking the upload.
 */
import { describe, expect, it } from 'vitest';

import {
  IMAGE_DOWNSCALE,
  downscaleImageFile,
  planDownscale,
} from '../utils/imageDownscale';

const BIG = IMAGE_DOWNSCALE.skipBelowBytes + 1;
const jpeg = (size = BIG) => ({ type: 'image/jpeg', size });

describe('planDownscale — the master switch', () => {
  it('switched off, a file that would otherwise shrink is left alone', () => {
    const cfg = { ...IMAGE_DOWNSCALE, enabled: false };
    const plan = planDownscale(jpeg(), { width: 9000, height: 9000 }, cfg);
    expect(plan).toMatchObject({ action: 'skip', reason: 'disabled' });
  });

  it('switched off wins over every other rule, so nothing is half-applied', () => {
    const cfg = {
      ...IMAGE_DOWNSCALE,
      enabled: false,
      maxWidth: 10,
      maxHeight: 10,
      skipBelowBytes: 0,
    };
    expect(planDownscale(jpeg(), { width: 9000, height: 9000 }, cfg).action).toBe(
      'skip',
    );
  });

  it('ships ON — the default config downscales', () => {
    expect(IMAGE_DOWNSCALE.enabled).toBe(true);
    expect(planDownscale(jpeg(), { width: 9000, height: 9000 }).action).toBe(
      'resize',
    );
  });
});

describe('planDownscale — what gets left alone', () => {
  it('a non-image is never touched', () => {
    const plan = planDownscale(
      { type: 'application/pdf', size: BIG },
      { width: 4000, height: 4000 },
    );
    expect(plan).toMatchObject({ action: 'skip', reason: 'not-an-image' });
  });

  /* Named literally, NOT driven off `IMAGE_DOWNSCALE.passthroughTypes`. Looping
     over the config would make the test follow the code: deleting 'image/gif'
     from the list would delete its own test case and stay green. These two are
     the contract — an animated GIF must keep its frames, an SVG is not raster. */
  it.each(['image/gif', 'image/svg+xml'])(
    '%s is passed through — re-encoding would destroy it',
    (type) => {
      const plan = planDownscale(
        { type, size: BIG },
        { width: 4000, height: 4000 },
      );
      expect(plan).toMatchObject({ action: 'skip', reason: 'passthrough-type' });
    },
  );

  it('a file at the byte threshold is small enough already', () => {
    const plan = planDownscale(
      jpeg(IMAGE_DOWNSCALE.skipBelowBytes),
      { width: 4000, height: 4000 },
    );
    expect(plan).toMatchObject({ action: 'skip', reason: 'already-small' });
  });

  it('unreadable dimensions fail OPEN — the upload still goes through', () => {
    const plan = planDownscale(jpeg(), { width: 0, height: 0 });
    expect(plan).toMatchObject({ action: 'skip', reason: 'unknown-dimensions' });
  });
});

describe('planDownscale — what gets shrunk, and to what', () => {
  it('scales the long edge onto the box and keeps the aspect ratio', () => {
    const plan = planDownscale(jpeg(), { width: 4000, height: 2000 });
    expect(plan).toMatchObject({ action: 'resize', reason: 'over-box' });
    expect(plan.width).toBe(IMAGE_DOWNSCALE.maxWidth);
    expect(plan.height).toBe(IMAGE_DOWNSCALE.maxWidth / 2);
  });

  it('scales on HEIGHT when that is the edge that overflows', () => {
    const plan = planDownscale(jpeg(), { width: 1000, height: 4000 });
    expect(plan.height).toBe(IMAGE_DOWNSCALE.maxHeight);
    expect(plan.width).toBe(IMAGE_DOWNSCALE.maxHeight / 4);
  });

  it('one pixel over the box still resizes', () => {
    const over = IMAGE_DOWNSCALE.maxWidth + 1;
    const plan = planDownscale(jpeg(), { width: over, height: over });
    expect(plan.action).toBe('resize');
    expect(plan.width).toBe(IMAGE_DOWNSCALE.maxWidth);
  });

  /* 3000×2000 into a 1600 box scales by 8/15, so the short edge lands on
     1066.67 — the one place round and floor disagree. Pinning 1067 is what
     stops the rounding being quietly changed. */
  it('rounds the short edge rather than flooring it', () => {
    const plan = planDownscale(jpeg(), { width: 3000, height: 2000 });
    expect(plan.width).toBe(1600);
    expect(plan.height).toBe(1067);
  });

  /* 20000×1 scales by 0.08, so the short edge rounds to 0 — and a canvas of
     width or height 0 throws. The clamp is what turns that into 1, so the
     assertion is `toBe(1)`: `toBeGreaterThan(0)` would also pass on the
     unclamped 0.08→0 path once rounding changed, and prove nothing. */
  it('never produces a zero-height canvas on an extreme aspect ratio', () => {
    const plan = planDownscale(jpeg(), { width: 20000, height: 1 });
    expect(plan.width).toBe(IMAGE_DOWNSCALE.maxWidth);
    expect(plan.height).toBe(1);
  });

  it('a heavy file already inside the box is re-encoded at its own size', () => {
    const plan = planDownscale(jpeg(), { width: 800, height: 600 });
    expect(plan).toMatchObject({
      action: 'resize',
      width: 800,
      height: 600,
      reason: 'over-bytes',
    });
  });

  it('exactly on the box edge is not "over" it', () => {
    const plan = planDownscale(jpeg(), {
      width: IMAGE_DOWNSCALE.maxWidth,
      height: IMAGE_DOWNSCALE.maxHeight,
    });
    expect(plan.reason).toBe('over-bytes');
    expect(plan.width).toBe(IMAGE_DOWNSCALE.maxWidth);
  });
});

describe('planDownscale — the config is the only authority', () => {
  it('a caller-supplied box is honoured instead of the default', () => {
    const cfg = { ...IMAGE_DOWNSCALE, maxWidth: 400, maxHeight: 400 };
    const plan = planDownscale(jpeg(), { width: 800, height: 800 }, cfg);
    expect(plan).toMatchObject({ action: 'resize', width: 400, height: 400 });
  });

  it('raising the byte threshold above the file size skips it', () => {
    const cfg = { ...IMAGE_DOWNSCALE, skipBelowBytes: BIG + 1 };
    const plan = planDownscale(jpeg(), { width: 9000, height: 9000 }, cfg);
    expect(plan.action).toBe('skip');
  });
});

describe('downscaleImageFile — failure hands back the original', () => {
  it('returns the very same File when there is no canvas to draw on', async () => {
    const file = new File([new Uint8Array(BIG)], 'photo.jpg', {
      type: 'image/jpeg',
    });
    await expect(downscaleImageFile(file)).resolves.toBe(file);
  });

  it('skips a small file without ever touching the DOM', async () => {
    const file = new File([new Uint8Array(16)], 'tiny.jpg', {
      type: 'image/jpeg',
    });
    await expect(downscaleImageFile(file)).resolves.toBe(file);
  });

  it('skips a non-image without ever touching the DOM', async () => {
    const file = new File([new Uint8Array(BIG)], 'doc.pdf', {
      type: 'application/pdf',
    });
    await expect(downscaleImageFile(file)).resolves.toBe(file);
  });
});
