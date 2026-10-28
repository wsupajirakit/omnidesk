/* [FIX-20260814-CUSTOMERNAME] one place that decides what a customer is called
 * ===========================================================================
 * Owner, 14/08: the ticket pages showed "Unknown" for customers who DO have a
 * name — same person read correctly on the Contact page. Root cause found by
 * querying the live ticket payload (`14aug1845res.txt`) and the member rows:
 *
 *   line_user_data: { display_name: "phat2519", nickname: "Unknown", … }
 *
 * `"Unknown"` is a SENTINEL the backend writes, never something a human typed:
 * the member placeholder stamps it (`chat-history.service.ts:174,177`), and the
 * eager-room bug of 13-14/08 left those stamps behind on real customers. It can
 * still be produced today on the hinted-insert path, so the frontend must stay
 * resilient rather than rely on a one-off data cleanup (the owner deliberately
 * skipped the backfill).
 *
 * Because `"Unknown"` is truthy, every `nickname || display_name` chain picked
 * the sentinel over the real name. The fix is to treat it as absent — the
 * PRIORITY of the fields is unchanged, so an operator-set nickname still wins,
 * which is the behaviour the owner confirmed is correct.
 * ลำดับเดิมไม่เปลี่ยน — แค่ข้ามค่าที่ระบบเขียนไว้เองว่า "Unknown".
 *
 * WHY IT LIVES HERE: the same chain was duplicated in six places across the
 * ticket and contact pages, each free to drift. One helper, one rule.
 *
 * revert: delete this file and inline `nickname || display_name` back at each
 * call site (see the [FIX-20260814-CUSTOMERNAME] markers).
 */

/** Fields every caller passes; extra keys are ignored. */
export interface CustomerNameSource {
  display_name?: string | null;
  nickname?: string | null;
  full_name?: string | null;
  line_user_id?: string | null;
}

/**
 * Placeholder names the BACKEND writes when it has no profile yet.
 * Compared case-insensitively after trimming, so `" unknown "` counts too.
 * ⚠️ Only add values the system generates itself — never a name a customer
 *    could plausibly have chosen, or a real person becomes invisible.
 */
const PLACEHOLDER_NAMES = new Set(['unknown']);

/** The value if it is a REAL name, otherwise `''`. */
export const realName = (value?: string | null): string => {
  const v = String(value ?? '').trim();
  return v && !PLACEHOLDER_NAMES.has(v.toLowerCase()) ? v : '';
};

export interface CustomerNameOptions {
  /**
   * Put the registered `full_name` first. The contacts book identifies people
   * by who they really are; a chat room leads with what the operator calls
   * them. Both orders predate this helper and are deliberate — the flag keeps
   * each page's behaviour byte-identical instead of forcing one on both.
   */
  preferFullName?: boolean;
}

/**
 * What to call this customer.
 *
 * Chat/ticket order: nickname the operator set → LINE display name →
 * registered full name → raw user id → `fallback`.
 * With `preferFullName`, the registered name leads (contacts book).
 *
 * `fallback` defaults to `'Line User'`, the wording the ticket header already
 * used for an unnamed customer.
 */
export const customerName = (
  source: CustomerNameSource | null | undefined,
  fallback = 'Line User',
  options: CustomerNameOptions = {},
): string => {
  const s = source ?? {};
  const chain = options.preferFullName
    ? [s.full_name, s.display_name, s.nickname]
    : [s.nickname, s.display_name, s.full_name];
  for (const candidate of chain) {
    const name = realName(candidate);
    if (name) return name;
  }
  return realName(s.line_user_id) || fallback;
};
