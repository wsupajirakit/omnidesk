/**
 * [PERF-20260821-MEMBERSEARCH] Search buckets on a member row — the derivation.
 * ===========================================================================
 * WHY: the ticket-support search runs an unanchored, case-insensitive regex over
 * ten member fields (three of them inside `raw_profile_data`). No B-tree index
 * can serve that shape — `explain()` shows `keysExamined=0`, a collection scan
 * per keystroke per operator. What an index CAN serve is a prefix-anchored
 * regex on a normalised (lowercased) value. So each searchable field gets a
 * BUCKET of lowercased tokens, and the search becomes `^<q>` on the buckets.
 * Owner's constraint: search must stay GLOBAL (every room, every OA, no time
 * window) — the limit is on query shape and result size, never on scope.
 *
 * WHY ONE BUCKET PER SOURCE FIELD: every member writer in the codebase (eight
 * sites across six modules) sends a PARTIAL `$set`. The update hook below sees
 * only the fields being written, so each field owns its bucket and only that
 * bucket is rewritten — `search.nickname` changes when `nickname` changes,
 * nothing else moves. A single array would need the whole document on every
 * write. ถังแยกตาม field ต้นทาง = อัปเดตบางส่วนได้ถูกต้อง.
 *
 * TOKENS:
 *   text   → the whole value lowercased + each whitespace-separated word, so
 *            "สมชาย ใจดี" is found by "ใจดี". Placeholders ('Unknown', '') → [].
 *   digits → phone / account: all digits + the last 8, 6, 4 — so "ค้นด้วยเลขท้าย"
 *            keeps working without a substring scan.
 *   profile→ `raw_profile_data.data.profile.{phone, bank.account_no, bank.account_name}`
 *            — exactly the three paths the search reads today.
 *
 * SEAMLESS: no default on the field → a legacy row has no `search` key at all
 * and renders/serialises exactly as before. Buckets appear on a row the first
 * time it is written after deploy. NO backfill (owner's standing rule); the
 * ticket search ships in `legacy_regex` mode and is switched to `tokens` only
 * once the buckets have had time to fill (see tickets/member-search.util.ts).
 *
 * The index: ONE wildcard index `{ 'search.$**': 1 }` (Mongo ≥ 4.2; local is
 * 7.0) covers every bucket as multikey, so the `$or` over buckets is an index
 * range scan per branch. Declared in member.schema.ts.
 *
 * revert: delete this file, the `search` prop, the two hooks and the index in
 *         member.schema.ts; existing buckets are inert and can be `$unset`.
 */

/** The seven member columns the ticket search reads; `raw_profile_data` is the eighth source. */
export const MEMBER_SEARCH_FIELDS = [
  'display_name',
  'nickname',
  'full_name',
  'phone_number',
  'contract_code',
  'member_user_id',
  'detail',
] as const;

export type MemberSearchField = (typeof MEMBER_SEARCH_FIELDS)[number];

/** Every bucket name as stored under `search.<bucket>`. */
export const MEMBER_SEARCH_BUCKETS = [
  ...MEMBER_SEARCH_FIELDS,
  'profile',
] as const;
export type MemberSearchBucket = (typeof MEMBER_SEARCH_BUCKETS)[number];

const DIGIT_FIELDS: ReadonlySet<string> = new Set(['phone_number']);
/** Values the stores write when they have nothing — never worth a token. */
const PLACEHOLDERS: ReadonlySet<string> = new Set([
  '',
  'unknown',
  'n/a',
  'null',
  'undefined',
]);

const uniq = (xs: string[]): string[] =>
  Array.from(new Set(xs.filter((x) => x.length > 0)));

export function tokensForText(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  const whole = value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (PLACEHOLDERS.has(whole)) return [];
  const words = whole.split(' ');
  return uniq([whole, ...(words.length > 1 ? words : [])]);
}

export function tokensForDigits(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  const digits = value.replace(/\D+/g, '');
  if (!digits) return [];
  const tails = [8, 6, 4]
    .filter((n) => digits.length > n)
    .map((n) => digits.slice(-n));
  return uniq([digits, ...tails]);
}

export function tokensForProfile(raw: unknown): string[] {
  const profile = (raw as { data?: { profile?: unknown } } | null | undefined)
    ?.data?.profile;
  if (!profile || typeof profile !== 'object') return [];
  const p = profile as { phone?: unknown; bank?: unknown };
  const bank =
    p.bank && typeof p.bank === 'object'
      ? (p.bank as { account_no?: unknown; account_name?: unknown })
      : {};
  return uniq([
    ...tokensForDigits(p.phone),
    ...tokensForDigits(bank.account_no),
    ...tokensForText(bank.account_name),
  ]);
}

function tokensForField(field: MemberSearchBucket, value: unknown): string[] {
  if (field === 'profile') return tokensForProfile(value);
  return DIGIT_FIELDS.has(field)
    ? tokensForDigits(value)
    : tokensForText(value);
}

const SOURCE_OF: Record<MemberSearchBucket, string> = {
  display_name: 'display_name',
  nickname: 'nickname',
  full_name: 'full_name',
  phone_number: 'phone_number',
  contract_code: 'contract_code',
  member_user_id: 'member_user_id',
  detail: 'detail',
  profile: 'raw_profile_data',
};

/** The save/validate door: every bucket from a whole document. */
export function searchBucketsForDoc(
  doc: Record<string, unknown>,
): Record<MemberSearchBucket, string[]> {
  const out = {} as Record<MemberSearchBucket, string[]>;
  for (const b of MEMBER_SEARCH_BUCKETS)
    out[b] = tokensForField(b, doc[SOURCE_OF[b]]);
  return out;
}

interface UpdateDoc {
  $set?: Record<string, unknown>;
  $setOnInsert?: Record<string, unknown>;
  $unset?: Record<string, unknown>;
}

/**
 * The update door: for each searchable source present in `$set` / `$setOnInsert`
 * / `$unset`, set that ONE bucket (dotted path, so sibling buckets survive);
 * a `$unset` of a source mirrors as `$unset` of its bucket.
 * An update touching no source field is left byte-identical.
 */
export function applySearchBucketsToUpdate(
  update: Record<string, unknown>,
): void {
  const u = update as UpdateDoc;
  for (const b of MEMBER_SEARCH_BUCKETS) {
    const src = SOURCE_OF[b];
    const key = `search.${b}`;
    if (u.$setOnInsert && src in u.$setOnInsert) {
      u.$setOnInsert[key] = tokensForField(b, u.$setOnInsert[src]);
    }
    if (u.$set && src in u.$set) {
      u.$set[key] = tokensForField(b, u.$set[src]);
    } else if (u.$unset && src in u.$unset) {
      // Mirror the $unset rather than $set-ing []: unsetting a path that does
      // not exist is a no-op for modifiedCount, so a caller that reports
      // "cleared" from modifiedCount (members.service.ts) stays truthful on a
      // row that never had the bucket. For search, no bucket == empty bucket.
      u.$unset[key] = '';
    }
  }
}
