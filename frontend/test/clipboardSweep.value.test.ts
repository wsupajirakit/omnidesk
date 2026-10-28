/**
 * [FIX-20260830-COPYHTTP2] no copy button may talk to `navigator.clipboard`.
 *
 * The Clipboard API exists ONLY in a secure context. This dashboard is served
 * over plain http (console.omnidesk.test), so every direct call was one of:
 *
 *   `navigator.clipboard?.writeText(x)`        → silent no-op, success UI lied
 *   `await navigator.clipboard.writeText(x)`   → threw, so the copy was
 *                                                impossible and the error
 *                                                branch fired every time
 *   `navigator.clipboard.writeText(x).then(…)` → `.writeText` of `undefined`
 *                                                threw BEFORE a promise existed,
 *                                                so `.catch` never ran and the
 *                                                click handler blew up
 *
 * `utils/copyText` handles all three: modern API first, legacy textarea +
 * `execCommand` fallback, and it RETURNS whether the copy really happened.
 *
 * 🔴 This test is the ratchet. It fails the moment anyone reaches for
 *    `navigator.clipboard` again — which has already happened twice
 *    (see the warning at the top of `components/messaging/cells/JobIdCell.tsx`).
 *    The fix is never to add an exception here; it is to call `copyText`.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const SCANNED = ['components', 'pages', 'hooks', 'services', 'utils', 'contexts'];

/** the ONE file allowed to touch the API — it is the wrapper itself */
const ALLOWED = path.join('utils', 'copyText.ts');

const walk = (dir: string): string[] => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return /\.tsx?$/.test(e.name) ? [full] : [];
  });
};

/* Comments are stripped first: several files legitimately EXPLAIN the trap in
   prose, and a prose mention is not a call. Block comments go first so a `//`
   inside one cannot re-open the line. */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const sourceFiles = SCANNED.flatMap((d) => walk(path.join(ROOT, d)));

describe('every copy goes through utils/copyText', () => {
  it('the sweep found files to check at all', () => {
    // guards the guard: a broken walk would make every assertion below vacuous
    expect(sourceFiles.length).toBeGreaterThan(200);
  });

  it('🔴 no source file calls navigator.clipboard directly', () => {
    const offenders = sourceFiles
      .filter((f) => !f.endsWith(ALLOWED))
      .filter((f) => /navigator\s*\.\s*clipboard/.test(stripComments(fs.readFileSync(f, 'utf8'))))
      .map((f) => path.relative(ROOT, f));

    expect(offenders).toEqual([]);
  });

  it('the wrapper itself still owns the real API', () => {
    // if this ever goes empty, copyText stopped copying and the rule is pointless
    const src = fs.readFileSync(path.join(ROOT, ALLOWED), 'utf8');
    expect(src).toContain('navigator.clipboard.writeText');
    expect(src).toContain("document.execCommand('copy')");
  });

  it('⭐ every file that copies also imports the helper', () => {
    /* A file can call `copyText` and forget the import — tsc catches that, but
       only when tsc runs. This keeps the pair together in the test suite too. */
    const missing = sourceFiles
      .filter((f) => !f.endsWith(ALLOWED))
      .filter((f) => {
        const src = fs.readFileSync(f, 'utf8');
        return /\bcopyText\s*\(/.test(stripComments(src)) && !/import \{ copyText \}/.test(src);
      })
      .map((f) => path.relative(ROOT, f));

    expect(missing).toEqual([]);
  });
});
