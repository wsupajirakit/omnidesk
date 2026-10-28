/**
 * [FIX-20260829-ORANGENEEDSCOUNT] should this group wear the orange "new" mark?
 * ===========================================================================
 * Owner 29/08: when the number reads 0 the orange must stop by itself.
 *
 * 🔴 Two questions, and BOTH have to answer yes:
 *      hasNew — something landed here since the admin last looked (the flag)
 *      count  — there is still something here to look at (the number on screen)
 *    The flag alone was the old rule. It is cleared when the group is opened or
 *    when no unread remains, but nothing clears it when the count itself drops
 *    to 0 (case closed, or moved elsewhere) — so the badge read 0 while the ring
 *    kept pulsing. Asking the number too closes that gap without touching when
 *    the flag is raised or cleared.
 *
 * 🔴 The count alone must NEVER light it. The orange means "new since you last
 *    looked", not "has open work" — drop the flag from the condition and every
 *    busy group glows permanently, which is worse than the bug being fixed.
 *
 * ⚠️ A pure function on purpose. The three paint sites in `TicketChat.tsx` are
 *    deep inside a 6,000-line component; a shared helper is what lets the rule be
 *    tested at all, and what stops the three drifting apart later.
 *
 * revert: inline `hasNew` back at the three call sites and delete this file.
 */

/** `true` only when something new arrived AND there is still something to show. */
export function showsNewGlow(hasNew: boolean, count: unknown): boolean {
  if (!hasNew) return false;
  const n = typeof count === 'number' ? count : Number.NaN;
  /* Not `> 0` on a raw value: `undefined`/`null`/NaN must read as "nothing to
     show", and a negative is data we do not trust either way. */
  return Number.isFinite(n) && n > 0;
}
