/**
 * [FEAT-20260907-AIVENDORCORE] One place that says where an AI vendor lives.
 * ref: todo/task/07092026/be_todo109_07092026_aivendorcore.md
 * ============================================================================
 * WHAT WAS WRONG. Ten call sites across six modules each built their own Gemini
 * URL, and they did not agree: `/v1beta` in the webhook reply lane and
 * `qr-vision`, `/v1` in the webhook summary lane, `translate`, `model.service`
 * and the key probe — and `rag-engine.service.ts` used BOTH, at different call
 * sites in one file. Nobody chose that; each transport was transcribed from a
 * different legacy function and inherited whatever that function happened to
 * use.
 *
 * 🔴 THE SPLIT IS HISTORICAL, NOT TECHNICAL — measured, not reasoned. The same
 *    body was fired at both versions on the same model with the same key,
 *    07/09/2026:
 *
 *      plain generateContent                    v1 200   ·  v1beta 200
 *      generationConfig.thinkingBudget: 0       v1 400   ·  v1beta 400
 *      generationConfig.thinkingLevel: minimal  v1 200   ·  v1beta 200
 *
 *    Identical in every case. What decides whether `thinkingConfig` is accepted
 *    is the MODEL (see `webhook/ai-vendors/gemini/thinking-config.ts`), never
 *    the API version. Google's own documentation describes v1 as stable and
 *    v1beta as "early features and capabilities that are actively being
 *    developed" — a difference in what MAY appear, not in how the shared
 *    surface behaves.
 *
 * WHY `src/common/` AND NOT `modules/ai`. `modules/ai` already shares
 * `GEMINI_HTTP_OPTS` and would have been the obvious home, but it imports
 * `@/modules/hooks` — so `hooks/ai-vendor/ai-key-probe.ts`, one of the ten
 * sites, could not import it back without closing a cycle. That file says so in
 * its own header, and it is the third place in this codebase forced to
 * re-declare a vendor host for exactly that reason. A constant with no imports
 * sits below everything and has no such problem.
 *
 * ⚠️ THIS FILE IMPORTS NOTHING, and must not start. `src/common/**` is barred
 *    from importing `@/modules/*` by eslint precisely so it can stay reachable
 *    from every module.
 *
 * ⚠️ WHAT IS DELIBERATELY NOT FIXED HERE. Several call sites put the key on the
 *    query string unencoded. Each transport's header calls that a "transcribed
 *    hazard, preserved", and changing it is a separate decision with its own
 *    proof — this file only removes the disagreement about the base.
 *
 * revert: delete this file and restore the literal in each call site. The URLs
 * return to disagreeing, which is where they started.
 */

/** The host. It has never varied and is not a decision. */
const GEMINI_HOST = 'https://generativelanguage.googleapis.com';

/**
 * The API versions Google publishes for this surface.
 *
 * Both are real, both answer today, and the choice between them is a POLICY not
 * a correctness question — which is why the version is a named value with a type
 * rather than a string baked into a URL. Switching is one edit here and the whole
 * suite proves nothing else moved; before this file existed the same switch meant
 * editing nine files that disagreed with each other.
 */
export type GeminiApiVersion = 'v1' | 'v1beta';

/**
 * Which version every Gemini call uses.
 *
 * ── The evidence behind the value ──────────────────────────────────────────
 * Fired live 07-08/09/2026, same model and key, both bases:
 *   plain                                v1 200  ·  v1beta 200
 *   thinkingConfig thinkingLevel minimal v1 200  ·  v1beta 200
 *   thinkingConfig thinkingBudget 128    v1 200  ·  v1beta 200
 *   thinkingConfig thinkingBudget -1     v1 200  ·  v1beta 200
 *   thinkingConfig thinkingBudget 0      v1 400  ·  v1beta 400   (a MODEL limit)
 * Google's API-versions page lists "Thinking / Reasoning" with a checkmark for
 * BOTH. So the long-standing comment claiming `/v1` rejects `thinkingConfig` is
 * false, and the split it justified was inherited from two legacy functions.
 *
 * ── Why `v1beta` and not `v1` ──────────────────────────────────────────────
 * The customer-reply lane and `qr-vision` have run on `v1beta` in production all
 * along, and Google's SDKs default to it "to enable access to preview features".
 * ⚠️ THE DOCUMENTED ARGUMENT FOR `v1` IS REAL AND IS NOT HIDDEN: Google calls v1
 *    *"fully supported over the lifetime of the major version"* and says v1beta
 *    *"may be subject to changes"*. If that trade ever matters more than early
 *    access, change this one value.
 *
 * ⚠️ A CONSTANT, NOT AN ENVIRONMENT VARIABLE — the same stance `now-block` takes
 *    for its own switch. A deployment must not be able to silently answer on a
 *    different API surface from the one its tests ran against; this belongs in a
 *    commit with a diff, not in a `.env` nobody diffs.
 */
export const GEMINI_API_VERSION: GeminiApiVersion = 'v1beta';

/**
 * The Gemini REST base for the selected version.
 *
 * Derived, never typed out — so the version above is the single place the
 * decision lives and no caller can pin a different one by accident.
 */
export const GEMINI_API_BASE = `${GEMINI_HOST}/${GEMINI_API_VERSION}`;

/**
 * The base for an EXPLICIT version, for a caller that must pin one.
 *
 * 🔴 NOTHING USES THIS TODAY, and that is deliberate: it exists so that if one
 *    path ever genuinely needs the other surface — a preview knob on v1beta while
 *    the rest stays on stable v1 — it can say so in ONE line at its own call site
 *    instead of pasting a URL and starting the scatter again. If it is still
 *    unused when someone reads this, deleting it is correct; an unused export is
 *    debt, and a second URL literal is worse.
 */
export function geminiBaseFor(version: GeminiApiVersion): string {
  return `${GEMINI_HOST}/${version}`;
}

/**
 * `…/models/<model>:generateContent`, the only Gemini operation this system
 * calls for text.
 *
 * ⚠️ The key is appended by the CALLER, not here. Two call sites encode it and
 *    the rest do not; folding that difference into this helper would silently
 *    change the wire for whichever group is wrong, which is a behaviour change
 *    hiding inside a refactor.
 */
export function geminiGenerateContentUrl(model: string): string {
  return `${GEMINI_API_BASE}/models/${model}:generateContent`;
}

/**
 * `…/models` — the listing endpoint, used to check whether a key is valid.
 *
 * 🔴 PINNED TO `v1`, NOT TO `GEMINI_API_VERSION`, AND THAT IS THE POINT.
 *    Both listing callers (`system/model.service.ts`, `hooks/ai-vendor/ai-key-probe.ts`)
 *    have always used `/v1`. The `v1` ↔ `v1beta` equivalence proved by live fire
 *    was measured on **generateContent** — the listing endpoint was never tested,
 *    and a different endpoint is a different question. Moving these callers to
 *    `GEMINI_API_BASE` would silently change their wire on an assumption.
 *
 *    So the version is named here, once, instead of pasted into two files. If
 *    somebody later fires both listing versions and finds them equivalent, this
 *    becomes `${GEMINI_API_BASE}/models` in one edit — with evidence.
 *
 * ⚠️ These callers ENCODE the key; the generateContent callers do not. That
 *    difference is real and stays with the callers.
 */
export const GEMINI_MODELS_URL = `${geminiBaseFor('v1')}/models`;

/**
 * The DeepSeek chat endpoint.
 *
 * It has never disagreed with itself — one host, one path, in every file that
 * names it. It is here so that "where does a vendor live" has ONE answer rather
 * than one answer for Gemini and a scattering for everyone else, and so the
 * next vendor has an obvious place to go.
 */
export const DEEPSEEK_CHAT_URL = 'https://api.deepseek.com/chat/completions';

/** `…/models` — DeepSeek's listing endpoint, the key-probe counterpart. */
export const DEEPSEEK_MODELS_URL = 'https://api.deepseek.com/models';
