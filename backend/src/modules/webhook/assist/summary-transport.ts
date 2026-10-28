/**
 * [FEAT-20260813-WRAPAI-W2] SummaryTransport — the vendor seam of the assist-
 * summary funnel. Mirrors `reply-transport.ts` for the summary path.
 *
 * A transport does ONE vendor-specific thing: turn a neutral `SummaryCall` into a
 * `SummaryTransportResult` (raw text + status). It does NOT parse the JSON or pick
 * the fallback string — that is domain, owned by the shared `summary-interpreter`,
 * so a second vendor implements only the call, not the interpretation.
 *
 * ⭐ THE DEEPSEEK INSERTION POINT (summary side): add a class implementing this
 *    interface, register it in `summary-transport.registry.ts` — one file + one
 *    line, exactly like the reply side.
 *
 * revert: delete this file + every transport that implements it + the registry.
 */
import type { SummaryCall, SummaryTransportResult } from './summary-neutral';

/** One vendor's summary call. The only thing a new vendor must implement. */
export interface SummaryTransport {
  send(call: SummaryCall): Promise<SummaryTransportResult>;
}

/**
 * The registry shape — provider name → transport. Keyed by `hook.ai_vendor`
 * values once the master plan's P2 introduces that field; the key is DATA, not a
 * branch. Same registry pattern the reply path uses.
 */
export type SummaryTransportRegistry = Record<string, SummaryTransport>;
