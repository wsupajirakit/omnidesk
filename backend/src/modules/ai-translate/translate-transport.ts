/**
 * [FEAT-20260818-TRANSLATE] TranslateTransport — the vendor seam of the
 * ticket-translate funnel. Mirrors `summary-transport.ts` (consumer #2).
 *
 * A transport does ONE vendor-specific thing: turn a neutral `TranslateCall`
 * into a `TranslateTransportResult`. It never parses or falls back — the shared
 * interpreter owns that, so a second vendor implements only the call.
 *
 * ⭐ Adding a vendor = one file in `./vendors/` implementing this interface +
 *    one line in `translate-transport.registry.ts`. Nowhere else.
 *
 * revert: delete with the funnel folder.
 */
import type {
  TranslateCall,
  TranslateTransportResult,
} from './translate-neutral';

/** One vendor's translate call. The only thing a new vendor must implement. */
export interface TranslateTransport {
  send(call: TranslateCall): Promise<TranslateTransportResult>;
}

/** Registry shape — provider name → transport. The key is DATA (`hook.ai_vendor`). */
export type TranslateTransportRegistry = Record<string, TranslateTransport>;
