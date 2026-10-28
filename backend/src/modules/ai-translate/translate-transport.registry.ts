/**
 * [FEAT-20260818-TRANSLATE] The translate transport registry — the one place a
 * vendor is wired into the translate path. Mirrors
 * `summary-transport.registry.ts` line for line.
 *
 * ⭐ ADD A VENDOR HERE, AND NOWHERE ELSE.
 * revert: delete with the funnel folder.
 */
import { DeepSeekTranslateTransport } from './vendors/deepseek-translate.transport';
import { GeminiTranslateTransport } from './vendors/gemini-translate.transport';
import type { TranslateTransportRegistry } from './translate-transport';

/** Registry keyed by provider name. The key is DATA (matches `hook.ai_vendor`). */
export const TRANSLATE_TRANSPORTS: TranslateTransportRegistry = {
  gemini: new GeminiTranslateTransport(),
  deepseek: new DeepSeekTranslateTransport(),
};

/** Default provider — the same family every other funnel defaults to. */
export const DEFAULT_TRANSLATE_PROVIDER = 'gemini';

/**
 * Look up the transport for a provider name. Absent/unknown falls back to the
 * default — an unknown vendor value must never break the ticket page.
 */
export function resolveTranslateTransport(provider?: string | null) {
  return (
    TRANSLATE_TRANSPORTS[provider ?? DEFAULT_TRANSLATE_PROVIDER] ??
    TRANSLATE_TRANSPORTS[DEFAULT_TRANSLATE_PROVIDER]!
  );
}
