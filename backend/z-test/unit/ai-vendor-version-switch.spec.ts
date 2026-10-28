/**
 * [FEAT-20260907-AIVENDORCORE] The API version is one switch, and it moves everything.
 * ref: todo/task/07092026/be_todo109_07092026_aivendorcore.md
 *
 * The point of the door is not that the URL is tidy — it is that the decision has
 * ONE owner. This asserts that: the base is DERIVED from `GEMINI_API_VERSION`, so
 * flipping that value moves every Gemini caller together and cannot move only
 * some of them, which is exactly the state this change found the codebase in
 * (three `/v1`, one `/v1beta`, in one file).
 *
 * ⚠️ It deliberately does NOT assert which version is selected. That is a policy
 *    recorded in `ai-endpoints.ts` with the evidence for both; a test that pinned
 *    it would turn a documented choice into a locked one.
 */
import {
  GEMINI_API_BASE,
  GEMINI_API_VERSION,
  geminiBaseFor,
} from '../../src/common/ai-endpoints';
import { geminiUrl } from '../../src/modules/ai-vendor';

describe('[FEAT-20260907-AIVENDORCORE] one version switch', () => {
  it('the base is derived from the version, not typed out beside it', () => {
    expect(GEMINI_API_BASE).toBe(
      `https://generativelanguage.googleapis.com/${GEMINI_API_VERSION}`,
    );
  });

  it('🔴 every URL the door builds carries that one version', () => {
    const url = geminiUrl('gemini-3.5-flash');
    expect(url.startsWith(`${GEMINI_API_BASE}/models/`)).toBe(true);
    /* both versions must never appear at once — the state this change removed */
    const hasV1 = /\/v1\/models\//.test(url);
    const hasBeta = /\/v1beta\/models\//.test(url);
    expect(hasV1 && hasBeta).toBe(false);
    expect(hasV1 || hasBeta).toBe(true);
  });

  it('the explicit-version helper builds both, so pinning one is possible without a literal', () => {
    expect(geminiBaseFor('v1')).toBe(
      'https://generativelanguage.googleapis.com/v1',
    );
    expect(geminiBaseFor('v1beta')).toBe(
      'https://generativelanguage.googleapis.com/v1beta',
    );
  });

  it('the path is identical whichever version is selected', () => {
    /* Switching versions must change the base and NOTHING else — no model name,
       no `:generateContent`. */
    const url = geminiUrl('m');
    const tail = url.slice(GEMINI_API_BASE.length);
    expect(tail).toBe('/models/m:generateContent');
  });

  it('🔴 [FEAT-20260908-GEMINIKEYHEADER] the URL carries NO KEY AND NO QUERY AT ALL', () => {
    /* This case used to assert the opposite — "the key is still appended
       UNENCODED" — which every legacy transport had called a transcribed hazard
       and preserved anyway. It is now inverted on purpose, so it fails the day
       anybody puts a credential back into a Gemini URL.
     *
     * WHY IT MATTERS, measured rather than asserted on principle: axios attaches
     * the request URL to every error it throws, and this codebase logs error
     * objects. Fired against the live vendor on 08/09/2026 with an invalid model
     * name (a 404, so no inference was billed), `err.config.url` carried the LIVE
     * KEY in the query form and carried none in the header form. */
    const url = geminiUrl('m');
    expect(url).not.toContain('?');
    expect(url).not.toContain('key=');
    /* and the builder takes no key to leak — arity is the guard */
    expect(geminiUrl.length).toBe(1);
  });
});
