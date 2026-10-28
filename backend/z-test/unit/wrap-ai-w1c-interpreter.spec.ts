/**
 * [WRAP-AI W1c] ReplyInterpreter — proves each recorded Gemini response maps to
 * the SAME AiReplyResponse the current path produces, and does it vendor-blind.
 *
 * The B-W2 fixtures in the W0 pack are the real Gemini payload shapes (normal,
 * NOT_FOUND, fallback, empty, no-candidates, plain). W0 recorded the
 * AiReplyResponse the LIVE path produced for each. Here the same payloads are
 * fed through `readGeminiText`-style extraction into the interpreter, and the
 * result is asserted equal to what W0 froze — so the interpretation is proven
 * identical against real bytes, not against opinion.
 *
 * ⚠️ NO NETWORK, NO KEY. Pure functions over fixtures.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  interpretReply,
  REPLY_ERROR_TEXT,
} from '@/modules/webhook/ai-reply/reply-interpreter';
import type { TransportResult } from '@/modules/webhook/ai-reply/reply-transport';

/** Extract rawText the way a transport would (candidates[0].content.parts[0].text). */
function rawTextOf(data: unknown): string | undefined {
  return (
    data as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  )?.candidates?.[0]?.content?.parts?.[0]?.text;
}

/** Build a success TransportResult from a canned Gemini payload. */
function okResult(data: unknown): TransportResult {
  return {
    rawText: rawTextOf(data),
    httpStatus: 200,
    raw: data,
    errorMessage: null,
  };
}

// The same fixtures W0's B-W2 recorded (kept in sync deliberately).
const FIXTURES: Record<string, unknown> = {
  'normal FOUND': {
    candidates: [{ content: { parts: [{ text: 'here you go [[[FOUND]]]' }] } }],
  },
  'NOT_FOUND tag': {
    candidates: [{ content: { parts: [{ text: 'sorry [[[NOT_FOUND]]]' }] } }],
  },
  'fallback text (noData)': {
    candidates: [
      { content: { parts: [{ text: 'ไม่พบข้อมูลที่เกี่ยวข้องในเอกสาร' }] } },
    ],
  },
  'empty candidates': { candidates: [] },
  'no candidates key': {},
  'plain answer no tag': {
    candidates: [{ content: { parts: [{ text: 'just an answer' }] } }],
  },
};

/** Pull W0's frozen AiReplyResponse for a fixture from its snapshot. */
function w0Response(fixtureName: string): Record<string, unknown> {
  const snap = readFileSync(
    join(__dirname, '__snapshots__', 'wrap-ai-w0-before-pack.spec.ts.snap'),
    'utf8',
  );
  const key = `response fixtures (B-W2) interprets ${fixtureName} identically (frozen) 1`;
  const at = snap.indexOf(key);
  if (at < 0) throw new Error(`W0 fixture snapshot not found: ${fixtureName}`);
  const seg = snap.slice(at, at + 1500);
  const objStart = seg.indexOf('{');
  const objEnd = seg.indexOf('`;', objStart);
  // the snapshot is a pretty-printed JS object literal; eval it in a tiny scope
  const literal = seg.slice(objStart, objEnd).trim().replace(/,\s*$/, '');

  return eval(`(${literal})`) as Record<string, unknown>;
}

describe('[WRAP-AI W1c] response fixtures interpret identically to the W0 record', () => {
  it.each(Object.keys(FIXTURES))(
    'fixture %s → same AiReplyResponse',
    (name) => {
      const got = interpretReply(okResult(FIXTURES[name]));
      const frozen = w0Response(name);
      // compare the same five fields W0 froze
      expect({
        text: got.text,
        noData: got.noData,
        tagStatus: got.tagStatus,
        http_status: got.http_status ?? null,
        error_message: got.error_message ?? null,
      }).toEqual(frozen);
    },
  );
});

describe('[WRAP-AI W1c] tag interpretation rules (transcribed)', () => {
  /* [FIX-20260830-FOUNDLENIENT] TARGET cases, written red-first: the model
     sometimes emits the closing tag with TWO brackets ([[FOUND]] — live case
     28/08 18:26). The shared TAG_*_REGEX consts are byte-pinned to legacy by
     rag-engine-parity.spec.ts:705-708 and MUST stay narrow; the leniency lives
     only in reply-interpreter's local regexes. Plan:
     todo/task/30082026/todo2_30082026_found-2bracket-plan.md (option B). */
  it('LENIENT: two-bracket [[FOUND]] → tagStatus found, tag stripped', () => {
    const r = interpretReply({
      rawText: 'ยอด 100 บาทค่ะ [[FOUND]]',
      httpStatus: 200,
      raw: null,
      errorMessage: null,
    });
    expect(r.tagStatus).toBe('found');
    expect(r.text).toBe('ยอด 100 บาทค่ะ');
  });

  it('LENIENT: two-bracket [[NOT_FOUND]] → not_found, stripped', () => {
    const r = interpretReply({
      rawText: 'sorry [[NOT_FOUND]]',
      httpStatus: 200,
      raw: null,
      errorMessage: null,
    });
    expect(r.tagStatus).toBe('not_found');
    expect(r.text).toBe('sorry');
  });

  it('LENIENT: mixed forms — not_found still wins, both stripped', () => {
    const r = interpretReply({
      rawText: 'x [[FOUND]] y [[[NOT_FOUND]]]',
      httpStatus: 200,
      raw: null,
      errorMessage: null,
    });
    expect(r.tagStatus).toBe('not_found');
    expect(r.text).toBe('x  y');
  });

  it('PIN: leniency is TAG-SPECIFIC — an unknown [[marker]] is not the interpreter\u2019s job', () => {
    // NOMARKERLEAK strips it before LINE; the interpreter must not turn into a
    // generic bracket sweeper (that would eat [[link]] before substitution).
    const r = interpretReply({
      rawText: 'ok [[bracket2]] [[link]]',
      httpStatus: 200,
      raw: null,
      errorMessage: null,
    });
    expect(r.tagStatus).toBe(null);
    expect(r.text).toBe('ok [[bracket2]] [[link]]');
  });

  it('PIN: the word FOUND inside NOT_FOUND is never matched by the FOUND side', () => {
    const r = interpretReply({
      rawText: 'a [[NOT_FOUND]]',
      httpStatus: 200,
      raw: null,
      errorMessage: null,
    });
    expect(r.tagStatus).toBe('not_found'); // not 'found'
  });

  it('FOUND tag → tagStatus found, tag stripped from text', () => {
    const r = interpretReply(okResult(FIXTURES['normal FOUND']));
    expect(r.tagStatus).toBe('found');
    expect(r.text).toBe('here you go');
    expect(r.noData).toBe(false);
  });

  it('NOT_FOUND tag → tagStatus not_found', () => {
    const r = interpretReply(okResult(FIXTURES['NOT_FOUND tag']));
    expect(r.tagStatus).toBe('not_found');
    expect(r.text).toBe('sorry');
  });

  it('not-found wins over found when both present', () => {
    const r = interpretReply(
      okResult({
        candidates: [
          { content: { parts: [{ text: 'x [[[FOUND]]] y [[[NOT_FOUND]]]' }] } },
        ],
      }),
    );
    expect(r.tagStatus).toBe('not_found');
  });

  it('the exact fallback string → noData true', () => {
    const r = interpretReply(okResult(FIXTURES['fallback text (noData)']));
    expect(r.noData).toBe(true);
  });

  it('empty / no candidates → FALLBACK_TEXT, noData true', () => {
    for (const key of ['empty candidates', 'no candidates key']) {
      const r = interpretReply(okResult(FIXTURES[key]));
      expect(r.text).toBe('ไม่พบข้อมูลที่เกี่ยวข้องในเอกสาร');
      expect(r.noData).toBe(true);
    }
  });

  it('plain answer, no tag → tagStatus null, text unchanged', () => {
    const r = interpretReply(okResult(FIXTURES['plain answer no tag']));
    expect(r.tagStatus).toBeNull();
    expect(r.text).toBe('just an answer');
  });

  it('called twice is stable (the /g lastIndex hazard is neutralised)', () => {
    const res = okResult(FIXTURES['normal FOUND']);
    const a = interpretReply(res);
    const b = interpretReply(res);
    expect(a).toEqual(b); // no alternation across calls
  });
});

describe('[WRAP-AI W1c] error path → the legacy error contract', () => {
  it('a vendor error → the DISTINCT error text, not FALLBACK_TEXT', () => {
    const r = interpretReply({
      rawText: undefined,
      httpStatus: 500,
      raw: 'boom',
      errorMessage: 'boom',
    });
    expect(r.text).toBe(REPLY_ERROR_TEXT);
    expect(r.text).not.toBe('ไม่พบข้อมูลที่เกี่ยวข้องในเอกสาร'); // not the success fallback
    expect(r.noData).toBe(false);
    expect(r.tagStatus).toBeNull();
    expect(r.http_status).toBe(500);
    expect(r.error_message).toBe('boom');
  });

  it('http_status 0 with a message (key missing / socket) → error contract', () => {
    const r = interpretReply({
      rawText: undefined,
      httpStatus: 0,
      raw: null,
      errorMessage: 'socket died',
    });
    expect(r.text).toBe(REPLY_ERROR_TEXT);
    expect(r.http_status).toBe(0);
  });
});

/* [FIX-20260901-SLASHTAG] a tag the model prefixed with "/" must still be read.
 * ===========================================================================
 * SEEN IN PRODUCTION 31/08: the model answered `[[[/FOUND]]]` instead of
 * `[[[FOUND]]]`. The lenient regexes below require the word to sit directly
 * against the bracket run, so the slash form matched NOTHING — and because the
 * same regex both DECIDES the verdict (`.test`) and REMOVES the tag
 * (`.replace`), one miss broke two things at once:
 *   · tagStatus fell to null, so a real hit was logged as no verdict
 *   · the tag stayed in the text, so the stored chat row (which the admin
 *     reads) showed `[[[/FOUND]]]` verbatim
 * The customer never saw it — the outbound NOMARKERLEAK catch-all sweeps every
 * bracket run on the way out — so this is about the stored row and the verdict.
 *
 * ⚠️ THE FIX BELONGS IN THE LOCAL REGEXES, NOT THE SHARED CONSTS. The shared
 * ones are byte-pinned against the legacy checkout by rag-engine-parity.spec.ts
 * and askGemini has to keep behaving exactly like legacy. Widening tolerance
 * here — and only here — is the pattern this file already established.
 * เจอ tag รูปแบบใหม่ให้ผ่อนที่ regex ตัวนี้ ห้ามไปแตะของกลาง
 */
describe('[FIX-20260901-SLASHTAG] junk around the tag word', () => {
  const run = (rawText: string) =>
    interpretReply({
      rawText,
      errorMessage: null,
      httpStatus: 200,
      raw: {},
    });

  it('[[[/FOUND]]] is read as found, and stripped', () => {
    const r = run('ยอดคุณคือ 500 [[[/FOUND]]]');
    expect(r.tagStatus).toBe('found');
    expect(r.text).toBe('ยอดคุณคือ 500');
  });

  it('[[[/NOT_FOUND]]] is read as not_found, and stripped', () => {
    const r = run('ไม่พบข้อมูล [[[/NOT_FOUND]]]');
    expect(r.tagStatus).toBe('not_found');
    expect(r.text).toBe('ไม่พบข้อมูล');
  });

  it('the two-bracket slash form works too', () => {
    expect(run('a [[/FOUND]]').tagStatus).toBe('found');
    expect(run('a [[/NOT_FOUND]]').tagStatus).toBe('not_found');
  });

  it('the brace and paren families accept the slash as well', () => {
    expect(run('a {{{/FOUND}}}').tagStatus).toBe('found');
    expect(run('a (((/NOT_FOUND)))').tagStatus).toBe('not_found');
  });

  it('NOT_FOUND still wins over FOUND when both appear', () => {
    /* the not-found regex runs first on purpose; a slash must not change that */
    expect(run('x [[[/FOUND]]] y [[[/NOT_FOUND]]]').tagStatus).toBe(
      'not_found',
    );
  });

  it('the plain forms are untouched — this is a widening, not a swap', () => {
    expect(run('a [[[FOUND]]]').tagStatus).toBe('found');
    expect(run('a [[[NOT_FOUND]]]').tagStatus).toBe('not_found');
    expect(run('a [[[FOUND]]]').text).toBe('a');
  });

  it('does not turn ordinary slashed prose into a verdict', () => {
    /* no bracket run in front — must stay null, or a customer writing
       "/FOUND" in chat would flip the bot's verdict */
    expect(run('ลูกค้าพิมพ์ /FOUND มาเฉย ๆ').tagStatus).toBeNull();
    expect(run('อ่านที่ /found-page ครับ').tagStatus).toBeNull();
  });

  it('leaves link and dynamic markers alone', () => {
    /* [[link]] and [[tag]] are substituted by later passes — the interpreter
       must not eat them while widening for the slash */
    const r = run('ดูที่ [[link]] และ [[web_code]] [[[/FOUND]]]');
    expect(r.tagStatus).toBe('found');
    expect(r.text).toContain('[[link]]');
    expect(r.text).toContain('[[web_code]]');
  });
});

/* [FIX-20260901-SLASHTAG] the big matrix — every junk shape in, every piece of
 * ordinary prose out.
 * ===========================================================================
 * THE RULE BEING PINNED: junk is tolerated AROUND the word, the BRACKET RUN IS
 * NOT OPTIONAL. `[[[ /_+* FOUND *_+/ ]]]` counts; a bare `found` never does.
 *
 * WHY NOT THE SIMPLER RULE ("contains not ⇒ not_found, contains found ⇒
 * found"). It was tried on paper and rejected on 01/09 with real reply text:
 * this OA answers in the customer's language, English included, so `cannot`,
 * `notification`, `nothing` and `could not` all appear in ordinary sentences.
 * That rule turns `Cannot process now [[[FOUND]]]` into not_found — a message
 * carrying an explicit FOUND tag — and `not_found` + noData sends the customer
 * `default_answer_text` instead of the real answer. It would have upgraded a
 * cosmetic bug into a wrong answer. กฎที่อ่านแค่คำ พังกับประโยคอังกฤษปกติ
 *
 * The negative half of this matrix is the important half. Every case there is
 * a sentence a bot could plausibly send, and none of them may produce a verdict.
 */
describe('[FIX-20260901-SLASHTAG] junk-tolerant matrix — positive', () => {
  const run = (rawText: string) =>
    interpretReply({
      rawText,
      errorMessage: null,
      httpStatus: 200,
      raw: {},
    });

  const FOUND_SHAPES = [
    '[[[FOUND]]]',
    '[[FOUND]]',
    '[[[/FOUND]]]',
    '[[/FOUND]]',
    '[[[_FOUND]]]',
    '[[[/found+]]]',
    '[[[++found]]]',
    '[[[*found*]]]',
    '[[[ FOUND ]]]',
    '[[[  found  ]]]',
    '[[[-FOUND-]]]',
    '[[[.found.]]]',
    '{{{FOUND}}}',
    '{{{/FOUND}}}',
    '{{ FOUND }}',
    '(((FOUND)))',
    '((( found )))',
    '((/FOUND))',
  ];
  const NOT_FOUND_SHAPES = [
    '[[[NOT_FOUND]]]',
    '[[NOT_FOUND]]',
    '[[[/NOT_FOUND]]]',
    '[[[**not_found]]]',
    '[[[notfound]]]',
    '[[[NOTFOUND]]]',
    '[[[ NOT_FOUND ]]]',
    '[[[_not_found_]]]',
    '[[[/notfound+]]]',
    '{{{NOT_FOUND}}}',
    '{{{/not_found}}}',
    '(((NOT_FOUND)))',
  ];

  it.each(FOUND_SHAPES)('reads %s as found', (shape) => {
    expect(run(`ยอด 500 ${shape}`).tagStatus).toBe('found');
  });

  it.each(NOT_FOUND_SHAPES)('reads %s as not_found', (shape) => {
    expect(run(`ไม่พบ ${shape}`).tagStatus).toBe('not_found');
  });

  it.each([...FOUND_SHAPES, ...NOT_FOUND_SHAPES])(
    'strips %s from the stored text',
    (shape) => {
      /* the same regex decides and removes — a shape that is read must also go */
      expect(run(`คำตอบจริง ${shape}`).text).toBe('คำตอบจริง');
    },
  );

  it('NOT_FOUND still wins when both are present, whatever the junk', () => {
    expect(run('x [[[/found]]] y [[[**not_found]]]').tagStatus).toBe(
      'not_found',
    );
    expect(run('x [[[NOT_FOUND]]] y [[[FOUND]]]').tagStatus).toBe('not_found');
  });
});

describe('[FIX-20260901-SLASHTAG] junk-tolerant matrix — NEGATIVE (must stay null)', () => {
  const run = (rawText: string) =>
    interpretReply({
      rawText,
      errorMessage: null,
      httpStatus: 200,
      raw: {},
    });

  const PROSE = [
    /* English replies happen — the training doc requires answering in the
       customer's own language, so these are real sentences, not hypotheticals */
    'I found your account, the balance is 500.',
    'Sorry, your account was not found in our system.',
    'Cannot process this right now, please try again.',
    'There is nothing pending on your account.',
    'We will send you a notification shortly.',
    'Please try another bank account.',
    /* Thai + mixed */
    'ลูกค้าถามเรื่อง notification ครับ',
    'ระบบยังไม่พบรายการ กรุณาลองใหม่',
    /* a customer quoting the tag word at the bot */
    'ลูกค้าพิมพ์ /FOUND มาเฉย ๆ',
    'ลูกค้าพิมพ์ NOT_FOUND มาเอง',
    'อ่านที่ /found-page ครับ',
    'ดูหัวข้อ not_found ในคู่มือ',
  ];

  it.each(PROSE)('gives no verdict for: %s', (text) => {
    expect(run(text).tagStatus).toBeNull();
  });

  it.each(PROSE)('leaves the text untouched: %s', (text) => {
    expect(run(text).text).toBe(text);
  });

  it('link and dynamic markers survive, even touching a tag', () => {
    /* [[link]] and [[web_code]] are substituted by later passes — the widened
       junk class accepts brackets, so this is the case that would break first
       if the tolerance were ever loosened further */
    const cases = [
      'ดูที่ [[link]] และ [[web_code]] [[[FOUND]]]',
      '[[[FOUND]]][[link]]',
      '[[[FOUND]]] [[web_code]]',
      'a [[link]] [[[/FOUND]]]',
    ];
    cases.forEach((t) => {
      const r = run(t);
      expect(r.tagStatus).toBe('found');
      expect(r.text).not.toContain('FOUND');
      if (t.includes('[[link]]')) expect(r.text).toContain('[[link]]');
      if (t.includes('[[web_code]]')) expect(r.text).toContain('[[web_code]]');
    });
  });

  it('an unknown bracketed marker is still not the interpreter’s job', () => {
    const r = run('ok [[bracket2]] [[link]]');
    expect(r.tagStatus).toBeNull();
    expect(r.text).toBe('ok [[bracket2]] [[link]]');
  });

  it('extra bracket layers do not confuse the verdict', () => {
    expect(run('[[[[FOUND]]]]').tagStatus).toBe('found');
    expect(run('[[[FOUND]]]]]').tagStatus).toBe('found');
  });
});

/* [FIX-20260901-SLASHTAG] every OTHER tag family must survive the interpreter.
 * ===========================================================================
 * The interpreter runs FIRST, before any of the passes that give these tags
 * meaning: customer-helper opens a registration card, flex_m/flex_pc render a
 * stored card, menu-* builds a button menu, and a dynamic [[name]] is
 * substituted from the profile. If a widened FOUND/NOT_FOUND regex ever eats
 * one of them, the feature does not fail loudly — the tag simply vanishes and
 * the card, menu or value never appears, with nothing in any log to say why.
 * ตัวแปลอื่นต้องรอดทั้งหมด ถ้าโดนกินจะเงียบ ไม่มีอะไรฟ้อง
 *
 * These are the exact shapes their own matchers accept (reply-tags.util.ts:20-26
 * and the menu runbook), not shapes invented for this test.
 */
describe('[FIX-20260901-SLASHTAG] other tag families are untouched', () => {
  const run = (rawText: string) =>
    interpretReply({
      rawText,
      errorMessage: null,
      httpStatus: 200,
      raw: {},
    });

  const OTHER_TAGS = [
    '[[[customer-helper]]]',
    '[[customer-helper]]',
    '[[[flex_profile]]]',
    '[[flex_profile]]',
    '[[[flex_m00031]]]',
    '[[flex_m00029]]',
    '[[[flex_pc00012]]]',
    '[[[menu-primary]]]',
    '[[[menu-primary-a]]]',
    '[[[assist]]]',
    '[[[history]]]',
    '[[[img_promo]]]',
    '[[[img_xxx]]]',
    '[[link]]',
    '[[web_code]]',
    '[[tier_name]]',
    '[START_OF_BASIC_INFO]',
    '[END_OF_BASIC_INFO]',
  ];

  it.each(OTHER_TAGS)('%s survives with no verdict', (tag) => {
    const r = run(`ข้อความ ${tag} ต่อท้าย`);
    expect(r.tagStatus).toBeNull();
    expect(r.text).toContain(tag);
  });

  it.each(OTHER_TAGS)('%s survives even beside a FOUND tag', (tag) => {
    /* the realistic shape: the model answers, marks it found, and asks for a
       card in the same breath */
    const r = run(`ข้อความ ${tag} [[[/FOUND]]]`);
    expect(r.tagStatus).toBe('found');
    expect(r.text).toContain(tag);
    expect(r.text).not.toContain('FOUND]]]');
  });

  it('a whole realistic reply keeps every tag but the verdict one', () => {
    const r = run(
      'สวัสดีค่ะ [[[customer-helper]]] ยอดของคุณ [[web_code]] คือ 500 ' +
        'ดูโปรที่ [[[flex_m00031]]] หรือเมนู [[[menu-primary]]] [[[**not_found]]]',
    );
    expect(r.tagStatus).toBe('not_found');
    [
      '[[[customer-helper]]]',
      '[[web_code]]',
      '[[[flex_m00031]]]',
      '[[[menu-primary]]]',
    ].forEach((t) => expect(r.text).toContain(t));
    expect(r.text).not.toContain('not_found');
  });
});

/* [FIX-20260901-SLASHTAG] the junk run is BOUNDED, and the bound is the point.
 * ===========================================================================
 * Found by mutation on 01/09: replacing `{0,4}` with `*` left every other case
 * in this file green, which means nothing was holding the limit. An unbounded
 * junk class lets the tag word sit arbitrarily far from its brackets, so a
 * bracketed sentence that merely ENDS in the word starts counting as a verdict.
 * Four is enough for `/`, `_`, `+`, `*` and a space or two — the shapes seen in
 * production — and short enough that a phrase can never bridge the gap.
 * ขอบเขตคือหัวใจ ถ้าปล่อยไม่จำกัด ประโยคทั้งประโยคจะกลายเป็น tag
 */
describe('[FIX-20260901-SLASHTAG] the junk run has a limit', () => {
  const run = (rawText: string) =>
    interpretReply({
      rawText,
      errorMessage: null,
      httpStatus: 200,
      raw: {},
    });

  it('accepts up to four junk characters before the word', () => {
    expect(run('a [[[/_+*FOUND]]]').tagStatus).toBe('found');
    expect(run('a [[[ -- FOUND]]]').tagStatus).toBe('found');
  });

  it('refuses a longer junk run — the word has drifted too far from the bracket', () => {
    expect(run('a [[[ ---- FOUND ]]]').tagStatus).toBeNull();
    expect(run('a [[[ !!!!!!!!!!!! FOUND ]]]').tagStatus).toBeNull();
    expect(run('a [[[ ... ... ... ... FOUND ]]]').tagStatus).toBeNull();
  });

  it('a bracketed sentence ending in the word is never a verdict', () => {
    /* the failure an unbounded class would allow */
    expect(run('[[ราคา 500 บาท FOUND]]').tagStatus).toBeNull();
    expect(
      run('[[[the account was not FOUND yesterday]]]').tagStatus,
    ).toBeNull();
  });
});
