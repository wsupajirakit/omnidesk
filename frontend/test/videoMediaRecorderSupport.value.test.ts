/**
 * [FEAT-20260904-OBJVIDEO] The MediaRecorder backend's OWN support rule.
 * ===========================================================================
 * WHY THIS FILE EXISTS — a mutation survived without it. `videoEncoderRegistry
 * .value.test.ts` proves the switchboard with fake engines, and its one real-
 * engine case asserts `isSupported() === false` under jsdom. That case passes
 * for the WRONG reason: jsdom has neither MediaRecorder nor element capture, so
 * deleting the `&& canCaptureElement()` half of the rule changes nothing and the
 * suite stays green. Confirmed by mutation on 04/09.
 *
 * The half that was unguarded is the one the backend file calls the point of the
 * feature: a browser that can record mp4 but cannot capture the media element
 * must be refused, because the audio track would be dropped and the admin would
 * get a silent clip back with no warning. A test that passes for another
 * reason measures nothing.
 *
 * These cases DRIVE the two capabilities independently, which is the only way
 * either half of the `&&` can be shown to matter.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

import { mediaRecorderEncoder } from '../utils/video/mediaRecorderEncoder';

/** A MediaRecorder stand-in that admits to exactly the types listed. */
const recorderSupporting = (types: readonly string[]): unknown => {
  const ctor = function (): void {
    /* never constructed here — only `isTypeSupported` is read */
  };
  (ctor as unknown as { isTypeSupported: (t: string) => boolean }).isTypeSupported = (
    t: string,
  ): boolean => types.some((known) => t.startsWith(known));
  return ctor;
};

/**
 * Element capture is decided per PROTOTYPE, because the backend asks a freshly
 * created <video>. jsdom ships none, so adding it is what simulates Chrome.
 */
const setElementCapture = (present: boolean): void => {
  const proto = globalThis.HTMLVideoElement.prototype as unknown as Record<string, unknown>;
  if (present) proto.captureStream = (): void => undefined;
  else delete proto.captureStream;
};

afterEach(() => {
  vi.unstubAllGlobals();
  setElementCapture(false);
});

describe('[OBJVIDEO] mediaRecorderEncoder.isSupported — both halves must hold', () => {
  it('🔴 mp4 is recordable but the element cannot be captured ⇒ NOT supported', () => {
    /* 🔴 MUTATION KILLER. This is the case jsdom could never reach: without the
       `canCaptureElement()` half the answer flips to true, the engine runs, and
       the clip comes back with its audio silently gone. */
    vi.stubGlobal('MediaRecorder', recorderSupporting(['video/mp4']));
    setElementCapture(false);
    expect(mediaRecorderEncoder.isSupported()).toBe(false);
  });

  it('🔴 the element can be captured but mp4 is not recordable ⇒ NOT supported', () => {
    /* 🔴 MUTATION KILLER for the other half. A WebM-only browser (Firefox) must
       be refused rather than handed back a container the upload route rejects. */
    vi.stubGlobal('MediaRecorder', recorderSupporting(['video/webm']));
    setElementCapture(true);
    expect(mediaRecorderEncoder.isSupported()).toBe(false);
  });

  it('both capabilities present ⇒ supported', () => {
    /* Without this case the rule could be a constant `false` and every other
       case here would still pass. */
    vi.stubGlobal('MediaRecorder', recorderSupporting(['video/mp4']));
    setElementCapture(true);
    expect(mediaRecorderEncoder.isSupported()).toBe(true);
  });

  it('no MediaRecorder at all ⇒ NOT supported, and never a throw', () => {
    /* Safari/older browsers: reading `isTypeSupported` off `undefined` must not
       become an exception, because `selectVideoEncoder` calls this while picking
       an engine and a throw there would cost the upload entirely. */
    vi.stubGlobal('MediaRecorder', undefined);
    setElementCapture(true);
    expect(() => mediaRecorderEncoder.isSupported()).not.toThrow();
    expect(mediaRecorderEncoder.isSupported()).toBe(false);
  });

  it('a MediaRecorder without isTypeSupported ⇒ NOT supported', () => {
    /* The API exists but the capability query does not — answering "yes" here
       would run an engine whose output container is unknown. */
    vi.stubGlobal('MediaRecorder', function (): void {});
    setElementCapture(true);
    expect(mediaRecorderEncoder.isSupported()).toBe(false);
  });
});
