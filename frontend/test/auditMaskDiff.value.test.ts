/* [FEAT-20260901-AUDITFULLDIFF] the audit page shows both sides of a change,
 * and never the value of a credential.
 * ===========================================================================
 * WHY THIS FILE EXISTS. The masking list here mirrors the backend's
 * `SENSITIVE_FIELDS`; a name added there and missed here is a credential
 * printed into a page admins read casually, and nothing else in the suite
 * would notice. These are pure functions, so this is a real call — no DOM.
 */
import { describe, expect, it } from 'vitest';
import {
  AUDIT_MASKED_DISPLAY,
  AUDIT_SENSITIVE_FIELDS,
  auditDisplayValue,
  isSensitiveAuditField,
} from '../utils/secretMask';

describe('which audit fields count as credentials', () => {
  it('matches every name the backend encrypts', () => {
    /* the list as measured in omnidesk-api/src/infra/crypto/crypto.service.ts */
    ['line_key', 'line_secret', 'custom_ai_key', 'telegram_key',
      'slip_verify_key', 'external_password', 'channel_secret',
      'access_token', 'customer_link_password', 'api_key',
    ].forEach((f) => expect(isSensitiveAuditField(f)).toBe(true));
  });

  it('matches the last segment of a dotted path, not just a bare name', () => {
    /* audit fields arrive both ways — `access_token` and `config.line.access_token` */
    expect(isSensitiveAuditField('config.line.access_token')).toBe(true);
    expect(isSensitiveAuditField('hook.channel_secret')).toBe(true);
  });

  it('is case-insensitive and tolerates padding', () => {
    expect(isSensitiveAuditField('  Access_Token  ')).toBe(true);
  });

  it('leaves ordinary fields alone', () => {
    ['status', 'fast_mode', 'display_name', 'follow_up.line.notice_deposit_at',
      'telegram_chat_id', 'api_key_label',
    ].forEach((f) => expect(isSensitiveAuditField(f)).toBe(false));
  });

  it('says nothing about an empty or missing field name', () => {
    [undefined, null, '', '   '].forEach((f) =>
      expect(isSensitiveAuditField(f)).toBe(false));
  });
});

describe('what the page renders for a value', () => {
  it('replaces a credential with the mask, on both sides', () => {
    expect(auditDisplayValue('access_token', 'ey.real.secret')).toBe(AUDIT_MASKED_DISPLAY);
    expect(auditDisplayValue('channel_secret', 'abc123')).toBe(AUDIT_MASKED_DISPLAY);
  });

  it('masks a credential even when the value is an object', () => {
    expect(auditDisplayValue('api_key', { k: 'v' })).toBe(AUDIT_MASKED_DISPLAY);
  });

  it('hands an ordinary value back untouched, object or not', () => {
    expect(auditDisplayValue('status', 1)).toBe(1);
    expect(auditDisplayValue('display_name', 'dev')).toBe('dev');
    const obj = { a: 1 };
    expect(auditDisplayValue('content_json', obj)).toBe(obj);
  });

  it('does not turn a real null/empty into the mask', () => {
    expect(auditDisplayValue('status', null)).toBeNull();
    expect(auditDisplayValue('status', '')).toBe('');
  });

  it('the mask is not the backend round-trip sentinel', () => {
    /* `__SECRET_KEPT__` means "leave the stored value alone" on a PUT; showing
       it to a reader would be leaking an implementation detail as if it were
       the value. The display mask must stay a separate string. */
    expect(AUDIT_MASKED_DISPLAY).not.toBe('__SECRET_KEPT__');
  });

  it('the list is not silently empty', () => {
    // [FEAT-20260904-VENDORSECCOL] 10 → 11: `custom_ai_key_sec` joined the list.
    // The number is deliberate — it is what stops the list being silently
    // emptied by a bad merge, so it moves only WITH a named field.
    expect(AUDIT_SENSITIVE_FIELDS.length).toBe(11);
    expect(AUDIT_SENSITIVE_FIELDS).toContain('custom_ai_key_sec');
  });
});
