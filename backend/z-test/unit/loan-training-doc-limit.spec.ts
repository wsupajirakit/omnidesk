/**
 * [FEAT-20261016-DOC60K] A Training Document box holds up to 60,000 characters — on EVERY site.
 *
 * Owner 16/10/2026: "ปรับ ให้อนุญาติ 60k ตัวอักษรได้" — `loan-demo-mint` already stores 50,183
 * characters, so its own form could not be saved (or Copy Item'd): every write answered
 * `suggestion_text must be 50000 characters or less`.
 *
 * 🔁 FLIPPED the same evening. The first cut raised it for the loan site only and PINNED shop-api at
 * 50,000 (the standing "ห้ามกระทบ x api"). The owner then ruled: "60000 ทั้งสองใช้ค่าเดียวกัน" —
 * one limit for both sites. The shop-api case below therefore now asserts 60,000; it was 50,000.
 *
 * TARGET (shop-api · loan · unbound alike): ≤ 60,000 accepted on all three boxes (create + edit share
 * this helper); 60,001 refused, the message naming 60000.
 */
import {
  bindActiveProvider,
  CUSTOMER_PROVIDER_ENTRIES,
  resetActiveProvider,
} from '@/modules/customer-provider';

import { normalizeSuggestionField } from '../../src/modules/hooks/hook-write.helpers';

const byName = (n: string) => {
  const p = CUSTOMER_PROVIDER_ENTRIES.find((e) => e.name === n);
  if (!p) throw new Error('no provider ' + n);
  return p;
};
const text = (n: number) => 'ก'.repeat(n);
const BOXES = [
  'suggestion_text',
  'suggestion_company_text',
  'suggestion_text_no_profile',
];

afterEach(() => resetActiveProvider());

describe('[DOC60K] one limit for both sites — a Training Document box holds up to 60,000 characters', () => {
  for (const [label, bind] of [
    ['loan', () => bindActiveProvider(byName('loan_v1'))],
    ['shop-api', () => bindActiveProvider(byName('shopapi_v1'))],
    ['unbound', () => undefined],
  ] as const) {
    it(`⭐ ${label}: 60,000 accepted on every box (and the real 50,183-character doc)`, () => {
      bind();
      for (const box of BOXES) {
        expect(normalizeSuggestionField(text(60_000), box)).toHaveLength(
          60_000,
        );
        expect(normalizeSuggestionField(text(50_183), box)).toHaveLength(
          50_183,
        );
      }
    });

    it(`⭐ ${label}: 60,001 refused, the message names 60000`, () => {
      bind();
      for (const box of BOXES) {
        expect(() => normalizeSuggestionField(text(60_001), box)).toThrow(
          `${box} must be 60000 characters or less`,
        );
      }
    });
  }

  it('the limit is ONE value — no site declares its own', () => {
    for (const p of CUSTOMER_PROVIDER_ENTRIES) {
      expect(p).not.toHaveProperty('trainingDocMaxChars');
    }
  });
});
