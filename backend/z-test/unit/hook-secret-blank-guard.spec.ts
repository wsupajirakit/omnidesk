/**
 * [FIX-20260817-BLANKSECRET] An empty string must never destroy a stored secret.
 *
 * The failure this pins, seen on production: the OA edit form posts EVERY field
 * it holds, and when a secret never loaded into the form it posts `''` rather
 * than the `__SECRET_KEPT__` sentinel the round-trip is built on. `''` slipped
 * past both guards — `stripKeptSecrets` only drops an exact sentinel match, and
 * the secret handlers returned the blank straight through — so pressing Save on
 * an unrelated field wiped the channel secret / AI key with no error and a 200
 * response. Proven over real HTTP first (`z-test/manual/prove-hook-secret-save.js`,
 * case B3), then pinned here.
 *
 * The two rules are in tension and BOTH are asserted, because fixing one by
 * breaking the other is the obvious wrong patch:
 *   · `''`  → "the form did not carry the value" → KEEP what is stored
 *   · `null`→ "the operator cleared it on purpose" → CLEAR it
 * ค่าว่าง = ไม่ได้ตั้งใจ ห้ามทับ · null = ตั้งใจล้าง ต้องล้างได้
 *
 * These call the real private handlers through a minimal instance, so no HTTP
 * or Mongo is involved — the HTTP proof lives in the manual probe.
 */
// Deep import, matching the sibling hook specs — see hook-update-blank-write.
// eslint-disable-next-line no-restricted-imports
import { HooksService } from '@/modules/hooks/hooks.service';

/** The private handlers this spec drives, typed instead of `any`. */
type HandlerHarness = Record<string, unknown> & {
  updateSecretField: (submitted: unknown, existing: unknown) => unknown;
  // [FIX-20260818-VENDORKEYPROBE · plan §7.4] third arg = the vendor the row
  // will end up with, so the key is checked against its own issuer.
  ensureValidCustomAiKeyForUpdate: (
    v: unknown,
    e: unknown,
    vendor?: unknown,
  ) => Promise<unknown>;
  ensureValidLineKeyForUpdate: (v: unknown, e: unknown) => Promise<unknown>;
  ensureValidDocIdForUpdate: (v: unknown, e: unknown) => Promise<unknown>;
  credentialCheck: {
    verifyCustomAiKey: jest.Mock;
    verifyLineKey: jest.Mock;
    verifyDocId: jest.Mock;
  };
};

/** Reversible stand-in for CryptoService: `plain:` marks "encrypted". */
const crypto = {
  encrypt: (v: string) => `plain:${v}`,
  safeDecrypt: (v: unknown) =>
    typeof v === 'string' && v.startsWith('plain:') ? v.slice(6) : v,
};

const STORED = 'plain:real-secret-value';
const STORED_PLAIN = 'real-secret-value';

describe('[FIX-20260817-BLANKSECRET] blank submissions never overwrite a secret', () => {
  let svc: HandlerHarness;

  beforeEach(() => {
    svc = Object.create(HooksService.prototype) as HandlerHarness;
    svc.crypto = crypto;
    // custom_ai_key / line_key / doc_id verify against their issuer before
    // storing; the network call is irrelevant to the blank rule.
    svc.credentialCheck = {
      verifyCustomAiKey: jest.fn().mockResolvedValue(undefined),
      verifyLineKey: jest.fn().mockResolvedValue(undefined),
      verifyDocId: jest.fn().mockResolvedValue(undefined),
    };
  });

  describe('updateSecretField (channel_secret · access_token · line_secret · telegram_key)', () => {
    it("'' → undefined, i.e. the key is NOT written and the stored value survives", () => {
      expect(svc.updateSecretField('', STORED)).toBeUndefined();
    });

    it('whitespace-only → also treated as "not carried", never a wipe', () => {
      expect(svc.updateSecretField('   ', STORED)).toBeUndefined();
    });

    it('null → clears, because that is an operator asking to clear', () => {
      expect(svc.updateSecretField(null, STORED)).toBeNull();
    });

    it('a new value → encrypted and stored', () => {
      expect(svc.updateSecretField('brand-new', STORED)).toBe(
        'plain:brand-new',
      );
    });

    it('the SAME value → the stored ciphertext is reused byte-for-byte', () => {
      // (pre-existing behaviour: re-encrypting would log a spurious change)
      expect(svc.updateSecretField(STORED_PLAIN, STORED)).toBe(STORED);
    });

    it("'' on a hook that has NO secret yet stays a no-op, not an empty write", () => {
      expect(svc.updateSecretField('', undefined)).toBeUndefined();
    });
  });

  describe('ensureValidCustomAiKeyForUpdate', () => {
    it("'' → undefined, the stored AI key survives", async () => {
      await expect(
        svc.ensureValidCustomAiKeyForUpdate('', STORED),
      ).resolves.toBeUndefined();
      expect(svc.credentialCheck.verifyCustomAiKey).not.toHaveBeenCalled();
    });

    it('null → clears deliberately', async () => {
      await expect(
        svc.ensureValidCustomAiKeyForUpdate(null, STORED),
      ).resolves.toBeNull();
    });

    it('a new key → verified with the issuer, then encrypted', async () => {
      await expect(
        svc.ensureValidCustomAiKeyForUpdate('AIzaNEW', STORED),
      ).resolves.toBe('plain:AIzaNEW');
      // [FIX-20260818-VENDORKEYPROBE · plan §7.4] the vendor now travels with the
      // key, so the checker asks the RIGHT issuer. Pinning both arguments is what
      // stops a future refactor from dropping the vendor and silently falling back
      // to Google for every vendor.
      expect(svc.credentialCheck.verifyCustomAiKey).toHaveBeenCalledWith(
        'AIzaNEW',
        null, // no vendor passed by this call ⇒ the default vendor
      );
    });

    it('[VENDORKEYPROBE] the vendor is forwarded to the checker', async () => {
      await expect(
        svc.ensureValidCustomAiKeyForUpdate('sk-deepseek', STORED, 'deepseek'),
      ).resolves.toBe('plain:sk-deepseek');
      expect(svc.credentialCheck.verifyCustomAiKey).toHaveBeenCalledWith(
        'sk-deepseek',
        'deepseek',
      );
    });

    it('the same key → reuses the stored ciphertext and skips the issuer call', async () => {
      await expect(
        svc.ensureValidCustomAiKeyForUpdate(STORED_PLAIN, STORED),
      ).resolves.toBe(STORED);
      expect(svc.credentialCheck.verifyCustomAiKey).not.toHaveBeenCalled();
    });
  });

  describe('ensureValidLineKeyForUpdate', () => {
    it("'' → undefined, the stored token survives", async () => {
      await expect(
        svc.ensureValidLineKeyForUpdate('', STORED),
      ).resolves.toBeUndefined();
    });

    it('null → clears deliberately', async () => {
      await expect(
        svc.ensureValidLineKeyForUpdate(null, STORED),
      ).resolves.toBeNull();
    });
  });

  describe('ensureValidDocIdForUpdate (plain text, never ciphertext)', () => {
    it("'' → undefined, the stored doc id survives", async () => {
      await expect(
        svc.ensureValidDocIdForUpdate('', 'sheet-123'),
      ).resolves.toBeUndefined();
    });

    it('null → clears deliberately', async () => {
      await expect(
        svc.ensureValidDocIdForUpdate(null, 'sheet-123'),
      ).resolves.toBeNull();
    });

    it('a new id → verified then stored as plain text', async () => {
      await expect(
        svc.ensureValidDocIdForUpdate('sheet-999', 'sheet-123'),
      ).resolves.toBe('sheet-999');
    });
  });
});
