import { maskCredsDeep } from '@/common/utils/mask-creds';

/**
 * [FIX-20260809-SEC-COMPARELEAK] `POST /hook/compare-external-api` returned
 * working credentials in its JSON body.
 *
 * THE LEAK: the handler built `configs.target.password = externalPassword` as
 * plaintext, and `configs.current` embeds the whole `_getApiConfig()` result,
 * which carries the stored credentials too. The route has NO permission guard
 * (hook-outbound.controller.ts:55 — and the file header records that the four
 * /hook routes are ungarded deliberately, matching legacy), so anyone who could
 * reach it got usable credentials back.
 *
 * ⭐ WHAT THIS FILE PROVES, and why it matters: masking hides ONLY
 * credential-shaped keys. Every other field must come back byte-identical, or
 * the compare screen breaks. A masker that is too greedy is its own outage.
 * ซ่อนเฉพาะ field ที่เป็นความลับ · ค่าอื่นต้องเหมือนเดิมเป๊ะ.
 */

// The exact shape the endpoint returns under `configs`.
const configsFixture = () => ({
  current: {
    config: {
      baseUrl: 'https://api.example.test',
      username: 'svc_user',
      password: 'sup3r-s3cret-pw',
      api_key: 'ak_live_1234567890', // gitleaks:allow (test fixture, not a real key)
    },
    endpoints: [{ key: 'PROFILE', method: 'GET', path: 'v1/customer' }],
    source: 'system_config',
  },
  target: {
    baseUrl: 'https://api.other.test',
    username: 'other_user',
    password: 'another-s3cret',
  },
});

describe('[SEC-COMPARELEAK] credentials never leave in the compare response', () => {
  it('⭐ masks the password on BOTH sides of the comparison', () => {
    const out = maskCredsDeep(configsFixture());

    // The two values that were previously plaintext.
    expect(out.current.config.password).not.toBe('sup3r-s3cret-pw');
    expect(out.target.password).not.toBe('another-s3cret');
    // And the api_key that rode along inside `current`.
    expect(out.current.config.api_key).not.toBe('ak_live_1234567890'); // gitleaks:allow (test fixture, not a real key)
  });

  it('no raw secret survives anywhere in the serialised body', () => {
    // Serialising is the real test: a secret nested deeper than we thought
    // would still be shipped to the caller.
    const json = JSON.stringify(maskCredsDeep(configsFixture()));
    for (const secret of [
      'sup3r-s3cret-pw',
      'another-s3cret',
      'ak_live_1234567890', // gitleaks:allow (test fixture, not a real key)
    ]) {
      expect(json).not.toContain(secret);
    }
  });

  it('⭐ every NON-credential field is byte-identical', () => {
    // The regression that would break the compare screen. Masking must be
    // surgical: hide the secret, change nothing else.
    const out = maskCredsDeep(configsFixture());

    expect(out.current.config.baseUrl).toBe('https://api.example.test');
    expect(out.current.config.username).toBe('svc_user');
    expect(out.current.source).toBe('system_config');
    expect(out.current.endpoints).toEqual([
      { key: 'PROFILE', method: 'GET', path: 'v1/customer' },
    ]);
    expect(out.target.baseUrl).toBe('https://api.other.test');
    expect(out.target.username).toBe('other_user');
  });

  it('does not mutate the input — the caller still holds real values', () => {
    // The service passes live config objects in. If masking mutated them, the
    // request that follows would send masked credentials upstream and fail.
    const input = configsFixture();
    maskCredsDeep(input);
    expect(input.current.config.password).toBe('sup3r-s3cret-pw');
    expect(input.target.password).toBe('another-s3cret');
  });
});
