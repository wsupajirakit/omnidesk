import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing, byte-compatible with the legacy backend.
 *
 * Stored format is `<salt-hex>:<derived-key-hex>`. Every parameter below is
 * fixed by the existing hashes in the database — changing any of them means no
 * current password verifies and every operator has to reset. They are not
 * tuning knobs while both backends run against the same data.
 */
const SALT_BYTES = 16;
const ITERATIONS = 310_000;
const KEY_LENGTH = 32;
const DIGEST = 'sha256';

const derive = (password: string, salt: string): string =>
  pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, DIGEST).toString('hex');

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES).toString('hex');
  return `${salt}:${derive(password, salt)}`;
}

/**
 * Verifies a password against a stored hash.
 *
 * Comparison is constant-time: a plain `===` leaks how many leading bytes
 * matched through its timing, which is enough to reconstruct a digest byte by
 * byte. Returns false for malformed input rather than throwing, so a corrupted
 * record fails authentication instead of the request.
 */
export function verifyPassword(
  password: string,
  stored: string | undefined | null,
): boolean {
  if (!stored || typeof stored !== 'string') return false;

  const [salt, expected] = stored.split(':');
  if (!salt || !expected) return false;

  const actualBuffer = Buffer.from(derive(password, salt), 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');

  // timingSafeEqual throws on length mismatch, so the lengths are checked first.
  if (actualBuffer.length !== expectedBuffer.length) return false;

  return timingSafeEqual(actualBuffer, expectedBuffer);
}
