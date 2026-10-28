import {
  base64UrlDecode,
  base64UrlEncode,
  parseExpiry,
  signToken,
  verifyToken,
} from '@/common/utils/jwt-utils';

describe('jwtUtils', () => {
  const secret = 'jwt-utils-secret-key';

  it('encodes and decodes base64url', () => {
    const raw = 'Hello World?&';
    const enc = base64UrlEncode(raw);
    expect(enc).not.toContain('+');
    expect(enc).not.toContain('/');
    expect(enc).not.toContain('=');
    expect(base64UrlDecode(enc)).toBe(raw);
  });

  it('parses expiry values', () => {
    expect(parseExpiry(60)).toBe(60);
    expect(parseExpiry('30s')).toBe(30);
    expect(parseExpiry('2m')).toBe(120);
    expect(parseExpiry('1h')).toBe(3600);
    expect(parseExpiry('1d')).toBe(86400);
    expect(parseExpiry('invalid')).toBe(3600);
  });

  it('signs and verifies JWT tokens', () => {
    const payload = { sub: 'user123', role: 'admin' };
    const token = signToken(payload, secret, '10m');

    const decoded = verifyToken<{ sub: string; role: string }>(token, secret);
    expect(decoded.sub).toBe('user123');
    expect(decoded.role).toBe('admin');
  });

  it('throws error when secret is invalid or token is tampered', () => {
    const token = signToken({ sub: 'user123' }, secret, '10m');
    expect(() => verifyToken(token, 'wrong-secret')).toThrow(
      'Invalid token signature',
    );
  });
});
