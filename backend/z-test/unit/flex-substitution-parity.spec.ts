import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  applyFlexProfileVars,
  buildContextVarMap,
  extractFlexProfileFields,
  renderFlexDoc,
  resolveSourceRoles,
} from '@/modules/webhook/flex/flex-render.util';

/**
 * DIFFERENTIAL test for flex variable substitution: the ported
 * `flex-render.util.ts` run against the ACTUAL legacy function it was ported
 * from, on identical inputs, asserting identical output.
 *
 * WHY DIFFERENTIAL AND NOT A TABLE OF EXPECTATIONS
 * `webhook-reply-render.spec.ts` already covers this area with hand-written
 * expectations. Those record what the author BELIEVED legacy does. This file
 * runs legacy and compares, which is the only way to catch the class of defect
 * the brief calls out: an "improvement" over legacy is a DEFECT, and an
 * expectation table written by the same person who wrote the port will happily
 * encode the improvement as the expected value.
 *
 * The five substitution edge cases named in the brief each get a case below:
 * a missing value, an empty string, an explicit null, a deep path that does not
 * exist, and a value containing characters that must be JSON-escaped.
 *
 * ── HOW LEGACY IS LOADED ────────────────────────────────────────────────────
 * `applyFlexProfileVars` lives inside a 5000-line controller that requires
 * mongoose models, axios and a dozen services at module scope — requiring it
 * would open sockets. Instead the function's exact line range is read out of the
 * file and evaluated on its own, the same technique `slip-flow-parity.spec.ts`
 * uses. The range covers `FLEX_DROP` through the close of the function, and its
 * only free identifiers are `FALLBACK_IMAGE_URL` and `isUsableImageUrl`, which
 * are supplied from legacy's own config module.
 *
 * NOTHING LEAVES THE PROCESS: no database, no HTTP, no AI provider. The
 * evaluated range is pure data transformation.
 */
const LEGACY_ROOT = resolve(__dirname, '../../../legacy-api');
const LEGACY_CONTROLLER = `${LEGACY_ROOT}/src/controllers/core-bot/webhookController.js`;
const LEGACY_IMAGE_FALLBACK = `${LEGACY_ROOT}/src/config/flexImageFallback.js`;
const LEGACY_VAR_SOURCES = `${LEGACY_ROOT}/src/config/flexVarSources.js`;
const LEGACY_PROFILE_FIELDS = `${LEGACY_ROOT}/src/services/core-bot/flexProfileFieldsService.js`;

const legacyAvailable =
  existsSync(LEGACY_CONTROLLER) &&
  existsSync(LEGACY_IMAGE_FALLBACK) &&
  existsSync(LEGACY_VAR_SOURCES);

type ApplyFn = (
  node: unknown,
  vars: Record<string, string> | null | undefined,
  opts?: { dropWhenEmpty?: Set<string> },
) => unknown;

/**
 * Extracts `applyFlexProfileVars` from the legacy controller by ANCHORING on
 * stable landmarks rather than hardcoded line offsets, which drift whenever the
 * 5000-line controller is edited above the function.
 *
 * The slice runs from `const FLEX_DROP` (the declaration the function needs and
 * that sits immediately above it) through the closing brace of the function
 * body. Anchoring on `const FLEX_DROP` is what keeps `FALLBACK_IMAGE_URL` and
 * `isUsableImageUrl` as FREE identifiers here — their `const … = require(...)`
 * declarations live above this marker and are excluded, so they can be injected
 * as `new Function` parameters without colliding with an in-slice declaration.
 */
const extractApplyFlexProfileVars = (): string => {
  const lines = readFileSync(LEGACY_CONTROLLER, 'utf8').split('\n');
  const start = lines.findIndex((l) => /^const FLEX_DROP = Symbol\(/.test(l));
  if (start < 0) {
    throw new Error('legacy anchor `const FLEX_DROP` not found — file drifted');
  }
  const fnStart = lines.findIndex(
    (l, i) => i > start && /^function applyFlexProfileVars\(/.test(l),
  );
  if (fnStart < 0) {
    throw new Error(
      'legacy anchor `function applyFlexProfileVars(` not found — file drifted',
    );
  }
  // The function closes at the first line that is a bare `}` at column 0 — the
  // controller's top-level declaration style. Brace-counting the raw text is
  // not safe here: `opts = {}` default params, the `{{…}}` regex literals and
  // the `{{tag}}` examples inside the comments all carry braces that a naive
  // counter miscounts. A column-0 `}` is unambiguous for a top-level function.
  const end = lines.findIndex((l, i) => i > fnStart && l === '}');
  if (end < 0) {
    throw new Error(
      'could not find close of applyFlexProfileVars — file drifted',
    );
  }
  return lines.slice(start, end + 1).join('\n');
};

/**
 * Evaluate the legacy range in an isolated scope.
 *
 * The image-fallback pair is injected as parameters rather than left to a
 * `require`, so the evaluated code touches nothing beyond what is handed to it.
 * They come from legacy's OWN config file, so the fallback url compared against
 * is legacy's real one and not a value restated here.
 */
function loadLegacyApply(): ApplyFn {
  const { FALLBACK_IMAGE_URL, isUsableImageUrl } = require(
    LEGACY_IMAGE_FALLBACK,
  ) as {
    FALLBACK_IMAGE_URL: string;
    isUsableImageUrl: (u: unknown) => boolean;
  };

  const src = extractApplyFlexProfileVars();
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    'FALLBACK_IMAGE_URL',
    'isUsableImageUrl',
    `${src}\nreturn applyFlexProfileVars;`,
  ) as (f: string, u: (u: unknown) => boolean) => ApplyFn;
  return factory(FALLBACK_IMAGE_URL, isUsableImageUrl);
}

const describeIf = legacyAvailable ? describe : describe.skip;

describeIf('flex substitution — port vs legacy, differentially', () => {
  let legacyApply: ApplyFn;

  beforeAll(() => {
    legacyApply = loadLegacyApply();
  });

  /**
   * Runs BOTH implementations and asserts identical output.
   *
   * Compared with `toEqual` on the returned structures rather than on
   * `JSON.stringify`, so a key present with value `undefined` on one side and
   * absent on the other is still caught.
   */
  const bothAgree = (
    node: unknown,
    vars: Record<string, string> | null | undefined,
    opts?: { dropWhenEmpty?: Set<string> },
  ): unknown => {
    const fromLegacy = legacyApply(structuredClone(node), vars, opts);
    const fromPort = applyFlexProfileVars(structuredClone(node), vars, opts);
    expect(fromPort).toEqual(fromLegacy);
    // Serialised form too: this is what actually goes on the wire to LINE, and
    // it catches an ordering or undefined-vs-absent difference toEqual forgives.
    expect(JSON.stringify(fromPort)).toBe(JSON.stringify(fromLegacy));
    return fromLegacy;
  };

  const textCard = (text: string): Record<string, unknown> => ({
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [{ type: 'text', text }],
    },
  });

  // ── the five cases the brief names ────────────────────────────────────────

  describe('the five substitution edge cases', () => {
    it('1. a MISSING value keeps the literal tag, it does not blank', () => {
      // Legacy is the spec: an unknown tag survives as text so a typo is
      // visible. Blanking it would be the "improvement" that is a defect.
      const out = bothAgree(textCard('hi {{not_in_the_map}}'), {
        bank_code: 'Bangkok Bank',
      });
      expect(JSON.stringify(out)).toContain('{{not_in_the_map}}');
    });

    it('2. an EMPTY STRING value empties the text, which then becomes "-"', () => {
      // The variable IS in the map, so it substitutes — to nothing. The text
      // component is then empty, and the empty-text rule rewrites it to '-'
      // because LINE rejects an empty text component outright.
      const out = bothAgree(textCard('{{phone}}'), { phone: '' });
      expect(JSON.stringify(out)).toContain('"text":"-"');
    });

    it('2b. an empty value NEXT TO other text does not trigger the dash', () => {
      const out = bothAgree(textCard('เบอร์ {{phone}}'), { phone: '' });
      expect(JSON.stringify(out)).toContain('เบอร์ ');
      expect(JSON.stringify(out)).not.toContain('"text":"-"');
    });

    it('3. a NULL value — the map holds null, not a string', () => {
      // `hasOwnProperty` is true, so the replacement runs and String(null)
      // yields the four characters "null". Legacy does not special-case it, so
      // neither may the port.
      const out = bothAgree(textCard('v={{maybe}}'), {
        maybe: null as unknown as string,
      });
      expect(JSON.stringify(out)).toContain('null');
    });

    it('3b. an UNDEFINED value in the map', () => {
      bothAgree(textCard('v={{maybe}}'), {
        maybe: undefined as unknown as string,
      });
    });

    it('4. a DEEP PATH that does not exist keeps its literal text', () => {
      const out = bothAgree(
        textCard('{{site_rules.nope.deeper}} and {{profile.a.b.c}}'),
        { 'site_rules.dep_min': '100' },
      );
      // Note the dotted tag only matches [a-zA-Z0-9_.]+, so both dotted tags
      // are seen as tags, found absent, and preserved verbatim.
      expect(JSON.stringify(out)).toContain('{{site_rules.nope.deeper}}');
      expect(JSON.stringify(out)).toContain('{{profile.a.b.c}}');
    });

    it('5. a value needing JSON ESCAPING survives byte for byte', () => {
      // Quotes, backslashes, newlines, tabs and a unicode line separator. If
      // either side built its output by string-concatenating JSON rather than
      // substituting into parsed objects, this is where it would corrupt.
      const nasty = 'He said "hi"\\ then\nnew\ttab   <b>&amp;</b>   emoji 🎉';
      const out = bothAgree(textCard('msg: {{note}}'), { note: nasty });
      const roundTripped = JSON.parse(JSON.stringify(out)) as {
        body: { contents: Array<{ text: string }> };
      };
      expect(roundTripped.body.contents[0]!.text).toBe(`msg: ${nasty}`);
    });

    it('5b. a value that itself looks like a tag is NOT re-substituted', () => {
      // Single-pass replacement: the inserted text is not rescanned. A value of
      // "{{phone}}" must appear literally rather than resolving a second time.
      const out = bothAgree(textCard('{{a}}'), {
        a: '{{phone}}',
        phone: '555',
      });
      expect(JSON.stringify(out)).toContain('{{phone}}');
      expect(JSON.stringify(out)).not.toContain('555');
    });
  });

  // ── the substitution mechanics around those cases ─────────────────────────

  describe('mechanics', () => {
    it('tag names are matched case-insensitively against a lowercase map', () => {
      bothAgree(textCard('{{BANK_CODE}} {{Bank_Code}} {{bank_code}}'), {
        bank_code: 'BBL',
      });
    });

    it('inner whitespace in the braces is tolerated', () => {
      bothAgree(textCard('{{  bank_code  }}'), { bank_code: 'BBL' });
    });

    it('keys are never substituted, only values', () => {
      bothAgree(
        { '{{bank_code}}': 'x', type: 'text', text: '{{bank_code}}' },
        {
          bank_code: 'BBL',
        },
      );
    });

    it('non-string leaves are untouched', () => {
      bothAgree(
        { type: 'text', text: '{{n}}', flex: 1, wrap: true, nothing: null },
        { n: '5' },
      );
    });

    it('a null/undefined variable map does not throw on either side', () => {
      bothAgree(textCard('{{anything}}'), null);
      bothAgree(textCard('{{anything}}'), undefined);
    });

    it('an image with an unusable url falls back identically', () => {
      for (const url of [
        '',
        '-',
        '{{missing}}',
        'img.example.net/a.png',
        null,
      ]) {
        bothAgree(
          {
            type: 'bubble',
            hero: { type: 'image', url: url as unknown as string },
          },
          {},
        );
      }
    });

    it('a usable https url is left alone', () => {
      bothAgree({ type: 'image', url: 'https://example.com/a.png' }, {});
    });

    it('deeply nested arrays and objects are walked the same way', () => {
      bothAgree(
        {
          type: 'bubble',
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: '{{a}}' },
              {
                type: 'box',
                layout: 'horizontal',
                contents: [
                  { type: 'text', text: '{{b}}' },
                  { type: 'text', text: 'literal' },
                ],
              },
            ],
          },
        },
        { a: 'A', b: '' },
      );
    });
  });

  // ── dropWhenEmpty, where the two could most easily diverge ────────────────

  describe('dropWhenEmpty — content slots', () => {
    const declared = new Set(['custom_content_1', 'custom_content_2']);

    it('an unfilled declared fashion removes its whole component', () => {
      bothAgree(
        {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: '{{custom_content_1}}' },
            { type: 'text', text: 'kept' },
          ],
        },
        { custom_content_1: '', custom_content_2: '' },
        { dropWhenEmpty: declared },
      );
    });

    it('a fashion mixed with other text keeps "-" instead of dropping', () => {
      bothAgree(
        { type: 'text', text: '{{custom_content_1}} บาท' },
        { custom_content_1: '' },
        { dropWhenEmpty: declared },
      );
    });

    it('a box emptied by drops removes itself, cascading upward', () => {
      bothAgree(
        {
          type: 'bubble',
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'box',
                layout: 'vertical',
                contents: [{ type: 'text', text: '{{custom_content_1}}' }],
              },
            ],
          },
        },
        { custom_content_1: '' },
        { dropWhenEmpty: declared },
      );
    });

    it('with NO declarations the cascade cannot fire at all', () => {
      bothAgree(
        {
          type: 'box',
          layout: 'vertical',
          contents: [],
        },
        {},
        { dropWhenEmpty: new Set<string>() },
      );
    });

    it('the drop marker never escapes — a dropped ROOT becomes null', () => {
      const out = bothAgree(
        { type: 'text', text: '{{custom_content_1}}' },
        { custom_content_1: '' },
        { dropWhenEmpty: declared },
      );
      expect(out).toBeNull();
    });

    it('an emptied section is deleted rather than sent as an empty box', () => {
      const out = bothAgree(
        {
          type: 'bubble',
          header: { type: 'text', text: '{{custom_content_1}}' },
          body: { type: 'text', text: 'kept' },
        },
        { custom_content_1: '' },
        { dropWhenEmpty: declared },
      );
      expect(Object.keys(out as object)).not.toContain('header');
    });

    it('a fashion with two declared tags and no other text drops', () => {
      bothAgree(
        { type: 'text', text: '{{custom_content_1}}{{custom_content_2}}' },
        { custom_content_1: '', custom_content_2: '' },
        { dropWhenEmpty: declared },
      );
    });

    it('a declared tag beside an UNdeclared one does not drop', () => {
      bothAgree(
        { type: 'text', text: '{{custom_content_1}}{{phone}}' },
        { custom_content_1: '', phone: '' },
        { dropWhenEmpty: declared },
      );
    });
  });
});

/**
 * The SAME comparison driven by the real card that production hooks point at.
 *
 * `flex_messages/a0d000000000000000000052` ("dev-profile-2") is the card
 * `flex_profile_id` names on hooks devtwo, demo-oa-three and devfour, and it declares
 * exactly three tags: `{{bank_account_name}}`, `{{phone}}` and `{{content}}`.
 * Its `content_json` is checked in below as a literal rather than read from the
 * database, so the case is reproducible on a machine with no Mongo and cannot
 * silently start passing because the row changed.
 *
 * The synthetic cards above prove the mechanics; this proves the mechanics on
 * the shape that actually ships.
 */
const REAL_PROFILE_CARD = {
  type: 'bubble',
  size: 'mega',
  header: {
    type: 'box',
    layout: 'vertical',
    contents: [
      {
        type: 'box',
        layout: 'horizontal',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: 'สมาชิก', color: '#ffffff', size: 'md' },
              { type: 'text', text: '{{bank_account_name}}', color: '#ffffff' },
              { type: 'text', text: '{{phone}}', color: '#ffffff' },
            ],
          },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              {
                type: 'image',
                url: 'https://png.pngtree.com/png-clipart/20250127/original/pngtree-a-golden-crown-with-king-and-png-image_20347454.png',
                size: 'full',
                aspectMode: 'fit',
              },
            ],
            maxWidth: '85px',
            spacing: 'sm',
            margin: 'md',
          },
        ],
      },
      { type: 'separator', color: '#FFFFFF', margin: 'none' },
    ],
    paddingAll: '20px',
    backgroundColor: '#5482EB',
    spacing: 'md',
    paddingTop: '22px',
  },
  body: {
    type: 'box',
    layout: 'vertical',
    contents: [
      {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '{{content}}',
            size: 'md',
            margin: 'sm',
            style: 'normal',
            decoration: 'none',
            position: 'relative',
            align: 'center',
            gravity: 'center',
            wrap: true,
            scaling: true,
          },
        ],
      },
    ],
  },
} as const;

describeIf('the real profile card (dev-profile-2) — port vs legacy', () => {
  let legacyApply: ApplyFn;
  beforeAll(() => {
    legacyApply = loadLegacyApply();
  });

  const cases: Array<[string, Record<string, unknown>]> = [
    [
      'all values present',
      {
        bank_account_name: 'สมชาย ใจดี',
        phone: '0812345678',
        content: 'ยินดีต้อนรับ',
      },
    ],
    ['MISSING — empty variable map', {}],
    ['EMPTY STRING values', { bank_account_name: '', phone: '', content: '' }],
    ['NULL values', { bank_account_name: null, phone: null, content: null }],
    ['DEEP PATH that does not exist', { 'profile.bank.deeper.nope': 'x' }],
    [
      'JSON-ESCAPE hostile values',
      {
        bank_account_name: 'A"B\\C\nD\tE',
        phone: '</script><b>&amp;</b>',
        content: 'quote " backslash \\ newline \n tab \t emoji 🎉',
      },
    ],
    [
      'a value that itself looks like a tag',
      { bank_account_name: '{{phone}}', phone: '555', content: 'x' },
    ],
    [
      'numeric and boolean values',
      { bank_account_name: 0, phone: false, content: 0 },
    ],
  ];

  it.each(cases)('%s renders identically', (_label, vars) => {
    const fromLegacy = legacyApply(
      structuredClone(REAL_PROFILE_CARD),
      vars as Record<string, string>,
    );
    const fromPort = applyFlexProfileVars(
      structuredClone(REAL_PROFILE_CARD),
      vars as Record<string, string>,
    );
    expect(JSON.stringify(fromPort)).toBe(JSON.stringify(fromLegacy));
  });

  it('an empty profile leaves no empty text node, so the card stays sendable', () => {
    // The concrete failure [FIX-20260801-FLEXEMPTYTEXT] records: a customer with
    // no name and no phone must still receive a card LINE will accept, which
    // means NO text component may be left with an empty string. Walked over the
    // whole tree rather than one level, because this card nests its text nodes
    // three boxes deep.
    const out = applyFlexProfileVars(structuredClone(REAL_PROFILE_CARD), {
      bank_account_name: '',
      phone: '',
      content: '',
    });

    const texts: Array<string | undefined> = [];
    const walk = (n: unknown): void => {
      if (Array.isArray(n)) return void n.forEach(walk);
      if (n && typeof n === 'object') {
        const o = n as Record<string, unknown>;
        if (o['type'] === 'text') texts.push(o['text'] as string | undefined);
        Object.values(o).forEach(walk);
      }
    };
    walk(out);

    // The three substituted slots became '-'; the hardcoded label is untouched.
    expect(texts).toContain('สมาชิก');
    expect(texts.filter((t) => t === '-')).toHaveLength(3);
    for (const t of texts) expect(String(t).trim()).not.toBe('');
  });
});

/**
 * The context-variable map and the source-role resolver are small enough to run
 * directly out of legacy's config module — it has no side effects at import
 * beyond a self-check, and it does not open anything.
 */
const describeConfigIf = existsSync(LEGACY_VAR_SOURCES)
  ? describe
  : describe.skip;

describeConfigIf('buildContextVarMap / resolveSourceRoles — vs legacy', () => {
  /*
   * [FIX-20260812-LEGACYOPTIONAL] loaded in `beforeAll`, not at describe scope.
   * `describe.skip` still runs the callback to collect test names, so a
   * `require()` written directly here executed even when the guard above had
   * already decided the legacy checkout was missing — the suite failed to run
   * instead of skipping. `beforeAll` does not fire for a skipped suite.
   */
  let legacy: {
    buildContextVarMap: (ctx: unknown) => Record<string, string>;
    resolveSourceRoles: (doc: unknown) => string[];
    FLEX_VAR_SOURCES: Record<string, unknown>;
  };
  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    legacy = require(LEGACY_VAR_SOURCES) as typeof legacy;
  });

  const ctxCases: unknown[] = [
    {},
    { hook: null, content: null },
    { hook: {}, content: '' },
    {
      hook: { domain_name: 'a.com', company_name: 'N', description: 'D' },
      content: 'hello',
    },
    // The three hook fields fall back to '' while content falls back to '-'.
    {
      hook: { domain_name: '', company_name: '   ', description: undefined },
      content: '   ',
    },
    // Untrimmed passthrough: trim only decides emptiness.
    { hook: { domain_name: '  spaced  ' }, content: '  padded  ' },
    { hook: { domain_name: ['a', 'b'] }, content: [] },
    { hook: { domain_name: { nested: 1 } }, content: { a: 1 } },
    { hook: { domain_name: 0 }, content: 0 },
    { hook: { domain_name: false }, content: false },
  ];

  it.each(ctxCases.map((c, i) => [i, c] as const))(
    'context map case %i matches legacy',
    (_i, ctx) => {
      expect(buildContextVarMap(ctx as never)).toEqual(
        legacy.buildContextVarMap(ctx),
      );
    },
  );

  const roleCases: unknown[] = [
    null,
    undefined,
    {},
    { source_roles: [] },
    { source_roles: ['site_rules'] },
    { source_roles: ['profile'] },
    { source_roles: ['site_rules', 'profile'] },
    { source_roles: ['bogus'] },
    { source_roles: ['site_rules', 'site_rules'] },
    { source_role: 'site_rules' },
    { source_role: 'profile' },
    { source_role: 'bogus' },
    { source_role: '' },
    { source_roles: ['  site_rules  '] },
    { source_roles: [null, undefined, 'site_rules'] },
    { source_roles: 'site_rules' },
  ];

  it.each(roleCases.map((c, i) => [i, c] as const))(
    'source-role case %i matches legacy',
    (_i, doc) => {
      expect(resolveSourceRoles(doc as never, legacy.FLEX_VAR_SOURCES)).toEqual(
        legacy.resolveSourceRoles(doc),
      );
    },
  );
});

const describeFieldsIf = existsSync(LEGACY_PROFILE_FIELDS)
  ? describe
  : describe.skip;

describeFieldsIf('extractFlexProfileFields — vs legacy', () => {
  /* [FIX-20260812-LEGACYOPTIONAL] loaded in `beforeAll` — see the note on the
     other describe in this file. `describe.skip` still runs this callback to
     collect test names, so a `require()` here executed even when the guard had
     found no legacy checkout, failing the whole suite instead of skipping it. */
  let legacy: { extractFlexProfileFields: (d: unknown) => unknown };
  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    legacy = require(LEGACY_PROFILE_FIELDS) as typeof legacy;
  });

  const cases: unknown[] = [
    null,
    undefined,
    {},
    'not an object',
    // The real shape: block.data.data.profile.
    {
      a: {
        is_profile: true,
        data: {
          data: { profile: { phone: '08', bank: { account_name: 'X' } } },
        },
      },
    },
    // The shallower shape.
    { a: { is_profile: true, data: { profile: { phone: '09' } } } },
    // Shallowest.
    { a: { is_profile: true, profile: { phone: '07' } } },
    // Flagged block whose request FAILED, plus an unflagged block that has the
    // data — legacy must prefer the one that actually holds a profile.
    {
      failed: { is_profile: true, success: false, data: { error: 'boom' } },
      good: {
        data: {
          data: { profile: { phone: '06', bank: { account_name: 'Y' } } },
        },
      },
    },
    // No profile anywhere.
    { a: { is_profile: true, data: { error: 'x' } } },
    // Profile present but bank missing.
    { a: { is_profile: true, data: { data: { profile: {} } } } },
    // Two flagged blocks that both have profiles — first wins.
    {
      one: { is_profile: true, data: { data: { profile: { phone: '1' } } } },
      two: { is_profile: true, data: { data: { profile: { phone: '2' } } } },
    },
  ];

  it.each(cases.map((c, i) => [i, c] as const))(
    'profile extraction case %i matches legacy',
    (_i, input) => {
      expect(extractFlexProfileFields(input)).toEqual(
        legacy.extractFlexProfileFields(input),
      );
    },
  );
});

/**
 * `renderFlexDoc` end to end. Legacy's version reaches into the database for
 * source variables, so the comparison is against the port with the data-variable
 * map handed in — which is exactly the seam the port introduced, and the reason
 * it takes `dataVars` as a parameter.
 */
describe('renderFlexDoc — precedence and marker stripping', () => {
  const card = (text: string): Record<string, unknown> => ({
    type: 'text',
    text,
  });

  it('context variables outrank data-source variables', () => {
    const out = renderFlexDoc(
      { content_json: card('{{content}}'), content_tags: [] },
      { content: 'FROM-DATA-SOURCE' },
      'FROM-CONTEXT',
      null,
    );
    expect(JSON.stringify(out)).toContain('FROM-CONTEXT');
  });

  it("a card's own slots outrank context variables", () => {
    const out = renderFlexDoc(
      {
        content_json: card('{{custom_content_1}}'),
        content_tags: [{ no: 1, label: 'a' }],
      },
      {},
      'THE ANSWER',
      null,
    );
    expect(JSON.stringify(out)).toContain('THE ANSWER');
  });

  it('{{content}} is marker-stripped for every card, declared or not', () => {
    const out = renderFlexDoc(
      { content_json: card('{{content}}'), content_tags: [] },
      {},
      'before [[[custom_content_1]]] after',
      null,
    );
    expect(JSON.stringify(out)).not.toContain('custom_content_1');
  });

  it('an ordinary answer keeps every space (STRIPNOOP)', () => {
    const out = renderFlexDoc(
      { content_json: card('{{content}}'), content_tags: [] },
      {},
      'สวัสดี  ครับ',
      null,
    );
    expect(JSON.stringify(out)).toContain('สวัสดี  ครับ');
  });

  it('hook context variables reach the card', () => {
    const out = renderFlexDoc(
      {
        content_json: card('{{hook_domain}}|{{hook_name}}|{{hook_detail}}'),
        content_tags: [],
      },
      {},
      'x',
      { domain_name: 'd.com', company_name: 'N', description: 'D' },
    );
    expect(JSON.stringify(out)).toContain('d.com|N|D');
  });

  it('an absent hook yields empty strings, not dashes', () => {
    const out = renderFlexDoc(
      { content_json: card('[{{hook_domain}}]'), content_tags: [] },
      {},
      'x',
      null,
    );
    expect(JSON.stringify(out)).toContain('[]');
  });
});
