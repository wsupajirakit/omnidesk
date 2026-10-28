/**
 * [FEAT-20260818-TRANSLATE] The translate provider seam — consumer #3's
 * equivalent of `assist-summary.provider.ts`.
 *
 * The INTERFACE is what the controller injects; the REAL provider drives the
 * funnel (resolve vendor by `hook.ai_vendor` → transport → interpreter). The
 * scripted twin and the cap decorator wrap this interface, so the controller
 * never knows which one answered — the same seam shape both other consumers use.
 *
 * KEY RULE (owner, 18/08): the hook's own `custom_ai_key` or REFUSE. No env
 * ladder here at all — stricter than replies, aligned with the DeepSeek
 * precedent ("must REFUSE, not borrow") and with the standing policy that
 * setting the key is the admin's duty. คีย์ของ OA เท่านั้น ไม่มีถังกลาง.
 *
 * revert: delete `src/modules/ai-translate/` whole. [FEAT-20260908-CHATTRANS]
 *         this line used to add "+ the provider entries in tickets.module.ts";
 *         there are none left there, so the folder delete is now the whole
 *         revert. A revert instruction that names a file it no longer touches is
 *         the kind of claim that gets trusted and then wastes an afternoon.
 */
import { Injectable, Logger } from '@nestjs/common';

import { resolveTranslateTransport } from './translate-transport.registry';
import { interpretTranslateResult } from './translate-interpreter';
import type { TranslateReasoning } from './translate-neutral';

/**
 * [FEAT-20260908-CHATTRANS] Renamed from `TICKET_TRANSLATE_PROVIDER`, joining
 * `AI_REPLY_PROVIDER` / `AI_ASSIST_SUMMARY_PROVIDER`. The funnel is not a ticket
 * feature any more, so the old name was describing a module it had left.
 *
 * 🔴 THE STRING INSIDE `Symbol()` MATTERS AND IS NOT DECORATION. Nest prints the
 * symbol's DESCRIPTION in its dependency-resolution errors, so renaming the
 * const alone would leave the old name in operator-facing output — a compiler
 * cannot see that, and no test would either. Both were changed together.
 *
 * 🔴 PRIVATE TO THE MODULE. It is deliberately absent from `index.ts`: the
 * public seam is `AiTranslateService` (see `ai-translate.module.ts`).
 * ⚠️ It has NO consumer today. `AiTranslateService` calls the factory directly,
 * so nothing injects this token — it is the private seam kept for a caller that
 * wants to swap the provider, not a live wire. Do not read its presence as
 * evidence that something binds it.
 */
export const AI_TRANSLATE_PROVIDER = Symbol('AI_TRANSLATE_PROVIDER');

export interface TranslateRequest {
  text: string;
  targetLang: string;
  sourceLang?: string | null;
  /** The hook's vendor choice (`hook.ai_vendor`), null ⇒ registry default. */
  vendor: string | null;
  /** The hook's model choice (`hook.ai_model`), null ⇒ vendor family default. */
  modelId: string | null;
  /** The hook's DECRYPTED `custom_ai_key`. Empty ⇒ this provider throws. */
  apiKey: string;
  /** For the cap ledger line only — never sent to a vendor. */
  hookId?: string | null;
  /**
   * [FEAT-20260909-DSREASONING] The OA's reasoning choice, resolved by the
   * CALLER from its own columns. Absent/null ⇒ nothing is said to the vendor.
   *
   * ⚠️ Passed straight through, never defaulted here. This module does not know
   *    what a hook is, and inventing a default would be it deciding a per-OA
   *    question on the operator's behalf.
   */
  reasoning?: TranslateReasoning | null;
}

export interface TranslateResponse {
  /** The translated text, trimmed. */
  text: string;
  /**
   * [FEAT-20260910-DETECTSOURCE] the source language the MODEL reported, when it
   * reported one this registry recognises.
   *
   * ⚠️ OPTIONAL, and `null` is a first-class answer. A caller that ignores it
   *    behaves exactly as it did before this field existed, and a caller that
   *    reads it must handle "the model did not say" — which is the common case
   *    for a one-word message. ไม่รู้ = null · ห้ามเดา.
   */
  from?: string | null;
}

export interface TranslateProvider {
  translate(request: TranslateRequest): Promise<TranslateResponse>;
}

/** Thrown when the OA carries no usable AI key — the admin has to set one. */
export class TranslateKeyMissingError extends Error {
  constructor() {
    super(
      "This OA has no custom_ai_key. Translation uses the OA's own key by " +
        'policy — set it on the hook (admin duty); there is no shared fallback.',
    );
    this.name = 'TranslateKeyMissingError';
  }
}

@Injectable()
export class RealTranslateProvider implements TranslateProvider {
  private readonly logger = new Logger(RealTranslateProvider.name);

  async translate(request: TranslateRequest): Promise<TranslateResponse> {
    if (!request.apiKey || !request.apiKey.trim()) {
      throw new TranslateKeyMissingError();
    }
    this.logger.warn(
      `[AI-TRANSLATE] request — hook=${request.hookId ?? '(none)'} target=${request.targetLang}`,
    );
    const transport = resolveTranslateTransport(request.vendor);
    const result = await transport.send({
      text: request.text,
      targetLang: request.targetLang,
      sourceLang: request.sourceLang ?? null,
      apiKey: request.apiKey,
      modelId: request.modelId,
      /* Absent stays absent — `?? null` would turn "not set" into an explicit
         null, and the transport branches on truthiness either way, but the
         neutral call is what the funnel spec reads. */
      reasoning: request.reasoning,
    });
    /* [FEAT-20260910-DETECTSOURCE] the interpreter now hands back both halves;
       spreading it keeps this line honest about which one is which. */
    const { text, from } = interpretTranslateResult(result);
    return { text, from };
  }
}
