/**
 * [FEAT-20260904-OBJVIDEO] The encoder switchboard — selection is the contract.
 * ===========================================================================
 * `selectVideoEncoder` is pure and takes its list and config as arguments, so
 * everything the owner asked for on 04/09 — switchable on, off and out, and
 * provable here with fake backends, in Node, with no browser and no codec.
 *
 * What is being defended:
 *  · the ORDER of the checks: off → disabled → preference → support
 *  · `null` is a NORMAL answer (Firefox/Safari reach it) and must never be an
 *    exception, because the caller turns it into "uploaded the original"
 *  · a backend that throws must not cost the admin the upload
 *
 * 🔴 SEVERAL CASES EXIST ONLY TO MAKE MUTATIONS DIE. A suite where every input
 * gives the same answer under two rule orders proves nothing about the order —
 * that mistake already let a reordering mutation survive on `planVideoDownscale`
 * (see `videoDownscale.value.test.ts`). Each one is marked below.
 */
import { describe, it, expect, vi } from 'vitest';

import { withExtension, type VideoEncoderBackend } from '../utils/video/encoderBackend';
import { mediaRecorderEncoder } from '../utils/video/mediaRecorderEncoder';
import {
  selectVideoEncoder,
  encodeVideo,
  VIDEO_ENCODERS,
  VIDEO_ENCODER_CONFIG,
  type VideoEncoderConfig,
} from '../utils/video/encoderRegistry';

/** A stand-in engine. `out` is what its `encode` resolves to. */
const fake = (
  id: string,
  supported: boolean,
  out: File | null = null,
): VideoEncoderBackend => ({
  id,
  isSupported: () => supported,
  encode: () => Promise.resolve(out),
});

const cfg = (over: Partial<VideoEncoderConfig> = {}): VideoEncoderConfig => ({
  enabled: true,
  order: [],
  disabled: [],
  ...over,
});

const request = { file: new File([], 'clip.mp4'), height: 720, bitrate: 2_000_000 };

describe('[OBJVIDEO] selectVideoEncoder — order of the checks', () => {
  it('🔴 switched off short-circuits everything below it', () => {
    /* A perfectly supported engine must STILL not be chosen. That is what
       proves the master switch is read first, and it is the one-line revert. */
    expect(selectVideoEncoder([fake('a', true)], cfg({ enabled: false }))).toBeNull();
  });

  it('a disabled id is never chosen, even as the only candidate', () => {
    expect(selectVideoEncoder([fake('a', true)], cfg({ disabled: ['a'] }))).toBeNull();
  });

  it('🔴 disabled beats order — a listed-but-disabled id does not win', () => {
    /* 🔴 MUTATION KILLER. If `disabled` were applied AFTER the preference sort,
       'a' would be at the front and would be returned. Two supported engines
       are required for this case to distinguish the two orders at all. */
    const chosen = selectVideoEncoder(
      [fake('a', true), fake('b', true)],
      cfg({ order: ['a'], disabled: ['a'] }),
    );
    expect(chosen?.id).toBe('b');
  });

  it('🔴 order overrides registration order', () => {
    /* 🔴 MUTATION KILLER. Both engines are supported, so registration order
       alone would answer 'a'. Only an honoured preference list answers 'b'. */
    const chosen = selectVideoEncoder(
      [fake('a', true), fake('b', true)],
      cfg({ order: ['b'] }),
    );
    expect(chosen?.id).toBe('b');
  });

  it('an unsupported preferred engine is skipped, not returned', () => {
    /* Preference says WHICH to try first, never WHETHER it can run. */
    const chosen = selectVideoEncoder(
      [fake('a', true), fake('b', false)],
      cfg({ order: ['b'] }),
    );
    expect(chosen?.id).toBe('a');
  });

  it('an id in `order` that matches nothing is ignored, not fatal', () => {
    /* A stale entry left behind after an engine was removed must not silently
       switch encoding off — that failure would be invisible for months. */
    const chosen = selectVideoEncoder([fake('a', true)], cfg({ order: ['gone'] }));
    expect(chosen?.id).toBe('a');
  });

  it('🔴 unlisted engines keep registration order behind the listed ones', () => {
    /* 🔴 MUTATION KILLER. Three engines with only the LAST one listed: the
       answer pins both halves of the sort at once — 'c' first because it is
       preferred, then 'a' before 'b' because that is how they were registered.
       Reversing either half changes this result. */
    const backends = [fake('a', false), fake('b', true), fake('c', false)];
    const chosen = selectVideoEncoder(backends, cfg({ order: ['c'] }));
    expect(chosen?.id).toBe('b');
  });

  it('no engine at all is null, not a throw', () => {
    expect(selectVideoEncoder([], cfg())).toBeNull();
    expect(selectVideoEncoder([fake('a', false)], cfg())).toBeNull();
  });
});

describe('[OBJVIDEO] encodeVideo', () => {
  it('returns null when nothing can encode — the caller uploads the original', () => {
    return expect(encodeVideo(request, [], cfg())).resolves.toBeNull();
  });

  it('hands back what the chosen engine produced', async () => {
    const out = new File(['x'], 'clip.mp4', { type: 'video/mp4' });
    await expect(encodeVideo(request, [fake('a', true, out)], cfg())).resolves.toBe(out);
  });

  it('🔴 a throwing engine becomes null, never an exception', async () => {
    /* 🔴 The upload must survive a browser API that changes under us. Without
       the try/catch this rejects and `downscaleVideoFile`'s own catch is the
       only thing between the admin and a failed upload. */
    const boom: VideoEncoderBackend = {
      id: 'boom',
      isSupported: () => true,
      encode: () => Promise.reject(new Error('codec gone')),
    };
    await expect(encodeVideo(request, [boom], cfg())).resolves.toBeNull();
  });

  it('does not call an engine it did not choose', async () => {
    const spy = vi.fn().mockResolvedValue(null);
    const unchosen: VideoEncoderBackend = {
      id: 'unchosen',
      isSupported: () => true,
      encode: spy,
    };
    await encodeVideo(request, [unchosen], cfg({ enabled: false }));
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('[OBJVIDEO] the shipped registry', () => {
  it('is enabled, with no engine held back', () => {
    expect(VIDEO_ENCODER_CONFIG.enabled).toBe(true);
    expect(VIDEO_ENCODER_CONFIG.disabled).toEqual([]);
  });

  it('every registered engine has a unique id', () => {
    const ids = VIDEO_ENCODERS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('🔴 MediaRecorder engine reports NO support under jsdom', () => {
    /* 🔴 THE HONESTY CASE. jsdom has no MediaRecorder and no element capture,
       which is exactly the shape of Firefox/Safari. An engine that claimed
       support here would return a file the browser never produced — or worse, a
       WebM the upload route refuses. อ้างว่าทำได้ทั้งที่ทำไม่ได้ = ห้าม */
    expect(mediaRecorderEncoder.isSupported()).toBe(false);
  });

  it('nothing is selected in this environment, and that is not an error', () => {
    expect(selectVideoEncoder()).toBeNull();
  });
});

describe('[OBJVIDEO] withExtension', () => {
  it('replaces the extension so the server allowlist sees the real container', () => {
    /* The upload filter keys on the extension: a re-encoded `.mov` arriving
       still named `.mov` is refused despite being a valid mp4. */
    expect(withExtension('clip.mov', '.mp4')).toBe('clip.mp4');
  });

  it('adds one when there is none', () => {
    expect(withExtension('clip', '.mp4')).toBe('clip.mp4');
  });

  it('only the LAST dot is the extension', () => {
    expect(withExtension('my.holiday.video.mov', '.mp4')).toBe('my.holiday.video.mp4');
  });

  it('a leading dot is part of the name, not an extension', () => {
    /* `.hidden` is a whole filename; slicing at index 0 would leave an empty
       stem and produce `.mp4`, silently losing the name. */
    expect(withExtension('.hidden', '.mp4')).toBe('.hidden.mp4');
  });
});
