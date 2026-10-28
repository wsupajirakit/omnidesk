/**
 * [FEAT-20260904-OBJVIDEO] Encoder backend #1 — canvas + MediaRecorder.
 * ===========================================================================
 * WHY THIS ENGINE FIRST. The server accepts `.mp4` only (`omnidesk-api`'s
 * `VIDEO_MIME`), and a raw `VideoEncoder` from WebCodecs emits an H.264
 * ELEMENTARY STREAM, not a container — using it means shipping a muxer. This
 * engine asks the browser to mux, so it costs **zero dependencies** and its
 * whole surface is the file you are reading. No dependency means no debt.
 *
 * ⚠️ AND ITS COST IS HONEST: IT RUNS IN REAL TIME. The clip is played through a
 * canvas and recorded, so a 40-second video takes ~40 seconds. That is the
 * trade for no dependency and no hand-written muxer. Only files between
 * `skipBelowBytes` (5 MB) and the 50 MB cap ever reach it, which in practice is
 * seconds to a couple of minutes. When that stops being acceptable, add a
 * WebCodecs + mp4-muxer backend ABOVE this one in `encoderRegistry.ts` — this
 * file does not need to change or be deleted for that to work.
 *
 * 🔴 WHAT IT REFUSES TO DO, which is the point of the whole feature:
 *   · no mp4 support in MediaRecorder → `isSupported()` is false. It will NOT
 *     hand back a WebM the upload route would then refuse.
 *   · no `captureStream` on the media element → false, because audio could not
 *     be carried and silently dropping a clip's sound is exactly the kind of
 *     quiet degradation this feature exists to avoid: audio must not vanish.
 *   · anything unexpected mid-encode → `null`, and the original is uploaded.
 *
 * revert: remove the entry from `VIDEO_ENCODERS` in `encoderRegistry.ts`; with
 * an empty registry `selectVideoEncoder` returns null and uploads send the
 * original bytes, which is the pre-encoder behaviour exactly.
 */
import {
  withExtension,
  type VideoEncodeRequest,
  type VideoEncoderBackend,
} from './encoderBackend';

/**
 * mp4 recording profiles, best first. The first one the browser admits to is
 * used. Both are H.264 baseline + AAC — the pair every target player handles,
 * and what LINE accepts. Adding a profile is one line.
 */
const MP4_PROFILES: readonly string[] = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4',
];

/** Canvas capture rate. 30 is the ceiling, not a promise — `captureStream`
 *  emits a frame only when one was drawn, so a 24 fps source stays 24 fps. */
const CAPTURE_FPS = 30;

/** Flush a chunk this often so a long clip does not sit in one giant buffer. */
const RECORDER_TIMESLICE_MS = 1_000;

/**
 * Hard ceiling on a single encode, in ms.
 *
 * 🔴 A STUCK DECODE MUST NOT EAT THE UPLOAD. `ended` is not guaranteed to fire
 * — a corrupt moov atom, a stream whose duration is Infinity, a tab throttled
 * in the background all end with the promise simply never settling. This bounds
 * it: the recorder is stopped, the partial result is DISCARDED (a truncated
 * video is worse than an un-shrunk one), and the original is uploaded.
 * 10 minutes is far past any 50 MB clip and is not meant to be reached.
 */
const ENCODE_TIMEOUT_MS = 10 * 60 * 1_000;

/** The first mp4 profile this browser will actually record, or null. */
function pickMp4Profile(): string | null {
  const Recorder = globalThis.MediaRecorder;
  if (typeof Recorder?.isTypeSupported !== 'function') return null;
  return MP4_PROFILES.find((p) => Recorder.isTypeSupported(p)) ?? null;
}

/** Does this browser expose element capture? Needed to carry the audio track. */
function canCaptureElement(): boolean {
  return (
    typeof document !== 'undefined' &&
    typeof document.createElement === 'function' &&
    typeof (
      document.createElement('video') as HTMLVideoElement & {
        captureStream?: unknown;
      }
    ).captureStream === 'function'
  );
}

/**
 * Even width for the target height, preserving aspect ratio.
 *
 * ⚠️ H.264 4:2:0 chroma subsampling requires EVEN dimensions; an odd width makes
 * encoders either refuse or pad, and padding shows as a green edge column.
 * `height` arrives from the rule, which only ever yields even numbers (720, or
 * the source height) — rounding here covers the second case.
 */
function evenWidthFor(video: HTMLVideoElement, height: number): number {
  const ratio = video.videoWidth / video.videoHeight;
  return Math.max(2, Math.round((height * ratio) / 2) * 2);
}

/** Resolve on the first of these events; never reject. */
function firstEvent(el: HTMLVideoElement, names: readonly string[]): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      names.forEach((n) => el.removeEventListener(n, done));
      resolve();
    };
    names.forEach((n) => el.addEventListener(n, done, { once: true }));
  });
}

/**
 * Copy frames from the playing element onto the canvas until playback ends.
 *
 * Uses `requestVideoFrameCallback` when present — it fires once per DECODED
 * frame, so nothing is duplicated or missed — and falls back to the animation
 * frame clock, which is good enough because `captureStream` samples the canvas
 * rather than the callback.
 */
function pumpFrames(
  video: HTMLVideoElement,
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  const withRvfc = video as HTMLVideoElement & {
    requestVideoFrameCallback?: (cb: () => void) => number;
  };
  const draw = (): void => {
    if (video.ended || video.paused) return;
    ctx.drawImage(video, 0, 0, width, height);
    if (typeof withRvfc.requestVideoFrameCallback === 'function') {
      withRvfc.requestVideoFrameCallback(draw);
    } else {
      requestAnimationFrame(draw);
    }
  };
  draw();
}

export const mediaRecorderEncoder: VideoEncoderBackend = {
  id: 'media-recorder-mp4',

  isSupported(): boolean {
    return pickMp4Profile() !== null && canCaptureElement();
  },

  async encode({ file, height, bitrate }: VideoEncodeRequest): Promise<File | null> {
    const mimeType = pickMp4Profile();
    if (!mimeType) return null;

    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    let recorder: MediaRecorder | null = null;
    let captured: MediaStream | null = null;

    try {
      /* Muted so the admin's speakers stay quiet. `captureStream` still carries
         the audio TRACK — `muted` is about output routing, not the track — so
         the encode keeps the sound. */
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.src = url;

      await firstEvent(video, ['loadedmetadata', 'error']);
      if (!video.videoWidth || !video.videoHeight) return null;

      const outHeight = Math.max(2, Math.round(height / 2) * 2);
      const outWidth = evenWidthFor(video, outHeight);

      const canvas = document.createElement('canvas');
      canvas.width = outWidth;
      canvas.height = outHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      const stream = canvas.captureStream(CAPTURE_FPS);
      /* Carry the source's audio, if it has any. A clip with no audio track
         yields none here and records video-only, which loses nothing. */
      captured = (
        video as HTMLVideoElement & { captureStream: () => MediaStream }
      ).captureStream();
      captured.getAudioTracks().forEach((track) => stream.addTrack(track));

      const chunks: Blob[] = [];
      recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: bitrate,
      });
      recorder.ondataavailable = (e): void => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      const stopped = new Promise<void>((resolve) => {
        if (recorder) recorder.onstop = (): void => resolve();
      });

      recorder.start(RECORDER_TIMESLICE_MS);
      await video.play();
      pumpFrames(video, ctx, outWidth, outHeight);

      /* Whichever comes first: the clip finished, or the ceiling was hit. */
      const finished = await Promise.race([
        firstEvent(video, ['ended', 'error']).then(() => true),
        new Promise<boolean>((r) => setTimeout(() => r(false), ENCODE_TIMEOUT_MS)),
      ]);

      recorder.stop();
      await stopped;

      /* 🔴 A TIMEOUT DISCARDS THE BYTES. Half a clip that claims to be the
         whole clip is the worst possible outcome here. */
      if (!finished || chunks.length === 0) return null;

      return new File([new Blob(chunks, { type: 'video/mp4' })], withExtension(file.name, '.mp4'), {
        type: 'video/mp4',
        lastModified: Date.now(),
      });
    } catch {
      return null;
    } finally {
      /* Order matters: stop the tracks before dropping the element, or Chrome
         keeps the decoder alive and the tab leaks one per attempt. */
      captured?.getTracks().forEach((t) => t.stop());
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      video.pause();
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
    }
  },
};
