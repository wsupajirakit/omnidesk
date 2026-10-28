/* eslint-disable no-restricted-imports -- these specs unit-test the rag engine's internals;
   production code reaches rag only through '@/modules/rag' (rag-engine-wiring.spec.ts pins the leaf rule) */
/**
 * [FEAT-20261026-RAGENGINE] How the engine is plugged in — the invariants that make it safe to
 * plug and unplug.
 *   1. the Training Doc sections rebuild EXACTLY what `buildSuggestionForHook` sends;
 *   2. the plug is one provider line in `webhook.module.ts`, bound to the engine;
 *   3. the rag module never imports webhook (no cycle — it stays a leaf).
 * ถอดเสียบได้เพราะ 3 ข้อนี้ — ห้ามพัง
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildSuggestionForHook,
  buildSuggestionSections,
} from '@/modules/webhook/ai-reply/prompt-context.util';

const ROOT = join(__dirname, '../..');
const rebuild = (s: { start: string; end: string; text: string }[]) =>
  s
    .map((x) => (x.start || x.end ? `${x.start}\n${x.text}\n${x.end}` : x.text))
    .join('\n');

describe('[RAGENGINE] Training Doc sections ⇔ buildSuggestionForHook', () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    [
      'both boxes',
      {
        suggestion_text: '  พื้นฐาน\nบรรทัดสอง  ',
        suggestion_company_text: '\nบริษัท\n',
      },
    ],
    ['only box 1', { suggestion_text: 'พื้นฐาน' }],
    ['only box 2', { suggestion_text: '', suggestion_company_text: 'บริษัท' }],
    ['empty', {}],
    [
      'legacy row (markers inside box 1)',
      {
        suggestion_text:
          '[START_OF_BASIC_INFO]\nเก่า\n[END_OF_BASIC_INFO]\nต่อ',
        suggestion_company_text: 'ไม่ถูกส่ง',
      },
    ],
    [
      'no_profile box is not sent',
      { suggestion_text: 'ก', suggestion_text_no_profile: 'ห้ามส่ง' },
    ],
  ];
  it.each(cases)('🔴 PIN %s — byte for byte', (_n, hook) => {
    for (const hasProfile of [true, false]) {
      expect(rebuild(buildSuggestionSections(hook, hasProfile))).toBe(
        buildSuggestionForHook(hook, hasProfile),
      );
    }
  });
});

describe('[RAGENGINE] the plug', () => {
  const strip = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('webhook.module binds DOC_RETRIEVAL_PROVIDER to the engine with ONE useExisting line', () => {
    const src = strip(
      readFileSync(join(ROOT, 'src/modules/webhook/webhook.module.ts'), 'utf8'),
    );
    expect(src.match(/provide:\s*DOC_RETRIEVAL_PROVIDER/g)).toHaveLength(1);
    expect(src).toMatch(
      /\{\s*provide:\s*DOC_RETRIEVAL_PROVIDER,\s*useExisting:\s*RagRetrievalService\s*\}/,
    );
    expect(src).toMatch(/imports:\s*\[[\s\S]*\bRagModule\b/);
  });

  it('the rag module is a leaf — no import of webhook (or anything that imports it)', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory()
          ? walk(p)
          : p.endsWith('.ts')
            ? [p]
            : [];
      });
    const offenders = walk(join(ROOT, 'src/modules/rag')).filter((f) =>
      /from '@\/modules\/(webhook|chat|hooks|ai)'/.test(
        readFileSync(f, 'utf8'),
      ),
    );
    expect(offenders).toEqual([]);
  });
});
