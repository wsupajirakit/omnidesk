/**
 * [FEAT-20261026-RAGENGINE] Thai-aware normalisation and tokenisation — no dependency.
 *
 * Thai has no spaces between words, and Mongo `$text` has no Thai analyser. Node 22 ships
 * full ICU, so `Intl.Segmenter('th', { granularity: 'word' })` segments Thai words in the
 * production image (verified in `node:22.23.4-alpine`, ICU 78.3).
 *
 * Two measured weaknesses and their answers:
 *   · compounds split (`สินเชื่อ` → `สิน|เชื่อ`) → token BIGRAMS are added, so the compound
 *     still matches as one term;
 *   · sentence segmentation does not work for Thai → chunking never relies on it
 *     (see `chunking/structural-chunker.ts`).
 * ตัดคำไทยด้วย Intl.Segmenter + bigram แก้คำประสมที่ถูกแยก
 */

const SEGMENTER = new Intl.Segmenter('th', { granularity: 'word' });

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

/** Polite particles and glue words that match everything and rank nothing. */
const STOPWORDS = new Set([
  'ครับ',
  'ค่ะ',
  'คะ',
  'นะ',
  'จ้ะ',
  'จ้า',
  'ที่',
  'และ',
  'หรือ',
  'ของ',
  'ใน',
  'ให้',
  'ได้',
  'ไป',
  'มา',
  'ก็',
  'จะ',
  'เป็น',
  'มี',
  'กับ',
  'แล้ว',
  'อยู่',
  'ว่า',
  'นี้',
  'นั้น',
  'การ',
  'the',
  'a',
  'an',
  'of',
  'to',
  'and',
  'or',
  'is',
  'in',
  'for',
]);

/** NFC, drop zero-width characters, unify `ํา`→`ำ`, Thai digits → Arabic, lowercase. */
export function normaliseText(text: string): string {
  return (
    text
      .normalize('NFC')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      // NIKHAHIT + SARA AA (two code points) → SARA AM (one) — both render as `ำ`.
      .replace(/\u0E4D\u0E32/g, '\u0E33')
      .replace(/[\u0E50-\u0E59]/g, (d) => String(THAI_DIGITS.indexOf(d)))
      .toLowerCase()
  );
}

/** Word tokens (stopwords removed) plus adjacent-token bigrams. */
export function tokenise(text: string): string[] {
  const words: string[] = [];
  for (const seg of SEGMENTER.segment(normaliseText(text))) {
    if (!seg.isWordLike) continue;
    const w = seg.segment.trim();
    if (!w || STOPWORDS.has(w)) continue;
    words.push(w);
  }
  const out = words.slice();
  for (let i = 0; i + 1 < words.length; i++)
    out.push(`${words[i]}${words[i + 1]}`);
  return out;
}

/** Word boundaries (character offsets) inside `text` — for splitting without cutting a word. */
export function wordBoundaries(text: string): number[] {
  const cuts: number[] = [];
  for (const seg of SEGMENTER.segment(text)) cuts.push(seg.index);
  cuts.push(text.length);
  return cuts;
}
