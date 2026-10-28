/**
 * [PROG-20260905-CENSUS] The one CODE-line ruler for the spine reduction program.
 *
 * WHY THIS EXISTS. Four different line counts for `processLockedEvent` circulated in the
 * planning documents (3,892 / 2,825 / 2,829 / 2,833) because every measurement used a
 * differently-written classifier. A size target measured on a ruler nobody can re-run is
 * not a measurement. This file IS the ruler: one implementation, in the repo, pinned by
 * `z-test/unit/code-line-census.spec.ts`, used by the growth ratchet and by every
 * before/after number the program reports.
 *
 * THE RULE. A line is:
 *   - BLANK   — nothing but whitespace, and not inside a block comment;
 *   - COMMENT — it carries comment text and no executable text (a whitespace-only line
 *               *inside* a block comment counts as COMMENT: it is part of the prose
 *               block, not a separator between statements);
 *   - CODE    — anything else, including `foo(); // trailing note` and the code that
 *               follows a block comment closing mid-line.
 *
 * WHY A SCANNER AND NOT A REGEX. This file is 46% comment and contains `/*`-looking
 * sequences inside string and template literals. A prefix rule ("line starts with // or
 * *") counts 3,892 CODE lines for the method — a thousand lines of prose misfiled as
 * code. The scanner below tracks block comments, line comments and the three string
 * flavours, so a `/*` inside a string does not open a comment.
 *
 * KNOWN DELTA, STATED RATHER THAN SMOOTHED. This scanner reports the method
 * (:1586-7060) as 2,829 CODE / 2,514 comment / 132 blank / 5,475 raw, and the file as
 * 4,290 / 3,716 / 242 / 8,248. The planning documents quote 2,825 and 4,286 — a constant
 * 4-line difference, on lines where a comment-like sequence sits inside a literal (this
 * scanner keeps them as CODE; the earlier ad-hoc classifier did not). Raw and blank
 * counts agree exactly. The difference is 0.14% and every program target carries more
 * than 100 CODE lines of margin, so no decision turns on it — but the number quoted from
 * here on is THIS scanner's, because this one can be re-run.
 *
 * Deliberately dependency-free and synchronous: the ratchet spec runs it on every suite.
 */

export type LineKind = 'code' | 'comment' | 'blank';

export interface Census {
  code: number;
  comment: number;
  blank: number;
  raw: number;
}

type ScanState = 'normal' | 'block' | 'single' | 'double' | 'template';

const CLOSERS: Record<Exclude<ScanState, 'normal' | 'block'>, string> = {
  single: "'",
  double: '"',
  template: '`',
};

/**
 * The single pass everything else is built on: per line, what KIND it is, and what its
 * executable characters are once comments and literal bodies are removed.
 *
 * `codeOnly` exists for brace matching. Counting `{` and `}` in raw text walks straight
 * into the braces inside `${...}` interpolations and the ones inside message strings —
 * on a 5,000-line method the depth never balances and the search silently finds nothing.
 */
function scan(source: string): { kinds: LineKind[]; codeOnly: string[] } {
  const lines = source.split('\n');
  // A trailing newline produces one empty element that is not a line of the file.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  const kinds: LineKind[] = [];
  const codeOnly: string[] = [];
  let state: ScanState = 'normal';

  for (const raw of lines) {
    const stateAtLineStart = state;
    let hasCode = false;
    let hasComment = false;
    let bare = '';
    let i = 0;

    while (i < raw.length) {
      const c = raw[i] as string;
      const next = i + 1 < raw.length ? (raw[i + 1] as string) : '';

      if (state === 'block') {
        hasComment = true;
        if (c === '*' && next === '/') {
          state = 'normal';
          i += 2;
          continue;
        }
        i += 1;
        continue;
      }

      if (state !== 'normal') {
        // Inside a literal: its content is code, and only its own closer ends it.
        hasCode = true;
        if (c === '\\') {
          i += 2; // an escape consumes the next character, closer or not
          continue;
        }
        if (c === CLOSERS[state]) state = 'normal';
        i += 1;
        continue;
      }

      if (c === '/' && next === '/') {
        hasComment = true;
        break; // a line comment owns the rest of the line
      }
      if (c === '/' && next === '*') {
        hasComment = true;
        state = 'block';
        i += 2;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') {
        hasCode = true;
        state = c === "'" ? 'single' : c === '"' ? 'double' : 'template';
        i += 1;
        continue;
      }
      if (!/\s/.test(c)) hasCode = true;
      bare += c; // executable character: safe to brace-match on
      i += 1;
    }

    if (hasCode) kinds.push('code');
    else if (hasComment) kinds.push('comment');
    else if (stateAtLineStart === 'block')
      kinds.push('comment'); // blank line inside prose
    else kinds.push('blank');
    codeOnly.push(bare);
  }

  return { kinds, codeOnly };
}

/**
 * Classify every line of a source text. The scanner carries its state across lines, so a
 * block comment or a multi-line template literal is understood as one span rather than a
 * series of independently-guessed lines.
 */
export function classifyLines(source: string): LineKind[] {
  return scan(source).kinds;
}

/**
 * Census a whole file or one 1-indexed inclusive line range (`from`/`to` are the numbers
 * an editor shows, so `census(src, 1586, 7060)` is the spine method).
 */
export function census(source: string, from?: number, to?: number): Census {
  const kinds = classifyLines(source);
  const start = from === undefined ? 0 : from - 1;
  const end = to === undefined ? kinds.length : to;
  const slice = kinds.slice(start, end);
  return {
    code: slice.filter((k) => k === 'code').length,
    comment: slice.filter((k) => k === 'comment').length,
    blank: slice.filter((k) => k === 'blank').length,
    raw: slice.length,
  };
}

/**
 * Find a method's inclusive line range by brace-matching from the line that carries
 * `signature`. Line numbers rot on every edit; the ratchet must not.
 *
 * Returns null when the signature is absent or its braces never balance — the caller
 * decides whether that is a failure (the ratchet treats it as one: a spine method that
 * cannot be found cannot be measured, and silently measuring nothing would read as a
 * perfect score).
 */
export function findMethodRange(
  source: string,
  signature: string,
): { from: number; to: number } | null {
  const lines = source.split('\n');
  const { kinds, codeOnly } = scan(source);
  const startIdx = lines.findIndex(
    (l, i) => kinds[i] === 'code' && l.includes(signature),
  );
  if (startIdx === -1) return null;

  // Close on INDENTATION, not on brace depth. Brace counting needs a full JS tokenizer:
  // a regex literal containing a quote (`/it's/`) or a brace (`/x{2}/`) throws the depth
  // off, and one bad character 3,000 lines up silently reports "method not found" — which
  // a ratchet would read as a perfect score. A class member closes with `}` at the
  // member's own indentation; that is unambiguous and needs no lexer.
  const signatureLine = lines[startIdx] ?? '';
  const indent = (signatureLine.match(/^\s*/) as RegExpMatchArray)[0];
  const closer = `${indent}}`;
  for (let i = startIdx + 1; i < codeOnly.length; i += 1) {
    if (kinds[i] === 'code' && lines[i] === closer)
      return { from: startIdx + 1, to: i + 1 };
  }
  return null;
}
