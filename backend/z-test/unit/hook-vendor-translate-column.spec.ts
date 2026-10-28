/**
 * [FEAT-20260909-VENDORTRANSLATE] Translate may pick its own vendor.
 * ============================================================================
 * Owner, 09/09: chat translate must be able to pick its own provider,
 * separately from the webhook, which already has a field for that — but the
 * key boxes can be shared between them.
 *
 * So: a SECOND vendor column, `ai_vendor_translate`, and **no second key
 * column.** The key columns are per VENDOR (`custom_ai_key` is Gemini's,
 * `custom_ai_key_sec` is DeepSeek's), so translate pointed at DeepSeek reads
 * the same key the webhook would — the sharing the owner asked for already
 * existed, and this column only chooses which side of it to read.
 *
 * WHAT THIS FILE IS FOR. A vendor column costs FOUR registrations, and
 * `hook.schema.ts` says so in its own revert note: the Prop, `FIELD_TAB`,
 * `ALLOWED_UPDATES`, and the parser. **Miss one and nothing fails loudly** —
 * `tsc` is happy, the PUT answers 200, and the operator's choice is dropped on
 * the floor. That silent-drop class is what every comment in `ALLOWED_UPDATES`
 * warns about, and it is the only reason this spec exists.
 *
 * 🔴 WHAT IT DELIBERATELY DOES NOT TEST: that translate READS the column. It
 *    does not yet — that is P3. Asserting it here would pass for the wrong
 *    reason (the fallback makes both answers identical today) and would go on
 *    passing if P3 were never written. Green because nobody reads it yet is not
 *    evidence of anything.
 *
 * RED-FIRST: every case below was run against the tree before the column
 * existed. T1/T2/T3 failed on a missing key, T5/T6 on the message text.
 *
 * revert: delete this spec together with the Prop and its three registrations.
 */

import { FIELD_TAB } from '@/modules/hooks/hook-field-tabs';
import {
  parseAiVendor,
  AI_VENDORS,
} from '@/modules/hooks/ai-vendor/parse-ai-vendor';
import { HookSchema } from '@/modules/hooks/schemas/hook.schema';

const FIELD = 'ai_vendor_translate';

describe('[VENDORTRANSLATE] the column is registered in all four places', () => {
  it('T1 · the schema has it, defaulting to null — "follow ai_vendor"', () => {
    const path = HookSchema.path(FIELD) as unknown as {
      instance: string;
      defaultValue: unknown;
    };
    expect(path).toBeDefined();
    expect(path.instance).toBe('String');
    /* null, not '' and not 'gemini': an unset column must be distinguishable
       from a deliberate choice, because that is what "follow the main vendor"
       is stored as. */
    expect(path.defaultValue).toBeNull();
  });

  it('T2 · it sits on the AI tab, like the vendor it sits beside', () => {
    expect(FIELD_TAB[FIELD]).toBe('ai');
    /* Pinned together so a future edit that moves one moves both, or fails. */
    expect(FIELD_TAB['ai_vendor']).toBe('ai');
  });

  it('T3 · 🔴 it is in ALLOWED_UPDATES — the list whose absence is silent', () => {
    /* Read from the source rather than imported: the list is a private static
       on the service, and standing up the whole service to read one array
       would drag in Mongo, the crypto module and half the DI graph. What
       matters is that the NAME is in the literal, which is exactly what the
       write path indexes by. */
    const src = readServiceSource();
    const list = sliceAllowedUpdates(src);
    expect(list).toContain(FIELD);
    /* Guards the slice itself: if the extraction ever stops finding the real
       list, this says so instead of quietly passing on an empty array. */
    expect(list).toContain('ai_vendor');
    expect(list.length).toBeGreaterThan(10);
  });

  it('T4 · both parser call sites pass the field name, so a typo blames the right box', () => {
    const src = readServiceSource();
    /* Two sites: create (`body[...]`) and update (`updates[...]`). Both must
       hand the field name in, or the operator is told `ai_vendor` is wrong
       while the box they actually mistyped sits untouched beside it. */
    const calls = src.match(
      /parseAiVendor\(\s*(?:body|updates)\['ai_vendor_translate'\],\s*'ai_vendor_translate',?\s*\)/g,
    );
    expect(calls?.length).toBe(2);
  });
});

describe('[VENDORTRANSLATE] the parser, and the callers it must not disturb', () => {
  it('T5 · a bad name is refused, and the message names THIS field', () => {
    expect(() => parseAiVendor('gemni', FIELD)).toThrow(/ai_vendor_translate/);
    /* The whole point of the second argument: without it this message would
       point the operator at the other box. */
    expect(() => parseAiVendor('gemni', FIELD)).not.toThrow(/^ai_vendor must/);
  });

  it('T6 · 🔴 EVERY EXISTING CALLER IS BYTE-IDENTICAL — the default is the old literal', () => {
    /* This is the "everything added is optional" proof for the parser. The
       field argument defaults to what this function has always thrown, so the
       four call sites that predate it produce the same string they always did.
       Mutation: change the default to anything else and this goes red. */
    let msg = '';
    try {
      parseAiVendor('nope');
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toBe(
      `ai_vendor must be one of: ${AI_VENDORS.join(', ')} (or empty for the default)`,
    );
  });

  it('T7 · empty and null both mean "follow the main vendor"', () => {
    expect(parseAiVendor('', FIELD)).toBeNull();
    expect(parseAiVendor(null, FIELD)).toBeNull();
    /* undefined is "the caller did not send this field" and must pass straight
       through, or an edit that omits it would clear a stored choice. */
    expect(parseAiVendor(undefined, FIELD)).toBeUndefined();
  });

  it('T8 · both real vendors are accepted, and the list is the shared one', () => {
    for (const v of AI_VENDORS) {
      expect(parseAiVendor(v, FIELD)).toBe(v);
    }
    /* No second list to drift: translate chooses from the SAME vendors the
       webhook does, which is what makes the shared key columns work. */
    expect([...AI_VENDORS]).toEqual(['gemini', 'deepseek']);
  });
});

describe('[VENDORTRANSLATE] an untouched hook is untouched', () => {
  it('T9 · a hook that never sets it carries null, and that is on purpose', () => {
    /* Read through the schema rather than asserted on a literal, so this
       measures what Mongoose actually installs. `default: null` means the key
       IS present and null — deliberately different from `translations`, where
       `default: undefined` keeps the key absent. A column that says "follow
       the main vendor" is meaningful as an explicit null; an empty array is
       not meaningful as an empty array. */
    const path = HookSchema.path(FIELD) as unknown as { defaultValue: unknown };
    expect(path.defaultValue).toBeNull();
    expect(path.defaultValue).not.toBeUndefined();
  });

  it('T10 · it is NOT a credential — it must never be in the sensitive map', () => {
    /* A vendor name is a name. Putting it in the sensitive map would encrypt
       it, mask it on read and hand the browser `********` where a select needs
       a value — the field would look broken rather than fail. */
    const src = readTabsSource();
    const sensitiveHalf = src.slice(src.indexOf('SENSITIVE'));
    expect(sensitiveHalf).not.toContain(FIELD);
  });
});

/* ── helpers ──────────────────────────────────────────────────────────────── */

function readServiceSource(): string {
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const { join } = require('node:path') as typeof import('node:path');
  return readFileSync(
    join(__dirname, '..', '..', 'src/modules/hooks/hooks.service.ts'),
    'utf8',
  );
}

function readTabsSource(): string {
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const { join } = require('node:path') as typeof import('node:path');
  return readFileSync(
    join(__dirname, '..', '..', 'src/modules/hooks/hook-field-tabs.ts'),
    'utf8',
  );
}

/**
 * Pull the quoted names out of the ALLOWED_UPDATES literal.
 *
 * ⚠️ This reads SOURCE TEXT, which this feature has already been bitten by
 *    three times (`ai-vendor-single-door:178` · `replyUi` · `member-plates`).
 *    It is defended two ways: the slice is anchored to the closing bracket
 *    rather than a line count, and T3 asserts the result is non-trivial, so an
 *    extraction that silently matches nothing fails instead of passing.
 */
function sliceAllowedUpdates(src: string): string[] {
  const start = src.indexOf('ALLOWED_UPDATES');
  expect(start).toBeGreaterThan(-1);
  const open = src.indexOf('[', start);
  const close = src.indexOf('];', open);
  expect(close).toBeGreaterThan(open);
  return [...src.slice(open, close).matchAll(/'([a-z0-9_]+)'/g)]
    .map((m) => m[1])
    .filter((n): n is string => typeof n === 'string');
}
