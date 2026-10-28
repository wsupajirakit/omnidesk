/**
 * [FEAT-2708-GUARDWINDOW] "stamp ต้องสดใน N ชั่วโมง" — the per-job guard window.
 * ===========================================================================
 * WHAT. A multicast job may carry `guard_window_hours` (int 1-72, optional).
 * When set, every rule on the THREE follow-up sources below stops meaning
 * "has ever been stamped" and starts meaning "stamped within the last N hours
 * counted back from the moment this send round starts":
 *
 *     follow_up.customer_helper_at   ได้รับการ์ดลงทะเบียน
 *     follow_up.notice_deposit_at    ติดตามฝาก
 *     follow_up.notice_withdraw_at   ติดตามถอน
 *
 * Owner, 27/08 (งาน 4.1): "force where ให้ stamp อยู่ในช่วง N ชม. ย้อนหลังจาก
 * เวลาเริ่มทำงานของ job เท่านั้น · เงื่อนไขเดิมคงครบ · ว่าง = ของเดิมทุกประการ".
 *
 * ⭐ WHY THE BOUND LIVES INSIDE EACH RULE'S OWN CLAUSE (todo9 §1.3 ทาง ก) and
 *    never on an outer `$and` like the two policies beside this file: the live
 *    DB holds real deposit+withdraw jobs with `match: 'or'`. An outer AND
 *    would demand BOTH stamps fresh, silently dropping people who qualify
 *    through one leg — breaking the one job shape the owner explicitly said
 *    must not break. Inside the clause, `$gte` only ever NARROWS that rule:
 *    OR keeps its meaning, AND keeps its meaning. ผูกต่อ-rule ไม่ใช่ชั้นนอก.
 *
 * ⭐ WHY RELATIVE TIME IS SAFE WHERE ABSOLUTE TIME WAS BANNED: the registry
 *    locked these keys to `has_value` ([UI-20260825-LOCKHASVALUE]) because the
 *    stamps are ROLLING — an admin-typed absolute date went stale and produced
 *    `refused-plan: empty` on real jobs. This window is computed from the send
 *    round's own start time on every round, so a repeat job asks a question
 *    that is fresh by construction. relative ต่อรอบส่ง = ไม่โดนกับดัก 25/08.
 *
 * 🔴 FAIL CLOSED. A guard the admin ordered that cannot be built (hours out of
 *    range, unreadable reference) REFUSES the whole job — silently dropping it
 *    would send to a WIDER list than intended, the exact failure this folder's
 *    other policies refuse the same way. It RETURNS, never throws — that is
 *    `audience-filter.ts`'s contract.
 *
 * 📌 CHANGING YOUR MIND — one edit here, `audience-filter.ts` never changes:
 *   · guard another source        → add its KEY to the array below
 *   · release one                 → remove it
 *   · widen/narrow the hour range → the two constants
 * The table holds SOURCE KEYS, never dotted Mongo paths — the path comes from
 * `audience-source.registry.ts` at build time, same doctrine and same reason
 * as `force-no-follow-up.policy.ts` (a path typed twice is checked by no one).
 *
 * 📖 Plan + evidence: todo/task/27082026/todo9_27082026_guard-window-adminname-quota.md §1
 * revert: delete this file + the [FEAT-2708-GUARDWINDOW] blocks in
 *         audience-filter.ts / new-send.service.ts / broadcasts-read.service.ts
 *         + the schema/DTO/ensure/copy/pick-list lines tagged the same.
 */
import { getAudienceSource } from './audience-source.registry';

/** The keys the window governs — the owner's list of three, exactly (Q4:
 *  `follow_up.notice_payment_at` is the fourth of the family and deliberately
 *  NOT here). Both FE (via the endpoint flag) and the filter read THIS set. */
export const GUARD_WINDOW_SOURCE_KEYS: readonly string[] = [
  'follow_up.customer_helper_at',
  'follow_up.notice_deposit_at',
  'follow_up.notice_withdraw_at',
];

export const GUARD_WINDOW_MIN_HOURS = 1;
export const GUARD_WINDOW_MAX_HOURS = 72;

export type GuardWindowResult =
  | { readonly ok: true; readonly bound: { readonly $gte: Date } | null }
  | { readonly ok: false; readonly reason: string };

/** Whole hours only (Q7) inside [1, 72] — 0 is forbidden by the owner. */
const validHours = (hours: unknown): hours is number =>
  typeof hours === 'number' &&
  Number.isInteger(hours) &&
  hours >= GUARD_WINDOW_MIN_HOURS &&
  hours <= GUARD_WINDOW_MAX_HOURS;

const asReference = (reference: unknown): Date | null => {
  const d =
    reference instanceof Date
      ? reference
      : typeof reference === 'string'
        ? new Date(reference)
        : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

/**
 * The `$gte` bound for one rule, or `bound: null` when the key is not governed
 * (the caller leaves that clause exactly as it was).
 *
 * `reference` is the send round's start instant — created ONCE per round in
 * `new-send.service.ts` and carried on the audience object, so the pager and
 * the per-OA recipient count can never disagree about "now".
 */
export function guardWindowBoundFor(
  key: string,
  hours: unknown,
  reference: unknown,
): GuardWindowResult {
  if (!GUARD_WINDOW_SOURCE_KEYS.includes(key)) return { ok: true, bound: null };
  /* Empty = the admin never ordered a guard — the plain query, byte for byte
     (same contract as `ensureValidGuardWindow`, which normalises these to
     null). Only a value that was ORDERED and cannot be built refuses below. */
  if (hours === undefined || hours === null || hours === '')
    return { ok: true, bound: null };
  /* The key is registry-resolved by the caller before this runs, but a policy
     that trusts its caller's ordering is one refactor away from a ghost key —
     same guard as the neighbour policy. */
  if (getAudienceSource(key) === null) {
    return {
      ok: false,
      reason:
        `the guarded condition "${key}" is not a known audience source — ` +
        'refusing rather than sending to a wider list than intended',
    };
  }
  if (!validHours(hours)) {
    return {
      ok: false,
      reason:
        `guard_window_hours must be a whole number of hours between ` +
        `${GUARD_WINDOW_MIN_HOURS} and ${GUARD_WINDOW_MAX_HOURS} — refusing ` +
        'rather than sending without the freshness the admin ordered',
    };
  }
  const ref = asReference(reference);
  if (!ref) {
    return {
      ok: false,
      reason:
        'the guard window has no readable start time for this round — ' +
        'refusing rather than sending without the freshness the admin ordered',
    };
  }
  return {
    ok: true,
    bound: { $gte: new Date(ref.getTime() - hours * 3_600_000) },
  };
}
