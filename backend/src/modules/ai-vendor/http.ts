/**
 * [FEAT-20260907-AIVENDORCORE] How long we wait for a vendor, in one place.
 * ref: todo/task/07092026/be_todo109_07092026_aivendorcore.md
 * ===========================================================================
 * `GEMINI_HTTP_OPTS` used to live in `@/modules/ai/rag-engine.service` and
 * `DEEPSEEK_HTTP_TIMEOUT_MS` was declared THREE times — once in each DeepSeek
 * transport. Same number every time, by luck rather than by design: nothing
 * would have failed if one copy had drifted.
 *
 * ⚠️ THE VALUE IS UNCHANGED, DELIBERATELY. 30s is a STALL ceiling, not a
 *    latency budget, and it is what every axios path has always used. This file
 *    removes the duplication and changes no behaviour.
 *
 * ⚠️ TWO PATHS HAVE NO TIMEOUT AND MUST KEEP HAVING NONE — `system/model.service`
 *    and `hooks/hook-credential-check` use `fetch` and pass no signal. Giving
 *    them one "for consistency" would turn two fail-fast paths into hanging
 *    ones. They are not consumers of this file.
 */

/**
 * The stall ceiling every axios-based vendor call uses.
 *
 * ── [FEAT-20260908-AITIMEOUT] RAISED 30s → 45s, BOTH VENDORS ────────────────
 * Owner decision, 08/09/2026: Gemini 45s, DeepSeek 45s, and the reply lane's
 * timeout retry 30s (`AI_RETRY_HTTP_OPTS` in `gemini-reply.transport.ts`).
 *
 * WHY IT WAS RAISED. 30s was chosen as "7.6x the worst generate_response ever
 * measured (max 3953ms)". Re-measured on 30/08/2026 the worst was 23,022ms — the
 * tail had grown 5.8x while the ceiling stood still, leaving a margin of 1.3x, so
 * healthy-but-slow answers were being cut off and read as failures. On the reply
 * lane a cut-off answer means the customer gets nothing.
 *
 * 🔴 THE BUDGET STILL FITS THE ONE HARD DEADLINE. 45 + 30 = 75s, and
 *    `REPLY_STALE_MS` (`webhook-routing.ts:258`) is 120s — checked before this
 *    value was changed, not after. The retry stays SHORTER than the first
 *    attempt on purpose: the first attempt must never get slower than the value
 *    an OA already experiences, and the second exists to catch a transient stall,
 *    not to double the wait.
 *
 * ⚠️ ONE NUMBER, BOTH VENDORS — still. The earlier plan note argued DeepSeek
 *    might need its own, larger ceiling (field guidance suggests 60–120s) and
 *    that no DeepSeek latency has ever been measured on this stack, because no
 *    DeepSeek key is configured anywhere. That remains true: 45s is the owner's
 *    figure for both, not a measured DeepSeek number. If DeepSeek is ever fired
 *    live and stalls at 45s, this is the constant to split — and splitting it
 *    means giving `deepSeekHttpOpts` its own value, not moving this one.
 */
export const AI_HTTP_TIMEOUT_MS = 45_000;

/**
 * Axios options for a Gemini call — the key rides the query string.
 *
 * 🔴 IDENTITY MATTERS, NOT JUST THE VALUE. `wrap-ai-timeout-retry.spec.ts` PIN 5
 *    asserts `posts[0].config` is `toBe` — the same OBJECT — as the one nine call
 *    sites across six subsystems share, and that the timeout retry passes a
 *    DIFFERENT one. Declaring a second object with the same shape passes every
 *    `toEqual` and fails that pin, which is how the first draft of this file was
 *    caught. So this is THE object: `@/modules/ai/rag-engine.service` re-exports
 *    it from here rather than declaring its own.
 *
 * ⚠️ No `as const`. The shared object is passed to axios as a plain mutable
 *    options bag by nine callers; freezing its type here changes what those call
 *    sites accept for no behavioural gain.
 */
export const GEMINI_HTTP_OPTS = { timeout: AI_HTTP_TIMEOUT_MS };

/**
 * [FEAT-20260908-GEMINIKEYHEADER] Axios options for a Gemini call — the key rides
 * the `x-goog-api-key` HEADER, which is what Google's own guidance asks for.
 *
 * 🔴 WHY THE KEY MOVED OFF THE QUERY STRING. Measured against the live vendor on
 *    08/09/2026 with `z-test/tmp/gemini-key-placement-probe.ts`, same body, same
 *    model, same key, differing only in where the key sat:
 *      · both forms answered 200, with the same envelope keys
 *        (candidates, modelVersion, responseId, usageMetadata), the same
 *        finishReason (STOP) and the same modelVersion. Receiving is equivalent.
 *      · then a deliberate 404 (a model name that does not exist, so no
 *        inference is billed) was fired both ways and `err.config.url` read:
 *          query  -> the error object carried the LIVE KEY
 *          header -> it did not
 *    axios attaches the request URL to every error it throws, and this codebase
 *    logs error objects. That is the whole reason for the change, and it is a
 *    measurement rather than a quote from a docs page.
 *
 * ⚠️ A FRESH OBJECT PER CALL, AND THAT IS THE POINT. `GEMINI_HTTP_OPTS` below is
 *    shared by nine call sites and `wrap-ai-timeout-retry.spec.ts` PIN 5 asserts
 *    it is never mutated or re-keyed. Putting a per-request header on the shared
 *    object would leak one hook's key into every other caller's config — the
 *    exact failure that pin exists to prevent. So this SPREADS the shared value
 *    and never writes to it; the shared object stays `{ timeout }` forever.
 */
export function geminiHttpOpts(apiKey: string): {
  timeout: number;
  headers: { 'x-goog-api-key': string };
} {
  return {
    timeout: AI_HTTP_TIMEOUT_MS,
    headers: { 'x-goog-api-key': apiKey },
  };
}

/** Axios options for a DeepSeek call — the key rides an Authorization header. */
export function deepSeekHttpOpts(apiKey: string): {
  timeout: number;
  headers: { Authorization: string };
} {
  return {
    timeout: AI_HTTP_TIMEOUT_MS,
    headers: { Authorization: `Bearer ${apiKey}` },
  };
}
