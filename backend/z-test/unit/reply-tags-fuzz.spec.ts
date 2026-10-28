import {
  MAX_LENGTH,
  looksLikeFlexPcJson,
  resolveReplyTags,
} from '@/modules/webhook/hook-reply/reply-tags.util';

/**
 * Property / fuzz suite for the marker-stripping guarantee.
 *
 * The customer-facing strip is NOT a standalone function — it is the catch-all
 * block at the end of `resolveReplyTags` (reply-tags.util.ts:261-271). So every
 * property here drives the real send path `resolveReplyTags(input, link)` and
 * asserts on `.finalReplyForLine`, the exact string that goes to LINE.
 *
 * The owner's rule is absolute: a reply sent to a customer must NEVER contain
 * `[[[`, `]]]`, `[[`, `]]`, `[START_OF_` or `[END_OF_`. This suite proves it
 * across a combinatorially-generated corpus rather than a handful of examples.
 *
 * ⚠️ NO Math.random anywhere — it is banned in this repo and makes fuzz tests
 *    flaky. The corpus is a FIXED cartesian product of marker fragments, so the
 *    same inputs run on every machine, every time.
 *
 * webhook-reply-render.spec.ts already covers the single, hand-picked cases and
 * the route-precedence contract; this file EXTENDS it with the exhaustive
 * bracket-leak sweep, and does not duplicate those example-based tests.
 *
 * ไฟล์นี้เป็น fuzz แบบ deterministic — คอร์ปัสมาจากการวนลูปคูณกัน (cartesian)
 * ไม่มีการสุ่ม จึงได้ผลเหมือนเดิมทุกครั้ง.
 */

// ── The forbidden shapes — asserted on the OUTPUT, never on the input ─────────
// Any one of these surviving to `finalReplyForLine` is a marker leak.
const LEAK_PATTERNS: readonly RegExp[] = [
  /\[\[\[/,
  /\]\]\]/,
  /\[\[/,
  /\]\]/,
  /\[START_OF_/,
  /\[END_OF_/,
];

/** True when ANY forbidden shape is present. เจอเศษ marker แม้ตัวเดียว = leak. */
function hasLeak(out: string): RegExp | null {
  for (const re of LEAK_PATTERNS) {
    if (re.test(out)) return re;
  }
  return null;
}

// ── The marker alphabet — fixed fragments the corpus is built from ────────────
// Each entry is a real-world marker SHAPE the model is known to emit. Every one
// of these is EXPECTED to be fully stripped, so the corpus built from them must
// come out clean. The shapes the util does NOT handle are listed separately in
// FOUND_LEAK_FRAGMENTS below so this set stays a true "must be clean" contract.
const MARKER_FRAGMENTS: readonly string[] = [
  // three-bracket family (named + invented + malformed inner)
  '[[[customer-helper]]]',
  '[[[flex_profile]]]',
  '[[[flex_m00001]]]',
  '[[[flex_pc00002]]]',
  '[[[assist]]]',
  '[[[history]]]',
  '[[[img_promo]]]',
  '[[[unknown_tag]]]',
  '[[[]]]', // empty inner
  '[[[flex_m0001]]]', // malformed: four digits, selects no card — still stripped
  '[[[x]]', // three open, two close — `]]]?` allows this, so it IS stripped
  // two-bracket family
  '[[customer-helper]]',
  '[[bracket2]]',
  '[[]]', // empty inner
  // single-bracket SCREAMING_CASE doc delimiters
  '[START_OF_BASIC_INFO]',
  '[END_OF_BASIC_INFO]',
  '[START_OF_COMPANY_INFO]',
  '[END_OF_NO_PROFILE_DATA]',
];

/**
 * ⚠️ FOUND LEAK — now FIXED (owner-approved 2026-08-08, [FIX-20260808-UNCLOSEDMARKER]).
 *
 * This suite discovered two shapes the util failed to strip: an UNCLOSED opener
 * ("[[[assist" with no "]]]") and a reversed run ("]]]broken[[["). The original
 * pair regexes needed a closing pair, so an opener with no close matched none of
 * them and reached the customer verbatim.
 *
 * The owner chose "strip only a known marker" over a blind bracket sweep (which
 * would leave the inner word "assist" — worse). The fix strips the opener plus
 * its single identifier token, stopping at the first space so real text after an
 * unclosed marker survives ("[[[assist world" → "world"). The block below now
 * asserts these are CLEAN and that surrounding prose is preserved — it is the
 * regression test for the fix, applied identically in legacy webhookController.js.
 */
const FIXED_LEAK_CASES: readonly (readonly [string, string])[] = [
  ['[[[assist', ''], // unclosed opener → fully stripped
  [']]]broken[[[', 'broken'], // stray close + stray open → only prose survives
  ['[[[assist world', 'world'], // real text after an unclosed marker is kept
  ['hello [[[assist world', 'hello world'],
];

// ── Carrier templates — how a fragment sits inside a real answer ──────────────
// `%s` is where a marker (or a pair of markers) is spliced in. Covers: alone,
// with leading/trailing real text, Thai text, split across newlines, adjacent.
const CARRIERS: readonly string[] = [
  '%s',
  'สวัสดีค่ะ %s ยินดีค่ะ',
  'hello %s world',
  'line1\n%s\nline3',
  'before%safter', // adjacent, no spaces
  '%s%s', // two markers back-to-back
  '%s ข้อความไทย %s', // two markers around Thai text
  'ก'.repeat(50) + '%s' + 'ข'.repeat(50),
];

/** Splice a fragment (or fragment pair) into a carrier's `%s` slots. */
function fill(carrier: string, a: string, b: string): string {
  let i = 0;
  return carrier.replace(/%s/g, () => (i++ === 0 ? a : b));
}

// ── Build the deterministic corpus: carriers × fragments × fragments ──────────
// Nested loops give a fixed cartesian product. No randomness, fully enumerable.
const CORPUS: string[] = [];
for (const carrier of CARRIERS) {
  for (const a of MARKER_FRAGMENTS) {
    for (const b of MARKER_FRAGMENTS) {
      CORPUS.push(fill(carrier, a, b));
    }
  }
}

// ── Plain-text corpus (NO markers) — used for the preservation property ───────
// These must survive apart from the util's documented whitespace normalisation.
const PLAIN_CORPUS: readonly string[] = [
  'สวัสดีค่ะ',
  'hello world',
  'ราคา [1] บาท', // ordinary single-bracket prose must survive
  '[ดูรูป] ที่นี่', // lowercase single-bracket prose survives
  'line one\nline two',
  'a b c',
  'ยินดีต้อนรับสู่บริการของเรา',
  'https://example.com/path?a=1',
];

/**
 * The whitespace normalisation the util DOCUMENTS and applies in the catch-all:
 *   - runs of 2+ spaces/tabs → a single space
 *   - runs of 3+ newlines    → exactly two
 *   - a final .trim()
 * The preservation property asserts against THIS, not a stricter equality that
 * would false-fail on inputs that legitimately collapse.
 *
 * ⚠️ Mirrors reply-tags.util.ts:268-270 exactly. If the util changes its
 *    normalisation this helper must change with it — kept tiny for that reason.
 */
function expectedNormalise(input: string): string {
  return input
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

describe('reply-tags marker-leak fuzz — no internal marker may reach a customer', () => {
  it(`corpus is deterministic and non-trivial (${CORPUS.length} marker cases)`, () => {
    // Guards against a refactor silently emptying the loops — a green suite
    // over an empty corpus proves nothing. กันคอร์ปัสว่างแล้วผ่านฟรี.
    expect(CORPUS.length).toBe(
      CARRIERS.length * MARKER_FRAGMENTS.length * MARKER_FRAGMENTS.length,
    );
    expect(CORPUS.length).toBeGreaterThan(2000);
  });

  // ── Property 1: no forbidden shape survives to the customer ─────────────────
  describe('Property 1 — output contains none of [[[ ]]] [[ ]] [START_OF_ [END_OF_', () => {
    it('holds for every string in the marker corpus', () => {
      const leaks: { input: string; output: string; pattern: string }[] = [];
      for (const input of CORPUS) {
        const out = resolveReplyTags(
          input,
          'https://link.example',
        ).finalReplyForLine;
        const leak = hasLeak(out);
        if (leak) leaks.push({ input, output: out, pattern: String(leak) });
      }
      // Report EVERY distinct leak, not just the first, so a real defect is
      // visible in full. รายงานทุก leak ที่เจอ ไม่ตัดจบแค่ตัวแรก.
      if (leaks.length > 0) {
        const sample = leaks
          .slice(0, 10)
          .map(
            (l) =>
              `  pattern ${l.pattern}\n    in:  ${JSON.stringify(l.input)}\n    out: ${JSON.stringify(l.output)}`,
          )
          .join('\n');
        throw new Error(
          `FOUND LEAK — ${leaks.length}/${CORPUS.length} corpus inputs leaked a marker:\n${sample}`,
        );
      }
      expect(leaks).toHaveLength(0);
    });
  });

  // ── FOUND LEAK — documented, NOT fixed here ─────────────────────────────────
  /**
   * ⚠️ These assert that the leak STILL happens. They are green today because
   *    the util does not strip unclosed markers. If the owner fixes the util,
   *    these tests turn RED — that is intentional: it forces whoever fixes it to
   *    move the fragment up into MARKER_FRAGMENTS and delete the leak record.
   */
  describe('FIXED LEAK — unclosed / reversed markers are now stripped, prose kept', () => {
    it.each(FIXED_LEAK_CASES.map((c) => [c[0], c[1]] as const))(
      'FIXED: %j → %j, and no marker residue remains',
      (frag, expected) => {
        const out = resolveReplyTags(frag, '').finalReplyForLine;
        // The unclosed marker is gone and any surrounding real text survives.
        expect(out).toBe(expected);
        // And the leak detector is clean — this is what proves the fix.
        expect(hasLeak(out)).toBeNull();
      },
    );
  });

  // ── Property 2: real content is preserved (modulo documented normalisation) ─
  describe('Property 2 — plain text is preserved apart from whitespace collapse', () => {
    it.each(PLAIN_CORPUS.map((t) => [t] as const))(
      'passes %j through unchanged (modulo normalise)',
      (text) => {
        const out = resolveReplyTags(
          text,
          'https://link.example',
        ).finalReplyForLine;
        // The catch-all still runs on marker-free text, so we assert against the
        // util's OWN normalisation, not raw equality.
        expect(out).toBe(expectedNormalise(text));
      },
    );

    it('a marker-free answer never has content eaten by the catch-all', () => {
      // Belt-and-braces: whatever normalise did, the leading real word must
      // still be there. ข้อความจริงต้องไม่โดนกินหายไปกับ marker.
      for (const text of PLAIN_CORPUS) {
        const out = resolveReplyTags(text, '').finalReplyForLine;
        const firstWord = text.trim().split(/\s+/)[0]!.replace(/[[\]]/g, '');
        if (firstWord) expect(out).toContain(firstWord);
      }
    });
  });

  // ── Property 3: the flex_pc JSON exemption is respected ─────────────────────
  describe('Property 3 — a flex_pc JSON payload is NOT corrupted by the stripper', () => {
    // Exact exemption condition reproduced from the util: starts with `{` AND
    // contains `flex_pcNNNNN` (looksLikeFlexPcJson). A payload that legitimately
    // carries `[[` inside its JSON must pass through untouched.
    const flexPcPayloads: readonly string[] = [
      // brackets living inside legitimate JSON values
      '{"flex_pc00001":"card","note":"contains [[ and ]] literally"}',
      '{"flex_pc00042":{"body":"[[bracket2]] stays"},"x":1}',
      // an array with bracket-looking content
      '{"id":"flex_pc00007","items":["[START_OF_X]","[END_OF_X]"]}',
      // leading whitespace is allowed by the `^\s*\{` anchor
      '   {"flex_pc00099":"[[[keep]]]"}',
    ];

    it.each(flexPcPayloads.map((p) => [p] as const))(
      'leaves the exempt payload %j byte-identical (only trimmed)',
      (payload) => {
        // Precondition: these MUST match the util's exemption, else the test is
        // asserting the wrong branch. เช็คก่อนว่าเข้าเงื่อนไข exempt จริง.
        expect(looksLikeFlexPcJson(payload)).toBe(true);
        const out = resolveReplyTags(payload, '').finalReplyForLine;
        // The exempt branch skips BOTH the strip and the normalise; only the
        // early `.trim()` before the branch applies to the raw text — but that
        // trim is on the pre-strip string, so the exempt output equals the
        // input trimmed.
        expect(out).toBe(payload.trim());
        // And its internal brackets are intact — the whole point of the exemption.
        expect(out).toContain(payload.trim().includes('[[') ? '[[' : '[');
      },
    );

    it('a non-JSON reply that merely mentions flex_pc is NOT exempt (still stripped)', () => {
      // The exemption is narrow — it needs the leading `{`. A plain sentence that
      // names a flex_pc tag must go through the stripper normally.
      const out = resolveReplyTags(
        'การ์ดคือ [[[flex_pc00001]]] นะคะ',
        '',
      ).finalReplyForLine;
      expect(looksLikeFlexPcJson('การ์ดคือ [[[flex_pc00001]]] นะคะ')).toBe(
        false,
      );
      expect(hasLeak(out)).toBeNull();
    });
  });

  // ── Property 4: idempotence — strip(strip(x)) === strip(x) ───────────────────
  describe('Property 4 — resolveReplyTags is idempotent over the whole corpus', () => {
    it('applying the strip twice yields the same string', () => {
      const failures: { input: string; once: string; twice: string }[] = [];
      for (const input of CORPUS) {
        const once = resolveReplyTags(
          input,
          'https://link.example',
        ).finalReplyForLine;
        const twice = resolveReplyTags(
          once,
          'https://link.example',
        ).finalReplyForLine;
        if (once !== twice) failures.push({ input, once, twice });
      }
      if (failures.length > 0) {
        const f = failures[0]!;
        throw new Error(
          `NON-IDEMPOTENT — ${failures.length} inputs changed on second pass. e.g.\n` +
            `    in:    ${JSON.stringify(f.input)}\n` +
            `    once:  ${JSON.stringify(f.once)}\n` +
            `    twice: ${JSON.stringify(f.twice)}`,
        );
      }
      expect(failures).toHaveLength(0);
    });

    it('holds for the plain corpus and the flex_pc payloads too', () => {
      const all = [
        ...PLAIN_CORPUS,
        '{"flex_pc00001":"[[keep]]"}',
        '   {"flex_pc00099":"[[[keep]]]"}',
      ];
      for (const input of all) {
        const once = resolveReplyTags(input, '').finalReplyForLine;
        const twice = resolveReplyTags(once, '').finalReplyForLine;
        expect(twice).toBe(once);
      }
    });
  });

  // ── Length guard interaction — a marker at the tail cannot survive the cut ──
  it('a marker past the 4000-char boundary never leaks (stripped before truncation)', () => {
    for (const frag of [
      '[[[unknown_tag]]]',
      '[[bracket2]]',
      '[END_OF_BASIC_INFO]',
    ]) {
      const input = `${'ก'.repeat(4500)}${frag}`;
      const out = resolveReplyTags(input, '').finalReplyForLine;
      expect(hasLeak(out)).toBeNull();
      expect(out.length).toBeLessThanOrEqual(MAX_LENGTH);
    }
  });
});
