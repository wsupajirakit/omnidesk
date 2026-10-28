/**
 * [FIX-2708-JSXCOMMENTLEAK] comment ที่ลืมห่อ `{...}` จะกลายเป็นข้อความบนจอ
 * ===========================================================================
 * เจ้าของเจอบน stg 27/08: ในฟอร์มแก้ไขบรอดแคสต์ ช่อง "ทำซ้ำ ตอนกี่โมง" มีข้อความ
 * `/* [FEAT-20260817-DATEINPUTOPEN] ... *​/` โผล่ให้ลูกค้าเห็นเต็ม ๆ
 *
 * ต้นเหตุ: ใน JSX เด็ก ๆ ของ element คอมเมนต์ต้องเป็น `{/* ... *​/}` — ถ้าเขียน
 * `/* ... *​/` เปล่า ๆ React ถือเป็น **text node** แล้ว render ออกจอ
 * (TypeScript/ESLint ไม่ฟ้อง เพราะมันถูกต้องตามไวยากรณ์ทุกประการ)
 *
 * เทสนี้สแกนทุกไฟล์ .tsx: บรรทัดที่ขึ้นต้นด้วย `/*` และอยู่ "ในเขต JSX" (บรรทัด
 * ก่อนหน้าจบด้วย `>` หรือ `}` ที่เป็นการปิด element) = คอมเมนต์หลุด
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(__dirname, '..');
const SKIP = new Set(['node_modules', 'dist', '.git', 'test']);

const tsxFiles = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) tsxFiles(full, out);
    else if (name.endsWith('.tsx')) out.push(full);
  }
  return out;
};

/**
 * Does the surrounding code say this line sits among an element's CHILDREN?
 *
 * `prev` alone was the original rule, and it had a hole that this scanner was
 * written to catch and did not: a line ending in `}` (or `)}`) is how a JSX
 * conditional block closes — `{cond && (<div/>)}` — and the original returned
 * false there, because that ending is ambiguous in plain TS too.
 *
 * ⚠️ Found 28/08 the hard way: a comment written directly under a `)}` inside
 * `FormSection.tsx` would have rendered as visible text on the broadcast form,
 * and this scanner reported the repo clean.
 *
 * The ambiguity is resolved by looking at BOTH neighbours: a comment is treated
 * as JSX children only when the line before it closes a tag or a block AND the
 * next code line opens JSX again (`{` or `<`). That pairing is what a plain
 * TypeScript body does not look like, which keeps false positives out.
 */
const insideJsxChildren = (prev: string, next: string): boolean => {
  const p = prev.trimEnd();
  const n = next.trimStart();
  const opensJsxAgain = n.startsWith('{') || n.startsWith('<');
  // closes an opening tag or an element
  if (p.endsWith('>') && !p.endsWith('=>')) return true;
  // closes a JSX conditional/expression block — only JSX if JSX resumes below
  if ((p.endsWith('}') || p.endsWith(')}')) && opensJsxAgain) return true;
  return false;
};

describe('[JSXCOMMENTLEAK] ไม่มีคอมเมนต์หลุดออกจอ', () => {
  it('⭐⭐ ทุก .tsx: คอมเมนต์ในเขต JSX ต้องห่อ {…} เสมอ', () => {
    const leaks: string[] = [];
    for (const file of tsxFiles(ROOT)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i]!.trim();
        if (!line.startsWith('/*')) continue;
        /* The next line that carries CODE. Two things must be stepped over or the
           pairing is read off the wrong line: the remaining lines of a multi-line
           comment (the first draft of this check compared against the comment's
           own second line and therefore caught nothing), and blank lines. */
        let end = i;
        while (end < lines.length && !lines[end]!.includes('*/')) end++;
        const next = lines.slice(end + 1).find((l) => l.trim().length > 0) ?? '';
        /* …and the previous line that carries CODE. A blank line between the JSX
           above and the comment is what defeated the first two attempts at this
           check: `lines[i - 1]` was simply "", which matches no ending at all. */
        const prev =
          [...lines.slice(0, i)].reverse().find((l) => l.trim().length > 0) ?? '';
        if (insideJsxChildren(prev, next)) {
          leaks.push(`${file.replace(ROOT + '/', '')}:${i + 1}`);
        }
      }
    }
    expect(leaks, `คอมเมนต์หลุดเข้า JSX (จะโชว์บนจอ):\n${leaks.join('\n')}`).toEqual([]);
  });
});
