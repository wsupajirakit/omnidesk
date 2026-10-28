/**
 * [FEAT-20260908-CHATTRANS] Is this OA's AI key USABLE — and if not, why not.
 * ===========================================================================
 * Owner, 09/09: the checker lives inside the chat caller and touches nothing
 * shared (`resolve-vendor-fields.ts` is read by the reply and summary lanes, so
 * adding to it would reach them). It is written so that MOVING it to
 * `modules/hooks/ai-vendor/` later is a `git mv` and not a rewrite: no DI, no
 * Nest, no `Model`, no room, no message, no request, and not one import from
 * `@/modules/chat`. The only thing it knows is a hook ROW and a vendor name.
 *
 * ## 🔴 WHY IT EXISTS AT ALL — `safeDecrypt` FAILS OPEN
 *
 * `crypto.service.ts:172-181`:
 *
 *     safeDecrypt(text) { … try { return this.decrypt(text); }
 *                         catch (err) { this.logDecryptFailure(text, err);
 *                                       return text; } }        ← :179
 *
 * On failure it hands back the CIPHERTEXT. So the natural-looking
 * `const key = safeDecrypt(row.custom_ai_key); if (!key) refuse;` passes for a
 * hook whose `ENCRYPTION_KEY` was rotated, and `enc:AAAA…` is then sent to the
 * vendor AS AN API KEY: a 401 from Google, a cap slot burned, and an error
 * message that points at the wrong thing. This function uses
 * `tryDecryptSecret` (`:183-193`) instead, which reports the failure as
 * `{ ok: false }` rather than as a value. ห้ามใช้ safeDecrypt ตรงนี้เด็ดขาด.
 *
 * ⚠️ `tryDecryptSecret` has no other production caller today. That is not a
 * reason to prefer the familiar one — it is the reason this bug survived.
 *
 * ## 🔴 WHY A DISCRIMINATED UNION AND NOT A `string | null`
 *
 * "usable" and "why not" become DIFFERENT TYPES, so the fail-open cannot be
 * reintroduced by an `if (!key)` at a call site: there is no key to test until
 * `ok` has been narrowed to `true`. The two problems are kept apart because
 * they are two different conversations with the operator — `missing` means "set
 * a key on this OA", `undecryptable` means "the key is there but this server
 * cannot read it; the master key changed". Collapsing them would tell an admin
 * to re-enter a key that is already correct.
 *
 * ## What it COMPOSES rather than reimplements
 *
 * `resolveVendorPair` (exported from `@/modules/hooks`) owns the question "which
 * two columns belong to this vendor" — `custom_ai_key` for gemini and every
 * unknown value, `custom_ai_key_sec` for deepseek — and already reduces blank
 * and whitespace to `null`. It is called, byte-identically, and nothing about it
 * is copied here; a third vendor is still one line in that file.
 *
 * ⚠️ Any test double for `SecretDecryptor` must NOT copy
 * `e2e/webhook-pipeline.e2e-spec.ts:199`, which stubs `isEncrypted` as
 * `() => false`. Copy that stub and the rotated-key case passes silently.
 *
 * 🔴 FINDING, NOT A TASK: the reply and summary lanes carry the identical
 * fail-open (`webhook/ai-vendors/request-credentials.ts:134` uses `safeDecrypt`,
 * and its deps type at `:32` cannot even reach `tryDecryptSecret`). NOT fixed
 * here — that is another lane and another owner's approval. This shape is what
 * that task would reuse.
 *
 * revert: delete this file and its call sites; the callers would then have to
 * decrypt inline, which is the state this replaced.
 */
import { resolveVendorPair } from '@/modules/hooks';

/** Why a hook cannot answer. Two states, because they need two answers. */
export type VendorKeyProblem = 'missing' | 'undecryptable';

/** Usable, with the key — or unusable, with the reason. Never both, never neither. */
export type VendorCredential =
  | { readonly ok: true; readonly apiKey: string }
  | { readonly ok: false; readonly problem: VendorKeyProblem };

/**
 * The two crypto methods this needs, declared structurally.
 *
 * 🔴 `safeDecrypt` IS DELIBERATELY ABSENT from this interface. It is not an
 * oversight and it must not be added "for convenience": if it is not reachable,
 * it cannot be reached by accident. The shape matches `CryptoService`, so the
 * real service satisfies it with no adapter.
 */
export interface SecretDecryptor {
  tryDecryptSecret(text: string | null | undefined): {
    ok: boolean;
    value: string | null;
    reason?: string;
  };
  isEncrypted(text: unknown): boolean;
}

/**
 * Resolve the hook's own key for one vendor, and say plainly whether it works.
 *
 * @param row    the hook document (or its `toObject()`), read-only
 * @param vendor `hook.ai_vendor` — absent, empty or unknown means gemini, the
 *   same answer every other vendor lookup in this repo gives
 * @param crypto the decryptor; see `SecretDecryptor` for what is NOT on it
 */
export function checkVendorKey(
  row: Record<string, unknown>,
  vendor: string | null | undefined,
  crypto: SecretDecryptor,
): VendorCredential {
  /* `resolveVendorPair` already turns '', '   ' and a non-string into null, so
     "the column is blank" and "the column is absent" arrive here as one case —
     which is right: both mean the admin has not set a key. */
  const { key } = resolveVendorPair(row, vendor);
  if (!key) return { ok: false, problem: 'missing' };

  const attempt = crypto.tryDecryptSecret(key);
  /* The branch `safeDecrypt` does not have. `ok: false` is only ever returned
     for a value that IS `enc:`-prefixed and could not be opened — a rotated or
     wrong `ENCRYPTION_KEY`, or a corrupted value. */
  if (!attempt.ok) return { ok: false, problem: 'undecryptable' };

  const plain = typeof attempt.value === 'string' ? attempt.value.trim() : '';
  /* Decrypted to nothing. Nothing is not a key. */
  if (!plain) return { ok: false, problem: 'missing' };

  /* 🔴 NOT DECORATION — it catches a REAL third fail-open, measured while
     writing this file's spec. `decrypt()` does not throw on a malformed
     payload: `crypto.service.ts:129` reads
       if (parts.length !== 3 || !part0 || !part1 || !part2) return text;
     and returns the INPUT, so `tryDecryptSecret` reports `{ok: true}` with the
     ciphertext as its value — the same shape as `safeDecrypt`, reached by a
     different branch. Without the line below, `enc:` or any truncated value
     would be sent to the vendor as an API key.
     It also covers a double-encrypted column and any future softening of
     `tryDecryptSecret`. This is what makes the fail-open unrepeatable rather
     than merely un-called. */
  if (crypto.isEncrypted(plain)) return { ok: false, problem: 'undecryptable' };

  return { ok: true, apiKey: plain };
}

/**
 * The operator-facing sentence for a refusal.
 *
 * It lives here, beside the problem it names, so the two cannot drift — and it
 * is a plain function so the caller decides the HTTP status. It names the hook
 * column, which is vocabulary `ai-translate` itself must never carry (the
 * module knows nothing about hooks); saying it in the CALLER is the whole
 * reason `TranslateKeyMissingError`'s own message is not reused.
 *
 * ⚠️ No file path, no env var name and no counter — this text reaches a browser.
 */
export function vendorKeyProblemMessage(problem: VendorKeyProblem): string {
  return problem === 'missing'
    ? 'This OA has no AI key set. Add the key on the OA before translating.'
    : 'This OA has an AI key, but this server cannot read it (the encryption key changed). Re-enter the key on the OA.';
}
