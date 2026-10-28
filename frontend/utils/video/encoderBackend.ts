/**
 * [FEAT-20260904-OBJVIDEO] The video-encoder CONTRACT — one seam, many backends.
 * ===========================================================================
 * WHY THIS FILE EXISTS AT ALL. `videoDownscale.ts` decides WHETHER and HOW FAR
 * to shrink; it must never also decide WITH WHAT. Owner, 04/09: the encoder has
 * to be independent, switchable on and off, replaceable, and able to grow —
 * It must be switchable on, off and out, and able to scale, without debt.
 * A concrete encoder wired
 * straight into the rule would make every one of those a rewrite.
 *
 * So the rule talks to THIS interface and nothing else. Adding a second engine
 * (a WebCodecs + mp4-muxer pipeline, a WASM transcoder) is a NEW FILE plus one
 * line in `encoderRegistry.ts` — the rule, the caller and the tests do not move.
 *
 * 🔴 THE HARD REQUIREMENT ON EVERY BACKEND: it returns `null` rather than
 * anything it is not sure about. `null` travels up as `encode-failed` and the
 * ORIGINAL bytes are uploaded. A backend that returns a file it silently
 * degraded — audio dropped, container swapped, duration truncated — breaks the
 * one promise this feature was built on. If it cannot shrink, return null —
 * never a damaged file.
 *
 * ⚠️ AND THE OUTPUT MUST BE SOMETHING THE SERVER ACCEPTS. `omnidesk-api`'s
 * `VIDEO_MIME` table holds `.mp4` alone, so a backend that can only emit WebM
 * must answer `false` from `isSupported()`. Producing a file the upload route
 * then refuses is worse than not encoding at all: the admin waits, and then
 * fails.
 *
 * revert: delete this folder (`utils/video/`) and restore the `return null`
 * body of `encodeToHeight` in `utils/videoDownscale.ts`. Uploads go back to
 * sending original bytes, which the 50 MB server cap still bounds.
 */

/** Everything a backend needs. Deliberately numbers and a File — no config
 *  object, so a backend can never read a knob the rule did not hand it. */
export interface VideoEncodeRequest {
  /** The source file, already known to be a container the rule handles. */
  file: File;
  /** Target height in pixels. Width is the backend's job to derive from the
   *  source aspect ratio — the rule never dictates width. */
  height: number;
  /** Target video bitrate, bits per second. */
  bitrate: number;
}

/**
 * One engine that can re-encode a video in this browser.
 *
 * Implement all three members. `id` is what `encoderRegistry`'s order and
 * disable lists refer to, so it is part of the public surface: renaming one
 * silently changes which engine runs: the id is the key the config refers to.
 */
export interface VideoEncoderBackend {
  /** Stable, kebab-case, unique across the registry. */
  readonly id: string;

  /**
   * Can this engine run HERE, right now, and produce a server-accepted file?
   *
   * Must be cheap and synchronous — the registry calls it to choose, and the
   * upload path calls it to decide whether to promise a shrink at all. Check
   * the real capability (an API's presence AND the codec support), never the
   * user agent string. Test the capability; never infer it from the UA.
   */
  isSupported(): boolean;

  /**
   * Produce a smaller file, or `null`.
   *
   * MUST NOT THROW — a rejected promise is treated as `null` by the registry,
   * but a backend that leaks an exception has also probably leaked an object
   * URL or a MediaStream track. Clean up in a `finally` and return `null`.
   *
   * Returning a file LARGER than the source is allowed here; the caller
   * (`downscaleVideoFile`) is what compares sizes and keeps the original. That
   * check lives in one place on purpose.
   */
  encode(request: VideoEncodeRequest): Promise<File | null>;
}

/**
 * Force a filename onto the container we actually produced.
 *
 * Shared because EVERY backend needs it and every backend would otherwise
 * hand-roll it slightly differently. The server keys its allowlist on the
 * extension, so `clip.mov` re-encoded to mp4 must arrive as `clip.mp4` or the
 * upload filter refuses a file that is genuinely fine.
 *
 * A name with no dot, or a dot only in a directory-ish prefix, simply gains the
 * extension. It must match the real container, or the server refuses a file
 * that is actually fine.
 */
export function withExtension(name: string, extension: string): string {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return `${stem}${extension}`;
}
