/**
 * [FEAT-20260909-VENDORTRANSLATE] The translate lane follows its own column,
 * and every hook that never set one is unmoved.
 * ===========================================================================
 * The column landed in P1 and the clone paths were pinned in P2. Neither of
 * those made anything READ it — this is the commit where the choice starts
 * having an effect, so this is where the fallback has to be nailed down.
 *
 * 🔴 THE CASE THAT MATTERS MOST IS T1, THE ONE THAT LOOKS TRIVIAL. Seven live
 *    OAs have no `ai_vendor_translate`, and the whole "everything added is
 *    optional" claim comes down to them resolving to exactly the vendor they
 *    resolved to yesterday. A regression here is invisible: the lane keeps
 *    working, it just quietly answers on the wrong vendor and bills the wrong
 *    account.
 *
 * ⚠️ WHY THE BLANK CASES ARE ENUMERATED RATHER THAN SUMMARISED. `''`, `'   '`,
 *    `null`, `undefined` and a non-string all have to mean the same thing, and
 *    a single `?? ` written without thinking gets `''` wrong — an empty string
 *    is not nullish, so `row['ai_vendor_translate'] ?? row['ai_vendor']` would
 *    return `''` and route the lane to the default vendor instead of to the
 *    one the OA actually runs on. That is a one-character bug with no symptom
 *    other than the wrong invoice.
 *
 * revert: delete this spec with `resolve-translate-vendor.ts`.
 */
import { resolveTranslateVendor } from '@/modules/chat/translate/resolve-translate-vendor';

describe('[VENDORTRANSLATE] an OA that never chose is exactly where it was', () => {
  it('T1 · ⭐ no column at all ⇒ the webhook vendor, unchanged', () => {
    expect(resolveTranslateVendor({ ai_vendor: 'deepseek' })).toBe('deepseek');
    expect(resolveTranslateVendor({ ai_vendor: 'gemini' })).toBe('gemini');
  });

  it('T2 · neither column ⇒ null, which is what this lane returned before', () => {
    /* `null` means "the default vendor" everywhere in this repo, and it is the
       answer all seven live rows produce today. */
    expect(resolveTranslateVendor({})).toBeNull();
    expect(resolveTranslateVendor({ ai_vendor: null })).toBeNull();
  });

  it('T3 · every shape of "not chosen" falls through, including the empty string', () => {
    for (const blank of [null, undefined, '', '   ', 0, false, {}, []]) {
      expect(
        resolveTranslateVendor({
          ai_vendor_translate: blank,
          ai_vendor: 'deepseek',
        }),
      ).toBe('deepseek');
    }
  });
});

describe('[VENDORTRANSLATE] a choice overrides, in both directions', () => {
  it('T4 · ⭐ webhook on gemini, translate on deepseek', () => {
    expect(
      resolveTranslateVendor({
        ai_vendor: 'gemini',
        ai_vendor_translate: 'deepseek',
      }),
    ).toBe('deepseek');
  });

  it('T5 · ⭐ and the reverse — the pair is not one-way', () => {
    expect(
      resolveTranslateVendor({
        ai_vendor: 'deepseek',
        ai_vendor_translate: 'gemini',
      }),
    ).toBe('gemini');
  });

  it('T6 · a translate choice stands even with no webhook vendor at all', () => {
    /* The common shape on a live row: `ai_vendor` is absent on all seven, so an
       operator who sets only the translate box must still get their choice. */
    expect(resolveTranslateVendor({ ai_vendor_translate: 'deepseek' })).toBe(
      'deepseek',
    );
  });

  it('T7 · stored padding is trimmed, so it compares equal to a clean name', () => {
    expect(resolveTranslateVendor({ ai_vendor_translate: ' deepseek ' })).toBe(
      'deepseek',
    );
  });
});

describe('[VENDORTRANSLATE] what it deliberately does not do', () => {
  it('T8 · it does not validate — an unknown name is returned as-is', () => {
    /* Both write paths run `parseAiVendor`, so this cannot arrive from a form.
       Rejecting here would only break rows written before the column existed,
       and downstream an unknown value resolves to the default vendor the same
       way it does for `ai_vendor`. */
    expect(resolveTranslateVendor({ ai_vendor_translate: 'openai' })).toBe(
      'openai',
    );
  });

  it('T9 · it reads nothing but those two keys', () => {
    /* A guard against the resolver quietly growing a dependency on the row's
       shape — it must stay a pure function of two columns, because that is what
       makes it safe to call with a `.lean()` document. */
    const row = {
      ai_vendor: 'gemini',
      ai_model: 'gemini-3.5-flash',
      custom_ai_key: 'enc:AAA',
      custom_ai_key_sec: 'enc:BBB',
      alias: 'some-oa',
    };
    const before = JSON.stringify(row);
    expect(resolveTranslateVendor(row)).toBe('gemini');
    expect(JSON.stringify(row)).toBe(before);
  });
});
