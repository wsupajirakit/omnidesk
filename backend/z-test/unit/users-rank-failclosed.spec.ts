/**
 * [FIX-20260818-RANKFAILCLOSED] plan §7.2 = C4 = T3-4 of fix_plan_18_aug · closes C1
 *
 * ## The hole
 * `ensureAllowedByRank` opened with `if (requesterRank <= 0) return true;` — a
 * caller whose role does not appear in `ROLE_RANKS` (or who has no role at all)
 * resolved to rank 0 and was therefore allowed to act on **anyone**, superadmins
 * included. The guard that exists to stop a lower rank touching a higher one
 * handed full authority to the one caller it could not rank.
 *
 * `getRequesterRank` returns 0 in two ways, and both reach that line: no `roleId`
 * on the claim, and a role whose name is outside the table (any custom role).
 *
 * ## Scope of the fix — requester side only, deliberately
 * The TARGET side (`targetRank <= requesterRank`, where an unknown target also
 * ranks 0) is left alone. An unranked target holds no privilege to protect, and
 * refusing it would block assigning a custom role to a user — a real flow, broken
 * for no security gain. The escalation is entirely on the requester side.
 *
 * ## Effect on real data at the time of the change
 * All 11 accounts in `local_db_10_aug_26_p2` hold a ranked role
 * (superadmin ×3 · admin ×1 · assist_admin ×7), so **no live account changes
 * behaviour**. That is what makes this the cheapest moment to close it.
 *
 * ⚠️ THE TRADE, stated so nobody discovers it during an incident: after this
 * change, renaming the `superadmin` role — or deleting a role document out from
 * under its users — turns those accounts into rank 0 and LOCKS THEM OUT of user
 * management instead of granting them everything. Fail-closed is the correct
 * direction, but it means role names are now load-bearing. ชื่อ role กลายเป็นของสำคัญ
 */
import { UsersAccessService } from '@/modules/admin';

/** The service's rank logic is pure; nothing here needs Nest or Mongo. */
const access = Object.create(
  UsersAccessService.prototype,
) as UsersAccessService;

describe('[RANKFAILCLOSED] ensureAllowedByRank — known ranks behave exactly as before', () => {
  // BEFORE cases: these must pass on the unchanged code and must not move.
  it('admin (2) may act on an operator (1)', () => {
    expect(access.ensureAllowedByRank(2, 'operator')).toBe(true);
  });

  it('admin (2) may not act on a superadmin (3)', () => {
    expect(access.ensureAllowedByRank(2, 'superadmin')).toBe(false);
  });

  it('superadmin (3) may act on a superadmin (3) — equal rank passes', () => {
    expect(access.ensureAllowedByRank(3, 'superadmin')).toBe(true);
  });

  it('assist_admin (1.5) may act on an operator (1) but not an admin (2)', () => {
    expect(access.ensureAllowedByRank(1.5, 'operator')).toBe(true);
    expect(access.ensureAllowedByRank(1.5, 'admin')).toBe(false);
  });

  it('an UNRANKED target is still allowed — deliberately unchanged', () => {
    // Assigning a custom role must keep working; an unranked target holds no
    // privilege that this guard exists to protect.
    expect(access.ensureAllowedByRank(2, 'some_custom_role')).toBe(true);
    expect(access.ensureAllowedByRank(2, undefined)).toBe(true);
  });
});

describe('[RANKFAILCLOSED] an unrankable REQUESTER must be refused, not trusted', () => {
  it('⭐ rank 0 requester may not act on a superadmin', () => {
    expect(access.ensureAllowedByRank(0, 'superadmin')).toBe(false);
  });

  it('⭐ rank 0 requester may not act on an admin', () => {
    expect(access.ensureAllowedByRank(0, 'admin')).toBe(false);
  });

  it('⭐ rank 0 requester may not act even on an unranked target', () => {
    // Nothing about being unrankable should confer authority over anyone.
    expect(access.ensureAllowedByRank(0, 'some_custom_role')).toBe(false);
  });

  it('a negative rank (defensive) is refused the same way', () => {
    expect(access.ensureAllowedByRank(-1, 'operator')).toBe(false);
  });
});

describe('[RANKFAILCLOSED] getRoleRank still maps the four known roles', () => {
  it.each([
    ['superadmin', 3],
    ['admin', 2],
    ['assist_admin', 1.5],
    ['operator', 1],
  ])('%s → %s', (name, rank) => {
    expect(access.getRoleRank(name)).toBe(rank);
  });

  it('an unknown or missing role name ranks 0', () => {
    expect(access.getRoleRank('nope')).toBe(0);
    expect(access.getRoleRank(undefined)).toBe(0);
  });
});
