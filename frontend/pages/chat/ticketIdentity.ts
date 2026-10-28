/* [FIX-20260814-TICKETIDENTITY] who a ticket belongs to, and what to call them
 * ===========================================================================
 * Moved verbatim out of `TicketChat.tsx` (which is on the max-lines waiver and
 * may not grow) so the rules below can be unit-tested directly — they were
 * module-private in a 4.5k-line component and had no coverage at all. Two live
 * bugs are fixed in the move; everything else is the original code.
 *
 * ── BUG 1 · the "Unknown" placeholder outranked the real name ──────────────
 * Owner, 14/08: a card read `Unknown (Line : phat25…)` when the customer's LINE
 * name is `phat2519`. `"Unknown"` is written by the BACKEND placeholder
 * (`chat-history.service.ts`), never chosen by a person, but it is a non-empty
 * string so it won the nickname slot. It is now skipped as absent, which lets
 * the real name move up — the PRIORITY ORDER itself is unchanged.
 *
 * ── BUG 2 · two different customers highlighted as one ────────────────────
 * Owner, 14/08: "การ์ด select active ค้างสองคน … มันต้องไม่ใช้ชื่อสิ".
 * `isSameTicketUser` fell back to comparing DISPLAY NAMES, so two customers
 * whose names happened to match — e.g. both rendered `"Unknown"` — were treated
 * as the same person. Selecting one highlighted both, and the same predicate
 * also drives tag sync and the bot bar, so a tag could land on the wrong row.
 * Identity now uses only values that are unique by construction: the LINE user
 * id, and the ticket's own `_id`. ชื่อไม่ใช่ตัวตน — ซ้ำกันได้ตามธรรมชาติ.
 *
 * Phone was dropped from the identity comparison for the same reason: it is
 * frequently empty (every customer in the live payload had `""`), and a shared
 * household number would merge two real people.
 *
 * revert: move these functions back into `TicketChat.tsx` and restore the
 *         name/phone branches in `isSameTicketUser` / `getTicketUserKey`.
 */

/** Minimal shape these rules read; tickets carry much more. */
export interface TicketLike {
  _id?: string;
  line_user_id?: string | null;
  line_user_data?: Record<string, unknown> | null;
}

export type IdField = { value: string; isLine: boolean };

/**
 * Placeholder names the backend writes when it has no profile yet — treated as
 * "no name". Kept in sync with `components/common/customerName.ts`, which
 * applies the same rule on the contact and chat screens.
 */
const PLACEHOLDER_NAMES = new Set(['unknown']);

const isPlaceholder = (value: string): boolean =>
  PLACEHOLDER_NAMES.has(value.toLowerCase());

/** `Member.detail` is one positional string: "name|phone|contract". */
export const parseTicketDetail = (
  raw?: string | null,
): { name: string; phone: string; contract: string } => {
  const parts = String(raw ?? '').split('|');
  return {
    name: parts[0] || '',
    phone: parts[1] || '',
    contract: parts[2] || '',
  };
};

/**
 * Ordered identity candidates, de-duplicated and blank-stripped.
 *
 * Priority (first non-empty wins), unchanged from the original:
 *   1. phone · 2. full_name · 3. nickname · 4. LINE display name · 5. LINE id
 *
 * ⚠️ A LINE display name always carries `isLine` so callers can prefix it with
 *    "Line :" — nobody should mistake it for a registered name. The label is
 *    not baked into the value because the value is also what gets copied.
 */
export function buildIdentityParts(
  ud: Record<string, any> | null | undefined,
  fallbackUserId?: string,
): IdField[] {
  const out: IdField[] = [];
  const push = (v: unknown, isLine = false) => {
    const s = v == null ? '' : String(v).trim();
    if (!s || s === '-' || s === 'null' || s === 'undefined') return;
    // [FIX-20260814-TICKETIDENTITY] BUG 1 — the backend placeholder is not a name
    if (isPlaceholder(s)) return;
    // The same string can arrive from two sources (e.g. full_name and
    // detail.name); showing it twice looks like a bug.
    if (out.some((o) => o.value === s)) return;
    out.push({ value: s, isLine });
  };

  if (ud) {
    const d = parseTicketDetail(ud.detail as string | null);
    push(ud.phone_number || d.phone); // 1
    push(ud.full_name || d.name); // 2
    push(ud.nickname); // 3
    push(ud.display_name, true); // 4 — always labelled "Line :"
  }
  // [FIX-20260730-LINEIDFB] the last resort must be the LINE user id, not the
  // Mongo _id: the backend sends `line_user_id` inside `line_user_data`, and the
  // outer field used to be an ObjectId, which surfaced as "tttdev (6a677…)".
  push((ud?.line_user_id as string) || fallbackUserId);

  return out;
}

/** Render one field, adding the "Line :" prefix when it is a LINE display name. */
export const labelIdField = (f?: IdField): string =>
  !f ? 'N/A' : f.isLine ? `Line : ${f.value}` : f.value;

/** `A (B)` — the ticket list card. Falls back to just `A`, then "N/A". */
export function formatIdentityPair(
  ud: Record<string, any> | null | undefined,
  fallbackUserId?: string,
): string {
  const p = buildIdentityParts(ud, fallbackUserId);
  if (p.length === 0) return 'N/A';
  if (p.length === 1) return labelIdField(p[0]);
  return `${labelIdField(p[0])} (${labelIdField(p[1])})`;
}

/**
 * `A (B)` for the LEFT CARD — same values, without the "Line :" prefix.
 *
 * [FIX-20260814-CARDNOLINE] Owner, 14/08: "เอาคำว่า line : ออกไป หน้า ticket
 * support panel ซ้าย". The card is a dense list where the prefix pushed the real
 * name out of view; the right panel and the pin menu keep it, because there the
 * label still earns its space by saying which kind of name is being shown.
 *
 * ⚠️ Deliberately a separate formatter rather than a flag on `labelIdField`:
 *    that helper feeds all three call sites, and a shared switch is exactly how
 *    one screen's preference leaks into another later. ตัดเฉพาะการ์ดซ้าย.
 *
 * revert: point the card back at `formatIdentityPair` and delete this function.
 */
export function formatIdentityCard(
  ud: Record<string, any> | null | undefined,
  fallbackUserId?: string,
): string {
  const p = buildIdentityParts(ud, fallbackUserId);
  if (p.length === 0) return 'N/A';
  if (p.length === 1) return p[0]!.value;
  return `${p[0]!.value} (${p[1]!.value})`;
}

/** Top line of the right panel: the highest-ranking identity, one value only. */
export function formatIdentityPanelHeader(
  ud: Record<string, any> | null | undefined,
  fallbackUserId?: string,
): string {
  const parts = buildIdentityParts(ud, fallbackUserId);
  return parts.length === 0 ? 'N/A' : labelIdField(parts[0]);
}

/** The LINE user id, from either place the payload carries it. */
const lineUserIdOf = (tk: TicketLike | null | undefined): string => {
  const raw =
    tk?.line_user_id ||
    (tk?.line_user_data?.['line_user_id'] as string | undefined);
  const s = String(raw ?? '').trim();
  return s && s !== 'undefined' && s !== 'null' ? s : '';
};

/**
 * A stable key for "all tickets of this one customer" — grouping, pinning and
 * the tab counters share it.
 *
 * [FIX-20260814-TICKETIDENTITY] BUG 2 — the phone and display-name fallbacks
 * were removed. A key built from a name merged strangers; the ticket `_id`
 * fallback keeps every row distinct when the LINE id is genuinely missing.
 */
export function getTicketUserKey(tk: TicketLike): string {
  const uid = lineUserIdOf(tk);
  return uid ? `uid_${uid}` : `id_${tk?._id ?? ''}`;
}

/**
 * Do these two tickets belong to the same customer?
 *
 * [FIX-20260814-TICKETIDENTITY] BUG 2 — identity by unique values only. Two
 * tickets match when they ARE the same ticket, or when they carry the same LINE
 * user id. Names and phone numbers are not identity.
 */
export function isSameTicketUser(
  tkA: TicketLike | null | undefined,
  tkB: TicketLike | null | undefined,
): boolean {
  if (!tkA || !tkB) return false;
  if (tkA._id && tkB._id && tkA._id === tkB._id) return true;

  const uA = lineUserIdOf(tkA);
  const uB = lineUserIdOf(tkB);
  return Boolean(uA) && uA === uB;
}

/* [FIX-20260815-CLOSEDTABUNKNOWN] the closed-ticket cards still said "Unknown"
 * ===========================================================================
 * Owner, 15/08: "แท็บปิดเคสมันยังมี Unknown อยู่ ให้แสดงเหมือนหน้าบอทดูแลเลย".
 *
 * Two different resolvers render the two tabs, and only ONE of them was fixed
 * on 14/08:
 *   · the bot-managed cards call `formatIdentityCard` (above) — placeholder
 *     already skipped, so they show the real LINE name
 *   · the closed / grouped cards called a private `getCustomerDisplayName`
 *     inside TicketChat.tsx, which had NO placeholder rule at all
 * Same customer, same data, two different names on screen.
 *
 * Moved here verbatim — same priority order, same fallbacks — with one change:
 * every candidate now passes through the SAME `isPlaceholder` test the rest of
 * this file uses. `"Unknown"` is written by the backend when a profile has not
 * synced yet (chat-history.service.ts); nobody chose it, so it must never beat
 * a real value or be printed as a name.
 *
 * ⚠️ Priority is deliberately DIFFERENT from `buildIdentityParts`: this one
 *    leads with phone, then nickname, then full name — the order the grouped
 *    cards have always used. Do not "unify" them without the owner's call;
 *    they answer different questions. ลำดับไม่เหมือนกันโดยตั้งใจ.
 *
 * revert: move this function back into TicketChat.tsx and drop the
 *         `keep()` wrapper so placeholders rank normally again.
 */
export function getCustomerDisplayName(
  ud: Record<string, any> | null | undefined,
  fallbackUserId?: string,
): string {
  const usableId = (v: unknown): string => {
    const s = String(v ?? '').trim();
    return s && s !== '-' && s !== 'null' && s !== 'undefined' ? s : '';
  };
  /** A candidate is only usable when it is neither blank nor a placeholder. */
  const keep = (v: unknown): string => {
    const s = String(v ?? '').trim();
    return s && !isPlaceholder(s) ? s : '';
  };

  if (!ud) return usableId(fallbackUserId) || '-';

  const detail = parseTicketDetail(ud.detail as string | null);

  return (
    keep(ud.phone_number) ||      // 1. phone
    keep(detail.phone) ||         // 2. phone from the positional detail string
    keep(ud.nickname) ||          // 3. nickname
    keep(ud.full_name) ||         // 4. full name
    keep(detail.name) ||          // 5. name from the detail string
    keep(ud.display_name) ||      // 6. the LINE profile name
    // 7. [FIX-20260730-LINEIDFB] the LINE id from `ud` first: some callers pass
    //    a ticket.line_user_id that the backend set to a Mongo _id.
    usableId(ud.line_user_id) ||
    usableId(fallbackUserId) ||
    '-'
  );
}
