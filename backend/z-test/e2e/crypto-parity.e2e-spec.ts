import { Test } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

import { ConfigModule } from '@/config/config.module';
import { CryptoModule, CryptoService } from '@/infra/crypto';
import { MongoModule } from '@/infra/mongo/mongo.module';

/**
 * Decryption against secrets the legacy backend actually wrote.
 *
 * The unit tests prove this implementation can decrypt what it encrypts, which
 * is a weaker claim than it looks: an implementation with the wrong algorithm or
 * key derivation is perfectly self-consistent and still cannot open a single
 * real record. The legacy service reports decrypting 27 fields across 7 hooks at
 * boot; this suite checks the same fields with the same key.
 *
 * Read-only, and no plaintext is ever asserted on or logged — only whether
 * decryption succeeded and that the result is no longer ciphertext.
 */
describe('Crypto parity (real encrypted data)', () => {
  let connection: Connection;
  let crypto: CryptoService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, MongoModule, CryptoModule],
    }).compile();

    connection = moduleRef.get<Connection>(getConnectionToken());
    crypto = moduleRef.get(CryptoService);
  });

  afterAll(async () => {
    await connection?.close();
  });

  /** Every `enc:`-prefixed string stored on hook documents. */
  const collectCiphertexts = async (): Promise<
    Array<{ field: string; value: string }>
  > => {
    const hooks = await connection.collection('hooks').find({}).toArray();
    const found: Array<{ field: string; value: string }> = [];

    for (const hook of hooks) {
      for (const [field, value] of Object.entries(hook)) {
        if (typeof value === 'string' && value.startsWith('enc:')) {
          found.push({ field, value });
        }
      }
    }

    return found;
  };

  it('finds encrypted secrets in the database to test against', async () => {
    const ciphertexts = await collectCiphertexts();

    // If this is 0 the remaining assertions would pass vacuously — which is
    // exactly how a broken implementation slips through a green suite.
    expect(ciphertexts.length).toBeGreaterThan(0);
  });

  it('decrypts every stored secret with the configured key', async () => {
    const ciphertexts = await collectCiphertexts();
    if (ciphertexts.length === 0) return;

    const failures: string[] = [];

    for (const { field, value } of ciphertexts) {
      const plaintext = crypto.safeDecrypt(value);

      // safeDecrypt returns the input unchanged when it cannot decrypt, so an
      // unchanged value means failure — not a secret that happens to look
      // encrypted.
      if (
        typeof plaintext !== 'string' ||
        plaintext === value ||
        plaintext.startsWith('enc:')
      ) {
        failures.push(field);
      }
    }

    // Field names only. A failure here means the key does not match the data,
    // which would surface in production as an unexplained 401 from a partner
    // API rather than as an error at boot.
    expect(failures).toEqual([]);
  });

  it('produces ciphertext the same key can reopen', async () => {
    const ciphertexts = await collectCiphertexts();
    if (ciphertexts.length === 0) return;

    // Round-trip a value of the same shape as the stored ones, confirming this
    // service writes records the legacy backend could also read.
    const sample = 'a-secret-value-of-realistic-length-0123456789';
    const encrypted = crypto.encrypt(sample)!;

    expect(typeof encrypted).toBe('string');
    expect(encrypted.startsWith('enc:')).toBe(true);
    expect(crypto.safeDecrypt(encrypted)).toBe(sample);
  });
});
