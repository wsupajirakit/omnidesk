/**
 * [CHAR-20260820-BANKLOGO] characterization — every bank logo the card can ask
 * for is a file that actually exists, and everything else falls back.
 *
 * WHY THIS FILE EXISTS, AND WHAT IT CORRECTS
 *   An audit item claimed "PROMPTPAY / TRUEMONEY logos 404 on the slip card".
 *   Measured on this code, that is FALSE and this file records the measurement so
 *   nobody re-opens it: `getBankInfoFromSlipCode('PROMPTPAY')` returns null, so
 *   `getBankLogoUrl` hands back DEFAULT_BANK_LOGO_URL — a fallback image, not a
 *   broken path. `pp.png` and `tmn.png` are both present on disk, and real slips
 *   never send the word "PROMPTPAY" anyway: the card reads `v.sender.bank.id`,
 *   which is a numeric code, and every numeric code resolves.
 *   ข้ออ้างเดิมว่า 404 — วัดแล้วไม่จริง
 *
 * WHAT THE REAL EXPOSURE IS
 *   A 404 is reachable, just not the way the audit said. The directory declares a
 *   `logo` path per bank and the files live in `public/bank-logos/`; nothing ties
 *   the two together. Add a bank, forget the PNG, and the card asks for a file
 *   that is not there — on a customer-visible payment confirmation. That is the
 *   hole this pins: 21 declared paths, 21 files, and they must stay in step.
 *
 * Nothing is changed here. This is a tripwire, not a fix.
 */
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

import { getBankInfoFromSlipCode } from '@/modules/webhook/slip-flex/bank-logo-code.map';
import { getBankLogoUrl } from '@/modules/webhook/slip-flex/slip-flex.handler';
import { BANK_DIRECTORY } from '@/modules/content/bank-directory';

const LOGO_DIR = join(__dirname, '../../public/bank-logos');
const BASE = 'https://x.test';

/** Every `logo` path the directory can hand to a card. */
const declaredLogos = (): string[] => {
  const out = new Set<string>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const rec = node as Record<string, unknown>;
    if (typeof rec['logo'] === 'string') out.add(rec['logo']);
    Object.values(rec).forEach(walk);
  };
  walk(BANK_DIRECTORY);
  return [...out];
};

describe('[CHAR-20260820-BANKLOGO] every declared logo is a file that exists', () => {
  it('finds logo paths to check at all — a silent zero would make this vacuous', () => {
    expect(declaredLogos().length).toBeGreaterThanOrEqual(21);
  });

  it('every declared logo path resolves to a real file', () => {
    const missing = declaredLogos().filter(
      (p) => !existsSync(join(LOGO_DIR, p.replace('/bank-logos/', ''))),
    );
    // Add a bank without adding its PNG and this is the line that tells you,
    // instead of a customer seeing a broken image on a payment confirmation.
    expect(missing).toEqual([]);
  });

  it('every file on disk is claimed by the directory', () => {
    const declared = new Set(
      declaredLogos().map((p) => p.replace('/bank-logos/', '')),
    );
    const orphans = readdirSync(LOGO_DIR).filter((f) => !declared.has(f));
    expect(orphans).toEqual([]);
  });
});

describe('[CHAR-20260820-BANKLOGO] what real slips send resolves; the rest falls back', () => {
  // Codes taken from real rows in slip_verifications: the card reads
  // `v.sender.bank.id`, which is always the numeric form.
  it.each(['004', '014', '002', '006', '025', '030', '074', '075'])(
    'numeric slip code %s resolves to a served asset URL',
    (code) => {
      const url = getBankLogoUrl(code, BASE);
      expect(url.startsWith(`${BASE}/bank-logos/`)).toBe(true);
      expect(
        existsSync(join(LOGO_DIR, url.split('/bank-logos/')[1] as string)),
      ).toBe(true);
    },
  );

  it.each([
    'PROMPTPAY',
    'TRUEMONEY',
    'TRUE MONEY WALLET',
    'ธนาคารกสิกรไทย',
    '',
    'nonsense',
  ])(
    'unresolvable input %s falls back rather than pointing at a missing file',
    (input) => {
      expect(getBankInfoFromSlipCode(input)).toBeNull();
      // Not a /bank-logos/ path at all — so it can never 404 on our own assets.
      expect(getBankLogoUrl(input, BASE)).not.toContain('/bank-logos/');
    },
  );
});
