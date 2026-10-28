import type { ConfigType } from '@nestjs/config';

import { CryptoService, PREFIX, SENSITIVE_FIELDS } from '@/infra/crypto';
import type { authConfig } from '@/config/app.config';

describe('CryptoService', () => {
  const mockAuthConfig: ConfigType<typeof authConfig> = {
    jwtSecret: 'test-secret',
    jwtExpiresIn: '1h',
    // [FIX-20260820-SESSIONCEILING] 0 = the feature is off, which is what this
    // suite exercises — CryptoService never reads it.
    sessionMaxLifetimeMin: 0,
    encryptionKey: 'test-encryption-key-12345', // gitleaks:allow (test fixture, not a real key)
    tempKeySecret: 'temp-key-secret',
  };

  let service: CryptoService;

  beforeEach(() => {
    delete process.env.ENCRYPTION_KEY_OLD;
    service = new CryptoService(mockAuthConfig);
  });

  it('encrypts plaintext with enc: prefix and decrypts back', () => {
    const original = 'my-secret-token-123';
    const encrypted = service.encrypt(original);

    expect(encrypted).toBeDefined();
    expect(encrypted?.startsWith(PREFIX)).toBe(true);
    expect(encrypted).not.toEqual(original);

    const decrypted = service.decrypt(encrypted!);
    expect(decrypted).toBe(original);
  });

  it('leaves non-string or already encrypted string unchanged during encrypt', () => {
    expect(service.encrypt(null)).toBeNull();
    expect(service.encrypt(undefined)).toBeUndefined();
    const alreadyEncrypted = `${PREFIX}some.data.here`;
    expect(service.encrypt(alreadyEncrypted)).toBe(alreadyEncrypted);
  });

  it('decrypts encrypted values using ENCRYPTION_KEY_OLD fallback', () => {
    const oldConfig: ConfigType<typeof authConfig> = {
      ...mockAuthConfig,
      encryptionKey: 'old-encryption-key-9999',
    };
    const oldService = new CryptoService(oldConfig);
    const secretEncryptedWithOld = oldService.encrypt('secret-with-old-key')!;

    process.env.ENCRYPTION_KEY_OLD = 'old-encryption-key-9999';
    const newService = new CryptoService(mockAuthConfig);

    const decrypted = newService.decrypt(secretEncryptedWithOld);
    expect(decrypted).toBe('secret-with-old-key');
  });

  it('safeDecrypt returns original text if decryption fails or text is not encrypted', () => {
    expect(service.safeDecrypt('plaintext-secret')).toBe('plaintext-secret');
    expect(service.safeDecrypt(`${PREFIX}invalid.payload.here`)).toBe(
      `${PREFIX}invalid.payload.here`,
    );
  });

  it('tryDecryptSecret returns ok status object', () => {
    const enc = service.encrypt('secret-data')!;
    expect(service.tryDecryptSecret(enc)).toEqual({
      ok: true,
      value: 'secret-data',
    });
    expect(service.tryDecryptSecret('plain')).toEqual({
      ok: true,
      value: 'plain',
    });
    expect(service.tryDecryptSecret(`${PREFIX}bad.payload.data`)).toEqual({
      ok: false,
      value: null,
      reason: 'undecryptable',
    });
  });

  it('encrypts and decrypts sensitive hook fields', () => {
    const rawHook = {
      name: 'My Hook',
      line_key: 'line-key-secret',
      line_secret: 'line-secret-key',
      channel_id: '123',
    };

    const encryptedHook = service.encryptHookFields(rawHook)!;
    expect(encryptedHook.line_key?.startsWith(PREFIX)).toBe(true);
    expect(encryptedHook.line_secret?.startsWith(PREFIX)).toBe(true);
    expect(encryptedHook.name).toBe('My Hook');

    const decryptedHook = service.decryptHookFields(encryptedHook)!;
    expect(decryptedHook.line_key).toBe('line-key-secret');
    expect(decryptedHook.line_secret).toBe('line-secret-key');
    expect(decryptedHook['channel_secret']).toBe('line-secret-key');
    expect(decryptedHook['access_token']).toBe('line-key-secret');
  });

  it('contains expected sensitive fields list', () => {
    expect(SENSITIVE_FIELDS).toContain('line_key');
    expect(SENSITIVE_FIELDS).toContain('line_secret');
    expect(SENSITIVE_FIELDS).toContain('api_key');
  });
});
