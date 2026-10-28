/**
 * [FEAT-20260828-MENUTAG-S1] the grammar + the postback codec.
 * PLAN: todo/task/28082026/todo1_28082026_menu-primary-tag.md §3b/§3c.
 *
 * The cases that carry the ZERO-IMPACT contract, not just the happy path:
 *   · a tap is the WHOLE text (C1.2) — a sentence containing the tag is not one
 *   · lowercase-only — an uppercase spelling is NOT ours and falls to the
 *     existing catch-all like any unknown marker
 *   · `default` is reserved, so default.ts belongs to the bare-level key alone
 *   · 🔴 the codec REQUIRES `menu:v1:` — the committed fixture `menu:open`
 *     (room-bootstrap-before-pack S08) must parse as NOT OURS, or a frozen
 *     snapshot flips (plan R16)
 *   · a broken/unclosed marker is stripped WHOLE — the legacy catch-all's
 *     unclosed class has no hyphen and would leave `-primary-x` on screen (R2)
 */
import {
  parseMenuTag,
  findMenuTag,
  hasMenuTag,
  stripMenuTags,
  scenarioFileName,
  variantFromFileName,
  scenarioKey,
  parseScenarioKey,
  buildMenuPostback,
  parseMenuPostback,
  MENU_POSTBACK_MAX_BYTES,
} from '@/modules/menu';

describe('[MENUTAG] inbound tap grammar', () => {
  it('parses all four shapes', () => {
    expect(parseMenuTag('[[[menu-primary]]]')).toEqual({
      level: 'primary',
      variant: null,
    });
    expect(parseMenuTag('[[[menu-primary-a]]]')).toEqual({
      level: 'primary',
      variant: 'a',
    });
    expect(parseMenuTag('[[[menu-second]]]')).toEqual({
      level: 'second',
      variant: null,
    });
    expect(parseMenuTag('[[[menu-second-promo2]]]')).toEqual({
      level: 'second',
      variant: 'promo2',
    });
  });

  it('⭐⭐ a tap is the WHOLE text — a sentence merely containing the tag is not one', () => {
    expect(parseMenuTag('ดูเมนู [[[menu-primary]]] หน่อย')).toBeNull();
    expect(parseMenuTag('  [[[menu-primary]]]  ')).not.toBeNull(); // surrounding space is fine
  });

  it('⭐⭐ lowercase only — an uppercase spelling is not a menu tag', () => {
    expect(parseMenuTag('[[[MENU-PRIMARY]]]')).toBeNull();
    expect(parseMenuTag('[[[Menu-Primary-A]]]')).toBeNull();
  });

  it('⭐⭐ `default` is reserved — default.ts belongs to the bare-level key', () => {
    expect(parseMenuTag('[[[menu-primary-default]]]')).toBeNull();
    expect(parseScenarioKey('primary-default')).toBeNull();
  });

  it('rejects unknown levels and two-bracket forms', () => {
    expect(parseMenuTag('[[[menu-third]]]')).toBeNull();
    expect(parseMenuTag('[[menu-primary]]')).toBeNull();
  });

  it('scenarioKey ↔ parseScenarioKey round-trip — ONE spelling in every layer', () => {
    for (const [level, variant] of [
      ['primary', null],
      ['primary', 'a'],
      ['second', null],
      ['second', 'promo2'],
    ] as const) {
      const key = scenarioKey(level, variant);
      expect(parseScenarioKey(key)).toEqual({ level, variant });
    }
  });
});

describe('[MENUTAG] outbound detection + strip', () => {
  it('finds the tag as a substring (the outbound half)', () => {
    expect(findMenuTag('answer text [[[menu-primary-a]]] tail')).toEqual({
      level: 'primary',
      variant: 'a',
    });
  });

  it('⭐⭐⭐ (R2) a BROKEN unclosed marker is stripped WHOLE — no `-primary-x` residue', () => {
    /* The legacy catch-all's unclosed class is [A-Za-z0-9_*] — no hyphen — so
       it would eat only `[[[menu` and leave `-primary-x` on the screen. */
    expect(stripMenuTags('hi [[[menu-primary-x sorry')).toBe(
      'hi  sorry'.trim(),
    );
    expect(stripMenuTags('[[[menu-second-b]]]')).toBe('');
    expect(stripMenuTags('[[menu-primary')).toBe('');
  });

  it('⭐⭐ hasMenuTag is exactly `findMenuTag !== null` — one detector, never a second opinion', () => {
    /* S5 asks "does this answer carry a menu tag?" through this helper and
       strips through stripMenuTags. If the two ever disagreed, the outbound
       half would strip a tag it never detected (or leave one it did) and a
       raw marker would reach the customer. Backtest 28/08 found this export
       unused AND unpinned — a mutation to it survived the whole suite. */
    for (const text of [
      'answer [[[menu-primary-a]]] tail',
      '[[[menu-second]]]',
      '[[[menu-primary-default]]]', // reserved ⇒ not ours
      '[[[MENU-PRIMARY]]]', // uppercase ⇒ not ours
      'ordinary prose [[[img_promo]]]',
      '',
    ]) {
      expect({ text, has: hasMenuTag(text) }).toEqual({
        text,
        has: findMenuTag(text) !== null,
      });
    }
    /* stated absolutely too, so mutating BOTH in the same direction cannot
       keep the comparison above vacuously true */
    expect(hasMenuTag('answer [[[menu-primary-a]]] tail')).toBe(true);
    expect(hasMenuTag('ordinary prose')).toBe(false);
  });

  it('leaves ordinary prose and other families untouched', () => {
    expect(stripMenuTags('ราคา [ดูรูป] 1 [[[img_promo]]]')).toBe(
      'ราคา [ดูรูป] 1 [[[img_promo]]]',
    );
  });

  it('⭐⭐ a non-string is stripped to empty — never coerced to "[object Object]"', () => {
    /* S5 hands this whatever an answer builder produced. A coerced object
       would put the literal text `[object Object]` on a customer's screen, and
       a coerced null would put `null` — both silent, both live. The source
       already claimed this in a comment; the 28/08 backtest showed no test
       held it, so removing the guard stayed green. */
    for (const value of [undefined, null, 42, { a: 1 }, ['x']]) {
      expect(stripMenuTags(value)).toBe('');
    }
  });
});

describe('[MENUTAG] the mechanical (level, variant) ↔ file-name rule', () => {
  it('⭐⭐ scenarioFileName ↔ variantFromFileName are exact inverses — `default.ts` belongs to the bare key', () => {
    /* Two halves of ONE rule (plan §3a). The registry spec walks the folder
       with the inverse; this pins the forward half a future dynamic/per-hook
       loader will use to compute a path. Unpinned, it drifted silently:
       the 28/08 backtest mutated it to return 'index' and every test stayed
       green — the loader would then have looked for a file that never exists. */
    expect(scenarioFileName(null)).toBe('default');
    expect(scenarioFileName('a')).toBe('a');
    expect(variantFromFileName('default.ts')).toBeNull();
    for (const variant of [null, 'a', 'f', 'promo2'] as const) {
      expect(variantFromFileName(`${scenarioFileName(variant)}.ts`)).toBe(
        variant,
      );
    }
  });
});

describe('[MENUTAG] postback codec', () => {
  it('builds and parses the full versioned shape', () => {
    const p = buildMenuPostback('primary-a', 'item-1');
    expect(p).toBe('menu:v1:primary-a:item-1');
    expect(parseMenuPostback(p)).toEqual({
      scenarioKey: 'primary-a',
      itemId: 'item-1',
    });
  });

  it('🔴🔴 the committed fixture `menu:open` is NOT OURS — the frozen S08 snapshot must not flip', () => {
    expect(parseMenuPostback('menu:open')).toBeNull();
    expect(parseMenuPostback('menu:v2:primary:item-1')).toBeNull();
    expect(parseMenuPostback('menu:primary:item-1')).toBeNull();
  });

  it('foreign payloads fall through (the pay:/hoc: contract)', () => {
    expect(parseMenuPostback('pay:resume:run-1:2')).toBeNull();
    expect(parseMenuPostback('hoc:whatever')).toBeNull();
    expect(parseMenuPostback('')).toBeNull();
    expect(parseMenuPostback(undefined)).toBeNull();
  });

  it('⭐ a payload that LINE would truncate fails at BUILD time, loudly', () => {
    const huge = 'x'.repeat(MENU_POSTBACK_MAX_BYTES);
    expect(() => buildMenuPostback('primary', huge)).toThrow(/exceeds/);
    expect(() => buildMenuPostback('not a key', 'item-1')).toThrow(
      /scenario key/,
    );
    expect(() => buildMenuPostback('primary', 'BAD ID')).toThrow(/item id/);
  });
});
