/**
 * [FIX-20260817-BLANKSECRET] The "keep the stored value" sentinel, and the one
 * question the form ever needs to ask about it.
 *
 * `GET /hook/:id` never returns a real secret — every configured one comes back
 * as `__SECRET_KEPT__` so a key cannot be stolen from the browser. The form
 * posts that value straight back, and the API reads it as "leave it alone".
 *
 * Why this file exists: the form ALSO writes its own audit row by diffing what
 * it loaded against what it submitted. Since what it loaded is the mask, an
 * untouched secret was logged as `from: "__SECRET_KEPT__"` — a change that
 * never happened, in the one record used to find out who changed what. (That
 * false trail cost an hour of a real incident investigation on 17/08.)
 *
 * The constant must stay identical to the backend's:
 *   omnidesk-api → src/modules/hooks/hooks.service.ts → `export const SECRET_MASK`
 *
 * revert: delete this file and the `isMaskedSecret` filters in
 * pages/hook/HookFormPage.tsx and pages/hook/WebhookList.tsx.
 */

/** Mirrors the backend's SECRET_MASK. Changing one without the other breaks the round trip. */
export const SECRET_MASK = '__SECRET_KEPT__';

/**
 * `true` when a value is the placeholder rather than a real secret — i.e. the
 * field was displayed but never edited, so nothing about it should be recorded.
 * ค่าที่เป็น mask = ไม่ได้แก้ ห้ามบันทึกว่าเปลี่ยน
 */
export const isMaskedSecret = (value: unknown): boolean => value === SECRET_MASK;

/**
 * What to put in a PUT body for a MASKED secret field.
 *
 * A blank is never an instruction. The form cannot tell "the operator emptied
 * this box" from "the value never loaded into the form" — both look like `''` —
 * so it must not decide, and it must never send the destructive reading.
 * Returning `undefined` makes `JSON.stringify` drop the key entirely, and an
 * absent key means "leave it as it is" (RFC 7386 merge-patch semantics, which
 * is what the API implements).
 *
 * ⚠️ Only for fields the API masks (`SENSITIVE_FIELDS` on the server). A field
 * that round-trips its real value — `telegram_chat_id`, for instance — has an
 * unambiguous blank and keeps its own clear-on-null behaviour.
 *
 * Consequence, on purpose: emptying the box no longer removes a stored secret.
 * Removing one needs a deliberate action that sends `null`; there is no such
 * button today, and adding one is a UI decision for the owner.
 * ค่าว่าง = ไม่ส่ง · การลบคีย์ต้องเป็นการกดที่ตั้งใจ ไม่ใช่ผลข้างเคียงของช่องว่าง
 */
export const secretForSubmit = (value: unknown): string | undefined => {
  if (value === null || value === undefined) return undefined;
  const trimmed = String(value).trim();
  return trimmed === '' ? undefined : trimmed;
};

/**
 * [FEAT-20260901-AUDITFULLDIFF] The field names whose VALUES must never be
 * printed in an audit row.
 *
 * Mirrors `SENSITIVE_FIELDS` in the backend
 * (`omnidesk-api/src/infra/crypto/crypto.service.ts`) — the same list the API
 * uses to decide what to encrypt and what to hand back as `SECRET_MASK`.
 * Keep the two in step: a name added there and missed here means a credential
 * printed in a log that admins read casually. เพิ่มฝั่ง BE แล้วต้องเพิ่มที่นี่ด้วย
 *
 * ⚠️ NOTHING ENFORCES THIS — checked 01/09 and stated rather than assumed. There
 * is no shared package, no generated file, and no test that reads across the two
 * repos. The backend's list carries the mirror-image warning next to it.
 * A cross-repo test was considered and dropped: it could only skip itself
 * wherever the sibling checkout is missing, and a test that skips while
 * reporting green is exactly the failure mode removed on 29/08. A note the next
 * editor reads BEFORE touching the list is worth more than a test that is green
 * for the wrong reason. โน้ตที่คนอ่านก่อนแก้ ดีกว่าเทสที่เขียวเพราะข้ามตัวเอง
 *
 * WHY THE FRONT END MASKS AT ALL, when the API already returns `SECRET_MASK`
 * for a configured secret: audit rows are HISTORY. A row written before the
 * masking existed, or by a path that recorded a raw value, still holds it —
 * and this page is the one place those old rows get rendered in full.
 * Masking on display costs nothing and does not depend on what was stored.
 */
export const AUDIT_SENSITIVE_FIELDS: readonly string[] = [
  'line_key',
  'line_secret',
  'custom_ai_key',
  // [FEAT-20260904-VENDORSECCOL] DeepSeek's key. Mirrors SENSITIVE_FIELDS in
  // omnidesk-api — the BE header states the rule: add a secret there without
  // adding it here and the raw value is rendered on the audit screen.
  'custom_ai_key_sec',
  'telegram_key',
  'slip_verify_key',
  'external_password',
  'channel_secret',
  'access_token',
  'customer_link_password',
  'api_key',
];

/** What a masked value is shown as. Not the backend sentinel — this one is for eyes. */
export const AUDIT_MASKED_DISPLAY = '••••••••';

/**
 * `true` when an audit `changed_fields[].field` names a credential.
 *
 * Matches the LAST dotted segment as well as the whole name: audit fields
 * arrive both bare (`access_token`) and pathed (`config.line.access_token`),
 * and only comparing the whole string would let the pathed form through.
 */
export const isSensitiveAuditField = (field: unknown): boolean => {
  const name = String(field ?? '').trim().toLowerCase();
  if (!name) return false;
  const leaf = name.split('.').pop() as string;
  return AUDIT_SENSITIVE_FIELDS.some((s) => name === s || leaf === s);
};

/**
 * The value to render for one audit field — the mask for a credential, the
 * value itself otherwise. Objects are handed back untouched so the caller can
 * still offer them to the JSON viewer.
 */
export const auditDisplayValue = (field: unknown, value: unknown): unknown =>
  isSensitiveAuditField(field) ? AUDIT_MASKED_DISPLAY : value;
