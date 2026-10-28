/**
 * [FEAT-20260818-TRANSLATE] Neutral types for the ticket-translate funnel — the
 * vendor-free contract between the translate transport and its interpreter.
 *
 * Consumer #3 of the wrap-ai shape. Mirrors `summary-neutral.ts` (consumer #2)
 * file-for-file: nothing here names a vendor, a `TranslateCall` is what ANY
 * translator needs, and a `TranslateTransportResult` is what any of them hands
 * back.
 *
 * 🔴 [FEAT-20260908-CHATTRANS] THE HEADER THAT USED TO BE HERE IS NOT KEPT, AND
 * DELETING IT IS THE POINT. It explained that the funnel lived INSIDE the
 * tickets module — vendor transports and all — because webhook already imports
 * tickets (`webhook.module.ts:40`), so reaching the webhook barrel from here
 * would close a TS-level cycle. That reasoning was true when it was written and
 * is now obsolete twice over: the vendor code lives behind `@/modules/ai-vendor`,
 * which is a LEAF that imports no module at all, and this folder is no longer
 * inside tickets. Carrying the old paragraph forward would tell the next reader
 * the funnel belongs in tickets and invite them to move it back.
 *
 * What survives from it is the rule, which still holds and is now ENFORCED
 * rather than described: nothing in this folder may import another feature
 * module — see `z-test/unit/ai-translate-isolation.spec.ts`. The one permitted
 * module edge is `@/modules/ai-vendor`. ห้าม import โมดูลอื่นจากโฟลเดอร์นี้.
 *
 * revert: delete `src/modules/ai-translate/` whole.
 */

/**
 * [FEAT-20260909-DSREASONING] Reasoning knobs, in the neutral vocabulary.
 *
 * TWO vendors, two genuinely different concepts, so this is a union rather than
 * one flattened shape. Gemini's is a token BUDGET (a number); DeepSeek's is a
 * switch plus an effort (two enums). Pretending they are one idea would put a
 * meaningless field on every call and a branch at every read site.
 *
 * The caller resolves whichever applies from the hook row and passes it; a
 * transport reads only its own arm and ignores the other, exactly as DeepSeek
 * already ignores `topK`.
 *
 * 🔴 `effort` HAS FOUR VALUES, AND `'medium'` IS ONE OF THEM ON EVIDENCE. The
 *    vendor's documentation lists only low/high/max; a real call on 09/09 showed
 *    `medium` answering 200 with reasoning content, the same as the other three.
 *    The list shipped short and grew when a probe said so — which is why it is a
 *    named constant and not an inline literal.
 *
 * ⚠️ `type: 'disabled'` WITH an `effort` is expressible on purpose, and MEASURED:
 *    the vendor accepts the pair and ignores the effort — 200, and no reasoning
 *    content. Storable, harmless, and not something this type should refuse.
 */
export interface TranslateReasoning {
  /** DeepSeek. Absent on a Gemini call. */
  thinking?: {
    type: 'enabled' | 'disabled';
    effort?: 'low' | 'medium' | 'high' | 'max';
  };
  /**
   * Extra generation-config entries, **already resolved by the caller** and
   * attached verbatim. Gemini's arm.
   *
   * 🔴 OPAQUE ON PURPOSE — this module does not interpret it, and that is what
   *    keeps it vendor-free. The door states the same contract for its own
   *    `generationExtra`: *"attached verbatim … passed through rather than
   *    interpreted so the door holds no opinion about models."* Today it carries
   *    exactly one thing, the output of `resolveThinkingConfig`.
   *
   * ⚠️ WHY THE CALLER RESOLVES IT AND NOT THIS MODULE. `resolveThinkingConfig`
   *    is `[HOTFIX-20260826-THINK36]`, and it lives in the webhook lane —
   *    which this folder may not import, by a rule its own isolation spec
   *    enforces. The alternatives were to copy the model-family table (a second
   *    copy to drift) or to move a file on the live reply path. Forwarding an
   *    already-resolved value costs neither, and the owner's rule is satisfied
   *    exactly: the same function decides for both lanes, so the same number
   *    means the same thing in both boxes.
   */
  generationExtra?: Readonly<Record<string, unknown>>;
}

/** Everything a translation needs for one call. Vendor-free. */
export interface TranslateCall {
  /** The text to translate, as stored on the message/ticket. */
  text: string;
  /** BCP-47-ish target, e.g. 'en', 'th', 'zh' — free-form, the prompt names it. */
  targetLang: string;
  /**
   * Optional source hint. Omitted ⇒ the model detects; passed through to the
   * prompt only, never branched on.
   */
  sourceLang?: string | null;
  /**
   * The hook's own decrypted `custom_ai_key`. NEVER an env fallback: owner rule
   * (18/08) — every OA must carry its own key, setting it is the admin's duty —
   * and the DeepSeek precedent: a hook without its key must REFUSE, not borrow.
   * The provider throws before the transport ever sees an empty key.
   */
  apiKey: string;
  /** The hook's model choice, or null for the vendor's family default. */
  modelId?: string | null;
  /**
   * [FEAT-20260909-DSREASONING] The OA's reasoning choice, or null/absent for
   * "say nothing to the vendor about it".
   *
   * 🔴 ABSENT MEANS ABSENT, and that is the whole compatibility story. A call
   *    without this field must produce a request body that is byte-identical to
   *    the one this lane sent before the field existed — not a body carrying a
   *    default, and not one carrying `thinking: undefined`.
   */
  reasoning?: TranslateReasoning | null;
}

/** What a translate transport hands back — raw text + status, never parsed. */
export interface TranslateTransportResult {
  /** The model's raw reply, or undefined when the call errored / produced none. */
  rawText: string | undefined;
  /** Vendor http status, or 0 for a transport/thrown error. */
  httpStatus: number;
  /** Raw provider payload, for logs only. */
  raw: unknown;
  /** Non-null when the vendor call failed. */
  errorMessage: string | null;
}
