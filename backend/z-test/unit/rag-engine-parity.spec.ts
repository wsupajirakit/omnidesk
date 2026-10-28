import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { Logger } from '@nestjs/common';
import axios from 'axios';
import mongoose from 'mongoose';

import {
  ALT_FALLBACK_TEXT,
  FALLBACK_TEXT,
  GEMINI_HTTP_OPTS,
  RAW_JSON_MAX_CHARS,
  RagEngineService,
  TAG_FOUND_REGEX,
  TAG_MARKER_RE,
  TAG_NOT_FOUND_REGEX,
  buildDynamicTagQuery,
  buildRawJsonBlock,
  buildRawJsonRulesBlock,
  buildRawSiteRulesBlock,
  buildSiteRulesGuideBlock,
  computeDynamicTagValue,
  findUnknownTagMarkers,
  getNestedResilient,
  isFallbackText,
  pickApiSource,
  reportTagMismatch,
  resolveFastMode,
  resolveThinkingBudget,
} from '@/modules/ai';

/**
 * DIFFERENTIAL test: `src/modules/ai/rag-engine.service.ts` against the legacy
 * JavaScript it was transcribed from, both running for real on identical inputs.
 *
 * ── WHY THIS SHAPE ──────────────────────────────────────────────────────────
 * There is no HTTP route to diff. The service is deliberately not wired into
 * `webhook.service.ts`, so a golden comparison is not available and will not be
 * until the pipeline lands. What IS available is the legacy source file sitting
 * beside this checkout, and it is a better oracle than a table of expectations:
 * a table records what I *believed* legacy does, and this file is full of things
 * a careful reader gets wrong — a fast-mode return with no `tagStatus` key, a
 * `?? 0.0` after a `parseFloat` that can never be null, a settings table with no
 * row for a mode that is reachable, an unescaped tag name inside a `RegExp`.
 * Every one of those would have been "corrected" into a table.
 *
 * ── HOW LEGACY RUNS HERE WITHOUT A DATABASE, A KEY, OR A NETWORK ────────────
 * `ragEngineService.js` requires only `dotenv`, `axios` and `crypto` at load;
 * everything else is a late `require()` inside a function. So it is compiled
 * with `vm.compileFunction` in THIS realm (shared `Set`/`RegExp`/`JSON`, which
 * `findUnknownTagMarkers`' `instanceof Set` check depends on) and handed a
 * `require` that returns fakes. `dotenv` is stubbed to a no-op ON PURPOSE: the
 * real one would read `legacy-api/.env` into `process.env`, and no test may read
 * a credential.
 *
 * ── NO MODEL CALL, EVER ─────────────────────────────────────────────────────
 * `axios.get`, `axios.post` and `globalThis.fetch` are all replaced for this
 * whole file with implementations that REJECT by default, so an outbound call a
 * case did not explicitly stub fails the test with the attempted URL instead of
 * billing an account. BOTH implementations are pointed at the SAME mock, which
 * is also what makes the request-body comparisons below meaningful: the bytes
 * that would have gone to Google are compared, and are never sent.
 *
 * The suite SKIPS rather than fails when the legacy checkout is not beside this
 * one, so it never turns red for a reason unrelated to the code under test.
 */
const LEGACY_PATH = resolve(
  __dirname,
  '../../../legacy-api/src/services/core-bot/ragEngineService.js',
);
const legacyAvailable = existsSync(LEGACY_PATH);

/**
 * [FEAT-20260908-AITIMEOUT] The legacy checkout's own stall ceiling, frozen here.
 * The port raised its own to 45s (`AI_HTTP_TIMEOUT_MS`) on the owner's decision;
 * legacy is untouched and still uses 30s, so the two sides are normalised with
 * their OWN expected value rather than with a shared one.
 */
const LEGACY_TIMEOUT_MS = 30000;

/** The port's ceiling, read from the shared object rather than re-typed. */
const PORT_TIMEOUT_MS = GEMINI_HTTP_OPTS.timeout;

/** Obvious fakes. Nothing in this file came from a hook row or a `.env`. */
const FAKE_KEY = 'unit-test-not-a-real-gemini-key';

// ───────────────────────────────────────────────────────────────────────────
// The shared HTTP mock. Both implementations call through it.
// ───────────────────────────────────────────────────────────────────────────

type HttpArgs = unknown[];
const refuse =
  (verb: string) =>
  (...args: HttpArgs) =>
    Promise.reject(
      new Error(
        `un-stubbed axios.${verb} in rag-engine-parity.spec.ts -> ${String(args[0])}. ` +
          `Stub it; never let it out.`,
      ),
    );

const httpPost = jest.fn(refuse('post'));
const httpGet = jest.fn(refuse('get'));

jest
  .spyOn(axios, 'post')
  .mockImplementation((...a: HttpArgs) => httpPost(...a));
jest.spyOn(axios, 'get').mockImplementation((...a: HttpArgs) => httpGet(...a));
globalThis.fetch = () =>
  Promise.reject(new Error('fetch is not available in this spec'));

/** Quiet, but still exercised — the port logs where legacy `console.*`s. */
beforeAll(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

// ───────────────────────────────────────────────────────────────────────────
// Collaborator fakes — the SAME objects are given to both implementations.
// ───────────────────────────────────────────────────────────────────────────

const createLog = jest.fn((payload: Record<string, unknown>) => {
  void payload;
  return Promise.resolve({});
});
const logSink = { createLog };

/**
 * The `applyFormat` / `translate` pair. Legacy `require`s them; the port takes
 * them as `DynamicTagFormatDeps`. Identical functions on both sides, so any
 * difference in the result is a difference in the caller, which is the point.
 */
const applyFormat = jest.fn(
  (
    raw: unknown,
    ctx: { path: string; canonical: string; field: string },
    translate: (dict: string, key: unknown) => string | null,
  ) => (ctx.field === 'status' ? translate('acc_status', raw) : null),
);
const translate = jest.fn((_dict: string, key: unknown) =>
  key === 'enable' ? 'เปิดใช้งาน' : null,
);
const formatDeps = { applyFormat, translate };

/** `DynamicTag.find(query).lean()` on legacy, `this.dynamicTagModel...` on the port. */
let tagRows: unknown[] = [];
const tagFind = jest.fn((query: unknown) => {
  void query;
  return { lean: () => Promise.resolve(tagRows) };
});
const tagModel = { find: tagFind };

/** `ChatMessage.find(...).sort(...).limit(...).lean()`. */
let chatRows: unknown[] = [];
const chatFind = jest.fn((filter: unknown, projection: unknown) => {
  void filter;
  void projection;
  return {
    sort: () => ({ limit: () => ({ lean: () => Promise.resolve(chatRows) }) }),
  };
});
const chatModel = { find: chatFind };

// ───────────────────────────────────────────────────────────────────────────
// Load legacy
// ───────────────────────────────────────────────────────────────────────────

/**
 * Appended to the legacy source so the module-private functions can be driven
 * too. Nine of the behaviours this suite has to pin — the chunking arithmetic,
 * the 0.12 threshold, `CHUNK_SETTINGS`, `isFallbackText` — live in functions
 * legacy never exported. Re-implementing them in the test would defeat the whole
 * exercise, so the source is extended rather than copied. legacy-api is not
 * modified: this string is concatenated in memory.
 */
const INTERNAL_EXPORTS = `
;module.exports.__internal = {
  resolveFastMode, formatThaiDateTime, generateCharNgrams, jaccardSet,
  chunkDocumentAndIndex, resolveChunkSettings, ensureCacheEntry,
  localRetrieveSnippets, isFallbackText, buildRawJsonRulesBlock,
  buildSiteRulesGuideBlock, buildRawJsonBlock, buildRawSiteRulesBlock,
  CHUNK_SETTINGS, FALLBACK_TEXT, ALT_FALLBACK_TEXT,
  TAG_FOUND_REGEX, TAG_NOT_FOUND_REGEX, TAG_MARKER_RE,
  RAW_JSON_MAX_CHARS, DOC_CACHE_TTL_MS, GEMINI_HTTP_OPTS,
  fetchGoogleDocs, resolveThinkingBudget, computeDynamicTagValue,
  pickApiSource, getNestedResilient,
};
`;

interface LegacyInternal {
  resolveFastMode(v?: unknown): number;
  formatThaiDateTime(): string;
  generateCharNgrams(text: unknown, n?: number): Set<string>;
  jaccardSet(a: unknown, b: unknown): number;
  chunkDocumentAndIndex(t: unknown, max: unknown, ov: unknown): unknown[];
  resolveChunkSettings(v?: unknown): Record<string, unknown>;
  localRetrieveSnippets(...a: unknown[]): { confident: boolean; text: string };
  isFallbackText(t: unknown): boolean;
  buildRawJsonBlock(p: unknown, x?: unknown): string;
  buildRawSiteRulesBlock(p: unknown): string;
  buildRawJsonRulesBlock(r: unknown): string | null;
  buildSiteRulesGuideBlock(g: unknown): string | null;
  resolveThinkingBudget(b?: unknown): number;
  computeDynamicTagValue(src: unknown, tag: unknown, opts?: unknown): string;
  pickApiSource(p: unknown, tag: unknown): unknown;
  getNestedResilient(o: unknown, p: unknown): unknown;
  CHUNK_SETTINGS: Record<string, unknown>;
  FALLBACK_TEXT: string;
  ALT_FALLBACK_TEXT: string;
  TAG_FOUND_REGEX: RegExp;
  TAG_NOT_FOUND_REGEX: RegExp;
  TAG_MARKER_RE: RegExp;
  DOC_CACHE_TTL_MS: number;
  GEMINI_HTTP_OPTS: { timeout: number };
}

interface LegacyModule {
  askGemini(...args: unknown[]): Promise<Record<string, unknown>>;
  findRelevantText(...args: unknown[]): Promise<string>;
  getCachedDocument(...args: unknown[]): Promise<string>;
  analyzeConversationForAdmin(
    ...a: unknown[]
  ): Promise<Record<string, unknown>>;
  analyzeCategoryFromRoom(...a: unknown[]): Promise<string>;
  buildDynamicTagQuery(h?: unknown, g?: unknown): Record<string, unknown>;
  findUnknownTagMarkers(t: unknown, k: unknown): string[];
  reportTagMismatch(m: unknown, l: unknown, h?: unknown, g?: unknown): void;
  __internal: LegacyInternal;
}

const loadLegacy = (): LegacyModule => {
  const source = readFileSync(LEGACY_PATH, 'utf8') + INTERNAL_EXPORTS;
  /* `new Function`, deliberately, and NOT `vm.compileFunction`.
   *
   * jest-environment-node gives each test file its own realm: its own `Set`, its
   * own `RegExp`, and a COPY of `process` (env included). `vm.compileFunction`
   * compiles into the main context, so legacy would get the *other* realm's
   * intrinsics — `knownTagNames instanceof Set` came back false and every
   * marker scan returned `[]`, and `process.env` changes made by a test were
   * invisible to it. Both would have looked like port bugs. `new Function`
   * compiles in the caller's realm, which is the one the port is running in. */
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    'exports',
    'require',
    'module',
    '__filename',
    '__dirname',
    source,
  ) as (...a: unknown[]) => void;

  const stubs: Record<string, unknown> = {
    // No-op. The real dotenv would load legacy-api/.env into process.env, and
    // this suite must never touch a credential.
    dotenv: { config: () => ({ parsed: {} }) },
    axios: {
      get: (...a: HttpArgs) => httpGet(...a),
      post: (...a: HttpArgs) => httpPost(...a),
    },
    crypto: jest.requireActual<object>('node:crypto'),
    mongoose,
    '../infra/webhookLogService': logSink,
    '../../models/hook/dynamicTagModel': tagModel,
    '../../models/chat/chatMessageModel': chatModel,
    '../../config/flexVarFormatRules': { applyFormat },
    '../content/translationDictService': { translate },
  };

  const fakeRequire = (id: string): unknown => {
    if (id in stubs) return stubs[id];
    throw new Error(`legacy required an un-stubbed module: ${id}`);
  };

  const mod: { exports: Record<string, unknown> } = { exports: {} };
  factory(mod.exports, fakeRequire, mod, LEGACY_PATH, dirname(LEGACY_PATH));
  return mod.exports as unknown as LegacyModule;
};

const describeIfLegacy = legacyAvailable ? describe : describe.skip;

describeIfLegacy('rag engine — parity with legacy ragEngineService.js', () => {
  /*
   * [FIX-20260812-LEGACYOPTIONAL] loaded in `beforeAll`, not at describe scope.
   * `describe.skip` still executes this callback to collect test names, so
   * `loadLegacy()` (which reads the legacy file from disk) ran even when the
   * guard above had already found no checkout — the suite failed to run instead
   * of skipping. `beforeAll` never fires for a skipped suite.
   */
  let legacy: LegacyModule;
  /* `L` is read in 57 places below. Rather than touch every one, it stays a
     const — a Proxy that resolves to the real `__internal` on first property
     access, which happens inside a test, i.e. after `beforeAll` has run. */
  const L = new Proxy({} as LegacyInternal, {
    get: (_t, prop) =>
      (legacy.__internal as unknown as Record<string | symbol, unknown>)[prop],
  });
  beforeAll(() => {
    legacy = loadLegacy();
  });

  const service = new RagEngineService(
    tagModel as never,
    chatModel as never,
    logSink,
    formatDeps,
  );

  beforeEach(() => {
    httpPost.mockReset();
    httpGet.mockReset();
    httpPost.mockImplementation(refuse('post'));
    httpGet.mockImplementation(refuse('get'));
    createLog.mockClear();
    tagFind.mockClear();
    chatFind.mockClear();
    tagRows = [];
    chatRows = [];
    TAG_FOUND_REGEX.lastIndex = 0;
    TAG_NOT_FOUND_REGEX.lastIndex = 0;
    L.TAG_FOUND_REGEX.lastIndex = 0;
    L.TAG_NOT_FOUND_REGEX.lastIndex = 0;
  });

  // ═════════════════════════════════════════════════════════════════════════
  it('the HTTP client really is stubbed (the guard this whole file rests on)', async () => {
    await expect(axios.post('https://example.invalid/x', {})).rejects.toThrow(
      /un-stubbed axios\.post/,
    );
    await expect(axios.get('https://example.invalid/x')).rejects.toThrow(
      /un-stubbed axios\.get/,
    );
  });

  // ═════════════════════════════════════════════════════════════════════════
  /* [FEAT-20261026-RAGENGINE] the legacy retrieval half (Google-Doc fetch, n-grams, chunking,
     localRetrieveSnippets, getCachedDocument, findRelevantText) was removed from
     `ai/rag-engine.service.ts` — it was never bound and never ran in production, and the new
     engine in `src/modules/rag/` replaces it. Its parity cases went with it; everything the
     port still ships (fast mode, tags, blocks, askGemini, dynamic tags) keeps its parity here.
     ส่วนค้นเอกสารเดิมถูกลบ (ไม่เคยทำงานจริง) — เคส parity ของส่วนนั้นจึงออกไปด้วย */
  describe('resolveFastMode', () => {
    const CASES: unknown[] = [
      0,
      1,
      2,
      '0',
      '1',
      '2',
      3,
      '3',
      -1,
      null,
      undefined,
      '',
      'x',
      2.0,
    ];

    it.each(CASES.map((c) => [JSON.stringify(c) ?? 'undefined', c]))(
      'resolveFastMode(%s)',
      (_name, input) => {
        expect(resolveFastMode(input)).toBe(L.resolveFastMode(input));
      },
    );

    it('the stall ceiling DELIBERATELY no longer matches legacy', () => {
      /* [FEAT-20260908-AITIMEOUT] This used to assert `toEqual(L.GEMINI_HTTP_OPTS)`.
         The owner raised the port's ceiling 30s -> 45s on 08/09/2026; legacy is
         untouched. So the divergence is pinned on BOTH sides by value — a silent
         drift back to 30s, or a stray extra key on the shared object, still goes
         red here. */
      expect(L.GEMINI_HTTP_OPTS).toEqual({ timeout: LEGACY_TIMEOUT_MS });
      expect(GEMINI_HTTP_OPTS).toEqual({ timeout: 45000 });
      expect(Object.keys(GEMINI_HTTP_OPTS)).toEqual(['timeout']);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  describe('isFallbackText is exact string equality', () => {
    const CASES: [string, unknown][] = [
      ['the primary fallback', FALLBACK_TEXT],
      ['the alternate fallback', ALT_FALLBACK_TEXT],
      ['primary with surrounding whitespace', `  \n${FALLBACK_TEXT}\t `],
      ['primary with a trailing full stop', `${FALLBACK_TEXT}.`],
      ['primary missing its last character', FALLBACK_TEXT.slice(0, -1)],
      [
        'primary with an inner space removed',
        FALLBACK_TEXT.replace('ที่', 'ท่ี'),
      ],
      ['primary embedded in a sentence', `ขออภัย ${FALLBACK_TEXT} ครับ`],
      ['alternate with a trailing space', `${ALT_FALLBACK_TEXT} `],
      ['empty', ''],
      ['null', null],
      ['undefined', undefined],
      ['unrelated', 'สวัสดีครับ'],
    ];

    it.each(CASES)('isFallbackText(%s)', (_n, text) => {
      expect(isFallbackText(text as string)).toBe(L.isFallbackText(text));
    });

    it('both constants are byte-identical to legacy', () => {
      expect(FALLBACK_TEXT).toBe(L.FALLBACK_TEXT);
      expect(ALT_FALLBACK_TEXT).toBe(L.ALT_FALLBACK_TEXT);
      // Pinned by code point so a homoglyph or a stray combining mark shows up
      // as a diff rather than as an identical-looking string.
      expect([...FALLBACK_TEXT].map((c) => c.codePointAt(0))).toEqual(
        [...L.FALLBACK_TEXT].map((c) => c.codePointAt(0)),
      );
      expect([...ALT_FALLBACK_TEXT].map((c) => c.codePointAt(0))).toEqual(
        [...L.ALT_FALLBACK_TEXT].map((c) => c.codePointAt(0)),
      );
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  describe('the tag regexes and their /g lastIndex', () => {
    it('sources and flags match legacy exactly', () => {
      expect(TAG_FOUND_REGEX.source).toBe(L.TAG_FOUND_REGEX.source);
      expect(TAG_FOUND_REGEX.flags).toBe(L.TAG_FOUND_REGEX.flags);
      expect(TAG_NOT_FOUND_REGEX.source).toBe(L.TAG_NOT_FOUND_REGEX.source);
      expect(TAG_NOT_FOUND_REGEX.flags).toBe(L.TAG_NOT_FOUND_REGEX.flags);
      /* TAG_MARKER_RE is deliberately NOT on this list any more — see the block
         below. Its flags must still agree: `matchAll` throws without /g. */
      expect(TAG_MARKER_RE.flags).toBe(L.TAG_MARKER_RE.flags);
    });

    /* ═══════════════════════════════════════════════════════════════════════
     * [FIX-20260901-TAGREBLIND] THE ONE DELIBERATE DIVERGENCE IN THIS FILE
     * ═══════════════════════════════════════════════════════════════════════
     * Every other assertion here says "we copied legacy correctly". This one
     * says "we copied legacy correctly, and legacy is WRONG about the data".
     *
     * Legacy pins the middle segment to the literal `x` (`ragEngineService.js:396`),
     * which is the shape the tag GENERATOR emits — `TAG_PREFIX = 'odk_x_90'` in
     * `hooks/dynamic-tags.service.ts:60`. Counted against `dynamic_tags` on
     * 01/09 it matched 0 of 801 live tags: operators create `odk_p_*` (451) and
     * `odk_s_*` (350), and not one row uses the generator's prefix. The scanner
     * had therefore never fired in production, and this suite could not tell,
     * because its own fixtures spell tags `odk_x_1` — copied from the same
     * mistaken source as the regex.
     *
     * Restoring byte-parity here would re-blind the scanner. So parity is
     * replaced by the two properties that actually matter, both asserted below:
     * we still match everything legacy matched, and we additionally match the
     * shape the database holds. เทียบ legacy ไม่ได้แปลว่าถูก — legacy ผิดเรื่องนี้
     */
    describe('TAG_MARKER_RE diverges from legacy, on purpose', () => {
      /* 🔴 NEVER call `.test()` on the shared exported regex. It carries /g, so
         `.test` leaves `lastIndex` parked past the match — and `matchAll` COPIES
         `lastIndex` from the original, so the very next `findUnknownTagMarkers`
         case starts scanning mid-string and silently misses the marker. That is
         not hypothetical: writing these cases against the real objects turned
         `an unknown marker` and `uppercase prefix (the /i flag)` red two describes
         later, which reads as a regex bug and is a test bug. The file header warns
         about exactly this ("must be reset before every .test/.exec"). Matching
         through a fresh clone keeps the assertion honest and the shared object
         untouched. อย่าแตะตัวจริง — โคลนก่อนเทสเสมอ */
      const fresh = (re: RegExp) => new RegExp(re.source, re.flags);
      const hits = (re: RegExp, s: string) => fresh(re).test(s);

      it('🔴 legacy matches NONE of the real tag shapes — the reason to diverge', () => {
        for (const real of ['odk_p_00001', 'odk_s_00350', 'odk_bank_00001']) {
          expect(hits(L.TAG_MARKER_RE, real)).toBe(false);
        }
      });

      it('⭐⭐⭐ ours matches every real tag shape, including a multi-letter middle', () => {
        for (const real of [
          'odk_p_00001',
          'odk_s_00350',
          'odk_ab_00001',
          'odk_bank_00001',
        ]) {
          expect(hits(TAG_MARKER_RE, real)).toBe(true);
        }
      });

      it('⭐⭐⭐ SUPERSET — nothing legacy caught is lost', () => {
        for (const legacyShape of [
          'ins_x_900063',
          'odk_x_1',
          'zzz_x_42',
          'abcd_x_7',
          'INS_X_900063',
        ]) {
          expect(hits(L.TAG_MARKER_RE, legacyShape)).toBe(true);
          expect(hits(TAG_MARKER_RE, legacyShape)).toBe(true);
        }
      });

      /* The reason the middle is not simply `[a-z]+`. These belong to other
         marker families with their own owners; claiming them would put a second
         reader on a name this scanner does not resolve. */
      it('⭐⭐ never claims a neighbouring marker family', () => {
        for (const other of [
          'custom_content_1',
          'menu_main_00010',
          'menu_sub_00011',
          'flex_m00001',
          'flex_pc00001',
          'img_promo',
          'flex_profile',
          'START_OF_BASIC_INFO',
          'END_OF_COMPANY_INFO',
        ]) {
          expect(hits(TAG_MARKER_RE, other)).toBe(false);
        }
      });
    });

    it.each(['[[[FOUND]]]', '{{{FOUND}}}', '(((FOUND)))'])(
      'accepts the %s bracket form',
      (form) => {
        TAG_FOUND_REGEX.lastIndex = 0;
        L.TAG_FOUND_REGEX.lastIndex = 0;
        expect(TAG_FOUND_REGEX.test(`answer ${form}`)).toBe(
          L.TAG_FOUND_REGEX.test(`answer ${form}`),
        );
      },
    );

    it('⚠️ two consecutive .test() calls alternate — the /g lastIndex hazard', () => {
      const text = 'answer [[[FOUND]]]';
      TAG_FOUND_REGEX.lastIndex = 0;
      L.TAG_FOUND_REGEX.lastIndex = 0;
      const portFirst = TAG_FOUND_REGEX.test(text);
      const portSecond = TAG_FOUND_REGEX.test(text);
      const legFirst = L.TAG_FOUND_REGEX.test(text);
      const legSecond = L.TAG_FOUND_REGEX.test(text);
      expect([portFirst, portSecond]).toEqual([true, false]);
      expect([portFirst, portSecond]).toEqual([legFirst, legSecond]);
    });

    it('.replace() resets lastIndex, which is why askGemini gets away with it', () => {
      const text = 'a [[[FOUND]]] b [[[FOUND]]]';
      TAG_FOUND_REGEX.lastIndex = 0;
      expect(TAG_FOUND_REGEX.test(text)).toBe(true);
      expect(TAG_FOUND_REGEX.lastIndex).toBeGreaterThan(0);
      expect(text.replace(TAG_FOUND_REGEX, '')).toBe('a  b ');
      expect(TAG_FOUND_REGEX.lastIndex).toBe(0);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  describe('buildDynamicTagQuery', () => {
    it.each([
      ['hook and group', 'hook-1', 'grp-1'],
      ['hook only', 'hook-1', null],
      ['hook only, undefined group', 'hook-1', undefined],
      ['neither — matches EVERY enabled tag', null, null],
      ['group only, no hook — group is ignored', null, 'grp-1'],
      ['empty string hook', '', 'grp-1'],
    ])('%s', (_n, hook, group) => {
      expect(buildDynamicTagQuery(hook, group)).toEqual(
        legacy.buildDynamicTagQuery(hook, group),
      );
    });

    it('with no hook there is no $or at all', () => {
      expect(buildDynamicTagQuery(null, null)).toEqual({
        status: true,
        deleted_at: null,
      });
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  describe('findUnknownTagMarkers', () => {
    const known = new Set(['ins_x_900063', 'odk_x_1']);
    const CASES: [string, unknown][] = [
      ['no markers', 'สวัสดีครับ'],
      ['a known marker', 'ยอด ins_x_900063 บาท'],
      ['an unknown marker', 'ยอด odk_x_900063 บาท'],
      ['the same unknown twice — deduped', 'a odk_x_5 b odk_x_5'],
      ['mixed known and unknown', 'ins_x_900063 and zzz_x_42'],
      ['system tags never match', '[[[assist]]] [[[history]]]'],
      ['uppercase prefix (the /i flag)', 'INS_X_900063'],
      ['no digits', 'ins_x_'],
      ['empty', ''],
      ['null', null],
      ['a number', 12345],
      ['an object', { a: 1 }],
    ];

    it.each(CASES)('%s', (_n, text) => {
      expect(findUnknownTagMarkers(text, known)).toEqual(
        legacy.findUnknownTagMarkers(text, known),
      );
    });

    it('a non-Set known list short-circuits to [] on both', () => {
      expect(findUnknownTagMarkers('odk_x_1', ['odk_x_1'])).toEqual(
        legacy.findUnknownTagMarkers('odk_x_1', ['odk_x_1']),
      );
    });

    it('repeated calls do not drift (matchAll does not strand lastIndex)', () => {
      const t = 'a odk_x_7 b';
      expect(findUnknownTagMarkers(t, known)).toEqual(
        findUnknownTagMarkers(t, known),
      );
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  describe('reportTagMismatch', () => {
    it('writes exactly one row per reply, not one per marker', () => {
      reportTagMismatch(
        ['a_x_1', 'b_x_2', 'a_x_1'],
        true,
        'hook-1',
        'grp-1',
        logSink,
      );
      const portCalls = createLog.mock.calls.map((c) => c[0]);
      createLog.mockClear();
      legacy.reportTagMismatch(
        ['a_x_1', 'b_x_2', 'a_x_1'],
        true,
        'hook-1',
        'grp-1',
      );
      const legCalls = createLog.mock.calls.map((c) => c[0]);
      expect(portCalls).toHaveLength(1);
      expect(portCalls).toEqual(legCalls);
    });

    it.each([
      ['tags never loaded', [] as string[], false],
      ['no markers', [] as string[], true],
      ['null markers', null, true],
    ])('%s → no row on either side', (_n, markers, loaded) => {
      reportTagMismatch(markers, loaded, 'h', 'g', logSink);
      const portCount = createLog.mock.calls.length;
      createLog.mockClear();
      legacy.reportTagMismatch(markers, loaded, 'h', 'g');
      expect(portCount).toBe(0);
      expect(createLog.mock.calls).toHaveLength(0);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  describe('the four prompt blocks and the sendRawJson / sendSiteRules coupling', () => {
    const PROFILE = {
      'Path : api/v1/customer': { data: { name: 'x' }, success: true },
      SITE_RULES: { role: 'site_rules', data: { min_deposit: 100 } },
      OTHER: { data: { z: 1 } },
    };
    const PROFILE_BY_NAME = {
      CUSTOMER: { data: { name: 'x' } },
      site_rules_v2: { data: { min_deposit: 100 } },
    };

    it.each([
      ['no profile', null, false],
      ['no profile, excluding', null, true],
      ['empty profile', {}, false],
      [
        'role-tagged site rules, NOT excluded — the dump is complete',
        PROFILE,
        false,
      ],
      ['role-tagged site rules, excluded — filtered out', PROFILE, true],
      ['name-matched site rules, not excluded', PROFILE_BY_NAME, false],
      ['name-matched site rules, excluded', PROFILE_BY_NAME, true],
    ])('buildRawJsonBlock(%s)', (_n, profile, exclude) => {
      expect(buildRawJsonBlock(profile, exclude)).toBe(
        L.buildRawJsonBlock(profile, exclude),
      );
    });

    it('⚠️ the coupling: excluding really removes the site-rules endpoint', () => {
      expect(buildRawJsonBlock(PROFILE, false)).toContain('SITE_RULES');
      expect(buildRawJsonBlock(PROFILE, true)).not.toContain('SITE_RULES');
      expect(buildRawJsonBlock(PROFILE, true)).toContain('OTHER');
    });

    /* ⚠️⚠️ DELIBERATE DIVERGENCE FROM LEGACY — 29/08/2026, owner's decision.
       `RAW_JSON_MAX_CHARS` was raised 20000 → 25000 here while legacy stays at
       20000 (`ragEngineService.js:481`). This is the ONE place the port no
       longer matches legacy byte-for-byte, and it is on purpose:

       · the `<field>_th` Thai-time fields inflate the raw-profile block ~28%
         (measured on a real payload: 8,392 → 10,755 pretty-printed)
       · the same constant also caps the SITE-RULES block, where truncation has
         already caused a real customer-facing fault — an open deposit account
         fell past the 20000 cut, the model saw only closed accounts and told a
         customer "ฝากปิด" (21/08 16:59, see site-rules-block-slim.spec.ts:1-20)

       So the behaviour under test splits in two: the CONTRACT (truncation is
       announced, never silent) still holds for both and is asserted for both;
       only the byte-identical comparison is dropped, and only for the payload
       size that falls between the two ceilings.

       revert: set RAW_JSON_MAX_CHARS back to 20000 and restore the single
       `expect(port).toBe(L.buildRawJsonBlock(big, false))` below. */
    it('truncation is announced, never silent — in BOTH port and legacy', () => {
      // 30000 chars is past BOTH ceilings, so both must announce the cut.
      const big = { X: { data: 'y'.repeat(30000) } };
      const port = buildRawJsonBlock(big, false);
      const legacy = L.buildRawJsonBlock(big, false);
      expect(port).toContain('"_truncated": true');
      expect(legacy).toContain('"_truncated": true');
    });

    it('⭐ the port cuts LATER than legacy — the raised ceiling, pinned', () => {
      /* Without this case the divergence would be invisible: someone could set
         the constant back to 20000 and every test would still pass, silently
         re-introducing the truncation fault the raise was meant to prevent. */
      const big = { X: { data: 'y'.repeat(30000) } };
      const port = buildRawJsonBlock(big, false);
      const legacy = L.buildRawJsonBlock(big, false);
      expect(port.length).toBeGreaterThan(legacy.length);
      expect(RAW_JSON_MAX_CHARS).toBe(25000);
    });

    it('⭐ a payload BETWEEN the two ceilings survives here but not in legacy', () => {
      /* This is the whole point of the raise, stated as behaviour rather than
         as a number: a block that legacy would have cut now arrives complete. */
      const between = { X: { data: 'y'.repeat(22000) } };
      const port = buildRawJsonBlock(between, false);
      const legacy = L.buildRawJsonBlock(between, false);
      expect(port).not.toContain('"_truncated": true');
      expect(legacy).toContain('"_truncated": true');
    });

    it('below BOTH ceilings the two are still byte-identical', () => {
      /* Parity is unchanged everywhere except the band between the ceilings —
         this keeps that guarantee under test rather than assumed. */
      const small = { X: { data: 'y'.repeat(500) } };
      expect(buildRawJsonBlock(small, false)).toBe(
        L.buildRawJsonBlock(small, false),
      );
    });

    it.each([
      ['role wins', PROFILE],
      ['name fallback', PROFILE_BY_NAME],
      ['nothing to pick', { A: { data: 1 } }],
      ['null', null],
    ])('buildRawSiteRulesBlock(%s)', (_n, profile) => {
      expect(buildRawSiteRulesBlock(profile)).toBe(
        L.buildRawSiteRulesBlock(profile),
      );
    });

    it.each([
      ['text', 'always answer in Thai'],
      ['padded', '   spaced   '],
      ['empty', ''],
      ['whitespace', '   '],
      ['null', null],
      ['undefined', undefined],
      ['number', 42],
    ])('buildRawJsonRulesBlock(%s) / buildSiteRulesGuideBlock(%s)', (_n, v) => {
      expect(buildRawJsonRulesBlock(v)).toBe(L.buildRawJsonRulesBlock(v));
      expect(buildSiteRulesGuideBlock(v)).toBe(L.buildSiteRulesGuideBlock(v));
    });

    it('⚠️ the two rules blocks use DIFFERENT markers', () => {
      const a = buildRawJsonRulesBlock('same text');
      const b = buildSiteRulesGuideBlock('same text');
      expect(a).not.toBe(b);
      expect(a).toContain('[RAW_JSON_PROFILE_RULES_START]');
      expect(b).toContain('[SITE_RULES_GUIDE_START]');
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  describe('resolveThinkingBudget', () => {
    const saved = process.env['GEMINI_THINKING_BUDGET'];
    afterEach(() => {
      if (saved === undefined) delete process.env['GEMINI_THINKING_BUDGET'];
      else process.env['GEMINI_THINKING_BUDGET'] = saved;
    });

    it.each([
      ['hook -1', -1, undefined],
      ['hook 0', 0, undefined],
      ['hook max', 24576, undefined],
      ['hook over max → env → 0', 24577, undefined],
      ['hook fractional → 0', 1.5, undefined],
      ['hook null → env', null, '512'],
      ['hook null, no env → 0', null, undefined],
      ['hook undefined, bad env → 0', undefined, 'abc'],
      ['hook null, empty env → 0', null, ''],
      ['hook string number', '128', undefined],
      ['hook -2 invalid → 0', -2, undefined],
    ])('%s', (_n, hook, env) => {
      if (env === undefined) delete process.env['GEMINI_THINKING_BUDGET'];
      else process.env['GEMINI_THINKING_BUDGET'] = env;
      expect(resolveThinkingBudget(hook)).toBe(L.resolveThinkingBudget(hook));
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  describe('dynamic tag value resolution', () => {
    const API = {
      data: {
        profile: { status: 'enable', name: 'Somchai' },
        installment: { total: 10, paid: 4, zero: 0 },
        balances: [
          { asset_code: 'cash', amount: 250 },
          { asset_code: 'coin', amount: 8 },
        ],
        deposit: [{ status: 'success' }, { status: 'pending' }],
        html: '<a href="#">อนุมัติ</a>',
      },
    };
    const WRAPPED = { data: { data: { profile: { status: 'enable' } } } };

    it.each([
      ['plain path', 'data.profile.name'],
      ['indexed path', 'data.deposit[0].status'],
      ['second index', 'data.deposit[1].status'],
      ['filter by field value', 'data.balances[asset_code=cash].amount'],
      ['filter, second member', 'data.balances[asset_code=coin].amount'],
      ['filter with no match', 'data.balances[asset_code=gold].amount'],
      ['missing path', 'data.nope.nope'],
      ['bare root', 'data'],
      ['resilient data. retry', 'profile.name'],
      ['html strip', 'data.html'],
      ['translated status', 'data.profile.status'],
    ])('getNestedResilient + computeDynamicTagValue: %s', (_n, path) => {
      const tag = { tag: 'ins_x_1', value: path, sub_type: 'CUSTOMER' };
      expect(getNestedResilient(API, path)).toEqual(
        L.getNestedResilient(API, path),
      );
      expect(
        computeDynamicTagValue(API, tag, { tool: 't', scope: 's' }, formatDeps),
      ).toBe(L.computeDynamicTagValue(API, tag, { tool: 't', scope: 's' }));
    });

    it('the double-wrap retry (data.data.) agrees', () => {
      expect(getNestedResilient(WRAPPED, 'profile.status')).toEqual(
        L.getNestedResilient(WRAPPED, 'profile.status'),
      );
    });

    it.each([
      ['addition', 'data.installment.total + data.installment.paid'],
      ['subtraction', 'data.installment.total - data.installment.paid'],
      ['multiplication', 'data.installment.total * data.installment.paid'],
      ['division', 'data.installment.total / data.installment.paid'],
    ])('calculation: %s', (_n, value) => {
      const tag = { tag: 'ins_x_2', value, sub_type: 'CUSTOMER' };
      expect(computeDynamicTagValue(API, tag, {}, formatDeps)).toBe(
        L.computeDynamicTagValue(API, tag, {}),
      );
    });

    it.each([
      ['division by zero', 'data.installment.total / data.installment.zero'],
      ['non-numeric operand', 'data.profile.name + data.installment.total'],
      ['missing operand', 'data.nope + data.installment.total'],
    ])('%s throws identically', (_n, value) => {
      const tag = { tag: 'ins_x_3', value, sub_type: 'CUSTOMER' };
      let portErr = '';
      let legErr = '';
      try {
        computeDynamicTagValue(API, tag, {}, formatDeps);
      } catch (e) {
        portErr = (e as Error).message;
      }
      try {
        L.computeDynamicTagValue(API, tag, {});
      } catch (e) {
        legErr = (e as Error).message;
      }
      expect(portErr).not.toBe('');
      expect(portErr).toBe(legErr);
    });

    it.each([
      ['legacy Path : key', { 'Path : CUSTOMER': { a: 1 } }, 'CUSTOMER'],
      ['verbatim sub_type', { CUSTOMER_LOOKUP: { a: 2 } }, 'CUSTOMER_LOOKUP'],
      ['upper-cased sub_type', { CUSTOMER: { a: 3 } }, 'customer'],
      ['no match', { OTHER: { a: 4 } }, 'CUSTOMER'],
      ['null profile', null, 'CUSTOMER'],
    ])('pickApiSource: %s', (_n, profile, subType) => {
      const tag = { tag: 't', value: 'a', sub_type: subType };
      expect(pickApiSource(profile, tag)).toEqual(
        L.pickApiSource(profile, tag),
      );
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  describe('askGemini — all three return shapes', () => {
    /** legacy's 17 positional parameters, in order, as one array. */
    const args = (over: Partial<Record<number, unknown>> = {}): unknown[] => {
      const base: unknown[] = [
        'ยอดค้างเท่าไหร่', // 1 question
        'DOCUMENT BODY', // 2 docText
        0, // 3 fastModeOverride
        FAKE_KEY, // 4 geminiKey
        '', // 5 suggestionText
        null, // 6 profileData
        undefined, // 7 geminiTemp
        undefined, // 8 geminiTopK
        undefined, // 9 geminiTopP
        null, // 10 hookId
        null, // 11 hookGroupId
        false, // 12 sendRawJson
        '', // 13 rawJsonRules
        null, // 14 hookThinkingBudget
        false, // 15 sendSiteRules
        {}, // 16 dictOpts
        '', // 17 siteRulesGuide
      ];
      for (const [k, v] of Object.entries(over)) base[Number(k)] = v;
      return base;
    };

    const geminiOk = (text: string) => ({
      status: 200,
      data: { candidates: [{ content: { parts: [{ text }] } }] },
    });

    /** Runs legacy then the port, returning both results and both request logs. */
    const runBoth = async (
      a: unknown[],
      impl: () => unknown,
    ): Promise<{
      legacyResult: Record<string, unknown>;
      portResult: Record<string, unknown>;
      legacyCalls: unknown[][];
      portCalls: unknown[][];
    }> => {
      httpPost.mockReset();
      httpPost.mockImplementation(impl as never);
      const legacyResult = await legacy.askGemini(...a);
      const legacyCalls = httpPost.mock.calls.map((c) => [...c]);

      httpPost.mockReset();
      httpPost.mockImplementation(impl as never);
      const portResult = await (
        service.askGemini as unknown as (
          ...x: unknown[]
        ) => Promise<Record<string, unknown>>
      ).apply(service, a);
      const portCalls = httpPost.mock.calls.map((c) => [...c]);
      return { legacyResult, portResult, legacyCalls, portCalls };
    };

    /**
     * [FEAT-20260908-GEMINIKEYHEADER] ONE INTENDED DIVERGENCE FROM LEGACY, MADE VISIBLE.
     *
     * Legacy appends the API key to the Gemini URL (`?key=…`). The port sends it in
     * the `x-goog-api-key` header instead, because axios attaches the request URL to
     * every error it throws and this codebase logs error objects — measured against
     * the live vendor on 08/09/2026: a forced 404 carried the LIVE KEY in
     * `err.config.url` in the query form and carried none in the header form.
     *
     * That is a deliberate behaviour change, so byte-for-byte parity on the URL is no
     * longer the right assertion. This normaliser strips the key from BOTH sides —
     * legacy's query and the port's header — so every OTHER byte is still compared
     * exactly. The divergence itself is not waved through: the case
     * "the key moved from the query to a header" below pins both halves of it, so
     * removing the header would go red here rather than silently passing.
     */
    function stripKeyPlacement(
      calls: unknown[][],
      expectedTimeout: number = PORT_TIMEOUT_MS,
    ): unknown[][] {
      return calls.map((c) => {
        const [url, body, config] = c;
        const cfg = { ...((config ?? {}) as Record<string, unknown>) };
        /* [FEAT-20260908-AITIMEOUT] The stall ceiling diverged from legacy too — the
       owner raised it 30s -> 45s on 08/09/2026. Assert each side's value out loud
       before removing it, so a normaliser can never quietly absorb a number
       nobody chose. */
        expect(cfg['timeout']).toBe(expectedTimeout);
        delete cfg['timeout'];
        delete cfg['headers'];
        return [String(url).replace(/\?key=[^&]*/, ''), body, cfg];
      });
    }

    it('⚠️⚠️ SHAPE 1 — fast mode 2 returns NO tagStatus KEY (not null)', async () => {
      const a = args({ 2: 2, 1: '' });
      const legRes = await legacy.askGemini(...a);
      const portRes = await (
        service.askGemini as unknown as (
          ...x: unknown[]
        ) => Promise<Record<string, unknown>>
      ).apply(service, a);

      expect(Object.keys(legRes).sort()).toEqual(['noData', 'text']);
      expect(Object.keys(portRes).sort()).toEqual(Object.keys(legRes).sort());
      expect('tagStatus' in portRes).toBe(false);
      expect(portRes).toEqual(legRes);
      expect(portRes).toEqual({ text: FALLBACK_TEXT, noData: true });
      // The caller's test is `tagStatus === null && noData`. This is why it fails.
      expect((portRes as { tagStatus?: unknown }).tagStatus).toBeUndefined();
      expect((portRes as { tagStatus?: unknown }).tagStatus === null).toBe(
        false,
      );
      expect(httpPost).not.toHaveBeenCalled();
    });

    it('fast mode 2 WITH a document returns the document, still no tagStatus', async () => {
      const a = args({ 2: 2, 1: 'the doc body' });
      const legRes = await legacy.askGemini(...a);
      const portRes = await (
        service.askGemini as unknown as (
          ...x: unknown[]
        ) => Promise<Record<string, unknown>>
      ).apply(service, a);
      expect(portRes).toEqual(legRes);
      expect(portRes).toEqual({ text: 'the doc body', noData: false });
      expect(Object.keys(portRes)).not.toContain('tagStatus');
      expect(httpPost).not.toHaveBeenCalled();
    });

    it('fast mode 2 accepts the string "2" too', async () => {
      const a = args({ 2: '2', 1: '' });
      const legRes = await legacy.askGemini(...a);
      const portRes = await (
        service.askGemini as unknown as (
          ...x: unknown[]
        ) => Promise<Record<string, unknown>>
      ).apply(service, a);
      expect(portRes).toEqual(legRes);
      expect(Object.keys(portRes)).not.toContain('tagStatus');
    });

    it.each([
      ['found tag', 'คำตอบคือ 1500 บาท [[[FOUND]]]', 'found'],
      ['not-found tag', 'ขออภัย [[[NOT_FOUND]]]', 'not_found'],
      ['both — not_found wins', 'x [[[FOUND]]] y [[[NOT_FOUND]]]', 'not_found'],
      ['curly form', 'x {{{FOUND}}}', 'found'],
      ['paren form', 'x (((NOT_FOUND)))', 'not_found'],
      ['no tag at all', 'คำตอบคือ 1500 บาท', null],
    ])('SHAPE 2 — success: %s', async (_n, modelText, expected) => {
      const { legacyResult, portResult, legacyCalls, portCalls } =
        await runBoth(args(), () => Promise.resolve(geminiOk(modelText)));
      expect(portResult).toEqual(legacyResult);
      expect(portResult['tagStatus']).toBe(expected);
      expect(portResult['http_status']).toBe(200);
      expect(portResult['error_message']).toBeNull();
      expect(Object.keys(portResult).sort()).toEqual(
        [
          'error_message',
          'http_status',
          'noData',
          'response_data',
          'tagStatus',
          'text',
        ].sort(),
      );
      expect(stripKeyPlacement(portCalls)).toEqual(
        stripKeyPlacement(legacyCalls, LEGACY_TIMEOUT_MS),
      );
    });

    it('SHAPE 2 — a fallback answer sets noData with tagStatus null', async () => {
      const { legacyResult, portResult } = await runBoth(args(), () =>
        Promise.resolve(geminiOk(FALLBACK_TEXT)),
      );
      expect(portResult).toEqual(legacyResult);
      expect(portResult['noData']).toBe(true);
      expect(portResult['tagStatus']).toBeNull();
    });

    it('SHAPE 2 — an empty model payload falls back to FALLBACK_TEXT', async () => {
      const { legacyResult, portResult } = await runBoth(args(), () =>
        Promise.resolve({ status: 200, data: {} }),
      );
      expect(portResult).toEqual(legacyResult);
      expect(portResult['text']).toBe(FALLBACK_TEXT);
      expect(portResult['noData']).toBe(true);
    });

    /** An axios rejection: always an Error, optionally carrying `.response`. */
    const axiosError = (message: string, response?: unknown): Error =>
      response === undefined
        ? new Error(message)
        : Object.assign(new Error(message), { response });

    it.each([
      [
        '429 with error.message',
        axiosError('Request failed with status code 429', {
          status: 429,
          data: { error: { message: 'quota' } },
        }),
      ],
      [
        '500 with data.message',
        axiosError('Request failed with status code 500', {
          status: 500,
          data: { message: 'boom' },
        }),
      ],
      ['transport failure, no response', axiosError('socket hang up')],
    ])('SHAPE 3 — error: %s', async (_n, err) => {
      const { legacyResult, portResult, legacyCalls, portCalls } =
        await runBoth(args(), () => Promise.reject(err));
      expect(portResult).toEqual(legacyResult);
      expect(portResult['text']).toBe(
        'โปรดลองอีกครั้งหรือกรุณาติดต่อเจ้าหน้าที่',
      );
      expect(portResult['noData']).toBe(false);
      expect(portResult['tagStatus']).toBeNull();
      expect(stripKeyPlacement(portCalls)).toEqual(
        stripKeyPlacement(legacyCalls, LEGACY_TIMEOUT_MS),
      );
    });

    it('the thinkingConfig 400 retry fires once and strips the config', async () => {
      let n = 0;
      const impl = () => {
        n += 1;
        if (n === 1)
          return Promise.reject(
            axiosError('Request failed with status code 400', {
              status: 400,
              data: { error: { message: 'thinkingConfig unsupported' } },
            }),
          );
        return Promise.resolve(geminiOk('ok [[[FOUND]]]'));
      };
      httpPost.mockReset();
      httpPost.mockImplementation(impl as never);
      const legRes = await legacy.askGemini(...args());
      const legCalls = httpPost.mock.calls.map((c) => [...c]);

      n = 0;
      httpPost.mockReset();
      httpPost.mockImplementation(impl as never);
      const portRes = await (
        service.askGemini as unknown as (
          ...x: unknown[]
        ) => Promise<Record<string, unknown>>
      ).apply(service, args());
      const portCalls = httpPost.mock.calls.map((c) => [...c]);

      expect(portRes).toEqual(legRes);
      expect(portCalls).toHaveLength(2);
      expect(stripKeyPlacement(portCalls)).toEqual(
        stripKeyPlacement(legCalls, LEGACY_TIMEOUT_MS),
      );
      const second = portCalls[1]![1] as {
        generationConfig: Record<string, unknown>;
      };
      expect(second.generationConfig['thinkingConfig']).toBeUndefined();
    });

    it('a non-400 error is NOT retried', async () => {
      const { legacyCalls, portCalls } = await runBoth(args(), () =>
        Promise.reject(
          axiosError('Request failed with status code 503', {
            status: 503,
            data: { message: 'thinking' },
          }),
        ),
      );
      expect(portCalls).toHaveLength(1);
      expect(stripKeyPlacement(portCalls)).toEqual(
        stripKeyPlacement(legacyCalls, LEGACY_TIMEOUT_MS),
      );
    });

    it('uses the /v1beta/ endpoint — NOT /v1/ like findRelevantText', async () => {
      const { portCalls, legacyCalls } = await runBoth(args(), () =>
        Promise.resolve(geminiOk('x')),
      );
      expect(String(portCalls[0]![0])).toContain('/v1beta/models/');
      /* [FEAT-20260908-GEMINIKEYHEADER] the URLs are equal apart from the key */
      expect(String(portCalls[0]![0])).toBe(
        String(legacyCalls[0]![0]).replace(/\?key=[^&]*/, ''),
      );
      expect(portCalls[0]![2]).toEqual({
        timeout: PORT_TIMEOUT_MS,
        headers: { 'x-goog-api-key': FAKE_KEY },
      });
    });

    it('🔴 [FEAT-20260908-GEMINIKEYHEADER] the key moved from the query to a header — both halves pinned', () => {
      /* This is the one place the port deliberately DIVERGES from legacy, so it
         gets its own case rather than living inside a normaliser nobody reads.
         `stripKeyPlacement` removes exactly this difference before the byte
         comparisons above; if it ever removed more, or if the header were
         dropped, one of the two halves below goes red. */
      const legacyUrl = `https://generativelanguage.googleapis.com/v1beta/models/m:generateContent?key=${FAKE_KEY}`;
      const [url, , config] = stripKeyPlacement([
        [
          `https://generativelanguage.googleapis.com/v1beta/models/m:generateContent`,
          {},
          { timeout: PORT_TIMEOUT_MS, headers: { 'x-goog-api-key': FAKE_KEY } },
        ],
      ])[0]!;
      /* the normaliser makes the two comparable... */
      expect(url).toBe(
        stripKeyPlacement(
          [[legacyUrl, {}, { timeout: LEGACY_TIMEOUT_MS }]],
          LEGACY_TIMEOUT_MS,
        )[0]![0],
      );
      /* ...by removing the key and the ceiling, and nothing else */
      expect(config).toEqual({});
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  describe('askGemini — the parts array order and the two switch couplings', () => {
    const PROFILE = {
      'Path : api/v1/customer': {
        data: { installment: { total_due_amount: 1500, due_date: '25/08' } },
      },
      SITE_RULES: { role: 'site_rules', data: { min_deposit: 100 } },
    };

    const build = async (over: Record<number, unknown>) => {
      const base: unknown[] = [
        'q',
        'DOC',
        0,
        FAKE_KEY,
        '',
        PROFILE,
        undefined,
        undefined,
        undefined,
        null,
        null,
        false,
        '',
        null,
        false,
        {},
        '',
      ];
      for (const [k, v] of Object.entries(over)) base[Number(k)] = v;
      httpPost.mockReset();
      httpPost.mockImplementation((() =>
        Promise.resolve({
          status: 200,
          data: { candidates: [{ content: { parts: [{ text: 'ok' }] } }] },
        })) as never);
      await legacy.askGemini(...base);
      const legBody = httpPost.mock.calls[0]![1] as {
        contents: { parts: { text: string }[] }[];
      };
      httpPost.mockReset();
      httpPost.mockImplementation((() =>
        Promise.resolve({
          status: 200,
          data: { candidates: [{ content: { parts: [{ text: 'ok' }] } }] },
        })) as never);
      await (
        service.askGemini as unknown as (...x: unknown[]) => Promise<unknown>
      ).apply(service, base);
      const portBody = httpPost.mock.calls[0]![1] as typeof legBody;
      return { legBody, portBody };
    };

    const heads = (b: { contents: { parts: { text: string }[] }[] }) =>
      b.contents[0]!.parts.map((p) => p.text.split('\n')[0]);

    it('both switches off — two parts, Document then Question', async () => {
      const { legBody, portBody } = await build({});
      expect(portBody).toEqual(legBody);
      expect(heads(portBody)).toEqual(['Document:', 'Question:']);
    });

    it('sendRawJson only — rawJson, rawJsonRules, Document, Question', async () => {
      const { legBody, portBody } = await build({
        11: true,
        12: 'follow the json',
      });
      expect(portBody).toEqual(legBody);
      expect(heads(portBody)).toEqual([
        '[RAW_JSON_PROFILE_START]',
        '[RAW_JSON_PROFILE_RULES_START]',
        'Document:',
        'Question:',
      ]);
      // Not excluded, so the site-rules endpoint IS in the dump.
      expect(portBody.contents[0]!.parts[0]!.text).toContain('SITE_RULES');
    });

    it('sendRawJson on but rules blank — the rules block is skipped', async () => {
      const { legBody, portBody } = await build({ 11: true, 12: '   ' });
      expect(portBody).toEqual(legBody);
      expect(heads(portBody)).toEqual([
        '[RAW_JSON_PROFILE_START]',
        'Document:',
        'Question:',
      ]);
    });

    it('sendSiteRules only — siteRules and its guide, NOT the raw json', async () => {
      const { legBody, portBody } = await build({
        14: true,
        16: 'site rules apply',
      });
      expect(portBody).toEqual(legBody);
      expect(heads(portBody)).toEqual([
        '[RAW_SITE_RULES_START]',
        '[SITE_RULES_GUIDE_START]',
        'Document:',
        'Question:',
      ]);
    });

    it('⚠️ BOTH on — full order, and site rules appear ONCE', async () => {
      const { legBody, portBody } = await build({
        11: true,
        12: 'json rules',
        14: true,
        16: 'site guide',
      });
      expect(portBody).toEqual(legBody);
      expect(heads(portBody)).toEqual([
        '[RAW_JSON_PROFILE_START]',
        '[RAW_JSON_PROFILE_RULES_START]',
        '[RAW_SITE_RULES_START]',
        '[SITE_RULES_GUIDE_START]',
        'Document:',
        'Question:',
      ]);
      // The coupling: the raw-json dump no longer carries the site-rules block.
      expect(portBody.contents[0]!.parts[0]!.text).not.toContain('min_deposit');
      expect(portBody.contents[0]!.parts[2]!.text).toContain('min_deposit');
    });

    it('⚠️ the two guides are gated on DIFFERENT switches', async () => {
      // rawJsonRules filled but only sendSiteRules on → the json rules are absent.
      const a = await build({ 12: 'json rules', 14: true, 16: 'site guide' });
      expect(a.portBody).toEqual(a.legBody);
      expect(heads(a.portBody)).not.toContain('[RAW_JSON_PROFILE_RULES_START]');
      // siteRulesGuide filled but only sendRawJson on → the site guide is absent.
      const b = await build({ 11: true, 12: 'json rules', 16: 'site guide' });
      expect(b.portBody).toEqual(b.legBody);
      expect(heads(b.portBody)).not.toContain('[SITE_RULES_GUIDE_START]');
    });

    it('no document — the Document part disappears entirely', async () => {
      const { legBody, portBody } = await build({ 1: '' });
      expect(portBody).toEqual(legBody);
      expect(heads(portBody)).toEqual(['Question:']);
    });

    it('base tags are substituted into the system instruction identically', async () => {
      const { legBody, portBody } = await build({
        4: 'ยอดรวม [[[total_due_amount]]] ครบกำหนด [[[ ins_due_date ]]] เหลือ [[[Total_terms_remain]]] งวด',
      });
      expect(portBody).toEqual(legBody);
      const instruction = (
        portBody as unknown as {
          system_instruction: { parts: { text: string }[] };
        }
      ).system_instruction.parts[0]!.text;
      expect(instruction).toContain('ยอดรวม 1500');
      expect(instruction).toContain('ครบกำหนด 25/08');
    });

    it('generationConfig matches, including the resolved thinkingBudget', async () => {
      const { legBody, portBody } = await build({
        6: 0.7,
        7: '5',
        8: '0.9',
        13: 512,
      });
      expect(portBody).toEqual(legBody);
      expect(
        (portBody as unknown as { generationConfig: unknown }).generationConfig,
      ).toEqual({
        temperature: 0.7,
        topP: 0.9,
        topK: 5,
        thinkingConfig: { thinkingBudget: 512 },
      });
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  describe('askGemini — dynamic tag resolution against the tag rows', () => {
    const PROFILE = {
      CUSTOMER: {
        data: { profile: { status: 'enable' }, bal: { a: 10, b: 4 } },
      },
    };

    const run = async (suggestion: string, rows: unknown[]) => {
      tagRows = rows;
      const base: unknown[] = [
        'q',
        'DOC',
        0,
        FAKE_KEY,
        suggestion,
        PROFILE,
        undefined,
        undefined,
        undefined,
        'hook-1',
        'grp-1',
        false,
        '',
        null,
        false,
        { tool: 't', scope: 's' },
        '',
      ];
      const ok = (() =>
        Promise.resolve({
          status: 200,
          data: { candidates: [{ content: { parts: [{ text: 'ok' }] } }] },
        })) as never;

      httpPost.mockReset();
      httpPost.mockImplementation(ok);
      tagFind.mockClear();
      await legacy.askGemini(...base);
      const legInstruction = (
        httpPost.mock.calls[0]![1] as {
          system_instruction: { parts: { text: string }[] };
        }
      ).system_instruction.parts[0]!.text;
      const legQuery = tagFind.mock.calls[0]![0];

      httpPost.mockReset();
      httpPost.mockImplementation(ok);
      tagFind.mockClear();
      await (
        service.askGemini as unknown as (...x: unknown[]) => Promise<unknown>
      ).apply(service, base);
      const portInstruction = (
        httpPost.mock.calls[0]![1] as {
          system_instruction: { parts: { text: string }[] };
        }
      ).system_instruction.parts[0]!.text;
      const portQuery = tagFind.mock.calls[0]![0];

      return { legInstruction, portInstruction, legQuery, portQuery };
    };

    it('the scoped query is the one buildDynamicTagQuery produces', async () => {
      const { legQuery, portQuery } = await run('no tags here', []);
      expect(portQuery).toEqual(legQuery);
      expect(portQuery).toEqual(buildDynamicTagQuery('hook-1', 'grp-1'));
    });

    it.each([
      ['triple bracket', '[[[ins_x_1]]]'],
      ['double bracket', '[[ins_x_1]]'],
      ['curly', '{{ins_x_1}}'],
      ['bare', 'ins_x_1'],
      ['padded', '[[[  ins_x_1  ]]]'],
      ['twice', '[[[ins_x_1]]] และ [[ins_x_1]]'],
    ])('resolves the %s form identically', async (_n, form) => {
      const { legInstruction, portInstruction } = await run(
        `สถานะ ${form} ครับ`,
        [
          {
            tag: 'ins_x_1',
            value: 'data.profile.status',
            sub_type: 'CUSTOMER',
          },
        ],
      );
      expect(portInstruction).toBe(legInstruction);
      expect(portInstruction).toContain('เปิดใช้งาน'); // via the shared dictionary fake
    });

    it('a calculation error becomes N/A and logs one operation row', async () => {
      const { legInstruction, portInstruction } = await run(
        'เหลือ [[[ins_x_9]]]',
        [
          {
            tag: 'ins_x_9',
            value: 'data.bal.a / data.bal.missing',
            sub_type: 'CUSTOMER',
          },
        ],
      );
      expect(portInstruction).toBe(legInstruction);
      expect(portInstruction).toContain('N/A');
    });

    it('⚠️ the tag name is interpolated into the RegExp UNESCAPED', async () => {
      /* The guard is `includes(dTag.tag)` — a literal test — but the replacement
       * is a RegExp built by interpolation. For `a+c_x_1` the two disagree:
       *   · the literal `a+c_x_1` IS in the text, so the tag is processed;
       *   · the pattern `a+c_x_1` means "one or more 'a' then c_x_1", which does
       *     NOT match `a+c_x_1` and DOES match the unrelated `aac_x_1`.
       * So the customer sees the raw tag left in place and a different token
       * replaced. Escaping the name fixes both — and changes the reply for every
       * tag of this shape that is already live. Pinned so the "fix" turns red. */
      const { legInstruction, portInstruction } = await run(
        'x a+c_x_1 y aac_x_1 z',
        [
          {
            tag: 'a+c_x_1',
            value: 'data.profile.status',
            sub_type: 'CUSTOMER',
          },
        ],
      );
      expect(portInstruction).toBe(legInstruction);
      // the literal tag SURVIVES (the pattern cannot match it) ...
      expect(portInstruction).toContain('a+c_x_1');
      // ... and the innocent bystander is what got substituted.
      expect(portInstruction).not.toContain('aac_x_1');
      expect(portInstruction).toContain('เปิดใช้งาน');
    });

    it('an unknown marker left in the text is reported exactly once', async () => {
      createLog.mockClear();
      tagRows = [
        { tag: 'ins_x_1', value: 'data.profile.status', sub_type: 'CUSTOMER' },
      ];
      const base: unknown[] = [
        'q',
        'DOC',
        2,
        FAKE_KEY,
        'ยอด odk_x_777 และ odk_x_777 บาท',
        PROFILE,
        undefined,
        undefined,
        undefined,
        'hook-1',
        'grp-1',
        false,
        '',
        null,
        false,
        {},
        '',
      ];
      await legacy.askGemini(...base);
      const legRows = createLog.mock.calls.map((c) => c[0]);
      createLog.mockClear();
      await (
        service.askGemini as unknown as (...x: unknown[]) => Promise<unknown>
      ).apply(service, base);
      const portRows = createLog.mock.calls.map((c) => c[0]);
      expect(portRows).toHaveLength(1);
      expect(portRows).toEqual(legRows);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  describe('analyzeConversationForAdmin / analyzeCategoryFromRoom', () => {
    const okJson = (text: string) => ({
      status: 200,
      data: { candidates: [{ content: { parts: [{ text }] } }] },
    });

    it.each([
      ['clean json', '{"summary":"ต้องการปิดบัญชี","category":"Collection"}'],
      ['fenced json', '```json\n{"summary":"s","category":"IT"}\n```'],
      ['no braces', 'sorry I cannot'],
      ['malformed json', '{ this is not json'],
      ['missing fields', '{}'],
      ['empty', ''],
    ])('analyzeConversationForAdmin: %s', async (_n, text) => {
      httpPost.mockReset();
      httpPost.mockImplementation((() =>
        Promise.resolve(okJson(text))) as never);
      const leg = await legacy.analyzeConversationForAdmin(
        'h',
        'q',
        'a',
        FAKE_KEY,
      );
      const legUrl = httpPost.mock.calls[0]![0];
      httpPost.mockReset();
      httpPost.mockImplementation((() =>
        Promise.resolve(okJson(text))) as never);
      const port = await service.analyzeConversationForAdmin(
        'h',
        'q',
        'a',
        FAKE_KEY,
      );
      expect(port).toEqual(leg);
      /* [FEAT-20260907-AIVENDORCORE] same named exception — legacy still says
         `/v1`, the port now says `/v1beta`, and the two differ in that segment
         and nothing else. */
      expect(String(legUrl)).toContain('/v1/models/');
      expect(String(httpPost.mock.calls[0]![0])).toContain('/v1beta/models/');
      /* [FEAT-20260908-GEMINIKEYHEADER] and the key is no longer in either URL
         on the port side — so legacy's `?key=` is stripped before comparing. */
      expect(
        String(httpPost.mock.calls[0]![0]).replace('/v1beta/', '/v1/'),
      ).toBe(String(legUrl).replace(/\?key=[^&]*/, ''));
    });

    it('analyzeConversationForAdmin: a request failure has its own wording', async () => {
      httpPost.mockReset();
      httpPost.mockImplementation(() => Promise.reject(new Error('down')));
      const leg = await legacy.analyzeConversationForAdmin(
        'h',
        'q',
        'a',
        FAKE_KEY,
      );
      const port = await service.analyzeConversationForAdmin(
        'h',
        'q',
        'a',
        FAKE_KEY,
      );
      expect(port).toEqual(leg);
      expect(port.summary).toBe('เกิดข้อผิดพลาดในการวิเคราะห์บทสนทนา');
    });

    const ROOM = 'a0d000000000000000000012';

    it.each([
      [
        'a clean category',
        '{"category":"แจ้งชำระเงิน/ส่งสลิป"}',
        [
          {
            sender_type: 'customer',
            message_type: 'text',
            content: 'โอนแล้วครับ',
          },
          { sender_type: 'bot', message_type: 'text', content: 'รับทราบครับ' },
        ],
      ],
      [
        'a blank category falls back',
        '{"category":"   "}',
        [{ sender_type: 'customer', message_type: 'text', content: 'hi' }],
      ],
      [
        'no braces falls back',
        'nope',
        [{ sender_type: 'customer', message_type: 'text', content: 'hi' }],
      ],
    ])('analyzeCategoryFromRoom: %s', async (_n, text, rows) => {
      chatRows = rows;
      httpPost.mockReset();
      httpPost.mockImplementation((() =>
        Promise.resolve(okJson(text))) as never);
      const leg = await legacy.analyzeCategoryFromRoom(ROOM, FAKE_KEY);
      const legBody = httpPost.mock.calls[0]![1];
      httpPost.mockReset();
      httpPost.mockImplementation((() =>
        Promise.resolve(okJson(text))) as never);
      const port = await service.analyzeCategoryFromRoom(ROOM, FAKE_KEY);
      expect(port).toBe(leg);
      expect(httpPost.mock.calls[0]![1]).toEqual(legBody);
    });

    it('⚠️ limit(5) is applied BEFORE the text filter — images crowd text out', async () => {
      chatRows = [
        { sender_type: 'customer', message_type: 'image', content: 'a.jpg' },
        { sender_type: 'customer', message_type: 'image', content: 'b.jpg' },
      ];
      httpPost.mockReset();
      httpPost.mockImplementation(refuse('post'));
      const leg = await legacy.analyzeCategoryFromRoom(ROOM, FAKE_KEY);
      const port = await service.analyzeCategoryFromRoom(ROOM, FAKE_KEY);
      expect(port).toBe(leg);
      expect(port).toBe('อื่นๆ');
      expect(httpPost).not.toHaveBeenCalled();
    });

    it('a malformed room id degrades to "อื่นๆ" without a request', async () => {
      chatRows = [];
      httpPost.mockReset();
      httpPost.mockImplementation(refuse('post'));
      const leg = await legacy.analyzeCategoryFromRoom(
        'not-an-objectid',
        FAKE_KEY,
      );
      const port = await service.analyzeCategoryFromRoom(
        'not-an-objectid',
        FAKE_KEY,
      );
      expect(port).toBe(leg);
      expect(port).toBe('อื่นๆ');
      expect(httpPost).not.toHaveBeenCalled();
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  it('suggestQuestions is gone from the port and present in legacy', () => {
    // The deletion is deliberate: no caller anywhere in legacy-api, and the body
    // is a billable model call. Asserted so a future "restore the missing
    // export" change has to argue with this line.
    expect(
      (legacy as unknown as Record<string, unknown>)['suggestQuestions'],
    ).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const port = require('@/modules/ai') as Record<string, unknown>;
    expect(port['suggestQuestions']).toBeUndefined();
    // validateSignature is likewise not re-implemented here — line-signature.guard.ts owns it.
    expect(port['validateSignature']).toBeUndefined();
  });
});
