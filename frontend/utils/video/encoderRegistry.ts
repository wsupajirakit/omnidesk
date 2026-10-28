/**
 * [FEAT-20260904-OBJVIDEO] Which encoder runs — the switchboard.
 * ===========================================================================
 * This is the switchable-and-scalable half of the owner's 04/09
 * instruction, and it is deliberately a few lines of arithmetic over a list so
 * that all four of those verbs are configuration rather than code:
 *
 *   turn everything off → `VIDEO_ENCODER_CONFIG.enabled = false`
 *   drop one engine     → add its id to `disabled`
 *   change preference   → put ids in `order`
 *   add an engine       → one import + one entry in `VIDEO_ENCODERS`
 *
 * Nothing outside this file knows an engine exists. `videoDownscale.ts` asks
 * for "an encoder" and gets whichever one is enabled and supported here.
 *
 * 🔴 `selectVideoEncoder` IS PURE — it takes the list and the config as
 * arguments. That is what lets the whole selection contract be tested with fake
 * backends, in Node, with no browser and no codec. The defaults exist so the
 * production call site can stay a bare `selectVideoEncoder()`.
 *
 * ⚠️ NO FALLBACK CHAIN, ON PURPOSE. Exactly one backend is chosen — the first
 * enabled one that reports support — and if its `encode` fails the ORIGINAL is
 * uploaded. Trying the next engine after a failure would double the admin's
 * wait for a file that is already known to upload fine as-is.
 *
 * revert: delete this file with the rest of `utils/video/`.
 */
import type { VideoEncoderBackend, VideoEncodeRequest } from './encoderBackend';
import { mediaRecorderEncoder } from './mediaRecorderEncoder';

/**
 * Every engine this build knows about, in default preference order.
 *
 * 🔴 ADDING ONE IS THIS LINE AND NOTHING ELSE. Write the backend file, import
 * it, put it in the array. Do not touch `videoDownscale.ts` — if a new engine
 * needs the rule to change, the contract in `encoderBackend.ts` is wrong and
 * that is the thing to fix. Adding an engine is one line.
 *
 * Today there is one: MediaRecorder, because it muxes mp4 itself and therefore
 * costs zero dependencies. A WebCodecs + mp4-muxer engine would slot in ABOVE
 * it (it is many times faster) without this file's logic changing at all.
 */
export const VIDEO_ENCODERS: readonly VideoEncoderBackend[] = [
  mediaRecorderEncoder,
];

/** The knobs. This object is the entire runtime control surface. */
export interface VideoEncoderConfig {
  /**
   * The master switch. `false` means no video is ever re-encoded in the
   * browser — uploads send original bytes and the 50 MB server cap is the only
   * ceiling, which is exactly the behaviour that shipped before any encoder
   * existed. So this is also the one-line revert.
   */
  enabled: boolean;
  /**
   * Preferred ids, best first. Ids not listed keep their `VIDEO_ENCODERS`
   * order behind the listed ones; an id here that matches nothing is ignored
   * rather than an error, so a stale entry cannot disable encoding by accident.
   */
  order: readonly string[];
  /** Ids that must never be chosen, whatever `order` says. */
  disabled: readonly string[];
}

export const VIDEO_ENCODER_CONFIG: VideoEncoderConfig = {
  enabled: true,
  order: [],
  disabled: [],
};

/**
 * Pick the engine that will run, or `null` when none can.
 *
 * The order of the checks is the contract:
 *   0. switched off      → null (nothing below is consulted)
 *   1. explicitly disabled → dropped from the candidates
 *   2. `order` first, then registration order for everything else
 *   3. the first candidate whose `isSupported()` is true wins
 *
 * `null` is a normal answer, not an error: Firefox and Safari legitimately
 * reach it, and the caller reports `no-encoder` and uploads the original.
 */
export function selectVideoEncoder(
  backends: readonly VideoEncoderBackend[] = VIDEO_ENCODERS,
  cfg: VideoEncoderConfig = VIDEO_ENCODER_CONFIG,
): VideoEncoderBackend | null {
  if (!cfg.enabled) return null;

  const allowed = backends.filter((b) => !cfg.disabled.includes(b.id));
  /* Listed ids first in the order given; the rest keep registration order.
     A stale id in `order` matches nothing and simply contributes nobody. */
  const preferred = cfg.order
    .map((id) => allowed.find((b) => b.id === id))
    .filter((b): b is VideoEncoderBackend => b !== undefined);
  const rest = allowed.filter((b) => !preferred.includes(b));

  return [...preferred, ...rest].find((b) => b.isSupported()) ?? null;
}

/**
 * Run the selected engine.
 *
 * ⚠️ SWALLOWS THE THROW ON PURPOSE. A backend is contractually not supposed to
 * throw, but a browser API that changes under us must not cost the admin the
 * upload — the failure becomes `null`, which the caller reports honestly as
 * `encode-failed` while sending the original file.
 */
export async function encodeVideo(
  request: VideoEncodeRequest,
  backends: readonly VideoEncoderBackend[] = VIDEO_ENCODERS,
  cfg: VideoEncoderConfig = VIDEO_ENCODER_CONFIG,
): Promise<File | null> {
  const backend = selectVideoEncoder(backends, cfg);
  if (!backend) return null;
  try {
    return await backend.encode(request);
  } catch {
    return null;
  }
}
