/**
 * [FEAT-20260813-WRAPAI-W1] The reply transport registry — the one place a
 * vendor is wired in.
 *
 * ⭐ ADD A VENDOR HERE, AND NOWHERE ELSE:
 *     import { DeepSeekReplyTransport } from '../ai-vendors/deepseek/deepseek-reply.transport';
 *     export const REPLY_TRANSPORTS = {
 *       gemini: new GeminiReplyTransport(),
 *       deepseek: new DeepSeekReplyTransport(),   // ← the whole change
 *     };
 *
 * This file is deliberately the ONLY vendor-aware wiring point. The interface
 * (`reply-transport.ts`), the assembler and the interpreter never import a
 * transport, so a new vendor cannot leak past this line.
 *
 * revert: delete this file + the transport it names.
 */

import {
  DEEPSEEK_CHAT_URL,
  DeepSeekReplyTransport,
} from '../ai-vendors/deepseek/deepseek-reply.transport';
import {
  GeminiReplyTransport,
  geminiReplyEndpoint,
} from '../ai-vendors/gemini/gemini-reply.transport';
import type { ReplyTransportRegistry } from './reply-transport';

/**
 * Registry keyed by provider name. The key is DATA (matches `hook.ai_vendor`
 * values once the master plan's P2 introduces that field); it is not a branch.
 */
export const REPLY_TRANSPORTS: ReplyTransportRegistry = {
  gemini: new GeminiReplyTransport(),
  // [P2-20260813] Vendor #2. Registering it changes NOTHING on its own: both
  // providers still call resolveReplyTransport() with no argument, so every
  // request keeps resolving to the default. It becomes reachable only when
  // hook.ai_vendor is threaded in (plan T09/T10, after the DB approval).
  deepseek: new DeepSeekReplyTransport(),
};

/** Default provider until per-hook selection (master plan P2) is wired. */
export const DEFAULT_REPLY_PROVIDER = 'gemini';

/**
 * Look up the transport for a provider name. Falls back to the default when the
 * name is absent/unknown — an unknown provider must never break the reply path.
 * This is the single line the provider (W1d) calls.
 *
 * ⚠️ [FIX-20260908-STALECOMMENT] This used to say "P2 later passes `hook.ai_vendor`
 *    here instead of the constant". **It already does** — see
 *    `gemini-reply.provider.ts`, which calls `resolveReplyTransport(request.aiVendor)`
 *    with the value read off the hook row. The sentence survived P2 and left the
 *    file claiming the opposite of what the code does.
 */
export function resolveReplyTransport(provider?: string | null) {
  return (
    REPLY_TRANSPORTS[provider ?? DEFAULT_REPLY_PROVIDER] ??
    REPLY_TRANSPORTS[DEFAULT_REPLY_PROVIDER]!
  );
}

/**
 * [FIX-20260816-WLOGVENDOR] The NAME of the vendor `resolveReplyTransport`
 * would pick — i.e. which vendor actually answers, not what the hook asked for.
 *
 * ⚠️ These differ, and the difference is the whole point. `hook.ai_vendor` is
 *    free text: a typo ('deepsek') resolves to the DEFAULT transport, so the
 *    request goes to Gemini. An audit row that echoed the raw hook field would
 *    name a vendor that never ran — trading one wrong label for another.
 *    Reading the registry keeps the log honest by construction.
 *    ค่าที่ hook เขียนไว้ ≠ ค่ายที่ตอบจริง — ต้องถาม registry เท่านั้น
 *
 * revert: delete this function and its two callers (the audit label).
 */
export function resolveReplyVendorName(provider?: string | null): string {
  const key = provider ?? DEFAULT_REPLY_PROVIDER;
  return REPLY_TRANSPORTS[key] ? key : DEFAULT_REPLY_PROVIDER;
}

/**
 * [FIX-20260816-WLOGVENDOR] The endpoint LABEL for an audit row, per vendor.
 *
 * Keyed exactly like `REPLY_TRANSPORTS`, so adding vendor #3 stays "one
 * transport + one registry line" — the label cannot be forgotten in a second
 * file. Each entry delegates to the vendor's own URL builder, so the label and
 * the real request can never drift apart.
 *
 * ⚠️ [FEAT-20260908-GEMINIKEYHEADER] NO LABEL CARRIES A KEY ANY MORE, masked or
 *    otherwise. This used to warn that `maskedKey` must be pre-masked because
 *    Gemini's key rode the query string and this string is persisted to
 *    `webhook_logs`. Gemini now sends its key in the `x-goog-api-key` header,
 *    exactly like DeepSeek's bearer token, so both labels are bare URLs and the
 *    parameter was removed rather than left to rot.
 *
 *    The masked key is NOT lost from the audit trail — it has always had its own
 *    column, `gemini_api_key_mask` (`request-credentials.ts:196`).
 *    ป้ายที่ลง DB ไม่มีคีย์อีกแล้ว ทั้งแบบ mask และไม่ mask
 */
const REPLY_ENDPOINT_LABELS: Record<
  string,
  (modelId: string | null | undefined) => string
> = {
  gemini: (modelId) => geminiReplyEndpoint(modelId),
  // The model rides in the JSON body, not the URL, so the label is the bare URL.
  deepseek: () => DEEPSEEK_CHAT_URL,
};

/** The audit label for the vendor that answered. Falls back like the registry. */
export function describeReplyEndpoint(
  provider: string | null | undefined,
  modelId: string | null | undefined,
): string {
  const vendor = resolveReplyVendorName(provider);
  const label =
    REPLY_ENDPOINT_LABELS[vendor] ??
    REPLY_ENDPOINT_LABELS[DEFAULT_REPLY_PROVIDER]!;
  return label(modelId);
}
