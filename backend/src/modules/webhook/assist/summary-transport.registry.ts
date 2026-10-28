/**
 * [FEAT-20260813-WRAPAI-W2] The summary transport registry — the one place a
 * vendor is wired into the assist-summary path. Mirrors
 * `reply-transport.registry.ts`.
 *
 * ⭐ ADD A VENDOR HERE, AND NOWHERE ELSE:
 *     import { DeepSeekSummaryTransport } from '../ai-vendors/deepseek/deepseek-summary.transport';
 *     export const SUMMARY_TRANSPORTS = {
 *       gemini: new GeminiSummaryTransport(),
 *       deepseek: new DeepSeekSummaryTransport(),   // ← the whole change
 *     };
 *
 * The interface, the neutral types, and the interpreter never import a transport,
 * so a new summary vendor cannot leak past this line. Same key convention as the
 * reply registry.
 *
 * ⚠️ [FIX-20260908-STALECOMMENT] This used to end "…selects here once master-plan
 *    P2 lands", which was read as "the DeepSeek entry is unreachable". **P2 landed.**
 *    `hook.ai_vendor` is threaded from the hook row through
 *    `request-credentials.ts` → `assist-turn-args.ts` → `assist-notification.ts` →
 *    `assist-summary.provider.ts` and arrives at `resolveSummaryTransport` below.
 *    A hook set to `deepseek` really does reach api.deepseek.com;
 *    `wrap-ai-p2a-thread.spec.ts` pins it with a spied axios.
 *
 * revert: delete this file + the transport it names.
 */

import { DeepSeekSummaryTransport } from '../ai-vendors/deepseek/deepseek-summary.transport';
import { GeminiSummaryTransport } from '../ai-vendors/gemini/gemini-summary.transport';
import type { SummaryTransportRegistry } from './summary-transport';

/** Registry keyed by provider name. The key is DATA (matches `hook.ai_vendor`). */
export const SUMMARY_TRANSPORTS: SummaryTransportRegistry = {
  gemini: new GeminiSummaryTransport(),
  // [P2-20260813] Vendor #2 — same note as the reply registry: unreachable
  // until hook.ai_vendor is threaded through (T09/T10).
  deepseek: new DeepSeekSummaryTransport(),
};

/** Default provider until per-hook selection (master plan P2) is wired. */
export const DEFAULT_SUMMARY_PROVIDER = 'gemini';

/**
 * Look up the transport for a provider name. Falls back to the default when the
 * name is absent/unknown — an unknown provider must never break the assist path.
 * This is the single line the provider (W2c) calls.
 */
export function resolveSummaryTransport(provider?: string | null) {
  return (
    SUMMARY_TRANSPORTS[provider ?? DEFAULT_SUMMARY_PROVIDER] ??
    SUMMARY_TRANSPORTS[DEFAULT_SUMMARY_PROVIDER]!
  );
}
