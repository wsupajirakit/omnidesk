/**
 * [FEAT-20260908-AIVENDORMODELS] Which model answers when the hook chose none.
 * ref: todo/task/07092026/be_todo109_07092026_aivendorcore.md §12.12, §13 SAVE POINT 2
 * ===========================================================================
 * `'gemini-3.5-flash'` was written as an independent default in THREE transports
 * (reply, summary, translate) and `'deepseek-chat'` in TWO, and the
 * trim-or-fallback resolver that reads them was re-implemented FOUR times,
 * character for character. Same values every time, by luck rather than by
 * design: nothing would have failed if one copy had drifted, and a model bump
 * meant hunting for declarations rather than editing one.
 *
 * 🔴 THIS IS A RENAME-ONLY MOVE. Every value below is byte-identical to the
 *    constant it replaces, and each transport re-exports its old name, so no
 *    consumer and no request changes. `ai-vendor-models.spec.ts` pins the values
 *    against the literals rather than against each other — comparing the new
 *    registry to itself would pass while both drifted.
 *
 * ── WHY A REGISTRY, NOT FIVE CONSTANTS ─────────────────────────────────────
 * ⚠️ THE ROLE AXIS IS REAL AND IS KEPT. Reply, summary and translate each own
 *    their default today even though the three Gemini values are currently
 *    equal. Collapsing them to one constant would quietly remove the ability to
 *    move one lane to a different model — which is a product decision somebody
 *    may well want, and not this refactor's to delete. Equal values are not the
 *    same thing as one value.
 *
 * ⚠️ THE HOOK STILL DECIDES. This file holds the FALLBACK only. A hook's own
 *    `ai_model` / `ai_model_sec` always wins; `resolveModelId` is the one place
 *    that says how (trim, and treat blank as unset). Nothing here is reachable
 *    when the hook has chosen.
 *
 * ⚠️ NO ENV RUNG. `DEEPSEEK_MODEL_ID` was deliberately deleted when DeepSeek
 *    arrived — a server-level model is exactly the override the per-hook rule
 *    removes. The one env-backed model that remains (`rag-engine`'s `MODEL_ID`)
 *    is legacy and is NOT moved here; that is P2.4's business, and pulling it in
 *    now would hide a behaviour question inside a rename.
 *
 * ── VENDOR #3 ───────────────────────────────────────────────────────────────
 * A new vendor adds ONE entry to `FAMILY_DEFAULTS` and, if any of its models
 * has a capability worth guarding, one entry to `MODEL_CAPABILITIES`. It does
 * not touch a transport. No third vendor exists here yet, on purpose:
 * an entry with no caller is debt, and it arrives with its first consumer.
 *
 * revert: delete this file and restore each transport's own constant and its
 * own `resolveModelId`. They were identical, so the restore is mechanical.
 */

/** Vendor names exactly as they appear in `hook.ai_vendor` — registry keys. */
export type VendorName = 'gemini' | 'deepseek';

/** The lanes that resolve a model. Each owns its default; see the header. */
export type ModelRole = 'reply' | 'summary' | 'translate';

/**
 * Per-vendor, per-role fallback. **Values are transcribed, not chosen.**
 *
 *   gemini.reply     ← GEMINI_FAMILY_MODEL            (gemini-reply.transport)
 *   gemini.summary   ← GEMINI_SUMMARY_FAMILY_MODEL    (gemini-summary.transport)
 *   gemini.translate ← GEMINI_TRANSLATE_FAMILY_MODEL  (gemini-translate.transport)
 *   deepseek.reply   ← DEEPSEEK_FAMILY_MODEL          (deepseek-reply.transport)
 *   deepseek.summary ← DEEPSEEK_FAMILY_MODEL          (the summary lane imported
 *                      the REPLY constant from its sibling; same value, and the
 *                      sibling edge is what this file removes)
 *   deepseek.translate ← DEEPSEEK_TRANSLATE_FAMILY_MODEL (translate's own copy)
 */
export const FAMILY_DEFAULTS: Readonly<
  Record<VendorName, Readonly<Record<ModelRole, string>>>
> = {
  gemini: {
    reply: 'gemini-3.5-flash',
    summary: 'gemini-3.5-flash',
    translate: 'gemini-3.5-flash',
  },
  /**
   * [FIX-20260909-DSMODELID] `deepseek-chat` -> `deepseek-v4-flash`, owner
   * authorised 09/09 after the id was checked two ways rather than assumed.
   *
   * WHAT WAS MEASURED, with a real key on 09/09:
   *   GET /v1/models          returns exactly three ids, and `deepseek-chat` is
   *                           NOT among them: deepseek-v4-flash, deepseek-v4-pro,
   *                           deepseek-v4-flash-vision-exp
   *   POST with deepseek-chat  still answers 200 — and the response's own
   *                           `model` field comes back `deepseek-v4-flash`.
   *                           It is an undocumented ALIAS, not a model.
   *   api-docs.deepseek.com    does not mention `deepseek-chat` anywhere.
   *
   * ⇒ the change is behaviour-preserving by construction: the request was
   *   already being served by this model. What it removes is the dependency on
   *   an alias the vendor does not document and can retire without warning.
   *
   * ⚠️ WHEN THE NAME CHANGES AGAIN — and it will — this is the ONE place to
   *    edit, and the free `GET /v1/models` listing is how to check before
   *    editing. No deploy is needed for an individual OA in the meantime: a
   *    hook's own `ai_model_sec` always wins over this table.
   */
  deepseek: {
    reply: 'deepseek-v4-flash',
    summary: 'deepseek-v4-flash',
    translate: 'deepseek-v4-flash',
  },
};

/**
 * What a model can be asked for — recorded so a pin stops being a mystery string.
 *
 * ⚠️ ONLY MODELS WITH A LIMIT WORTH GUARDING APPEAR HERE, and absence means
 *    "nothing special is known", never "unsupported". A lookup miss must
 *    therefore never be read as a denial — `qr-vision` pins
 *    `gemini-2.5-flash` precisely because that model rejects a thinking config,
 *    and that pin is the reason this map exists at all.
 *
 * 🔴 THIS MAP DOES NOT DECIDE ANYTHING TODAY. `thinking-config.ts` is the single
 *    thinking decider and is untouched (a deliberate hotfix, §3b). This is
 *    documentation with a type, and it stays that way until a caller is written
 *    for it deliberately — wiring it into the decider is a behaviour change, not
 *    a rename.
 */
export interface ModelCapabilities {
  /** `false` ⇒ sending a thinking config to this model is known to fail. */
  readonly supportsThinking: boolean;
  /** `true` ⇒ this model accepts an `inlineData` image part. */
  readonly supportsInlineData: boolean;
}

export const MODEL_CAPABILITIES: Readonly<Record<string, ModelCapabilities>> = {
  /* The slip lane's pin. Multimodal, and it does NOT accept a thinking config —
     which is why `qr-vision.service.ts` names a model instead of following the
     family default. Recorded here; the pin itself moves in P2.3. */
  'gemini-2.5-flash': { supportsThinking: false, supportsInlineData: true },
};

/** The fallback for one lane. Never reached when the hook chose a model. */
export function familyModel(vendor: VendorName, role: ModelRole): string {
  return FAMILY_DEFAULTS[vendor][role];
}

/**
 * The hook's choice, else the lane's family default.
 *
 * 🔴 TRANSCRIBED FROM FOUR IDENTICAL COPIES, INCLUDING THE TRIM. A whitespace-only
 *    `ai_model` means "not set" — `'   '` must fall back, not be sent to the
 *    vendor as a model name. Every existing copy trims and every existing spec
 *    asserts it (`resolveDeepSeekModelId('   ')`), so dropping the trim would
 *    turn a blank column into a guaranteed vendor error.
 */
export function resolveModelId(
  modelId: string | null | undefined,
  fallback: string,
): string {
  return modelId && modelId.trim() ? modelId.trim() : fallback;
}
