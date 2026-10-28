import { pbkdf2Sync, randomBytes } from 'node:crypto';

import { hashPassword, verifyPassword } from '@/common/utils/password';

/**
 * Password hashing has to stay byte-compatible with the legacy backend: both
 * services read the same `users` collection, so a hash produced by one must
 * verify in the other. These tests pin the format and the parameters.
 */
describe('password', () => {
  it('produces the legacy salt:hash format', () => {
    const stored = hashPassword('correct horse battery staple');
    const [salt, digest] = stored.split(':');

    // 16 salt bytes and a 32-byte derived key, both hex-encoded.
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('verifies a hash produced by the legacy implementation', () => {
    // Built here exactly as the legacy code builds it: PBKDF2-SHA256,
    // 310,000 iterations, 32-byte key, salt stored as hex and used as the
    // literal salt string.
    const salt = randomBytes(16).toString('hex');
    const digest = pbkdf2Sync(
      'legacy-password',
      salt,
      310_000,
      32,
      'sha256',
    ).toString('hex');
    const legacyStored = `${salt}:${digest}`;

    expect(verifyPassword('legacy-password', legacyStored)).toBe(true);
    expect(verifyPassword('wrong-password', legacyStored)).toBe(false);
  });

  it('round-trips its own hashes', () => {
    const stored = hashPassword('s3cret');
    expect(verifyPassword('s3cret', stored)).toBe(true);
    expect(verifyPassword('s3cre', stored)).toBe(false);
    expect(verifyPassword('', stored)).toBe(false);
  });

  it('rejects malformed stored values instead of throwing', () => {
    // A corrupted record must fail authentication, not fail the request — and
    // it must never be treated as a match.
    expect(verifyPassword('x', undefined)).toBe(false);
    expect(verifyPassword('x', null)).toBe(false);
    expect(verifyPassword('x', '')).toBe(false);
    expect(verifyPassword('x', 'no-colon-here')).toBe(false);
    expect(verifyPassword('x', ':')).toBe(false);
    expect(verifyPassword('x', 'salt:')).toBe(false);
    // Digest of the wrong length would make timingSafeEqual throw if the
    // lengths were not checked first.
    expect(verifyPassword('x', 'abcd:00ff')).toBe(false);
  });

  it('salts each hash so identical passwords differ on disk', () => {
    const first = hashPassword('same');
    const second = hashPassword('same');

    expect(first).not.toEqual(second);
    expect(verifyPassword('same', first)).toBe(true);
    expect(verifyPassword('same', second)).toBe(true);
  });
});
