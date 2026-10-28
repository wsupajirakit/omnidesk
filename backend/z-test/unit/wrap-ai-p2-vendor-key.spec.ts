/**
 * [TEST-20260813-P2-VENDORKEY] One vendor's key must never reach another vendor.
 *
 * The hazard this pins, found in adversarial review: `DEEPSEEK_API_KEY` was
 * declared in the env schema and read by nothing, while both providers resolved
 * `GEMINI_TEST_KEY ?? GEMINI_API_KEY` and threaded the result onto the neutral
 * call — so a keyless DeepSeek hook would have sent the Google key to
 * api.deepseek.com. These cases fail if that regression ever returns.
 */

import {
  resolveVendorEnvKey,
  resolveVendorKey,
} from '@/modules/webhook/ai-vendors/resolve-vendor-key';

const ENV_KEYS = [
  'GEMINI_TEST_KEY',
  'GEMINI_API_KEY',
  'DEEPSEEK_API_KEY',
] as const;
// ⚠️ DEEPSEEK_API_KEY is in this list only so a stray value in the developer's
//    shell cannot make these tests lie — the product deliberately has no such
//    env var (owner rule: everything per hook).

describe('[P2 VENDOR KEY] the shared env fallback is per vendor', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('⭐ deepseek NEVER receives a Gemini key, even when only Gemini keys exist', () => {
    process.env['GEMINI_TEST_KEY'] = 'G-TEST';
    process.env['GEMINI_API_KEY'] = 'G-PROD';
    expect(resolveVendorEnvKey('deepseek')).toBeUndefined();
    expect(resolveVendorKey(null, 'deepseek')).toBeUndefined();
  });

  it('⭐ gemini NEVER receives the DeepSeek key either', () => {
    /* ⚠️ The obvious version of this test is vacuous: with every Gemini env var
       cleared, `undefined` comes back whether or not the code reads a DeepSeek
       variable, so it would pass even against the bug it names. Set a Gemini key
       TOO, then assert the returned value is that one — the assertion has to be
       about WHICH key comes back, not merely that something does.
       เทสต์ต้องบอกว่าได้คีย์ไหน ไม่ใช่แค่ว่าได้/ไม่ได้. */
    process.env['DEEPSEEK_API_KEY'] = 'DS-PROD';
    process.env['GEMINI_API_KEY'] = 'G-PROD';
    expect(resolveVendorEnvKey('gemini')).toBe('G-PROD');
    expect(resolveVendorKey(null, 'gemini')).toBe('G-PROD');
  });

  it('gemini with NO key of its own returns undefined, DeepSeek key present or not', () => {
    // The other half: absence must stay absence rather than falling through to
    // whatever else is exported.
    process.env['DEEPSEEK_API_KEY'] = 'DS-PROD';
    expect(resolveVendorEnvKey('gemini')).toBeUndefined();
    expect(resolveVendorKey(null, 'gemini')).toBeUndefined();
  });

  it('⭐ deepseek has NO env fallback at all — per-hook only (owner rule)', () => {
    // Even if someone exports one, it must not become a credential source: the
    // rule is per hook, and a keyless DeepSeek OA must refuse rather than borrow.
    process.env['DEEPSEEK_API_KEY'] = 'DS-PROD';
    expect(resolveVendorEnvKey('deepseek')).toBeUndefined();
    expect(resolveVendorKey(null, 'deepseek')).toBeUndefined();
  });

  it('gemini keeps the legacy ladder order: TEST_KEY before API_KEY', () => {
    process.env['GEMINI_TEST_KEY'] = 'G-TEST';
    process.env['GEMINI_API_KEY'] = 'G-PROD';
    expect(resolveVendorEnvKey('gemini')).toBe('G-TEST');
    delete process.env['GEMINI_TEST_KEY'];
    expect(resolveVendorEnvKey('gemini')).toBe('G-PROD');
  });

  it('absent / null / unknown vendor resolves like the default (gemini), never undefined-by-accident', () => {
    process.env['GEMINI_API_KEY'] = 'G-PROD';
    expect(resolveVendorEnvKey(undefined)).toBe('G-PROD');
    expect(resolveVendorEnvKey(null)).toBe('G-PROD');
    expect(resolveVendorEnvKey('no-such-vendor')).toBe('G-PROD');
  });

  it('a blank per-hook key does not become a "Bearer  " request', () => {
    expect(resolveVendorKey('   ', 'deepseek')).toBeUndefined();
    expect(resolveVendorKey('', 'deepseek')).toBeUndefined();
  });
});

describe("[P2 VENDOR KEY] the OA's own key always wins", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env['GEMINI_API_KEY'] = 'G-PROD';
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it('hook.custom_ai_key beats the fallback for either vendor', () => {
    expect(resolveVendorKey('HOOK-KEY', 'gemini')).toBe('HOOK-KEY');
    expect(resolveVendorKey('HOOK-KEY', 'deepseek')).toBe('HOOK-KEY');
  });

  it('is trimmed, and blank falls through to the vendor fallback', () => {
    expect(resolveVendorKey('  HOOK-KEY  ', 'deepseek')).toBe('HOOK-KEY');
    expect(resolveVendorKey('   ', 'deepseek')).toBeUndefined(); // no env rung
    expect(resolveVendorKey('', 'gemini')).toBe('G-PROD');
    expect(resolveVendorKey(null, 'gemini')).toBe('G-PROD');
  });
});
