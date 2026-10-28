/**
 * [FEAT-20260813-WRAPAI-W1] ReplyTransport — the vendor seam, ⭐ the DeepSeek
 * insertion point, born here (not retrofitted).
 *
 * A transport is the ONLY thing that knows a vendor. It takes a vendor-free
 * `NeutralReplyCall`, turns it into that vendor's request, fires it, and returns
 * a vendor-free `TransportResult`. Everything before it (assembler) and after it
 * (interpreter) is vendor-blind.
 *
 * OWNER REQUIREMENT (12 Aug): "จุดใส่ deepseek ต้องง่าย ชัดเจน ออกแบบเผื่อตอนนี้
 * ไม่ใช่ hard gemini". Honoured by construction:
 *   · adding a vendor = ONE new file implementing `ReplyTransport` + ONE registry
 *     line in `REPLY_TRANSPORTS`. Zero edits to assembler, interpreter, provider
 *     logic, webhook, FE or DB.
 *   · the word "gemini"/"deepseek" may appear ONLY inside that vendor's own
 *     transport file — grep-gated in review. The interface, the result type and
 *     the registry KEYS are vendor-free (a `'gemini'` key is data, not coupling).
 *   · selection is a constant today; the master plan's P2 later feeds
 *     `hook.ai_vendor` into the SAME lookup line — no second code path is kept
 *     alive meanwhile, so no feature-flag debt.
 *
 * revert: delete this file + the transport implementations; nothing imports them
 *         until W1d switches the provider.
 */

import type { NeutralReplyCall } from './reply-neutral';

/**
 * What a transport returns — vendor-free numbers and the raw text, nothing the
 * interpreter has to understand per-vendor.
 */
export interface TransportResult {
  /** The model's raw answer, or undefined when the vendor produced no text. */
  rawText: string | undefined;
  /** HTTP status of the (final) call; a vendor error maps to its own code here. */
  httpStatus: number;
  /** The raw provider payload, opaque — only for the webhook log. */
  raw: unknown;
  /** Error text when the call failed at the vendor, else null. */
  errorMessage: string | null;
}

/** One vendor's request/response translation. Implemented per vendor, nowhere else. */
export interface ReplyTransport {
  send(call: NeutralReplyCall): Promise<TransportResult>;
}

/**
 * The registry — data, not branching. A vendor key maps to its transport.
 *
 * ⚠️ Populated in `reply-transport.registry.ts` to keep this interface file free
 *    of any vendor import. The lookup that selects one lives in the provider:
 *    `REPLY_TRANSPORTS[provider]`, where `provider` is `hook.ai_vendor`.
 *
 * ⚠️ [FIX-20260908-STALECOMMENT] This used to say `provider` is "a constant
 *    `'gemini'` today and `hook.ai_vendor` after the master plan's P2". P2 landed;
 *    the constant is only the FALLBACK for an absent or unknown name.
 */
export type ReplyTransportRegistry = Record<string, ReplyTransport>;
