/**
 * [FIX-20260812-BANKLOGOKEY] Numeric slip-code → bank-directory slug resolver.
 *
 * WHY THIS FILE EXISTS (and why it is its own file):
 * Swiftcheck's slip verification sends `bank.id` as the 3-digit NUMERIC code
 * ("004"), while `BANK_DIRECTORY` is keyed by ALPHA slug ("kbank") — so
 * `{{sender_bank_logo}}` / `{{receiver_bank_logo}}` resolved to the fallback
 * image on EVERY real slip (defect pinned as [BUG-20260810-BANKLOGOKEY],
 * logged in todo/be_todo20_10082026.md). Owner ordered the fix 2026-08-12 as a
 * SEPARATE single-purpose module: do not grow bank-directory.ts (served
 * verbatim to the FE via GET /banks) and do not touch `getBankInfo` /
 * `resolveBankNiceName` (they feed `{{bank_code}}` card text — widening them
 * would change other cards' behaviour).
 *
 * The numeric map is DERIVED once from the `code` field the directory already
 * carries — there is no second hand-written table to drift. Two entries are
 * then overridden to match what legacy (`legacy-api` banks.json) actually
 * served in prod; parity was checked against all 18 legacy rows on 2026-08-12:
 *   '011' → ttb  (legacy shows TTB.png   — our table has 011=tmb, no logo)
 *   '026' → icbc (legacy shows ICBC.png  — our table has 026=mega, no logo)
 *
 * ONLY consumer: `getBankLogoUrl` (slip-flex.handler.ts). Everything else keeps
 * resolving through `getBankInfo` untouched.
 * REVERT: delete this file + the one lookup line in `getBankLogoUrl`.
 * ไฟล์นี้ตั้งใจแยกเดี่ยว — ห้ามยัด map นี้กลับเข้า bank-directory.ts (FE ใช้ตารางนั้นตรง ๆ).
 */

import {
  BANK_DIRECTORY,
  DEFAULT_COUNTRY,
  getBankInfo,
  normalizeBankKey,
  type BankInfo,
} from '../../content/bank-directory';

/** Legacy-parity overrides — the numeric code legacy served differs from a
 * blind `code`-field derivation for exactly these two rows (see header). */
const LEGACY_CODE_ALIASES: Record<string, string> = {
  '011': 'ttb',
  '026': 'icbc',
};

/** numeric code → slug, built once at module load. Aliases win over derivation. */
const NUMERIC_TO_SLUG: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  const table = BANK_DIRECTORY[DEFAULT_COUNTRY] ?? {};
  for (const [slug, info] of Object.entries(table)) {
    if (info.code) out[info.code] = slug;
  }
  Object.assign(out, LEGACY_CODE_ALIASES);
  return out;
})();

/**
 * Resolve a slip's bank identifier — numeric id ("004"), shortCode ("KBANK")
 * or already-a-slug ("kbank") — to the directory record. Null when unknown;
 * the caller keeps its own fallback image (กันพลาด: ไม่รู้จัก = ภาพ fallback เดิม).
 */
export function getBankInfoFromSlipCode(idOrShort: unknown): BankInfo | null {
  // slug / shortCode first: "KBANK" normalises straight onto the table key.
  const direct = getBankInfo(idOrShort);
  if (direct) return direct;
  const slug = NUMERIC_TO_SLUG[normalizeBankKey(idOrShort)];
  return slug ? getBankInfo(slug) : null;
}
