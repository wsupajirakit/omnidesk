/**
 * [FEAT-20260813-WRAPAI-W1] ReplyInterpreter — our side, vendor-blind.
 *
 * Takes a `TransportResult` (raw text + http status, from ANY vendor) and turns
 * it into the `AiReplyResponse` the pipeline expects. This is the SHARED half of
 * the response path: it only ever sees `rawText` + `httpStatus`, never a vendor
 * shape, so every vendor's parse feeds the same interpretation and cannot drift.
 *
 * Transcribes the interpretation half of `askGemini` — byte-for-byte except
 * ONE deliberate, tagged divergence ([FIX-20260830-FOUNDLENIENT] below):
 *   · success (`rag-engine.service.ts:1655-1706`):
 *       text = rawText || FALLBACK_TEXT
 *       tagStatus = notFound ? 'not_found' : found ? 'found' : null   (not-found wins)
 *       cleanText = strip both tag families, trim
 *       noData = isFallbackText(cleanText)
 *   · error (`:1724-1736`):
 *       a DISTINCT fallback text 'โปรดลองอีกครั้ง…' — NOT the success FALLBACK_TEXT
 *       noData:false, tagStatus:null, error_message set, http_status the vendor code
 *
 * ⚠️ TWO DIFFERENT FALLBACK STRINGS. The success "no grounded answer" fallback
 *    (`FALLBACK_TEXT`) and the error "the model call failed" fallback are not the
 *    same string and must never be merged — the webhook branches on them via
 *    `noData` / `isGenerativeError`.
 *
 * ⚠️ NOT INCLUDED HERE: `reportTagMismatch` and the dynamic-tag "mismatched
 *    markers" scan. Those are dyntag side effects that belong with the dyntag
 *    substitution — closed in W1d, not W1c (see the gap note in the W1a spec).
 *
 * revert: delete this file; nothing imports it until W1d.
 */
import { FALLBACK_TEXT, isFallbackText } from '@/modules/ai/rag-engine.service';

/* ==== [FIX-20260830-FOUNDLENIENT] tolerate a malformed closing tag ==========
 *
 * Live case 28/08 18:26: the model appended `[[FOUND]]` (TWO brackets). The
 * shared TAG_FOUND_REGEX/TAG_NOT_FOUND_REGEX know only the three-bracket
 * families, so the tag survived into the stored chat row (the admin saw it)
 * and tagStatus fell to null instead of 'found'. The customer never saw it —
 * the outbound NOMARKERLEAK catch-all strips every `[[…]]` — so this fix is
 * about the STORED row and the tag verdict, not customer safety.
 *
 * ⚠️ The SHARED consts must stay narrow: rag-engine-parity.spec.ts:705-708
 * byte-pins their source against the legacy checkout, and askGemini (the
 * legacy-parity path) must keep behaving exactly like legacy. The leniency
 * therefore lives HERE ONLY, as local regexes: 2-or-3 brackets of each family
 * accepted for these two well-known tags — nothing else. It is deliberately
 * NOT a generic bracket sweeper: `[[link]]` and dynamic `[[tag]]` markers must
 * survive the interpreter untouched (later passes substitute them).
 *
 * revert: import the two shared consts again and use them below.
 * ======================================================================== */
/* [FIX-20260901-SLASHTAG] `/?` — the model sometimes writes `[[[/FOUND]]]`.
 * Seen in production 31/08. Without it the tag matched nothing, and because
 * ONE regex both decides the verdict (`.test`) and removes the tag
 * (`.replace`), a single miss broke two things at once: `tagStatus` fell to
 * null on a real hit, and the marker stayed in the STORED chat row the admin
 * reads. (The customer never saw it — the outbound NOMARKERLEAK catch-all
 * sweeps every bracket run on the way out.)
 *
 * ⭐ THIS IS WHERE A NEW TAG SHAPE GETS ABSORBED. When the model invents
 * another form, widen THESE regexes and nothing else:
 *   · the SHARED consts are byte-pinned against the legacy checkout
 *     (`rag-engine-parity.spec.ts`) and `askGemini` must keep matching legacy
 *   · the outbound catch-all already protects the customer, so it needs no
 *     change and must not be loosened "to be safe"
 * Keep the widening NARROW — anchored to the bracket run and the exact word.
 * A bare `/FOUND` a customer types must never count, or anyone could flip the
 * bot's verdict by typing it. เจอ tag รูปแบบใหม่ ให้ผ่อนที่สองบรรทัดนี้เท่านั้น
 * 📖 todo/task/01092026/be_todo114_01092026_slashtag.md — the rejected
 *    alternatives, the full matrix and the mutation results.
 * revert: restore the two plain regexes (`\[\[\[?FOUND\]\]\]?` …), delete
 *         `JUNK` and `lenient()`, and drop the four `[FIX-20260901-SLASHTAG]`
 *         describes in `wrap-ai-w1c-interpreter.spec.ts`. */
/**
 * Junk the model may sprinkle around the word: `/`, `_`, `+`, `*`, spaces.
 *
 * 🔴 THE BOUND IS LOAD-BEARING. `{0,4}` is long enough for every shape seen in
 * production and short enough that a phrase can never bridge the gap. Replace
 * it with `*` and `[[ราคา 500 บาท FOUND]]` becomes a verdict — a bracketed
 * sentence that merely ENDS in the word. Mutation-checked: widening this to `*`
 * turns a case in `wrap-ai-w1c-interpreter.spec.ts` red on purpose.
 * ขอบเขตคือหัวใจ ปล่อยไม่จำกัดแล้วประโยคทั้งประโยคกลายเป็น tag
 */
const JUNK = '[^A-Za-z0-9]{0,4}';
const lenient = (word: string): RegExp =>
  new RegExp(
    `(\\[\\[\\[?${JUNK}${word}${JUNK}\\]\\]\\]?` +
      `|\\{\\{\\{?${JUNK}${word}${JUNK}\\}\\}\\}?` +
      `|\\(\\(\\(?${JUNK}${word}${JUNK}\\)\\)\\)?)`,
    'gi',
  );

/* `NOT_?FOUND` so `notfound` (no underscore) is read too. NOT_FOUND is tested
 * first in `interpretReply` — the FOUND matcher needs a bracket run right in
 * front of the word, so the two can never claim the same characters. */
const LENIENT_FOUND_REGEX = lenient('FOUND');
const LENIENT_NOT_FOUND_REGEX = lenient('NOT_?FOUND');

import type { AiReplyResponse } from './ai-reply.provider';
import type { TransportResult } from './reply-transport';

/** The legacy error-path text — DISTINCT from FALLBACK_TEXT (`askGemini:1724`). */
export const REPLY_ERROR_TEXT = 'โปรดลองอีกครั้งหรือกรุณาติดต่อเจ้าหน้าที่';

/**
 * Interpret a transport result into the pipeline's AiReplyResponse.
 *
 * @param result vendor-free — the interpreter never learns which vendor produced it.
 */
export function interpretReply(result: TransportResult): AiReplyResponse {
  // ── vendor error → the legacy error contract (askGemini catch, :1725-1736) ──
  // A transport reports an error as httpStatus 0 (transport/thrown) or >=400
  // (vendor http error) WITH an errorMessage. rawText is undefined in that case.
  if (result.errorMessage !== null && result.rawText === undefined) {
    return {
      text: REPLY_ERROR_TEXT,
      noData: false,
      tagStatus: null,
      http_status: result.httpStatus,
      error_message: result.errorMessage,
      response_data: result.raw,
    };
  }

  // ── success path (askGemini:1655-1706), byte-for-byte ──────────────────────
  const text = result.rawText || FALLBACK_TEXT;

  // ⚠️ TRANSCRIBED: reset lastIndex before .test() on /g regexes — the same
  //    hazard askGemini gets away with only because the .replace() below resets
  //    it. Doing it explicitly makes the interpreter safe to call more than once.
  LENIENT_FOUND_REGEX.lastIndex = 0;
  LENIENT_NOT_FOUND_REGEX.lastIndex = 0;
  // NOT_FOUND first: its lenient form contains the letters "FOUND", and the
  // FOUND regex requires a bracket run right before the word, so the two can
  // never claim the same characters — asserted by the PIN cases in W1c.
  const hasNotFoundTag = LENIENT_NOT_FOUND_REGEX.test(text);
  const hasFoundTag = LENIENT_FOUND_REGEX.test(text);

  const cleanText = text
    .replace(LENIENT_NOT_FOUND_REGEX, '')
    .replace(LENIENT_FOUND_REGEX, '')
    .trim();

  return {
    text: cleanText,
    noData: isFallbackText(cleanText),
    // not-found wins over found — the precedence askGemini's dead if/else records
    tagStatus: hasNotFoundTag ? 'not_found' : hasFoundTag ? 'found' : null,
    http_status: result.httpStatus,
    error_message: null,
    response_data: result.raw,
  };
}
