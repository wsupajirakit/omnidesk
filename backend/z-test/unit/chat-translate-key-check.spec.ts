/**
 * [FEAT-20260908-CHATTRANS] the key checker — and the fail-open it exists to close
 * ===========================================================================
 * `safeDecrypt` returns the CIPHERTEXT when decryption fails
 * (`crypto.service.ts:179`). Every caller that writes
 * `const key = safeDecrypt(row.custom_ai_key); if (!key) refuse;` therefore
 * accepts `enc:AAAA…` as an API key on any hook whose `ENCRYPTION_KEY` was
 * rotated, sends it to the vendor, gets a 401 and burns a budget slot — while
 * reporting an error that points at the vendor rather than at the key.
 *
 * ## 🔴 THE CRYPTO HERE IS REAL, ON PURPOSE
 *
 * The rotated-key case is built by encrypting with one `ENCRYPTION_KEY` and
 * decrypting with a service constructed on a DIFFERENT one — a real AES-GCM
 * auth-tag failure, not a stub that returns `{ok:false}` because it was told to.
 *
 * ⚠️ `e2e/webhook-pipeline.e2e-spec.ts:199` stubs `isEncrypted` as
 * `() => false`. A double shaped like that would make the case below pass with
 * the checker deleted, which is why this file does not use one.
 *
 * ## What the last case pins, and why it is a grep
 *
 * `safeDecrypt` must not be reachable from the checker at all. A behavioural
 * assertion cannot say "and it never calls the other method" once the right
 * method is being called — so the source is read instead. That is the same
 * instrument `ai-vendor-single-door.spec.ts` uses for the same class of rule.
 *
 * revert: delete this file with `src/modules/chat/translate/translate-key-check.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CryptoService } from '@/infra/crypto';
import {
  checkVendorKey,
  vendorKeyProblemMessage,
  type SecretDecryptor,
} from '@/modules/chat';

const SOURCE_FILE = 'src/modules/chat/translate/translate-key-check.ts';

/** A real service, keyed on `master`. No Nest, no config module. */
const cryptoWith = (master: string): CryptoService =>
  new CryptoService({ encryptionKey: master } as never);

/** The one the app would build. */
const crypto = cryptoWith('unit-test-master-key-A');
/** A server that has since had its master key rotated. */
const rotated = cryptoWith('unit-test-master-key-B');

beforeAll(() => {
  /* Otherwise a stray ENCRYPTION_KEY_OLD in the environment would let the
     rotated service open the old ciphertext and the case would prove nothing. */
  delete process.env.ENCRYPTION_KEY_OLD;
});

describe('⭐ a usable key comes back as a key, and nothing else does', () => {
  it('⭐ an encrypted gemini key decrypts and is returned in plaintext', () => {
    const row = { custom_ai_key: crypto.encrypt('AIza-real-key') };
    const out = checkVendorKey(row, 'gemini', crypto);
    expect(out).toEqual({ ok: true, apiKey: 'AIza-real-key' });
  });

  it('a column that was never encrypted is passed through unchanged', () => {
    /* `tryDecryptSecret` returns a non-`enc:` value as-is. Older rows and
       hand-edited ones look like this and must keep working. */
    expect(
      checkVendorKey({ custom_ai_key: 'plain-key' }, null, crypto),
    ).toEqual({ ok: true, apiKey: 'plain-key' });
  });

  it('surrounding whitespace never reaches the vendor', () => {
    const out = checkVendorKey(
      { custom_ai_key: '  spaced-key  ' },
      null,
      crypto,
    );
    expect(out).toEqual({ ok: true, apiKey: 'spaced-key' });
  });
});

describe('⭐ refusals — and the two are NOT the same conversation', () => {
  it('no column at all ⇒ missing', () => {
    expect(checkVendorKey({}, 'gemini', crypto)).toEqual({
      ok: false,
      problem: 'missing',
    });
  });

  it('blank and whitespace-only columns ⇒ missing, never an empty-string key', () => {
    /* An empty string would be sent as a Bearer token and the refusal would
       arrive from the vendor as a 401 instead of from us. */
    for (const custom_ai_key of ['', '   ', null, 42]) {
      expect(checkVendorKey({ custom_ai_key }, null, crypto)).toEqual({
        ok: false,
        problem: 'missing',
      });
    }
  });

  it('⭐ THE BUG: a rotated master key ⇒ undecryptable, NOT a key', () => {
    const row = { custom_ai_key: crypto.encrypt('AIza-real-key') };

    /* First, the behaviour that makes this necessary — measured, not quoted:
       the method the checker refuses to use hands the ciphertext back. */
    const viaSafeDecrypt = rotated.safeDecrypt(row.custom_ai_key);
    expect(viaSafeDecrypt).toBe(row.custom_ai_key);
    expect(String(viaSafeDecrypt).startsWith('enc:')).toBe(true);

    /* And what the checker does with the same row on the same server. */
    expect(checkVendorKey(row, 'gemini', rotated)).toEqual({
      ok: false,
      problem: 'undecryptable',
    });
  });

  it('⭐ a MALFORMED `enc:` value ⇒ undecryptable — the third fail-open, found here', () => {
    /* MEASURED, and it surprised this spec's first draft, which expected
       `missing`. `decrypt()` does not throw on a malformed payload: at
       `crypto.service.ts:129` it reads
         if (parts.length !== 3 || !part0 || !part1 || !part2) return text;
       and hands the INPUT back — so `tryDecryptSecret` reports `{ok: true}`
       with the ciphertext as its value, exactly like `safeDecrypt` would. It is
       a third fail-open in the same file, on a different branch from the one
       this checker was written for.
       ⇒ the `isEncrypted` guard is what refuses it, which is the evidence that
       that branch is load-bearing rather than defensive decoration. Remove it
       and `enc:` ships to the vendor as an API key. */
    expect(checkVendorKey({ custom_ai_key: 'enc:' }, null, crypto)).toEqual({
      ok: false,
      problem: 'undecryptable',
    });
    expect(
      checkVendorKey({ custom_ai_key: 'enc:only.two' }, null, crypto),
    ).toEqual({ ok: false, problem: 'undecryptable' });
  });

  it('a value that is STILL ciphertext after a successful decrypt ⇒ undecryptable', () => {
    /* The belt-and-braces branch. A decryptor that reports success while
       returning an `enc:` value — a double-encrypted column, or a future
       softening of `tryDecryptSecret` back towards failing open — must not
       produce a key. This is the only case that needs a hand-built double, and
       it is built to be WRONG in the fail-open direction on purpose. */
    const failsOpen: SecretDecryptor = {
      tryDecryptSecret: (t) => ({ ok: true, value: t ?? null }),
      isEncrypted: (t) => typeof t === 'string' && t.startsWith('enc:'),
    };
    expect(
      checkVendorKey(
        { custom_ai_key: 'enc:still.cipher.text' },
        null,
        failsOpen,
      ),
    ).toEqual({ ok: false, problem: 'undecryptable' });
  });

  it('⭐ the union is real — a refusal carries no `apiKey` to read by mistake', () => {
    const out = checkVendorKey({}, null, crypto);
    expect(out.ok).toBe(false);
    expect('apiKey' in out).toBe(false);
  });
});

describe('⭐ it composes resolveVendorPair — the columns are not re-decided here', () => {
  it('deepseek reads its OWN column, so a deepseek hook with a gemini key refuses', () => {
    /* The behaviour `resolve-vendor-fields.ts` was built for: the COLUMN says
       who owns the value, so one vendor's credential can never be borrowed by
       another. ไม่มีคีย์ = ปฏิเสธ ไม่ใช่ยืม. */
    const row = { custom_ai_key: crypto.encrypt('AIza-gemini-only') };
    expect(checkVendorKey(row, 'deepseek', crypto)).toEqual({
      ok: false,
      problem: 'missing',
    });
  });

  it('deepseek finds `custom_ai_key_sec`', () => {
    const row = { custom_ai_key_sec: crypto.encrypt('sk-deepseek') };
    expect(checkVendorKey(row, 'deepseek', crypto)).toEqual({
      ok: true,
      apiKey: 'sk-deepseek',
    });
  });

  it('an unknown or absent vendor resolves to the gemini columns', () => {
    const row = { custom_ai_key: crypto.encrypt('AIza-key') };
    for (const vendor of [null, undefined, '', 'openai', 'DEEPSEEK']) {
      expect(checkVendorKey(row, vendor, crypto)).toEqual({
        ok: true,
        apiKey: 'AIza-key',
      });
    }
  });
});

describe('⭐ the rule that keeps the fail-open unreachable', () => {
  it('⭐ the checker never mentions `safeDecrypt`', () => {
    const src = readFileSync(join(process.cwd(), SOURCE_FILE), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(src).toContain('tryDecryptSecret');
    expect(src).toContain('isEncrypted');
    expect(src).not.toContain('safeDecrypt');
  });

  it('⭐ it imports nothing from chat — a future move to hooks is a `git mv`', () => {
    /* The one property that makes the placement decision reversible. If this
       file ever grows a `@/modules/chat` import, moving it becomes a rewrite
       and the reason for writing it this way is gone. */
    const raw = readFileSync(join(process.cwd(), SOURCE_FILE), 'utf8');
    const imports = raw.match(/^import .*$/gm) ?? [];
    expect(imports).toEqual([
      "import { resolveVendorPair } from '@/modules/hooks';",
    ]);
  });

  it('each problem has its own operator-facing sentence, and neither leaks a path', () => {
    const missing = vendorKeyProblemMessage('missing');
    const undec = vendorKeyProblemMessage('undecryptable');
    expect(missing).not.toEqual(undec);
    for (const m of [missing, undec]) {
      expect(m).not.toMatch(/\/|\.json|ENCRYPTION_KEY|custom_ai_key_sec/);
    }
  });
});
