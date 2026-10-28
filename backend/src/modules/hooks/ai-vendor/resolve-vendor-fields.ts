/**
 * [FEAT-20260904-VENDORSECCOL] Which two columns belong to which vendor.
 *
 * ⚠️ OWNER RULE (04/09): `ai_vendor` has three states and only three.
 *     `null` / `'gemini'` → `ai_model` + `custom_ai_key` — the path that has
 *                           always existed, unchanged byte for byte.
 *     `'deepseek'`        → `ai_model_sec` + `custom_ai_key_sec`.
 *   The Gemini knobs (`gemini_top_k`, `gemini_top_p`, `gemini_thinking_budget`,
 *   `gemini_temperature`) are Gemini's and are NOT part of this split.
 *   deepseek แยกไปหาค่าของตัวเอง · gemini/default ใช้ของเดิมทุกอย่าง
 *
 * WHY THIS IS A TABLE AND NOT AN `if` AT EACH CALL SITE. The reply path, the
 * assist summary and the translate funnel all need the same answer, and the
 * previous shape of this question (`resolve-vendor-key.ts`) had to be threaded
 * into every provider one argument at a time. Vendor #3 adds one entry here and
 * edits nothing else. ค่ายที่สามเพิ่มบรรทัดเดียวที่นี่ ไม่ต้องไล่แก้ทุกจุด
 *
 * ⭐ WHAT THE SPLIT ACTUALLY BUYS. `resolve-vendor-key.ts` documents, as its
 *    first rule, that one vendor's credential must never reach another — and it
 *    enforced that by ASKING which vendor was active, because both vendors read
 *    the one `custom_ai_key` column. Now the COLUMN says who owns the value:
 *    `custom_ai_key` is Gemini's whatever `ai_vendor` claims. A DeepSeek hook
 *    holding only a Gemini key therefore resolves to NO key and refuses, which
 *    is the behaviour that file always wanted and could only approximate.
 *    ไม่มีคีย์ = ปฏิเสธ ไม่ใช่ยืม — ตอนนี้เป็นจริงโดยโครงสร้าง ไม่ใช่โดยด่านตรวจ
 *
 * ⚠️ UNKNOWN VENDOR RESOLVES TO GEMINI, deliberately, and it must keep matching
 *    `resolveReplyTransport` / `resolveReplyVendorName` in
 *    `ai-reply/reply-transport.registry.ts`, which answer an unknown name with
 *    the Gemini transport. If the two ever disagreed, a typo'd row would send
 *    DeepSeek's key to Google — the exact class of bug this file removes.
 *    `parseAiVendor` already refuses unknown names at the write, so this only
 *    covers rows written before that guard or edited directly in Mongo.
 *
 * Placement: `hooks/ai-vendor/`, beside `parse-ai-vendor.ts` and
 * `ai-key-probe.ts`, because the columns belong to the HOOK document and three
 * modules need the answer — `webhook` (reply + assist summary) and `tickets`
 * (the translate funnel). Both already import `@/modules/hooks`, so this adds
 * no new coupling; putting it under `webhook/ai-vendors/` (its first home this
 * session) would have made `tickets` import `webhook`, which it does nowhere
 * today. เจ้าของคอลัมน์คือ hook ไฟล์จึงอยู่ฝั่ง hooks
 *
 * ⚠️ Exported from the hooks barrel (`modules/hooks/index.ts`) — a deep path
 *    into this file from another module is an eslint ERROR.
 *
 * revert: delete this file, drop the two `@Prop`s from `hook.schema.ts`, and
 *         have the call sites read `ai_model` / `custom_ai_key` directly again.
 *         Values already written to `*_sec` columns stay in the rows, unread.
 */

import { VENDOR_DEEPSEEK } from './parse-ai-vendor';

/** The pair of column names one vendor owns, and whether it can answer without them. */
export interface VendorColumns {
  /** Hook field holding this vendor's model id. */
  modelField: string;
  /** Hook field holding this vendor's (encrypted) API key. */
  keyField: string;
  /**
   * `true` when a hook with NO key of its own can still answer, because this
   * vendor has a shared env rung to fall back to.
   *
   * ⚠️ "no key" and "cannot answer" are NOT the same question, and telling an
   *    operator otherwise is how a warning becomes noise. A keyless Gemini OA
   *    rides `GEMINI_TEST_KEY ?? GEMINI_API_KEY` and answers normally; a keyless
   *    DeepSeek OA refuses every message. Whoever needs to say "this OA is
   *    stuck" must ask THIS, not `!key`.
   *    ไม่มีคีย์ ≠ ตอบไม่ได้ · ถามว่าค่ายมีบันไดสำรองไหม
   *
   * ⚠️ MIRRORS `resolveVendorEnvKey` in
   *    `webhook/ai-vendors/resolve-vendor-key.ts` — the function that actually
   *    performs the fallback. It cannot be imported (webhook imports hooks; the
   *    reverse closes a cycle that is fatal at boot), so the two are pinned
   *    together by `ai-vendor-sec-columns.spec.ts` instead. Change one and that
   *    spec fails. ต้องแก้คู่กันเสมอ เทสจับไว้แล้ว
   */
  hasSharedFallback: boolean;
}

/** Gemini — and every unknown value. The original columns, unmoved. */
export const GEMINI_COLUMNS: VendorColumns = {
  modelField: 'ai_model',
  keyField: 'custom_ai_key',
  // the legacy env ladder, which phase K retires — not a pattern to copy.
  hasSharedFallback: true,
};

/** DeepSeek — its own pair, added 04/09. No env rung by owner rule. */
export const DEEPSEEK_COLUMNS: VendorColumns = {
  modelField: 'ai_model_sec',
  keyField: 'custom_ai_key_sec',
  hasSharedFallback: false,
};

/**
 * The columns for a vendor.
 *
 * @param vendor `hook.ai_vendor` — absent, empty or unknown means Gemini, which
 *   is how every other vendor lookup in this module resolves.
 */
export function resolveVendorColumns(
  vendor: string | null | undefined,
): VendorColumns {
  return vendor === VENDOR_DEEPSEEK ? DEEPSEEK_COLUMNS : GEMINI_COLUMNS;
}

/** One hook turn's model + key, already reduced to "set" or "not set". */
export interface VendorPair {
  model: string | null;
  key: string | null;
}

/** Blank, whitespace and non-strings all mean "not set", never `''`. */
function readColumn(
  row: Record<string, unknown>,
  field: string,
): string | null {
  const raw = row[field];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Read the vendor's own pair off a hook row.
 *
 * ⚠️ The key comes back EXACTLY as stored — still ciphertext on a real row. The
 *    caller decrypts, because decryption belongs to the service that owns the
 *    CryptoService instance and this file must stay pure (it is imported by
 *    specs that must never touch DI). ที่นี่ไม่ถอดรหัส คนเรียกถอดเอง
 *
 * ⚠️ An empty string must NOT survive: the DeepSeek transport would send it as
 *    a Bearer token and the refusal would arrive from the vendor as a 401
 *    instead of from us as "this OA has no key".
 */
export function resolveVendorPair(
  row: Record<string, unknown>,
  vendor: string | null | undefined,
): VendorPair {
  const { modelField, keyField } = resolveVendorColumns(vendor);
  return {
    model: readColumn(row, modelField),
    key: readColumn(row, keyField),
  };
}
