/**
 * [FEAT-20260822-BCASTRAWREAD] Our own reader over what Mongo already stores.
 * ===========================================================================
 * A pure decision. No database call — the rows are handed in.
 *
 * เจ้าของ 22/08: "อ่านจาก raw profile data เป็นฟังก์ชั่นใหม่ของเราเอง" ·
 * "profile และ site rule เอาจาก db นะ ห้ามดึงสด".
 *
 * 🔑 WHY THIS IS NEW CODE RATHER THAN ANOTHER CLONE
 * The original reader (`extractFlexProfileFields`) is built for the COMBINED
 * API response — an object keyed by endpoint, whose blocks it searches for an
 * `is_profile` flag. What Mongo stores is a different shape entirely:
 *
 *   members.raw_profile_data      = { data: { profile: {…} }, success: true }
 *     ← written by `external-api.service.ts:1250`, which saves `profileResult.data`
 *   hooks.raw_site_rules_data     = { data: { shop:    {…} }, success: true }
 *     ← written by `custom-tool.service.ts:1446`
 *
 * Both verified against real rows on 2026-08-22. Feeding a stored blob to a
 * reader written for the API envelope happens to work by accident today, and
 * "works by accident" is the thing that breaks quietly later.
 * รูปที่เก็บใน DB คนละรูปกับที่ API คืน — ต้องมีตัวอ่านของตัวเอง.
 *
 * ⚠️ NOTHING HERE FETCHES. If a blob is missing, the answer is "no data", not
 *    "go and get it" — a background job must never call a customer's API.
 *
 * revert: delete this folder and its line in the barrel.
 */

/** One member's stored profile blob, plus how fresh it is. */
export interface StoredProfile {
  readonly raw: unknown;
  /** `profile_data_updated_at`. null = never fetched. */
  readonly fetchedAt: Date | null;
}

/** One OA's stored site-rules blob. */
export interface StoredSiteRules {
  readonly raw: unknown;
  /** `site_rules_updated_at`. null = never fetched. */
  readonly fetchedAt: Date | null;
}

/**
 * Pull the profile object out of a stored blob.
 *
 * Tolerant by design — the same customer data has arrived in three envelopes
 * over time and a reader that only knows one of them silently returns nothing.
 * Returns `null` when there is genuinely no profile, which the caller must
 * treat as "every profile tag is empty", never as an error.
 */
export function readProfileObject(
  stored: unknown,
): Record<string, unknown> | null {
  const blob = asObject(stored);
  if (!blob) return null;

  // The shape Mongo actually holds.
  const data = asObject(blob['data']);
  const fromData = asObject(data?.['profile']);
  if (fromData) return fromData;

  // A blob saved one envelope earlier, and a bare profile object.
  const nested = asObject(asObject(data?.['data'])?.['profile']);
  if (nested) return nested;
  const bare = asObject(blob['profile']);
  if (bare) return bare;

  // Last resort: a blob that IS the profile. Recognised by a field the spec
  // reads, so an unrelated object is not mistaken for one.
  if ('web_code' in blob || 'line_user_id' in blob) return blob;
  return null;
}

/**
 * How old is this data, in whole days? `null` when we do not know.
 *
 * ⚠️ Reported, never enforced here. The owner's rule is "เก่าก็เอา" — stale data
 * is still sent — so this exists to be written into the run's history row, not
 * to gate anything. บอกอายุ ไม่ใช่ห้ามส่ง.
 */
export function dataAgeDays(fetchedAt: Date | null, now: Date): number | null {
  if (!(fetchedAt instanceof Date) || Number.isNaN(fetchedAt.getTime()))
    return null;
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return null;
  const ms = now.getTime() - fetchedAt.getTime();
  return ms < 0 ? 0 : Math.floor(ms / 86_400_000);
}

/** Is there anything to build profile variables from? */
export function hasProfileData(stored: unknown): boolean {
  return readProfileObject(stored) !== null;
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}
