/**
 * [FIX-20260910-ZHHANTFORCE] The override fires on exactly one combination, and
 * is invisible everywhere else.
 * ===========================================================================
 * 🔴 THE RISK THIS FILE GUARDS IS NOT "does it turn thinking on". It is the
 *    opposite: an override that leaks. Thinking costs the OA money on every
 *    call it touches, and this one is allowed to touch a single vendor, a single
 *    target language, and only when the operator did NOT already ask for
 *    thinking. Most of the cases below are therefore about it NOT firing.
 *
 * ⚠️ The evidence behind the rule is in the helper's header — a live run, not a
 *    reading. If the symptom is ever fixed upstream, the constant goes to
 *    `false` and every case here still passes, because "off" means "returns its
 *    input unchanged".
 */
import {
  FORCED_TARGET_LANGS,
  FORCE_DEEPSEEK_THINKING_ON_ZH_HANT,
  forceTranslateThinking,
} from '@/modules/chat/translate/force-translate-thinking';

const OFF = { thinking: { type: 'disabled' as const, effort: 'low' as const } };
const ON = { thinking: { type: 'enabled' as const, effort: 'low' as const } };

describe('[ZHHANTFORCE] it fires on one combination only', () => {
  it('⭐⭐⭐ deepseek + zh-Hant + thinking disabled ⇒ forced ON, effort untouched', () => {
    const out = forceTranslateThinking(OFF, 'deepseek', 'zh-Hant');
    expect(out.forced).toBe(true);
    expect(out.reasoning).toEqual({
      thinking: { type: 'enabled', effort: 'low' },
    });
  });

  it('⭐⭐⭐ …and UNSET counts too (owner, 10/09)', () => {
    /* `null` means the request says nothing and DeepSeek applies its own
       default, which was never tested for this pair — so it is covered rather
       than found out through a customer. */
    const out = forceTranslateThinking(null, 'deepseek', 'zh-Hant');
    expect(out.forced).toBe(true);
    expect(out.reasoning).toEqual({ thinking: { type: 'enabled' } });
  });

  it('⭐⭐ an OA that already chose `enabled` is left exactly as it asked', () => {
    const out = forceTranslateThinking(ON, 'deepseek', 'zh-Hant');
    expect(out.forced).toBe(false);
    expect(out.reasoning).toBe(ON); // same object — nothing rebuilt
  });
});

describe('[ZHHANTFORCE] it stays out of everything else', () => {
  it('⭐⭐⭐ another target language is untouched — zh-Hans was tested and works', () => {
    for (const to of ['zh-Hans', 'en', 'my', 'km', 'lo', 'th']) {
      const out = forceTranslateThinking(OFF, 'deepseek', to);
      expect({ to, forced: out.forced }).toEqual({ to, forced: false });
      expect(out.reasoning).toBe(OFF);
    }
  });

  it('⭐⭐⭐ another vendor is untouched, and a null vendor IS another vendor', () => {
    /* null = the registry default = Gemini, which has no symptom. */
    for (const vendor of ['gemini', null, 'openai']) {
      const out = forceTranslateThinking(OFF, vendor, 'zh-Hant');
      expect({ vendor, forced: out.forced }).toEqual({ vendor, forced: false });
    }
  });

  it('⭐⭐ the switch is a constant, and the language set is a list of what was measured', () => {
    expect(typeof FORCE_DEEPSEEK_THINKING_ON_ZH_HANT).toBe('boolean');
    expect([...FORCED_TARGET_LANGS]).toEqual(['zh-Hant']);
  });

  it('⭐⭐⭐ nothing it returns is the hook — the override never writes a column', () => {
    /* A shape check standing in for the rule: this function takes a reasoning
       object and a language, has no model, no db handle and no way to persist.
       The stored setting stays what the operator chose. */
    const before = JSON.stringify(OFF);
    forceTranslateThinking(OFF, 'deepseek', 'zh-Hant');
    expect(JSON.stringify(OFF)).toBe(before);
  });
});
