/**
 * [PERF-20260820-LISTPROFILE] Drop from a LIST row the parts of a customer
 * profile that nothing on the list reads.
 * ============================================================================
 * Owner, 2026-08-20, on a 2.7 MB ticket-list response: "limit=all คืน 2.7 MB ต่อ
 * request … โตขึ้นเรื่อย ๆ ตามข้อมูล".
 *
 * WHERE THE WEIGHT IS. `formatTicket` ships the member document WHOLE as
 * `line_user_data` — deliberately, so the list can render a customer without a
 * second call. Measured on a real row: `raw_profile_data` is ~83% of that member,
 * and five keys inside it are ~97% of the profile:
 *     promotion 2039 · finance 954 · bonus 370 · activity 313 · transaction 159
 *     ── against bank 63 · tier 43 · phone 12, which are what the list uses.
 * A response of 2.7 MB is about 1,168 rows carrying that five times over.
 *
 * WHO READS THE PROFILE OFF A LIST ROW — verified across the dashboard, and it
 * is only these three:
 *   · the tier badge         → `profile.tier`
 *   · the client-side search → `profile.phone`, `bank.account_no`, `bank.account_name`
 *   · the green avatar ring  → "does the profile have ANY key at all"
 * `PersonalPanel` DOES read the five heavy keys — but from its own
 * `getRawProfile(memberId)` call, never from the row, so it is unaffected. The
 * single-ticket endpoints and the raw-profile route do not go through here.
 *
 * ⚠️ DENY-LIST, NOT ALLOW-LIST, AND THAT IS THE DESIGN. The green ring is
 * `Object.keys(profile).length > 0`. Keeping only the four leaves that are read
 * would empty the profile of any customer carrying none of them and put their
 * ring out with no error anywhere. Removing five NAMED keys cannot: everything
 * else survives untouched, including keys nobody has thought of yet.
 * ตัดตามชื่อ ไม่ใช่เก็บตามชื่อ · เก็บตามชื่อทำกรอบเขียวหายได้เงียบ ๆ.
 *
 * ⚠️ Pure and non-mutating: the caller hands over a lean document that other code
 * may still hold a reference to.
 *
 * revert: delete this file and its single call in `enrichTicketRows`.
 */

/** Read by `PersonalPanel` through its own fetch — never off a list row. */
export const HEAVY_PROFILE_KEYS = [
  'promotion',
  'finance',
  'bonus',
  'activity',
  'transaction',
] as const;

/**
 * Marker left behind when a profile consisted ONLY of heavy keys, so
 * `hasRawProfile` still answers "this customer is known".
 * It is never added to a profile that was already empty — no profile must stay
 * no profile. ไม่มีโปรไฟล์อยู่แล้ว ห้ามเสกให้มี.
 */
const TRIMMED_MARKER = '_trimmed';

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Strip the heavy keys from one profile object, preserving "is it non-empty". */
function trimProfile(
  profile: Record<string, unknown>,
): Record<string, unknown> {
  const hadKeys = Object.keys(profile).length > 0;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(profile)) {
    if (!(HEAVY_PROFILE_KEYS as readonly string[]).includes(k)) out[k] = v;
  }
  if (hadKeys && Object.keys(out).length === 0) out[TRIMMED_MARKER] = true;
  return out;
}

/**
 * Return a copy of `raw_profile_data` with the heavy keys removed, whichever of
 * the three shapes it arrives in (`data.profile`, `profile`, or the profile keys
 * at the root). Anything that is not an object comes back untouched.
 */
export function trimListProfile(raw: unknown): unknown {
  if (!isPlainObject(raw)) return raw;

  const data = raw['data'];
  if (isPlainObject(data) && isPlainObject(data['profile'])) {
    return {
      ...raw,
      data: { ...data, profile: trimProfile(data['profile']) },
    };
  }
  if (isPlainObject(raw['profile'])) {
    return { ...raw, profile: trimProfile(raw['profile']) };
  }
  return trimProfile(raw);
}
