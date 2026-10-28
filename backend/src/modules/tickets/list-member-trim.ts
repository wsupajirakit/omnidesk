/**
 * [PERF-20260822-LISTMEMBERTRIM] Drop from a LIST row the member columns that
 * nothing on the list reads.
 * ============================================================================
 * SIBLING OF `list-profile-trim.ts`, one layer up. That file trims the heavy
 * keys INSIDE `raw_profile_data`; this one trims columns of the member document
 * itself. Same call site, same rule, same revert shape — kept as a separate
 * file because they answer to different readers and revert independently.
 *
 * WHERE THE WEIGHT IS. `formatTicket` ships the member document WHOLE as
 * `line_user_data`, and a customer with several open cases pays for it once per
 * case. Measured on a clone (409 active tickets, 412 rooms): `line_user_data`
 * is 172,925 of 419,029 bytes (41.3%), and the eight columns below are 58,334
 * of those — 33.7% of the member, 13.9% of the whole response.
 *
 * WHO READS THE MEMBER OFF A LIST ROW — every consumer traced in the dashboard
 * before a single name was added here:
 *   · `utils/memberSearchText.ts:119-138`  the client-side search haystack —
 *      phone_number, display_name, nickname, full_name, contract_code, detail,
 *      line_user_id, channel_user_id, and three raw-profile paths
 *   · `utils/memberTier.ts:60`             the tier badge, `tier` with a
 *      raw_profile fallback — LOOKS redundant, is not
 *   · `components/member/PersonalPanel.tsx` reads `ud.detail`, `ud.full_name`,
 *      `ud.phone_number`, `ud.display_name`, `ud.line_user_id`, `._id` — and it
 *      receives the LIST ROW directly (`TicketChat.tsx:3488`), not its own
 *      fetch, so anything it reads must survive
 *   · `ignore_abandon_assist` travels a PROP CHAIN (`TicketChat.tsx:4705` →
 *      `:4783` → `ignoreAbandonService.ts:45`) and a plain grep does NOT find it
 *   · the green avatar ring asks only "does the profile have ANY key"
 *
 * The eight below appear in the dashboard only as TYPE DECLARATIONS
 * (`types/common.ts`, `services/chat/chatService.ts`) or on a different API —
 * every `member_user_id` hit is a handoff page reading `HandoffChainRun`, never
 * `line_user_data`. Verified 2026-08-22 against `origin/dev`.
 *
 * ⚠️ DENY-LIST, NOT ALLOW-LIST — the same reason `list-profile-trim.ts` gives.
 * Keeping named columns would silently drop any column nobody has thought of
 * yet, including one a future screen starts reading. Removing named columns
 * cannot: everything else survives untouched.
 * ตัดตามชื่อ ไม่ใช่เก็บตามชื่อ.
 *
 * ⚠️ LIST PATH ONLY. `getTicketById`, `updateTicket` and the raw-profile route
 * do not pass through here and still return the member whole.
 *
 * ⚠️ Pure and non-mutating: the caller hands over a lean document that other
 * code may still hold a reference to.
 *
 * BEHAVIOUR: the response loses eight keys nothing reads. Nothing else moves —
 * no row is added or removed, so realtime patching and the badge counts (which
 * count ROWS in memory, `TicketChat.tsx:1966`) are untouched. The ticket search
 * runs in the DATABASE, before this function exists, so it is unaffected too.
 *
 * revert: delete this file and its single call in `enrichTicketRows`.
 */

/**
 * Columns no list consumer reads.
 *
 * `member_user_id` is the one that looks dangerous and is not: the BE ticket
 * search does query it (`member-search.util.ts:43`), but that happens in the
 * DATABASE against the stored document — this only shapes the RESPONSE.
 */
export const UNREAD_MEMBER_KEYS = [
  'member_user_id',
  'status_message',
  'last_synced_at',
  'profile_data_updated_at',
  'config',
  'created_at',
  'updated_at',
  '__v',
] as const;

/**
 * Columns that MUST survive, with the reader that proves it. This list exists
 * so a spec can assert it; it is deliberately NOT used to filter anything —
 * see the deny-list warning above.
 */
export const READ_MEMBER_KEYS = [
  '_id', // PersonalPanel memberId, raw-profile fetch
  'line_user_id', // search haystack, PersonalPanel
  'channel_user_id', // search haystack
  'display_name', // card, search haystack
  'nickname', // card, search haystack
  'picture_url', // avatar
  'phone_number', // card, search haystack
  'contract_code', // search haystack
  'full_name', // card, search haystack
  'detail', // PersonalPanel form, search haystack
  'tier', // memberTier.ts:60 — fallback, not redundant
  'raw_profile_data', // tier fallback, search paths, green ring
  'link_registered_by', // link provenance on the card
  'link_registered_at',
  'ignore_abandon_assist', // prop chain — grep does not find it
] as const;

/**
 * [PERF-20260826-TKTPOPTRIM] 📖 docs/bottleneck_26_aug.md (S2)
 * The SAME deny-list, pushed down into the list's `chat_user_id` populate so
 * the eight columns stop crossing the Mongo→BE wire at all (they were fetched
 * whole, then deleted right here on every row). Derived from
 * `UNREAD_MEMBER_KEYS` — one source, no second list to drift.
 *
 * ⚠️ Exclusion-only by construction ('-col ...'): a single inclusion term
 * would flip Mongo into whitelist mode and every unlisted column would vanish
 * — the exact trap the deny-list decision above exists to prevent.
 * ⚠️ `HEAVY_PROFILE_KEYS` must NEVER join this projection: `trimListProfile`'s
 * `_trimmed` marker needs to SEE a profile that had only heavy keys to keep
 * the green ring lit; a DB-level cut would hand it `{}` and the ring would go
 * out silently. Pinned by ticket-list-populate-trim.spec.ts.
 * `trimListMember` stays in place as the net — it becomes a no-op for these.
 * revert: drop the second populate argument in listTickets; this constant
 * then has no caller.
 */
export const LIST_MEMBER_POPULATE_EXCLUSION = (
  UNREAD_MEMBER_KEYS as readonly string[]
)
  .map((k) => `-${k}`)
  .join(' ');

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Return a copy of a member document with the unread columns removed.
 * Anything that is not a plain object comes back untouched.
 */
export function trimListMember(member: unknown): unknown {
  if (!isPlainObject(member)) return member;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(member)) {
    if (!(UNREAD_MEMBER_KEYS as readonly string[]).includes(k)) out[k] = v;
  }
  return out;
}
