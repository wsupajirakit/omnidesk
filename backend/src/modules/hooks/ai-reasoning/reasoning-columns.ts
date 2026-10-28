/**
 * [FEAT-20260909-DSREASONING] The six reasoning columns, in one place.
 * ===========================================================================
 * Owner, 09/09 — the matrix this file exists to serve:
 *
 *                  main bot (reply + summary)        translate
 *   Gemini         gemini_thinking_budget  (EXISTS)  must be settable
 *   DeepSeek       must be settable                  must be settable
 *
 * and *"summary uses the same one as the main bot"* — so there are TWO lanes,
 * not three. Summary is not a third setting; it reads what the main bot reads.
 *
 * ## Naming
 *
 *     <vendor>_<knob>            → the MAIN lane
 *     <vendor>_<knob>_translate  → the TRANSLATE lane
 *
 * The absent suffix marks the main lane because `gemini_thinking_budget`
 * ALREADY has that name and is read on a live path. Renaming it to `_main`
 * would be a migration on a running system for a cosmetic gain, and the owner
 * ruled that out in as many words: an OA on the Gemini bot needs no backfill of
 * any kind. The suffix therefore marks the lane that came second — which is
 * also the convention `ai_vendor` / `ai_vendor_translate` established hours
 * ago. One convention, already in the tree.
 *
 * ## Why the knobs are not unified across vendors
 *
 * Gemini's concept is a `thinkingBudget` — a NUMBER of tokens. DeepSeek's is
 * `thinking.type` plus `reasoning_effort` — two ENUMS. They are not one idea
 * wearing two names, and flattening them into a shared column would be the
 * debt: a number that means nothing to one vendor and an enum that means
 * nothing to the other, with a branch at every read site to tell them apart.
 *
 * ## Why this lives under `hooks/`
 *
 * Both consumers can reach it. `webhook` already imports `hooks`, and importing
 * back would close the cycle `parse-ai-vendor.ts` warns is fatal at boot;
 * `chat` already imports `hooks` for `resolveVendorPair`. Putting it in
 * `ai-translate/` would put it out of the webhook's reach AND break that
 * module's isolation guard, which forbids it from importing feature modules.
 *
 * 🔴 NOTHING HERE TOUCHES THE RUNNING GEMINI PATH. `gemini_thinking_budget` is
 *    listed so the map of six is complete and truthful, but the reply lane goes
 *    on reading it exactly where it does today
 *    (`webhook/ai-vendors/request-credentials.ts` → `ask-model.step.ts` →
 *    `gemini-reply.transport.ts`). A spec pins this map's entry against that
 *    literal so the two cannot drift. Consistency without moving a live wire.
 *
 * revert: delete this directory and the columns it names.
 */

/** The two lanes an OA can configure separately. */
export type ReasoningLane = 'main' | 'translate';

/** The knob column names for one vendor, one lane. */
export interface ReasoningColumns {
  /** Gemini's numeric budget, or null for a vendor that has no such concept. */
  readonly budgetField: string | null;
  /** DeepSeek's on/off, or null. */
  readonly thinkingField: string | null;
  /** DeepSeek's effort enum, or null. */
  readonly effortField: string | null;
}

/**
 * 🔴 THE ONLY PLACE THESE SIX NAMES ARE WRITTEN.
 *
 * A column name repeated at a read site is how a lane ends up reading the other
 * lane's setting — a mistake with no compile error and no visible symptom,
 * because both values are the same type and both are usually null.
 */
export const REASONING_COLUMNS: Readonly<
  Record<string, Readonly<Record<ReasoningLane, ReasoningColumns>>>
> = {
  gemini: {
    /* ⚠️ EXISTING AND LIVE. Named here, read elsewhere — see the header. */
    main: {
      budgetField: 'gemini_thinking_budget',
      thinkingField: null,
      effortField: null,
    },
    translate: {
      budgetField: 'gemini_thinking_budget_translate',
      thinkingField: null,
      effortField: null,
    },
  },
  deepseek: {
    main: {
      budgetField: null,
      thinkingField: 'deepseek_thinking',
      effortField: 'deepseek_reasoning_effort',
    },
    translate: {
      budgetField: null,
      thinkingField: 'deepseek_thinking_translate',
      effortField: 'deepseek_reasoning_effort_translate',
    },
  },
};

/**
 * Every column this feature owns, for the write-side registrations.
 *
 * ⚠️ `gemini_thinking_budget` is EXCLUDED deliberately — it was registered in
 *    `FIELD_TAB` and `ALLOWED_UPDATES` long before this file existed, and
 *    listing it again would say this feature introduced it.
 */
export const NEW_REASONING_COLUMNS: readonly string[] = [
  'gemini_thinking_budget_translate',
  'deepseek_thinking',
  'deepseek_reasoning_effort',
  'deepseek_thinking_translate',
  'deepseek_reasoning_effort_translate',
];

/**
 * The columns for a vendor + lane. An unknown vendor resolves to gemini's, the
 * same answer every other vendor lookup in this repo gives for an unknown name.
 */
export function reasoningColumns(
  vendor: string | null | undefined,
  lane: ReasoningLane,
): ReasoningColumns {
  const key = typeof vendor === 'string' ? vendor.trim() : '';
  /* The non-null assertion is on `gemini`, a key this file declares as a
     literal two dozen lines above — the index signature is what makes `tsc`
     doubt it, not any real possibility of absence. */
  const forVendor = REASONING_COLUMNS[key] ?? REASONING_COLUMNS['gemini']!;
  return forVendor[lane];
}
