/**
 * [FEAT-20260907-AIVENDORCORE] The Gemini door — one URL, one body builder, one reader.
 * ref: todo/task/07092026/be_todo109_07092026_aivendorcore.md
 * ===========================================================================
 * Three files built a Gemini URL and they did not agree: `/v1beta` in the reply
 * lane, `/v1` in the summary lane and in translate. Nobody chose that — each was
 * transcribed from a different legacy function and inherited whatever it used.
 *
 * 🔴 PROVEN INTERCHANGEABLE BY FIRE, NOT BY READING. The same body on the same
 *    model with the same key, 07/09/2026:
 *      plain generateContent                    v1 200  ·  v1beta 200
 *      generationConfig.thinkingBudget: 0       v1 400  ·  v1beta 400
 *      generationConfig.thinkingLevel: minimal  v1 200  ·  v1beta 200
 *    Identical every time. What decides whether a thinking config is accepted is
 *    the MODEL, never the API version.
 *
 * ── WHY THIS OWNS THE REQUEST BUT NOT THE CALL ─────────────────────────────
 * 🔴 A DELIBERATE SCOPE LINE, not an oversight. The reply lane wraps its POST in
 *    two retries that are load-bearing and heavily evidenced: a 400-on-"think"
 *    retry that DELETES a key from the body and re-fires, and a timeout retry
 *    that uses a SHORTER options object and logs the first failure by name
 *    (`[FIX-20260901-AIRETRYLOG]` — added because the first attempt had never
 *    been recorded at all, measured over 24h of production rows).
 *
 *    A door that owned the call would have to either reproduce that policy for
 *    everyone, or hand the caller enough error detail to re-implement it by
 *    sniffing strings. Both change behaviour on the customer money path to buy
 *    tidiness. So the caller keeps `axios.post` and its own retry; this file
 *    owns the thing that was actually scattered — the URL — plus the body and
 *    the reader, which were duplicated with no variation at all.
 *
 *    Moving the call itself is a later block and needs a retry contract designed
 *    on its own terms.
 *
 * ⚠️ THE KEY IS NOT ENCODED, and that is preserved on purpose. Every existing
 *    generateContent path puts it on the query string raw — the transports call
 *    it a "transcribed hazard, preserved". Two OTHER paths (`model.service`,
 *    `ai-key-probe`) DO encode it, and they use the listing endpoint. Both
 *    behaviours are kept; this file does not unify them.
 *
 * revert: delete this file and restore each transport's own URL literal, body
 * builder and `readGeminiText`. They were byte-identical, so the restore is
 * mechanical.
 */
import { GEMINI_API_BASE } from '@/common/ai-endpoints';

import type { VendorCall } from '../call';

/** The wire body, exactly as the three transports built it between them. */
export interface GeminiBody {
  system_instruction?: { parts: { text: string }[] };
  contents: { parts: unknown[] }[];
  generationConfig: Record<string, unknown>;
}

/**
 * `…/v1beta/models/<model>:generateContent`
 *
 * 🔴 [FEAT-20260908-GEMINIKEYHEADER] THE KEY IS NO LONGER IN THIS URL. It used to
 *    be appended raw as `?key=<key>`; it now rides the `x-goog-api-key` header
 *    built by `geminiHttpOpts(apiKey)` in `../http`.
 *
 * ⚠️ The second parameter was REMOVED rather than ignored, deliberately. Leaving
 *    `(model, apiKey)` and silently dropping the key would have compiled at all
 *    eight call sites and sent keyless requests — a 401 at runtime, from code
 *    that still reads as if it passes a key. Deleting the parameter turns every
 *    site that has not been migrated into a COMPILE error, so the compiler
 *    enumerates the work instead of a person trying to remember it.
 *
 * Every caller must now pair this with `geminiHttpOpts(key)` as the axios config.
 */
export function geminiUrl(model: string): string {
  return `${GEMINI_API_BASE}/models/${model}:generateContent`;
}

/**
 * [FEAT-20261026-RAGENGINE] The embedding endpoint — built here, beside `geminiUrl`, so no
 * caller writes a Google URL literal. Same base, same `geminiHttpOpts(key)` header rule.
 * `batchEmbedContents` takes one request per text and answers one vector per request
 * (sending several texts in one `content` would return ONE aggregated vector).
 */
export function geminiBatchEmbedUrl(model: string): string {
  return `${GEMINI_API_BASE}/models/${model}:batchEmbedContents`;
}

/**
 * Build the request body.
 *
 * 🔴 KEY ORDER IS PART OF THE CONTRACT. `system_instruction` first when present,
 *    then `contents`, then `generationConfig` — that is the order the reply lane
 *    emitted and `ai-vendor-wire-baseline.spec.ts` pins it. JSON key order is not
 *    semantically meaningful to the vendor, but a diff in it means somebody
 *    rebuilt this function from memory instead of moving it.
 *
 * 🔴 ABSENT MEANS ABSENT. `systemInstruction` and `generationExtra` are only
 *    written when supplied, so a summary body carries neither key — byte-identical
 *    to what it sent before this file existed.
 */
export function buildGeminiBody(call: VendorCall): GeminiBody {
  const body: GeminiBody = {
    contents: [{ parts: call.parts.map((p) => ({ ...p })) }],
    generationConfig: {
      temperature: call.knobs.temperature,
      topP: call.knobs.topP,
      topK: call.knobs.topK,
      ...(call.generationExtra ?? {}),
    },
  };
  if (call.systemInstruction !== undefined) {
    /* Written FIRST — the reply lane's order. Assigning after `contents` would
       put it last, which the baseline spec catches. */
    return {
      system_instruction: { parts: [{ text: call.systemInstruction }] },
      contents: body.contents,
      generationConfig: body.generationConfig,
    };
  }
  return body;
}

/** The response walk that four files each declared identically. */
export function readGeminiText(data: unknown): string | undefined {
  return (
    data as
      | { candidates?: { content?: { parts?: { text?: string }[] } }[] }
      | undefined
  )?.candidates?.[0]?.content?.parts?.[0]?.text;
}
