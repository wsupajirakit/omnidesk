/**
 * [FEAT-20260818-TRANSLATE] The translate interpreter — turns a neutral
 * transport result into either the translated text or a typed refusal.
 * Mirrors the role `summary-interpreter.ts` plays for consumer #2.
 *
 * Deliberately tiny: translation has no JSON to unwrap and no category to
 * extract. What it DOES own, so no vendor copy can drift:
 *  · an errored call and an empty answer are DIFFERENT failures with different
 *    messages — an admin retries an outage but rephrases an empty answer;
 *  · trimming — models close with a newline; the admin pastes this text.
 *
 * revert: delete with the funnel folder.
 */
import type { TranslateTransportResult } from './translate-neutral';
import {
  parseTranslateEnvelope,
  type TranslateEnvelope,
} from './translate-envelope';

/** Thrown when the vendor call failed or produced no usable text. */
export class TranslateFailedError extends Error {
  constructor(
    message: string,
    /** 'vendor_error' = call failed · 'empty' = 200 but no text came back. */
    public readonly reason: 'vendor_error' | 'empty',
    public readonly httpStatus: number,
  ) {
    super(message);
    this.name = 'TranslateFailedError';
  }
}

/**
 * [FEAT-20260910-DETECTSOURCE] returns the ENVELOPE now, not a bare string: the
 * translation plus the source language the model reported.
 *
 * ⚠️ The two failures below are unchanged and still owned here — the envelope
 *    parser never throws, so "vendor error" and "empty" keep meaning exactly
 *    what they meant. What changed is only how much of a SUCCESS is understood.
 */
export function interpretTranslateResult(
  result: TranslateTransportResult,
): TranslateEnvelope {
  if (result.errorMessage !== null) {
    throw new TranslateFailedError(
      `translate vendor call failed: ${result.errorMessage}`,
      'vendor_error',
      result.httpStatus,
    );
  }
  const text = (result.rawText ?? '').trim();
  if (!text) {
    throw new TranslateFailedError(
      'translate vendor returned no text',
      'empty',
      result.httpStatus,
    );
  }
  /* the trimmed reply is what the parser falls back to, so a model that ignores
     the format still yields exactly the string this function used to return */
  return parseTranslateEnvelope(text);
}
