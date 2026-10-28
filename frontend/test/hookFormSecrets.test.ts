/* [FIX-20260817-BLANKSECRET] FE half — the audit the form writes itself must
 * never record the mask as if it were a value.
 *
 * The BE now refuses to overwrite a secret with a blank, so the DATA is safe
 * either way. What is still wrong on the FE is the AUDIT: HookFormPage diffs
 * `hookData` (which holds `__SECRET_KEPT__`, because that is what GET returns)
 * against the submitted payload, so an untouched secret is logged as
 * "changed from __SECRET_KEPT__" — a false trail that sent this very
 * investigation down the wrong path for an hour.
 *
 * Pinned as source assertions: the page is far too heavy to mount here, and the
 * rule is about which lines exist, not about rendering.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('[FIX-20260817-BLANKSECRET] the form never audits a masked secret', () => {
  const page = src('pages/hook/HookFormPage.tsx');
  const list = src('pages/hook/WebhookList.tsx');

  /** The guard must live INSIDE the diff loop — an import alone changes nothing.
   *  Sliced from the loop's own text so deleting the line fails this test. */
  const diffLoop = (file: string) => {
    const start = file.indexOf('const changes = Object.keys(finalPayload)');
    expect(start).toBeGreaterThan(-1);
    return file.slice(start, file.indexOf('});', start));
  };

  it('HookFormPage skips masked fields INSIDE the changed_fields loop', () => {
    const loop = diffLoop(page);
    expect(loop).toContain('isMaskedSecret(beforeVal)');
    expect(loop).toContain('isMaskedSecret(afterVal)');
    expect(loop).toContain('return [];');
  });

  it('WebhookList skips them in its own loop too', () => {
    const loop = diffLoop(list);
    expect(loop).toContain('isMaskedSecret(beforeVal)');
    expect(loop).toContain('isMaskedSecret(afterVal)');
  });

  it('the sentinel constant matches what the BE emits', () => {
    // The literal lives in ONE place (utils/secretMask.ts); the pages import it.
    // BE counterpart: src/modules/hooks/hooks.service.ts → export const SECRET_MASK
    expect(src('utils/secretMask.ts')).toContain("'__SECRET_KEPT__'");
  });
});

/* [FIX-20260817-BLANKSECRET] the remaining hole the BE cannot close.
 *
 * `telegram_key` is masked on read like every other secret, but the form turns
 * a blank into an explicit `null` — and `null` legitimately means "clear it".
 * So a form that failed to load the value wipes the key, and no backend rule
 * can tell that apart from an operator deliberately removing it.
 *
 * This is not hypothetical: production audit rows for hook `demo-oa-three` show
 * `telegram_key from:null to:null` written on ordinary saves, i.e. the form
 * really does post this field on every save. On a hook that HAD a key, the
 * same save with an unloaded form would have erased it.
 *
 * Rule: a blank is never an instruction. Omit the field; the BE then leaves the
 * stored value alone (RFC 7386 merge-patch semantics: absent = unchanged).
 * `telegram_chat_id` keeps its null-clears behaviour on purpose — it is NOT a
 * masked field, so its blank is a real, unambiguous blank.
 */
describe('[FIX-20260817-BLANKSECRET] a blank masked secret is omitted, not nulled', () => {
  it('secretForSubmit: blank/whitespace/undefined → undefined (key omitted)', async () => {
    const { secretForSubmit } = await import('../utils/secretMask');
    expect(secretForSubmit('')).toBeUndefined();
    expect(secretForSubmit('   ')).toBeUndefined();
    expect(secretForSubmit(undefined)).toBeUndefined();
    expect(secretForSubmit(null)).toBeUndefined();
  });

  it('secretForSubmit: a real value (and the sentinel) passes through trimmed', async () => {
    const { secretForSubmit, SECRET_MASK } = await import('../utils/secretMask');
    expect(secretForSubmit('  abc  ')).toBe('abc');
    expect(secretForSubmit(SECRET_MASK)).toBe(SECRET_MASK);
  });

  it('JSON.stringify drops an undefined field, which is what "unchanged" means on the wire', async () => {
    const { secretForSubmit } = await import('../utils/secretMask');
    const body = JSON.parse(JSON.stringify({ telegram_key: secretForSubmit('') }));
    expect('telegram_key' in body).toBe(false);
  });

  /* [FEAT-20260817-FORMDIFF] The payload builder moved out of HookFormModal into
     utils/hookFormPayload.ts (verbatim), so the rule is pinned at its new home.
     The two save screens are pinned too: both used to hold their own copy of the
     `'' → null` conversion, and both now go through the shared normaliser. */
  it('the payload builder no longer turns a blank telegram_key into null', () => {
    const builder = src('utils/hookFormPayload.ts');
    expect(builder).toContain('telegram_key: secretForSubmit(');
    expect(builder).not.toContain('telegram_key: telegramKeyTrimmed ? telegramKeyTrimmed : null');
  });

  it('neither save screen resurrects the null conversion of its own', () => {
    for (const rel of ['pages/hook/HookFormPage.tsx', 'pages/hook/WebhookList.tsx']) {
      const page = src(rel);
      expect(page).not.toContain('telegram_key: telegramKeyTrimmed ? telegramKeyTrimmed : null');
      expect(page).toContain('normalizeHookSubmission(');
    }
  });

  it('webhookService does the same on its own payload', () => {
    const svc = src('services/hook/webhookService.ts');
    expect(svc).toContain('telegram_key: secretForSubmit(');
  });
});
