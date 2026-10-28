/**
 * [FIX-20260828-FORCEPERLEG] A forced condition belongs to the RULE that asked
 * for it — not to the whole job.
 * ===========================================================================
 * Owner, 28/08, from a campaign that reached nobody:
 *   "deposit OR withdraw must NOT carry the raw-profile rule,
 *    but the register card MUST carry it."
 *
 * What actually happened (job `demo`, OA `omnideskdevoathree`, run 16:59):
 *   rules = notice_deposit_at has_value OR notice_withdraw_at has_value
 *           OR customer_helper_at has_value
 *   The third rule is a FORCE_NO_PROFILE key, and the forced
 *   `raw_profile_data: null` was ANDed at the OUTERMOST level, so it silenced
 *   the deposit and withdraw legs too. Measured against the live data at the
 *   time: 6 members matched the rules and 3 had a room on that OA, but the
 *   outer clauses cut it to 0 — the history row read
 *   `this OA was skipped: empty`.
 *
 * The rule these cases pin, both halves of it:
 *   ① the triggering leg still carries every forced condition (a linked member
 *     can never be reached by a register-chasing rule), and
 *   ② no other leg is constrained by it.
 *
 * 🔴 And the danger the ORIGINAL design was protecting against is pinned too:
 *   a forced condition must never become a SEPARATE MEMBER of the `$or`, which
 *   would read "or is not linked" and let exactly the wrong people in. Merging
 *   into the triggering leg's own object is an AND for that leg, not an escape
 *   hatch. บังคับเฉพาะขาที่ขอ · แต่ห้ามกลายเป็นทางเลือกใน $or เด็ดขาด
 */
import { buildAudienceFilter } from '../../src/modules/content/audience';

const DEPOSIT = 'follow_up.notice_deposit_at';
const WITHDRAW = 'follow_up.notice_withdraw_at';
const CARD = 'follow_up.customer_helper_at';

const DEPOSIT_PATH = 'config.follow_up.line.notice_deposit_at';
const WITHDRAW_PATH = 'config.follow_up.line.notice_withdraw_at';
const CARD_PATH = 'config.follow_up.line.customer_helper_trigger_at';
const ABANDON_PATH = 'config.follow_up.line.abandon_trigger_at';
const REQUEST_REG_PATH = 'config.follow_up.line.request_reg_at';

/** The exact audience of the job that failed. */
const realJob = () =>
  buildAudienceFilter({
    match: 'or',
    rules: [
      { key: DEPOSIT, op: 'has_value' },
      { key: WITHDRAW, op: 'has_value' },
      { key: CARD, op: 'has_value' },
    ],
  } as never);

describe('[FORCEPERLEG] the job the owner actually ran', () => {
  it('⭐⭐⭐ deposit and withdraw legs carry NO forced condition', () => {
    const r = realJob();
    expect(r.ok).toBe(true);
    const or = r.ok ? (r.filter as { $or: Record<string, unknown>[] }).$or : [];
    expect(or).toHaveLength(3);

    /* This is the bug, stated as an assertion: before the fix these two legs
       were silenced by a condition belonging to a rule about registration. */
    expect(or[0]).toEqual({ [DEPOSIT_PATH]: { $ne: null } });
    expect(or[1]).toEqual({ [WITHDRAW_PATH]: { $ne: null } });
  });

  it('⭐⭐⭐ the register-card leg still carries every forced condition', () => {
    const r = realJob();
    const or = r.ok ? (r.filter as { $or: Record<string, unknown>[] }).$or : [];
    /* Loosening this leg would be the opposite failure: a campaign chasing
       people to register reaching people who already did. */
    expect(or[2]).toEqual({
      [CARD_PATH]: { $ne: null },
      raw_profile_data: null,
      [ABANDON_PATH]: null,
      [REQUEST_REG_PATH]: null,
    });
  });

  it('⭐⭐ a forced condition is never a standalone member of the $or', () => {
    const r = realJob();
    const or = r.ok ? (r.filter as { $or: Record<string, unknown>[] }).$or : [];
    const FORCED = [ABANDON_PATH, REQUEST_REG_PATH, 'raw_profile_data'];
    for (const leg of or) {
      const keys = Object.keys(leg);
      expect(keys.length).toBeGreaterThan(0);
      expect(keys.every((k) => FORCED.includes(k))).toBe(false);
    }
  });

  it('⭐ match:"and" is unaffected — per-leg and outer placement select the same members', () => {
    /* Every leg is ANDed anyway, so this is a no-op by construction. Pinned so
       that a future change to placement cannot quietly alter the `and` case. */
    const r = buildAudienceFilter({
      match: 'and',
      rules: [
        { key: DEPOSIT, op: 'has_value' },
        { key: CARD, op: 'has_value' },
      ],
    } as never);
    expect(r.ok).toBe(true);
    const and = r.ok
      ? (r.filter as { $and: Record<string, unknown>[] }).$and
      : [];
    expect(and).toEqual([
      { [DEPOSIT_PATH]: { $ne: null } },
      {
        [CARD_PATH]: { $ne: null },
        raw_profile_data: null,
        [ABANDON_PATH]: null,
        [REQUEST_REG_PATH]: null,
      },
    ]);
  });
});
