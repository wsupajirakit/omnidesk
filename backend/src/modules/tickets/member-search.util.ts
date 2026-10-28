/**
 * [PERF-20260821-MEMBERSEARCH] What the ticket search asks the members
 * collection — ONE builder, two modes, one switch.
 *
 *   legacy_regex  the query shipped on 19/08, byte for byte: ten fields,
 *                 unanchored, case-insensitive. No index can serve it
 *                 (`explain`: keysExamined=0 — a collection scan per keystroke).
 *                 THIS IS WHAT SHIPS, because the buckets below are filled only
 *                 as members are written after deploy (no backfill, owner's
 *                 rule) — switching early would hide every untouched member.
 *   tokens        `^<q>` on the lowercased buckets `search.<bucket>` written by
 *                 member.schema.ts — an index range scan per branch on the
 *                 wildcard index. Bounded by MIN_CHARS and RESULT_CAP, never by
 *                 scope or time: the owner's "ค้นทุกห้องได้" stands; the limit is
 *                 on the query's shape and the result's size.
 *
 * FLIPPING THE SWITCH: `MEMBER_SEARCH_MODE = 'tokens'` — after stg has written
 * buckets long enough that `db.members.countDocuments({ search: { $exists: false } })`
 * is acceptably small, or after a one-off token build the owner orders.
 * Flip back any time; the buckets keep filling either way.
 *
 * revert: delete this file; restore the inline $or in tickets.service.ts.
 */

/**
 * [PERF-20260826-TKTSEARCHHYBRID] 📖 docs/bottleneck_26_aug.md (S3)
 * `hybrid` = tokens first (index range scan), byte-identical legacy walk as
 * the net when tokens found NOTHING or the term is too short for it. The
 * orchestration lives in `listTickets` — this builder stays pure and only
 * ever receives the two concrete query modes (type-enforced below).
 * DEFAULT STAYS `legacy_regex`: the flip is an owner decision gated on the
 * stg parity numbers (P2.1/P2.3, prove-search-parity.mjs), never a side
 * effect of this code landing. สลับโหมดคือการตัดสินใจ ไม่ใช่ผลพลอยได้.
 */
export type MemberSearchMode = 'legacy_regex' | 'tokens' | 'hybrid';
/** The query modes the pure builder understands — `hybrid` resolves to these. */
export type MemberLookupMode = Exclude<MemberSearchMode, 'hybrid'>;

/** The switch. Code, not env — owner's rule. */
export const MEMBER_SEARCH_MODE: MemberSearchMode = 'legacy_regex';

/** tokens mode: shorter terms match almost everything and are not worth a query. */
export const MEMBER_SEARCH_MIN_CHARS = 2;
/** tokens mode: the member lookup stops here; the response says `truncated`. */
export const MEMBER_SEARCH_RESULT_CAP = 200;

/** Same escaping the legacy call used (ported from tickets.service.ts). */
export const escapeRegexText = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The ten legacy paths, in the order the 19/08 query listed them. */
const LEGACY_PATHS = [
  'display_name',
  'nickname',
  'member_user_id',
  'full_name',
  'phone_number',
  'contract_code',
  'detail',
  'raw_profile_data.data.profile.phone',
  'raw_profile_data.data.profile.bank.account_no',
  'raw_profile_data.data.profile.bank.account_name',
] as const;

/** The buckets, in schema order (member-search-tokens.ts MEMBER_SEARCH_BUCKETS). */
const BUCKET_PATHS = [
  'search.display_name',
  'search.nickname',
  'search.full_name',
  'search.phone_number',
  'search.contract_code',
  'search.member_user_id',
  'search.detail',
  'search.profile',
] as const;

export interface MemberSearchQuery {
  filter: Record<string, unknown>;
  /** null = no limit (legacy); a number = `.limit(n)` on the member lookup */
  limit: number | null;
}

/**
 * null = do not query at all (term too short for the mode).
 * The caller applies `filter` to the members collection and, in tokens mode,
 * `limit` — and reports `truncated` when the cap was hit.
 */
export function buildMemberSearchQuery(
  term: string,
  // hybrid never reaches here: listTickets resolves it to a concrete leg first
  mode: MemberLookupMode = MEMBER_SEARCH_MODE as MemberLookupMode,
): MemberSearchQuery | null {
  const raw = term.trim();
  if (!raw) return null;

  if (mode === 'legacy_regex') {
    const rx = new RegExp(escapeRegexText(raw), 'i');
    return {
      filter: { $or: LEGACY_PATHS.map((p) => ({ [p]: rx })) },
      limit: null,
    };
  }

  // tokens: normalise the way the buckets were built — lowercase; a digit-ish
  // term (phone/account fragments) loses its separators so "087-941" meets
  // the digits-only bucket. Case-sensitive ON PURPOSE: the buckets are already
  // lowercased, and the `i` flag is what turns an index range into a scan.
  const lowered = raw.toLowerCase().replace(/\s+/g, ' ');
  if (lowered.length < MEMBER_SEARCH_MIN_CHARS) return null;
  const textRx = new RegExp('^' + escapeRegexText(lowered));
  // Digit buckets (phone, profile) hold digits only — built with `\D` stripped —
  // so the term is normalised the SAME way for those branches: "087/941",
  // "087-941" and "087 941" all meet `^087941`. Text buckets keep the raw
  // lowered term, so a dashed contract code like "2024-001" still matches its
  // bucket as-is (review finding: one normalisation for all buckets lost it).
  const digits = lowered.replace(/\D/g, '');
  const digitRx =
    digits.length >= MEMBER_SEARCH_MIN_CHARS ? new RegExp('^' + digits) : null;
  const branches = BUCKET_PATHS.map((p) => {
    const isDigitBucket = p === 'search.phone_number' || p === 'search.profile';
    return { [p]: isDigitBucket && digitRx ? digitRx : textRx };
  });
  return { filter: { $or: branches }, limit: MEMBER_SEARCH_RESULT_CAP };
}
