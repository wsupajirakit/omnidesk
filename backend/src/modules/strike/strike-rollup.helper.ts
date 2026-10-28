/**
 * [FEAT-20260826-STRIKEROLLUP] The arithmetic behind `GET :lineUserId/rollup`.
 * ===========================================================================
 * WHY THIS IS ITS OWN FILE. `strike.service.ts` crossed the repo's 400-line
 * warning the moment the rollup landed in it, and §6.1's rule is that the
 * waiver list may only ever SHRINK — so the answer is to split, never to add a
 * name to it. What moved out is the part with no database in it: given the
 * documents, produce the answer. The service keeps the queries.
 *
 * That split is worth more than the line count. These functions are pure, so
 * the folding rules below are provable without a model, a fake, or a promise —
 * and the rule that actually bites (`+=`, not overwrite) is one assertion away.
 *
 * revert: fold both functions back into `strike.service.ts` and delete this file.
 */

/** A session, reduced to the fields the fold reads. */
export interface RollupSessionRow {
  strike_total?: number;
  by_level?: Record<string, number>;
  first_strike_at?: Date;
  last_strike_at?: Date;
}

/**
 * How many sessions one rollup will fold before it admits it stopped.
 *
 * A person's session count rises only when an ADMIN CLEARS one — it does not
 * track how many strikes they earned — so real values are 1-5 and this ceiling
 * is never reached in ordinary use. It exists so a pathological row cannot turn
 * one HTTP read into an unbounded one.
 *
 * ⚠️ Reaching it does NOT silently truncate: the query asks for `CAP + 1`, and
 * getting more than CAP back sets `truncated: true` on the answer. A capped
 * number that does not say it was capped is simply a wrong number.
 * แก้ตัวเลขนี้ตัวเดียวพอถ้าจะขยับเพดาน — ไม่มีที่อื่นอ้างค่านี้
 */
export const ROLLUP_SESSION_CAP = 1000;

/**
 * Add up the sessions: one total, one merged per-level tally, and the outer
 * bounds of the whole record.
 *
 * ⚠️ THE MERGE IS `+=`, NEVER A SPREAD. Two sessions can hold the same level —
 * a customer blocked at level 1 before a clear and again at level 1 after it —
 * and `{...a, ...b}` would keep only the second, reading correct in every test
 * whose levels happen not to overlap. ระดับซ้ำต้องบวก ไม่ใช่ทับ
 *
 * `by_level` may be absent entirely (a session opened by a clear that has not
 * earned a strike yet), so every read of it is guarded rather than assumed.
 */
export function foldSessions(rows: RollupSessionRow[]): {
  total: number;
  by_level: Record<string, number>;
  first_strike_at?: Date;
  last_strike_at?: Date;
} {
  const by_level: Record<string, number> = {};
  let total = 0;
  let first: Date | undefined;
  let last: Date | undefined;

  for (const row of rows) {
    total += row.strike_total ?? 0;
    for (const [level, n] of Object.entries(row.by_level ?? {})) {
      by_level[level] = (by_level[level] ?? 0) + n;
    }
    if (row.first_strike_at && (!first || row.first_strike_at < first)) {
      first = row.first_strike_at;
    }
    if (row.last_strike_at && (!last || row.last_strike_at > last)) {
      last = row.last_strike_at;
    }
  }

  return {
    total,
    by_level,
    ...(first ? { first_strike_at: first } : {}),
    ...(last ? { last_strike_at: last } : {}),
  };
}

/** Turn `$group` rows keyed by level into the same `by_level` shape. */
export function foldLevelRows(rows: Array<{ _id: number; n: number }>): {
  total: number;
  by_level: Record<string, number>;
} {
  const by_level: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    by_level[String(r._id)] = r.n;
    total += r.n;
  }
  return { total, by_level };
}
