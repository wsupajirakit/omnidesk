import {
  buildSignatureHeaders,
  canonicalPayload,
  goEscape,
  render,
  sortKeysDeep,
} from '@/common/utils/hmac-signer';

describe('hmacSigner', () => {
  it('escapes special chars like Go json marshal', () => {
    expect(goEscape('<foo & bar>')).toBe('\\u003cfoo \\u0026 bar\\u003e');
  });

  it('sorts keys deeply', () => {
    const input = { z: 1, a: { c: 2, b: 3 }, m: [3, 2, 1] };
    const sorted = sortKeysDeep(input) as Record<string, unknown>;
    expect(Object.keys(sorted)).toEqual(['a', 'm', 'z']);
    expect(Object.keys(sorted.a as object)).toEqual(['b', 'c']);
  });

  it('canonicalizes JSON payloads', () => {
    const raw = { name: 'A&B', age: 30 };
    const result = canonicalPayload(raw, 'application/json', true);
    expect(result).toContain('\\u0026');
  });

  it('renders template variables', () => {
    expect(
      render('{{web_code}}-{{timestamp}}', {
        web_code: 'STORE1',
        timestamp: '12345',
      }),
    ).toBe('STORE1-12345');
  });

  it('builds signature headers correctly', () => {
    const res = buildSignatureHeaders({
      secret: 'my-hmac-secret',
      webCode: 'AGENT_007',
      body: { action: 'ping' },
      contentType: 'application/json',
      now: 1600000000000,
      nonce: 'fixed-nonce',
    });

    expect(res.timestamp).toBe('1600000000');
    expect(res.signature).toBeDefined();
    expect(res.headers['X-Timestamp']).toBe('1600000000');
    expect(res.headers['X-Signature']).toBe(res.signature);
  });
});
