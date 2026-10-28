/**
 * [FIX-20260812-BANKLOGOKEY] bank-logo-code.map.ts — numeric slip-code resolver.
 *
 * Groups:
 *   A) legacy parity — all 18 numeric codes legacy's banks.json served must
 *      resolve to a record WITH a logo (the two alias rows included)
 *   B) input shapes — numeric id / shortCode / slug / unknown / empty
 *   C) fallback safety — getBankLogoUrl keeps the legacy default image for
 *      anything unresolvable (owner-mandated กันพลาด)
 *   D) isolation — the shared directory API is untouched by this fix
 */
import { getBankInfoFromSlipCode } from '../../src/modules/webhook/slip-flex/bank-logo-code.map';
import { getBankLogoUrl } from '../../src/modules/webhook/slip-flex/slip-flex.handler';
import { getBankInfo } from '../../src/modules/content/bank-directory';

const BASE = 'https://cdn.example.com';

describe('bank-logo-code.map — numeric slip-code → bank record', () => {
  // Every code legacy banks.json carried, with the slug it must land on now.
  // 011/026 are the alias rows (legacy showed TTB/ICBC; a blind `code`-field
  // derivation would land on tmb/mega which ship no logo).
  const LEGACY_PARITY: Array<[string, string]> = [
    ['002', 'bbl'],
    ['004', 'kbank'],
    ['006', 'ktb'],
    ['011', 'ttb'],
    ['014', 'scb'],
    ['017', 'citi'],
    ['024', 'uob'],
    ['025', 'bay'],
    ['026', 'icbc'],
    ['030', 'gsb'],
    ['031', 'hsbc'],
    ['033', 'ghb'],
    ['034', 'baac'],
    ['066', 'ibank'],
    ['067', 'tisco'],
    ['069', 'kk'],
    ['071', 'tcrb'],
    ['073', 'lhb'],
  ];

  it('A1 resolves every legacy-served numeric code to a record with a logo', () => {
    for (const [code, slug] of LEGACY_PARITY) {
      const info = getBankInfoFromSlipCode(code);
      expect(info).not.toBeNull();
      expect(info?.logo).toBe(getBankInfo(slug)?.logo);
      expect(info?.logo).toBeTruthy();
    }
  });

  it('A2 alias rows land on the legacy bank, not the code-field owner', () => {
    // 011 belongs to tmb (no logo) in the directory; legacy served TTB.
    expect(getBankInfoFromSlipCode('011')?.logo).toBe('/bank-logos/ttb.png');
    // 026 belongs to mega (no logo); legacy served ICBC.
    expect(getBankInfoFromSlipCode('026')?.logo).toBe('/bank-logos/icbc.png');
  });

  it('B1 shortCode ("KBANK") resolves via the existing normaliser', () => {
    expect(getBankInfoFromSlipCode('KBANK')?.logo).toBe(
      '/bank-logos/kbank.png',
    );
  });

  it('B2 slug passthrough still works (pre-fix behaviour kept)', () => {
    expect(getBankInfoFromSlipCode('ktb')?.logo).toBe('/bank-logos/ktb.png');
  });

  it('B3 unknown / empty → null (caller falls back)', () => {
    expect(getBankInfoFromSlipCode('999')).toBeNull();
    expect(getBankInfoFromSlipCode('')).toBeNull();
    expect(getBankInfoFromSlipCode(null)).toBeNull();
    expect(getBankInfoFromSlipCode(undefined)).toBeNull();
    expect(getBankInfoFromSlipCode({})).toBeNull();
  });

  it('C1 getBankLogoUrl: numeric id now yields the real asset URL', () => {
    expect(getBankLogoUrl('004', BASE)).toBe(`${BASE}/bank-logos/kbank.png`);
    expect(getBankLogoUrl('011', BASE)).toBe(`${BASE}/bank-logos/ttb.png`);
  });

  it('C2 getBankLogoUrl: fallback image survives for every unresolvable input', () => {
    // กันพลาด — เจ้าของสั่งคง fallback ภาพเดิมเสมอ
    for (const bad of ['999', '', null, undefined]) {
      expect(getBankLogoUrl(bad, BASE)).toContain('images.example.com');
    }
    // known bank but no asset (rbs '005' has no logo entry) → fallback too
    expect(getBankLogoUrl('005', BASE)).toContain('images.example.com');
  });

  it('D1 shared directory API untouched: getBankInfo still rejects numerics', () => {
    // {{bank_code}} / GET /banks behaviour must NOT have widened.
    expect(getBankInfo('004')).toBeNull();
    expect(getBankInfo('kbank')?.code).toBe('004');
  });
});
