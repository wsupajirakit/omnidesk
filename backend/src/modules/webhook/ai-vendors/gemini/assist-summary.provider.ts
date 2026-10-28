/**
 * The assist-summary seam.
 *
 * The same rule as `ai-reply.provider.ts`, for the same reason: the one outbound
 * generative call on the assist path sits behind `AssistSummaryProvider.summarise`,
 * and nothing else does. Everything on this side — the room claim, the ticket, the
 * Telegram card, the flex-error override — runs without a model, so the whole
 * hand-off can be driven end to end in a test with a stubbed provider.
 *
 * Legacy calls `ragService.analyzeConversationForAdmin(...)` inline at
 * `webhookController.js:565-570`. That function exists here already, ported at
 * `rag-engine.service.ts:1745`, and it posts straight to
 * `generativelanguage.googleapis.com`. Calling it directly from the webhook would
 * mean the assist path bills a real account on every hand-off, with no seam a test
 * could stand in front of — so the call is routed through this interface instead.
 * The FIELDS and the return shape are legacy's, one for one; only the calling
 * convention changed.
 *
 * [FIX-20260808-ASSISTSUMMARYFIRE] `AI_ASSIST_SUMMARY_PROVIDER` is now chosen by
 * the SAME AI_PROVIDER × AI_CAP switch the reply seam uses (see
 * `selectAssistSummaryProvider` in webhook.module.ts). `AI_PROVIDER=real` fires the
 * real `RealAssistSummaryProvider`; `AI_PROVIDER=mock` binds the scripted
 * stand-in. This file mirrors `ai-reply.provider.ts` / `gemini-reply.provider.ts` /
 * `scripted-ai-reply.provider.ts` one for one — the only difference is the seam
 * method (`summarise` vs `generate`) and the request/response shapes. Owner
 * decision (2026-08-08): one flag, no separate AI_SUMMARY env — "real ยิงจริงหมด".
 *
 * `UnavailableAssistSummaryProvider` (below) is kept as the inert fallback for a
 * future off-mode, but is no longer the default binding.
 *
 * ── [FIX-20260908-SUMMARYNAME] THE CLASS WAS CALLED `GeminiAssistSummaryProvider`
 *    AND THAT NAME WAS A LIE ────────────────────────────────────────────────────
 * This class contains no Gemini-specific logic whatsoever. It resolves the
 * transport from the hook's own `ai_vendor` (`resolveSummaryTransport` below), so
 * a hook set to `deepseek` genuinely sends its assist summary to
 * api.deepseek.com — `summary-transport.registry.ts` registers a real DeepSeek
 * transport and `wrap-ai-p2a-thread.spec.ts` pins that the DeepSeek host is the
 * one contacted.
 *
 * 🔴 The old name did measurable harm rather than merely reading oddly: the
 *    logger is constructed from the class name, so a DeepSeek dispatch printed
 *    `[GeminiAssistSummaryProvider] [AI-REAL] assist-summary request` at the
 *    operator. Somebody debugging a DeepSeek OA would have read the vendor's name
 *    off that line and been wrong.
 *
 * The renamed class follows the axis the switch actually turns on — scripted vs
 * real — which is what the translate lane already names correctly
 * (`ScriptedTranslateProvider` / `RealTranslateProvider`).
 *
 * ⚠️ REMAINING DEBT, deliberately not fixed in the same change: the FILE still
 *    lives under `ai-vendors/gemini/`. Moving it is a wider diff (every importer,
 *    including specs) and belongs in its own commit, not riding on a rename.
 */

import { Injectable, Logger } from '@nestjs/common';

import { interpretSummary } from '../../assist/summary-interpreter';
import { resolveSummaryTransport } from '../../assist/summary-transport.registry';
import { resolveVendorKey } from '../resolve-vendor-key';

/** DI token — inject with `@Inject(AI_ASSIST_SUMMARY_PROVIDER)`. */
export const AI_ASSIST_SUMMARY_PROVIDER = Symbol('AI_ASSIST_SUMMARY_PROVIDER');

/** The four positional arguments of `analyzeConversationForAdmin`, named. */
export interface AssistSummaryRequest {
  /** Formatted prior turns, oldest first. Legacy `history`. */
  history: string;
  /** The customer's message that triggered the hand-off. Legacy `currentQuestion`. */
  currentQuestion: string;
  /** The bot's answer, marker already stripped. Legacy `currentAnswer`. */
  currentAnswer: string;
  /**
   * [FEAT-20260909-DSREASONING] The MAIN lane's reasoning choice. Optional, and
   * null for every OA that has not set it — the transport then attaches nothing.
   */
  reasoning?: {
    type: 'enabled' | 'disabled';
    effort?: 'low' | 'high' | 'max';
  } | null;
  /** The OA's key. Legacy passes `geminiApiKey` through unchanged. */
  geminiApiKey?: string;

  /**
   * [P2-20260813] The hook's vendor and model, so the summary path is per hook
   * like the reply path. Both nullable: the registry falls back on an unknown
   * vendor, and the transport applies its family default on a null model.
   *
   * ⚠️ The key field above is still named `geminiApiKey` — a vendor-flavoured
   *    name on a vendor-neutral port. Renaming it touches five call sites and
   *    is registered debt, not P2's business.
   */
  aiVendor?: string | null;
  aiModel?: string | null;
}

/**
 * What the summary turn produced.
 *
 * ⚠️ Legacy tolerates a non-object return here (`typeof aiResult === 'object'`
 *    at `:572`), in which case the whole value is the summary and the category is
 *    left at its default. The ported `analyzeConversationForAdmin` always returns
 *    the object, so this interface is the object shape — the string branch is
 *    handled by the caller for parity, not by the provider.
 */
export interface AssistSummaryResponse {
  /** One or two lines of Thai describing what the customer wants. */
  summary: string;
  /**
   * `'Collection'` | `'IT'` | `'Other'` — the model's own verdict.
   *
   * [NOTE-20260815-TICKETCATEGORY] ⚠️ ONLY `'Payment'` AND `'Other'` ARE IN USE
   * on tickets (owner-stated 15/08/2026, and confirmed against the live data:
   * 120 `Other`, 18 `Payment`, nothing else). `'Collection'` and `'IT'` are what
   * this MODEL may answer; nothing normalises the value on the way to
   * `tickets.category`, which is a bare String with no enum, so such an answer
   * would be stored verbatim. It has never happened.
   * See the note on `category` in `tickets/schemas/ticket.schema.ts`.
   * ใช้จริงแค่ Payment กับ Other — ค่าอื่นมาจากโมเดล ไม่ใช่การตัดสินใจของเรา.
   */
  category: string;
}

export interface AssistSummaryProvider {
  summarise(request: AssistSummaryRequest): Promise<AssistSummaryResponse>;
}

/** Thrown when no provider is bound. Caught by the assist flow, never propagated. */
export class AssistSummaryUnavailableError extends Error {
  constructor() {
    super('no assist summary provider is bound');
    this.name = 'AssistSummaryUnavailableError';
  }
}

/**
 * The default binding.
 *
 * Rejecting is not a degraded hand-off. Legacy's own AI failure path returns
 * "เกิดข้อผิดพลาดในการวิเคราะห์บทสนทนา" and carries on creating the ticket, so an
 * unavailable model here produces the same outcome legacy produces on a Gemini
 * outage: the operator gets the case, with a fallback summary instead of an
 * analysed one.
 */
export class UnavailableAssistSummaryProvider implements AssistSummaryProvider {
  summarise(): Promise<AssistSummaryResponse> {
    return Promise.reject(new AssistSummaryUnavailableError());
  }
}

/**
 * [FIX-20260808-ASSISTSUMMARYFIRE] Thrown when no usable key is available for the
 * real summary provider. Mirrors `GeminiKeyMissingError` in
 * `gemini-reply.provider.ts` — the summary seam refuses to call rather than fire
 * with an empty key, exactly as the reply seam does.
 */
export class AssistSummaryKeyMissingError extends Error {
  constructor() {
    super(
      'No AI key available for the real assist-summary provider. Neither the ' +
        'per-hook geminiApiKey nor GEMINI_TEST_KEY/GEMINI_API_KEY is set. ' +
        'Refusing to call.',
    );
    this.name = 'AssistSummaryKeyMissingError';
  }
}

/**
 * [FIX-20260808-ASSISTSUMMARYFIRE] The REAL assist-summary provider — the mirror
 * of `GeminiReplyProvider` for the summary seam. It wraps the one outbound call
 * (`RagEngineService.analyzeConversationForAdmin`, ported at
 * rag-engine.service.ts:1745) that the assist path used to make inline in legacy.
 *
 * It fires under the SAME `AI_PROVIDER=real` flag the reply provider fires under —
 * there is no separate summary env. Key resolution mirrors the reply seam: the
 * OA's own key on the request first (`req.geminiApiKey`, the decrypted
 * `custom_ai_key` the webhook service already threads in), then the shared env
 * fallbacks. Refuses with `AssistSummaryKeyMissingError` rather than call keyless.
 *
 * The cap, when on, is a SEPARATE layer (`AssistSummaryCapDecorator`), exactly as
 * `AiCapDecorator` wraps `GeminiReplyProvider` — this class does one thing: turn a
 * request into a real model call and map `{summary, category}` through.
 */
@Injectable()
export class RealAssistSummaryProvider implements AssistSummaryProvider {
  private readonly logger = new Logger(RealAssistSummaryProvider.name);

  // [FEAT-20260813-WRAPAI-W2] No constructor dependency: after the switch the
  // provider drives the summary funnel (transport + interpreter), which resolve
  // the model id and parse the response themselves. It no longer calls
  // RagEngineService — so injecting it would be a dead dependency. The transport
  // still pulls MODEL_ID/GEMINI_HTTP_OPTS from ai/ at import, so AiModule stays a
  // real (compile-time) dependency of the webhook module; only this runtime
  // injection is gone. ไม่พึ่ง RagEngineService แล้ว — ตัด dead dep ออก.

  async summarise(
    request: AssistSummaryRequest,
  ): Promise<AssistSummaryResponse> {
    // Same key precedence as GeminiReplyProvider: the OA's own key first, then a
    // shared env test key, then the shared prod key. Never a silent keyless call.
    /* [P2-20260813] Vendor-aware, same rule as the reply path: the OA's key
     * first, then only Gemini's legacy env ladder. A DeepSeek hand-off with no
     * key of its own refuses instead of borrowing Google's. */
    const key = resolveVendorKey(request.geminiApiKey, request.aiVendor);
    if (!key || !key.trim()) throw new AssistSummaryKeyMissingError();

    this.logger.warn('[AI-REAL] assist-summary request');

    // ── [FEAT-20260813-WRAPAI-W2] THE SWITCH ─────────────────────────────────
    // This provider USED to call `ragEngine.analyzeConversationForAdmin(...)`
    // directly. It now drives the wrapped, vendor-swappable summary funnel:
    //   resolveSummaryTransport().send(call) -> interpretSummary(result)
    // Both pieces are request/response-equal to analyzeConversationForAdmin
    // (proven by the W2-0 before pack), so THIS SWITCH CHANGES NO BEHAVIOUR — it
    // only re-routes the same computation through a transport a second vendor
    // (DeepSeek) can slot into: one transport file + one registry line, this
    // provider unchanged. analyzeConversationForAdmin stays in place, now unused
    // by this path; removing it is a later, separate act.
    //
    // The transport builds the /v1 wire body + fires; the interpreter owns the
    // JSON extraction and the three fallback strings. The key resolved above is
    // threaded onto the neutral call, exactly where the 4th positional argument
    // used to land. Gemini is the FALLBACK for an absent or unknown vendor name,
    // not a hard default.
    // [FIX-20260908-STALECOMMENT] this used to read "Default provider is Gemini
    // until master-plan P2 wires per-hook ai_vendor into resolveSummaryTransport"
    // — it was already wired two lines below.
    // [P2-20260813] per-hook vendor selection — unknown/absent falls back to
    // the default inside the registry, so a typo can never break a hand-off.
    const transport = resolveSummaryTransport(request.aiVendor);
    const result = await transport.send({
      history: request.history,
      currentQuestion: request.currentQuestion,
      currentAnswer: request.currentAnswer,
      apiKey: key,
      modelId: request.aiModel ?? null,
      /* [FEAT-20260909-DSREASONING] the main lane's setting, carried through —
         the summary shares the reply path's choice by the owner's rule, so it is
         threaded from the same credentials bundle rather than resolved again. */
      reasoning: request.reasoning ?? null,
    });
    // Pass the provider's logger so a malformed-JSON reply still logs the
    // "AI Analysis JSON parse error" line legacy emitted (divergence D1). The
    // transport already logs the request-failure line (D2) in its own catch.
    return interpretSummary(result, this.logger);
  }
}
