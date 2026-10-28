/**
 * i18n/index.tsx resolves a key FLAT: translations[locale]?.[key] -> translations.en?.[key]
 * -> the KEY ITSELF. So `en` is the last real fallback: a key absent from en.json renders
 * on screen as raw text like `status.status`, in EVERY locale.
 *
 * This scans the shipped source for t('key') calls and asserts en.json covers all of them.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import en from '../i18n/translations/en.json';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', 'dist', 'test', 'public']);
// t('some.key') / t("some.key") — only dotted keys, to skip local helpers named t().
const CALL = /\bt\(\s*(['"])([A-Za-z0-9_.]+)\1/g;

const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
};

describe('i18n key coverage', () => {
  it('every t() key used in the source exists in en.json', () => {
    const used = new Map<string, string>();
    for (const file of walk(ROOT)) {
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(CALL)) {
        const key = m[2];
        if (!key.includes('.')) continue;
        if (!used.has(key)) {
          const line = src.slice(0, m.index).split('\n').length;
          used.set(key, `${path.relative(ROOT, file)}:${line}`);
        }
      }
    }
    expect(used.size).toBeGreaterThan(1000); // guard: the scan actually found call sites

    const table = en as Record<string, string>;
    const missing = [...used.entries()]
      .filter(([key]) => !(key in table))
      .map(([key, where]) => `${key} (${where})`)
      .sort();

    expect(missing).toEqual([]);
  });
});
