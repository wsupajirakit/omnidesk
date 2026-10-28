/**
 * [FEAT-20260822-NOTICERUNTIME] The per-member notice cooldown.
 * ===========================================================================
 * Without it, a customer typing "ฝาก" five times inside the window gets five
 * identical cards. The last-sent stamp lives in the member's config bag
 * (notice.keys.ts) and MOVES on every notice — which is why the writer is
 * `writeMemberConfig`, never `writeMemberConfigOnce`.
 *
 * Owner's requirements, 22/08 (verbatim intent): the cooldown must be
 * switchable ON/OFF by a value in code, and the duration must be editable —
 * both live below, and NOTHING else knows the numbers.
 *   · the enabled flag = false → every qualifying hit fires a card. ⚠️ 22/08:
 *     the LIVE flag moved to `notice-policy.ts` as NOTICE_COOLDOWN_ENABLED and
 *     ships `false`; what stays here is NOTICE_COOLDOWN_DEFAULT_ENABLED, the
 *     answer this function gives a caller that passes no override.
 *   · NOTICE_COOLDOWN_MINUTES          → the window between cards per member,
 *                                        per stamp key (deposit / withdraw /
 *                                        payment are independent stamps)
 *
 * Collision check done 22/08 before writing this (owner: "ชนกับระบบใช่ไหม
 * ยืนยันก่อน"): the existing cooldowns are other subsystems (panel refresh
 * guard 10s, handoff cooldown_sec, external circuit-breakers) and the rate
 * ladder counts message volume — none share state or names with this. Reads
 * and writes here address one config leaf, which cannot touch another
 * feature's key (member-config.registry.ts's one-leaf proof).
 *
 * All comparisons are UTC instant maths — see the TIME NOTE in notice.keys.ts.
 * Pure — the caller passes both the stamp and `now`; nothing here has a clock.
 * revert: delete this file with the rest of `notice-runtime/`.
 */

/**
 * The module's own default, kept for its tests and for a direct caller.
 * ⚠️ THE LIVE SWITCH IS `NOTICE_COOLDOWN_ENABLED` in `notice-policy.ts`, which
 * ships `false` (owner removed the cooldown on 22/08). The guard passes that
 * policy value in explicitly, so this constant does not decide anything in
 * production — it only says what this function does when nobody overrides it.
 * สวิตช์จริงอยู่ที่ notice-policy.ts.
 */
export const NOTICE_COOLDOWN_DEFAULT_ENABLED = true;

/** Minutes a member waits between two cards of the same stamp. แก้ที่นี่ที่เดียว. */
export const NOTICE_COOLDOWN_MINUTES = 30;

/**
 * true = the cooldown BLOCKS this notice (a valid stamp is younger than the
 * window). Anything that is not a real past Date — absent, null, a legacy
 * string, a clock-skewed future value — does NOT block: fail-open, the card
 * is allowed rather than silently starved by bad data.
 */
export function noticeCooldownBlocks(
  lastAt: unknown,
  now: Date,
  opts: { enabled?: boolean; minutes?: number } = {},
): boolean {
  const enabled = opts.enabled ?? NOTICE_COOLDOWN_DEFAULT_ENABLED;
  if (!enabled) return false;
  const minutes = opts.minutes ?? NOTICE_COOLDOWN_MINUTES;

  if (!(lastAt instanceof Date) || !Number.isFinite(lastAt.getTime())) {
    return false;
  }
  const ageMs = now.getTime() - lastAt.getTime();
  if (ageMs < 0) return false; // future stamp = corrupt, never starve the card
  return ageMs < minutes * 60 * 1000;
}
