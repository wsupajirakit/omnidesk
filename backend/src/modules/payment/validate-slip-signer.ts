/**
 * ==== [FEAT-20260808-PAYTOOL-P2] Shop-API validate-slip (topup) HMAC signer ====
 *
 * The topup leg (`POST /shop-api/v1/customer/validate-slip`) is multipart/form-data
 * signed the Shop-API way, but its canonical is NOT the JSON body — so the generic
 * custom-tool HMAC signer (which JSON-stringifies the body) CANNOT produce it.
 * This is the dedicated signer, faithful to the server's `canonicalMultipartPayload`
 * as documented in the ground-truth `sh_script_gen-test/standalone-validate-slip.sh`:
 *
 *   signature = HMAC_SHA256(web_code + timestamp + canonical, secret)   (hex)
 *
 *   canonical = a field-name→value map, JSON-encoded with keys sorted
 *   ascending, compact, where the FILE field is reduced to
 *   "sha256:<hex-of-file-bytes>;filename:<name>" — so the signature covers the
 *   file content without embedding raw bytes and is independent of the wire
 *   multipart encoding (boundary / field order / header formatting).
 *
 * ⚠️ ENCODING = the ground-truth `.sh` (AUTHORITATIVE), which builds the canonical
 * with `python3 json.dumps(fields, sort_keys=True, separators=(",",":"),
 * ensure_ascii=False)`. That does NOT Go-escape `& < >` (nor ` / `) and
 * keeps non-ASCII literal — and Node's `JSON.stringify(sortKeysDeep(map))` is
 * byte-identical to it (verified incl. a `web_code` containing `&` and Thai
 * text). So we DELIBERATELY do NOT `goEscape` here: an earlier version did, which
 * would 401 any `web_code`/`line_user_id` containing `& < >` against the real
 * server. `sortKeysDeep` alone is reused from the Shop-API signer. Secrets are
 * decrypted by the caller at call time and never logged here.
 *
 * revert: delete this file with the payment module.
 */
import { createHash, createHmac } from 'node:crypto';

import { sortKeysDeep } from '@/modules/external';

export interface ValidateSlipSignInput {
  secret: string;
  webCode: string;
  /** Multipart TEXT fields (e.g. line_user_id, web_code, payload). */
  fields: Record<string, string>;
  file: { field: string; buffer: Buffer; filename: string };
  /** Injectable clock for deterministic tests. */
  now?: number;
}

export interface ValidateSlipSignResult {
  headers: { 'X-Timestamp': string; 'X-Signature': string };
  timestamp: string;
  canonical: string;
}

/**
 * Build the X-Timestamp / X-Signature headers for one validate-slip request.
 * The `fields` MUST be exactly the text fields sent on the wire, and `file` the
 * exact bytes + filename of the multipart file field, or the signature will not
 * verify.
 */
export function buildValidateSlipHeaders(
  input: ValidateSlipSignInput,
): ValidateSlipSignResult {
  const timestamp = String(Math.floor((input.now ?? Date.now()) / 1000));

  const fileSha = createHash('sha256').update(input.file.buffer).digest('hex');
  const map: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.fields)) {
    if (v !== undefined && v !== null) map[k] = String(v);
  }
  map[input.file.field] = `sha256:${fileSha};filename:${input.file.filename}`;

  // Sorted-key, compact, NO Go-escaping — byte-identical to the ground-truth
  // `.sh`'s python `json.dumps(sort_keys=True, separators=(",",":"),
  // ensure_ascii=False)` (see the file header). A `&`/`<`/`>` in a field value
  // MUST stay literal, or the server (which does the same) rejects the signature.
  const canonical = JSON.stringify(sortKeysDeep(map));

  const signature = createHmac('sha256', String(input.secret || ''))
    .update(`${input.webCode || ''}${timestamp}${canonical}`, 'utf8')
    .digest('hex');

  return {
    headers: { 'X-Timestamp': timestamp, 'X-Signature': signature },
    timestamp,
    canonical,
  };
}

/**
 * Canonicalise the optional `payload` TEXT field (the Swiftcheck verify result).
 * The server reduces the multipart body to field→value and folds the payload's
 * WIRE string verbatim, so all that matters for SIGNATURE verification is that
 * the string we put on the wire equals the string we fold into the canonical —
 * which it does, because both use this function's output. Encoding is compact +
 * non-ASCII literal + NO Go-escape, which `JSON.stringify` matches.
 *
 * ==== [FIX-20260810-PAYLOAD-SORT] keys are sorted ascending, every level ====
 * WHY: the endpoint spec (`todo/topup/spec/dev.spec.md:12`, identical in
 * `shopapi.md:12`) requires the `payload` field be "JSON object เข้ารหัสเป็น text
 * field เดียว **sort key ด้วย น้อยไปมาก**". We previously emitted Swiftcheck's own
 * key order (`isDuplicate,amountInSlip,rawSlip`), which is NOT ascending — `i`
 * sorts after `a`. Sorted, the same object leads with `amountInSlip`.
 *
 * Note the two ground-truth artifacts DISAGREE with that line, which is why this
 * needs a comment rather than looking obvious: the `.sh` generator sorts only the
 * outer FIELD MAP (`standalone-validate-slip.sh:127`, `sort_keys=True`) and folds
 * `payload` in as an opaque string, while `spec/README.md:4` builds that string
 * with `json.dumps(..., separators=(',',':'))` and NO `sort_keys`; the shipped
 * `spec/fixtures/payload.json` is itself unsorted. So sorting here is NOT
 * required by the signature — it cannot break it either, since the wire string
 * and the folded string remain the same string. We sort because the WRITTEN spec
 * asks for it and the owner asked us to match the spec exactly, removing this as
 * a variable while `slip_status:"fail"` is being investigated with the provider.
 * ⚠️ Sorting changes only KEY ORDER — never a key or a value. Swiftcheck's data
 * reaches the endpoint intact, as `dev.spec.md:41` requires ("payload คือตัวที่
 * ได้มาจาก swiftcheck").
 * revert: drop the `sortKeysDeep` call; nothing else depends on the order.
 *
 * MEASURED 2026-08-10 15:48–15:50 ICT (`todo/topup/topup_20260810_1550_test.md`):
 * sorting did NOT change the outcome — 2 fresh slips still answered
 * `slip_status:"fail"`, so the unsorted order was never the cause. What DID
 * change the answer was the payload SHAPE: sending Swiftcheck's full envelope
 * (`{success,message,error,data}`, as in `spec/fixtures/payload.json`) instead of
 * the inner `data` moved the message from "อ่านสลิปไม่ได้" to "บัญชีผู้รับไม่ตรง
 * บัญชีระบบ" — i.e. the endpoint only FINDS the transfer details when they arrive
 * wrapped in the envelope, and the real blocker is that the slips pay a receiver
 * account the agent does not own. The caller therefore decides the shape; see
 * `payment-runner.service.ts:1000` (`_swiftcheckResult`). ห่อ envelope แล้ว server
 * อ่านเจอ — สาเหตุจริงคือบัญชีผู้รับไม่ตรง.
 *
 * `''` when there is nothing to send. A `string` input is passed through
 * untouched — it is already a caller-canonicalised wire string, and re-parsing it
 * to sort could change bytes the caller already signed.
 */
export function canonicalizePayloadField(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(sortKeysDeep(value));
  } catch {
    return '';
  }
}
