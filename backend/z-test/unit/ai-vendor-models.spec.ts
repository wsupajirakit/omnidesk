/**
 * [FEAT-20260908-AIVENDORMODELS] The model registry is a RENAME, and this proves it.
 * ref: todo/task/07092026/be_todo109_07092026_aivendorcore.md §13 SAVE POINT 2
 * ============================================================================
 * Five family constants and four identical `resolveModelId` copies collapsed into
 * `src/modules/ai-vendor/models.ts`. The whole claim is "no value moved", so the
 * test has to be able to FAIL on a moved value.
 *
 * 🔴 THE VALUES ARE PINNED AGAINST STRING LITERALS, NOT AGAINST EACH OTHER.
 *    `expect(GEMINI_FAMILY_MODEL).toBe(familyModel('gemini','reply'))` would pass
 *    forever — both sides read the same registry, so a typo in the registry
 *    changes both and the test still agrees with itself. Every assertion below
 *    therefore names the literal the transport declared BEFORE this change.
 *
 * ⚠️ WHAT THIS DOES NOT COVER. It does not prove the request bytes are unchanged
 *    — `ai-vendor-wire-baseline.spec.ts` does that, and it reads the model out of
 *    the assembled body. Both are needed: this one catches a wrong default, that
 *    one catches a wrong placement.
 *
 * revert: delete this file with `models.ts`.
 */
import {
  FAMILY_DEFAULTS,
  MODEL_CAPABILITIES,
  familyModel,
  resolveModelId,
} from '../../src/modules/ai-vendor';
import { GEMINI_FAMILY_MODEL } from '../../src/modules/webhook/ai-vendors/gemini/gemini-reply.transport';
import { GEMINI_SUMMARY_FAMILY_MODEL } from '../../src/modules/webhook/ai-vendors/gemini/gemini-summary.transport';
import { GEMINI_TRANSLATE_FAMILY_MODEL } from '../../src/modules/ai-translate/vendors/gemini-translate.transport';
import {
  DEEPSEEK_FAMILY_MODEL,
  resolveDeepSeekModelId,
} from '../../src/modules/webhook/ai-vendors/deepseek/deepseek-reply.transport';

/**
 * The literals each transport is expected to resolve to.
 *
 * ⚠️ [FIX-20260909-DSMODELID] THIS WAS `BEFORE` — the literals as they stood
 *    before the registry extraction — and the whole point of it was that the
 *    move changed no value. That promise held and is still worth keeping for
 *    Gemini; the three DeepSeek entries have since changed ON PURPOSE, so the
 *    name would now be a lie.
 *
 *    `deepseek-chat` was retired here on 09/09 because it is not a model: the
 *    vendor's `/v1/models` does not list it, the documentation does not mention
 *    it, and a live call revealed it to be an undocumented ALIAS whose response
 *    comes back as `deepseek-v4-flash`. The request was already being served by
 *    this model; naming it removes a dependency on an alias the vendor can
 *    retire without warning.
 */
const EXPECTED = {
  geminiReply: 'gemini-3.5-flash',
  geminiSummary: 'gemini-3.5-flash',
  geminiTranslate: 'gemini-3.5-flash',
  deepseekReply: 'deepseek-v4-flash',
  deepseekSummary: 'deepseek-v4-flash',
  deepseekTranslate: 'deepseek-v4-flash',
} as const;

describe('[FEAT-20260908-AIVENDORMODELS] the registry holds the CURRENT values', () => {
  it('🔴 every family default equals the literal it is meant to send', () => {
    expect({
      geminiReply: familyModel('gemini', 'reply'),
      geminiSummary: familyModel('gemini', 'summary'),
      geminiTranslate: familyModel('gemini', 'translate'),
      deepseekReply: familyModel('deepseek', 'reply'),
      deepseekSummary: familyModel('deepseek', 'summary'),
      deepseekTranslate: familyModel('deepseek', 'translate'),
    }).toEqual(EXPECTED);
  });

  it('🔴 the names each transport still exports resolve to the same literals', () => {
    /* The re-export is the compatibility promise — two specs and the URL builder
       import these names from their old paths. Asserted against the literal, so
       a registry typo cannot make this agree with itself. */
    expect(GEMINI_FAMILY_MODEL).toBe('gemini-3.5-flash');
    expect(GEMINI_SUMMARY_FAMILY_MODEL).toBe('gemini-3.5-flash');
    expect(GEMINI_TRANSLATE_FAMILY_MODEL).toBe('gemini-3.5-flash');
    expect(DEEPSEEK_FAMILY_MODEL).toBe('deepseek-v4-flash');
  });

  it('covers every vendor and role, so a new lane cannot be added untested', () => {
    /* Without this, adding `FAMILY_DEFAULTS.gemini.classify` would ship with no
       assertion at all and the suite would stay green. */
    expect(Object.keys(FAMILY_DEFAULTS).sort()).toEqual(['deepseek', 'gemini']);
    for (const vendor of Object.keys(FAMILY_DEFAULTS)) {
      expect(
        Object.keys(FAMILY_DEFAULTS[vendor as 'gemini' | 'deepseek']).sort(),
      ).toEqual(['reply', 'summary', 'translate']);
    }
  });
});

describe('[FEAT-20260908-AIVENDORMODELS] resolveModelId — all four copies behaved like this', () => {
  it("the hook's choice wins", () => {
    expect(resolveModelId('gemini-3.6-flash', 'FALLBACK')).toBe(
      'gemini-3.6-flash',
    );
  });

  it('🔴 a whitespace-only value is NOT a model — it falls back', () => {
    /* Every original copy trimmed. Dropping the trim would send `'   '` to the
       vendor as a model name, which is a guaranteed error, and a blank column is
       exactly what an OA that never chose a model has. */
    expect(resolveModelId('   ', 'FALLBACK')).toBe('FALLBACK');
    expect(resolveModelId('', 'FALLBACK')).toBe('FALLBACK');
  });

  it('null and undefined fall back', () => {
    expect(resolveModelId(null, 'FALLBACK')).toBe('FALLBACK');
    expect(resolveModelId(undefined, 'FALLBACK')).toBe('FALLBACK');
  });

  it('🔴 the surrounding whitespace is stripped, not just detected', () => {
    /* `' x '` must become `'x'`, not `' x '`. A copy that only used trim() for
       the emptiness TEST and then passed the raw value through would still pass
       every case above. */
    expect(resolveModelId('  gemini-3.6-flash  ', 'FALLBACK')).toBe(
      'gemini-3.6-flash',
    );
  });

  it('the still-exported wrapper behaves identically', () => {
    expect(resolveDeepSeekModelId('  deepseek-reasoner ')).toBe(
      'deepseek-reasoner',
    );
    expect(resolveDeepSeekModelId('   ')).toBe('deepseek-v4-flash');
    expect(resolveDeepSeekModelId(null)).toBe('deepseek-v4-flash');
  });
});

describe('[FEAT-20260908-AIVENDORMODELS] capabilities are notes, not decisions', () => {
  it("records the slip lane's pin and why it is pinned", () => {
    expect(MODEL_CAPABILITIES['gemini-2.5-flash']).toEqual({
      supportsThinking: false,
      supportsInlineData: true,
    });
  });

  it('🔴 an unknown model is ABSENT, which must never read as "unsupported"', () => {
    /* The map is deliberately sparse. If a future caller treats a miss as
       `supportsThinking: false` it will silently strip thinking from every model
       not listed here — which is every model the product actually uses. */
    expect(MODEL_CAPABILITIES['gemini-3.5-flash']).toBeUndefined();
    expect(MODEL_CAPABILITIES['deepseek-chat']).toBeUndefined();
  });
});
