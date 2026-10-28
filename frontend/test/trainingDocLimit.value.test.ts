/* [FEAT-20261016-DOC60K] The form refuses a Training Document box on EXACTLY the rule the server uses.
 *
 * Owner 16/10/2026: "ทำให้มันถูกต้องสิ" — the form checked 100,000 while the server (omnidesk-api
 * `hooks/hook-write.helpers.ts`) refuses above 60,000, so 60,001–100,000 passed the form and
 * failed on save. The server's rule, mirrored here:
 *   · limit 60,000 (one value, both sites)
 *   · measured after stripDocBlockTags + trim (`joinTrainingDoc` already does exactly that)
 *   · only a box that is SENT is checked — an edit sends only changed boxes (`diffHookPayload`),
 *     so a stored doc already over the limit, left untouched, never reaches the server and must
 *     not block saving the rest of the form.
 * The drift guard below reads the server's constant so the two numbers cannot part again.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SUGGESTION_TEXT_MAX_LENGTH, normalizeSuggestionText } from '../services/hook/suggestionUtils';
import { trainingDocOverLimit } from '../services/hook/trainingDoc';

const ROOT = join(__dirname, '..');
const t = (n: number) => 'ก'.repeat(n);
const boxes = (general: string, company = '', noProfile = '') => ({ general, company, noProfile });

describe('[DOC60K] the limit', () => {
  it('⭐ is 60,000', () => {
    expect(SUGGESTION_TEXT_MAX_LENGTH).toBe(60_000);
  });

  it('normalizeSuggestionText (the submit-path normaliser) accepts 60,000 and refuses 60,001', () => {
    expect(normalizeSuggestionText(t(60_000))).toHaveLength(60_000);
    expect(() => normalizeSuggestionText(t(60_001))).toThrow('60000');
  });
});

const BE = ['../backend']
  .map((p) => join(ROOT, p))
  .find((p) => existsSync(join(p, 'src/modules/hooks/hook-write.helpers.ts')));

describe.skipIf(!BE)(`[DOC60K] drift — the form's number is the server's number (BE: ${BE ?? 'NOT FOUND — skipped'})`, () => {
  it('⭐ SUGGESTION_TEXT_MAX_LENGTH matches omnidesk-api hook-write.helpers.ts', () => {
    const src = readFileSync(join(BE!, 'src/modules/hooks/hook-write.helpers.ts'), 'utf8');
    const m = src.match(/const SUGGESTION_TEXT_MAX_LENGTH = (\d+);/);
    expect(m, 'the server constant must exist under this name').not.toBeNull();
    expect(Number(m![1])).toBe(SUGGESTION_TEXT_MAX_LENGTH);
  });
});

describe('[DOC60K] create / clone (no baseline — every box is sent)', () => {
  it('⭐ 60,000 passes · 60,001 is refused, per box', () => {
    expect(trainingDocOverLimit(boxes(t(60_000), t(60_000), t(60_000)), null)).toEqual([]);
    expect(trainingDocOverLimit(boxes('x', t(60_001)), null)).toEqual(['suggestion_company_text']);
    expect(trainingDocOverLimit(boxes(t(60_001), '', t(60_001)), null)).toEqual([
      'suggestion_text',
      'suggestion_text_no_profile',
    ]);
  });

  it('measured like the server: after trim (spaces around 60,000 are not counted)', () => {
    expect(trainingDocOverLimit(boxes(`   ${t(60_000)}\n\n`), null)).toEqual([]);
  });
});

describe('[DOC60K] edit (baseline = what the form loaded — only changed boxes are sent)', () => {
  const stored = t(61_000); // a legacy doc already above the limit
  const baseline = { suggestion_text: stored, suggestion_company_text: '', suggestion_text_no_profile: '' };

  it('⭐ an untouched over-limit box does NOT block the save (the server never receives it)', () => {
    expect(trainingDocOverLimit(boxes(stored), baseline)).toEqual([]);
  });

  it('⭐ the same box once edited is checked — 60,001 refused, 60,000 accepted', () => {
    expect(trainingDocOverLimit(boxes(t(60_001)), baseline)).toEqual(['suggestion_text']);
    expect(trainingDocOverLimit(boxes(t(60_000)), baseline)).toEqual([]);
  });
});
