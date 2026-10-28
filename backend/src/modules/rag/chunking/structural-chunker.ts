/**
 * [FEAT-20261026-RAGENGINE] Structure-first chunking for Thai Training Docs.
 *
 * Order of cuts: heading → paragraph (blank line) → line → word boundary (Intl.Segmenter).
 * Never by sentence — ICU cannot find Thai sentence ends (measured, see `text/thai-text.ts`).
 *
 * Rules that keep `replace` mode honest:
 *   · a chunk's `text` is an exact slice of its section — the prompt receives the owner's
 *     own words, nothing re-flowed;
 *   · a cut never falls inside a dynamic tag (`{{…}}`) or a control marker (`[[[…]]]`) —
 *     a half tag would not be substituted downstream;
 *   · a heading always starts a new chunk and is remembered as that chunk's `heading`,
 *     which retrieval prepends (contextual chunk) without changing `text`.
 * No overlap: neighbours are pulled in at retrieval time instead (small-to-big).
 * ตัดตามโครงสร้าง ไม่ตัดกลาง tag · ข้อความใน chunk = ของเดิมทุกตัวอักษร
 */
import { createHash } from 'node:crypto';

import { RAG_CONFIG } from '../rag.config';
import type { RagChunk, RagSection } from '../rag.types';
import { normaliseText, wordBoundaries } from '../text/thai-text';

interface Unit {
  start: number;
  end: number;
  heading: string;
  isHeading: boolean;
}

const TAG_SPAN = /\{\{[^{}]*\}\}|\[\[\[[^\]]*\]\]\]/g;

/** A short line that names what follows: `# …`, `[…]`/`【…】` (not a marker), or ends with `:`. */
export function isHeadingLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 80) return false;
  if (t.startsWith('[[[') || t.startsWith('{{')) return false;
  if (/^#{1,6}\s*\S/.test(t)) return true;
  if (/^[[【].+[\]】]$/.test(t)) return true;
  return /[:：]$/.test(t);
}

function tagSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const m of text.matchAll(TAG_SPAN))
    spans.push([m.index, m.index + m[0].length]);
  return spans;
}

/** Split [start,end) of `text` into pieces ≤ max chars, cutting only at word boundaries outside tags. */
function splitLong(
  text: string,
  start: number,
  end: number,
  max: number,
): Array<[number, number]> {
  const spans = tagSpans(text);
  const inTag = (pos: number) => spans.some(([a, b]) => pos > a && pos < b);
  const cuts = wordBoundaries(text).filter(
    (c) => c > start && c < end && !inTag(c),
  );
  const out: Array<[number, number]> = [];
  let from = start;
  while (end - from > max) {
    const limit = from + max;
    const cut =
      [...cuts].reverse().find((c) => c > from && c <= limit) ?? limit;
    const safe = inTag(cut)
      ? (spans.find(([a, b]) => cut > a && cut < b)?.[1] ?? cut)
      : cut;
    out.push([from, safe]);
    from = safe;
  }
  if (end > from) out.push([from, end]);
  return out;
}

/** Lines → units (paragraphs, headings, and long lines already split). */
function unitsOf(text: string, max: number): Unit[] {
  const units: Unit[] = [];
  let heading = '';
  let para: Unit | null = null;
  let pos = 0;
  const flush = () => {
    if (para) units.push(para);
    para = null;
  };
  for (const line of text.split('\n')) {
    const lineStart = pos;
    const lineEnd = pos + line.length;
    pos = lineEnd + 1;
    if (!line.trim()) {
      flush();
      continue;
    }
    if (isHeadingLine(line)) {
      flush();
      heading = line.trim().replace(/^#+\s*/, '');
      units.push({ start: lineStart, end: lineEnd, heading, isHeading: true });
      continue;
    }
    if (lineEnd - lineStart > max) {
      flush();
      for (const [a, b] of splitLong(text, lineStart, lineEnd, max)) {
        units.push({ start: a, end: b, heading, isHeading: false });
      }
      continue;
    }
    // a paragraph of many short lines is cut at a LINE boundary once it would pass max
    if (para && lineEnd - para.start > max) flush();
    if (para) para.end = lineEnd;
    else para = { start: lineStart, end: lineEnd, heading, isHeading: false };
  }
  flush();
  return units;
}

const hashOf = (heading: string, text: string) =>
  createHash('sha256')
    .update(normaliseText(`${heading}\n${text}`))
    .digest('hex');

export function chunkSections(
  sections: readonly RagSection[],
  opts: { targetChars: number; maxChars: number } = RAG_CONFIG.chunk,
): RagChunk[] {
  const chunks: RagChunk[] = [];
  sections.forEach((section, si) => {
    const text = section.text;
    let ord = 0;
    let cur: {
      start: number;
      end: number;
      heading: string;
      headingOnly: boolean;
    } | null = null;
    const emit = () => {
      if (!cur) return;
      const slice = text.slice(cur.start, cur.end);
      if (slice.trim()) {
        const pinned =
          (si === 0 && ord === 0) ||
          RAG_CONFIG.pinnedPatterns.some((re) => re.test(slice));
        chunks.push({
          id: `${si}:${ord}`,
          section: si,
          ord,
          heading: cur.heading,
          text: slice,
          pinned,
          hash: hashOf(cur.heading, slice),
        });
        ord++;
      }
      cur = null;
    };
    for (const u of unitsOf(text, opts.maxChars)) {
      // a heading opens a new chunk and travels with it
      if (u.isHeading) emit();
      /* …and is never emitted ALONE: a heading-only chunk is useless to retrieve, and as the
         first chunk it was the PINNED one while the rules under it were not (found 26/10).
         So the block after a heading always joins it — maxChars may then be exceeded by the
         length of that one heading line. หัวข้อห้ามเป็น chunk เดี่ยว */
      if (cur && !cur.headingOnly && u.end - cur.start > opts.targetChars)
        emit();
      if (cur) {
        cur.end = u.end;
        if (!u.isHeading) cur.headingOnly = false;
      } else
        cur = {
          start: u.start,
          end: u.end,
          heading: u.heading,
          headingOnly: u.isHeading,
        };
    }
    emit();
  });
  return chunks;
}
