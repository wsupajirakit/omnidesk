/**
 * [FEAT-20260822-BCASTSCHED] "Who has to run right now?" and "whose run died?"
 * ===========================================================================
 * A pure decision. It builds query SHAPES; the caller runs them — the same
 * contract `broadcast-send/claim.ts` uses, and for the same reason: the hard
 * part is getting the filter exactly right, and a filter you can hold in your
 * hand is a filter you can test without Mongo.
 *
 * NOTHING HERE RUNS BY ITSELF. No timer, no @Injectable, no clock: `now` is
 * always an argument. `BROADCAST_SCHEDULER_ENABLED` is false, so every entry
 * point below answers `null` today. ยังไม่ต่อเข้าระบบ — ตั้งใจ.
 *
 * ═══ 🔴 THE INDEX — READ BEFORE TURNING THE SWITCH ON ═══════════════════════
 * แผน §11b.5 measured this exact query on MongoDB 7.0.37 (200,000 rows, 50,000
 * `scheduled`):
 *
 *   no index at all ......................  73 ms · 200,000 docs read · COLLSCAN
 *   `{status:1, created_at:-1}` (exists) ..  34 ms ·  50,000 docs read · SORT←FETCH←IXSCAN
 *   `broadcast_due` partial ...............   1 ms ·      50 docs read · LIMIT←FETCH←IXSCAN
 *   `broadcast_due`, EMPTY round ..........   0 ms ·       0 keys read
 *
 * 🔴 `broadcast_due` DOES NOT EXIST in `broadcast.schema.ts` today. The three
 * indexes that do (`:167-169`) plus `broadcast_claim` (`:184`) are listed below,
 * and NONE of them has a send-time date as a key. So today this query would be
 * served by `{status:1, created_at:-1}`: an IXSCAN bounded to `scheduled` rows —
 * not a table scan, but it FETCHes every one of them and SORTs in memory, which
 * is the 34 ms row above, once a minute, 1,440 times a day, to return nothing.
 *
 * ⇒ THE "an empty scan costs ~0 ms" GUARANTEE IS NOT TRUE UNTIL THE INDEX EXISTS.
 * ⇒ That is one of the reasons the kill switch ships OFF. Adding the index is a
 *   schema change and needs the owner's approval — it is not this folder's to
 *   make. The shape below is written so that the moment it lands the query is
 *   served with no SORT stage: equality on `status`, range + sort on the date
 *   key (ESR — Equality, Sort, Range).
 *
 * The index this query is SERVED BY (added 22/08, verified 23/08):
 *   { status: 1, next_run_at: 1 }  name: 'broadcast_due'
 *   partialFilterExpression: { status: 'scheduled' }
 *   · `status` first — equality
 *   · the date second — it is BOTH the `$lte` range AND the sort, so one index
 *     serves both and the plan disappears
 *   · partial — 462 KB at 50,000 rows vs 970 KB for `{status:1,created_at:-1}`
 *   ⚠️ CORRECTED 23/08. This block used to describe a partial set of
 *     `{ $in: ['scheduled','sending'] }` so the SWEEP could share this index.
 *     The schema took the other route: the sweep has its OWN `broadcast_claim`
 *     index, `{status:1, lease_until:1}` partial on `'sending'`, which matches
 *     `buildStaleClaimFilter` exactly. Two tight indexes rather than one wide
 *     one — and a reader who trusted this paragraph would have "fixed" the
 *     partial filter, forcing a drop-and-rebuild for no gain.
 *     สองตัวแคบ ๆ ไม่ใช่ตัวเดียวกว้าง ๆ — คอมเมนต์เดิมชี้ผิดทาง.
 *   · ⚠️ `deleted_at: {$exists:false}` CANNOT go in the index definition —
 *     tested on this machine: "Expression not supported in partial index: $not".
 *     It stays a residual filter in the query, which is where it is below.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * revert: delete this file with the rest of `broadcast-schedule/`.
 */
import { CLAIMED_STATE, buildStaleClaimFilter } from '../broadcast-send/claim';
import { BROADCAST_SCHEDULER_ENABLED, DUE_SCAN_LIMIT } from './schedule-limits';
import {
  CLAIMED_AT_FIELD,
  CLAIMED_BY_FIELD,
  DELETED_AT_FIELD,
  DUE_AT_FIELD,
  DUE_STATUS,
  SEND_KIND_FIELD,
  LEASE_UNTIL_FIELD,
  STATUS_FIELD,
  readDate,
  type BroadcastScheduleRow,
} from './schedule-shape';

/** A job whose run died is put back here so the next scan can take it again. */
export const SWEEP_RECOVER_STATUS = DUE_STATUS;

/**
 * ...unless it has no next round, in which case it ends here.
 *
 * `'failed'` is in the enum (`broadcast.schema.ts:105`) and is the truth: the
 * process holding it died mid-send. Re-arming it as `scheduled` would be worse
 * than useless — see the re-fire trap on `buildStaleRunSweep`.
 */
export const SWEEP_DEAD_STATUS = 'failed';

export interface DueScanQuery {
  readonly filter: Record<string, unknown>;
  /** Latest-overdue first, and FREE — it is the index's second key. */
  readonly sort: Record<string, 1 | -1>;
  readonly limit: number;
  /**
   * §11b.5.6 rule 5. `message.flex_json` is `Mixed` and holds tens of KB of
   * flex JSON per row; dragging 50 of those across the network 1,440 times a
   * day to read one date is pure waste. The runner loads the full document only
   * for the job it actually claimed.
   */
  readonly projection: Record<string, 1>;
}

export interface SweepQuery {
  readonly filter: Record<string, unknown>;
  readonly update: {
    readonly $set: Record<string, unknown>;
    readonly $unset: Record<string, ''>;
  };
  readonly sort: Record<string, 1 | -1>;
  readonly limit: number;
}

/**
 * Which jobs are ready to run at `now`?
 *
 * `null` = do not ask the database at all. That is the kill switch, and it is
 * the ONLY answer today.
 *
 * ⚠️ A LIVE LEASE IS EXCLUDED BY THE STATUS, NOT BY A DATE CLAUSE.
 * `buildClaimQuery` takes a job by flipping `scheduled` → `sending` atomically,
 * so a job somebody is holding is not in `scheduled` any more and cannot match
 * the equality below. It is worth spelling out why NOT to "also check the
 * lease" here, because it looks like belt-and-braces and is in fact a bug:
 *   · `lease_until: {$exists:false}` — a MISSING field never matches a date
 *     comparison, the trap `handoff-job.schema.ts:191-198` records word for
 *     word and `broadcast.schema.ts:131-140` repeats. Every normal scheduled
 *     job has no lease column at all, so adding a date clause on it would make
 *     the whole scan return nothing, forever, silently.
 *   · and it would put a third key in the filter that the index does not carry.
 * ⇒ one status equality does the job that a lease clause would break.
 * ด่านคือ status ไม่ใช่วันที่ของ lease.
 *
 * ⚠️ `deleted_at` is filtered here and not in the index, because
 * `deleteBroadcast` soft-deletes WITHOUT touching `status` — a scheduled job
 * that was deleted stays claimable forever otherwise. Same clause, same reason,
 * as `claim.ts:70`.
 */
export function buildDueScanQuery(
  now: Date,
  limit: number = DUE_SCAN_LIMIT,
  enabled: boolean = BROADCAST_SCHEDULER_ENABLED,
): DueScanQuery | null {
  if (!enabled) return null;
  if (readDate(now) === null) return null;

  const take = Number.isInteger(limit) && limit > 0 ? limit : DUE_SCAN_LIMIT;

  return {
    filter: {
      [STATUS_FIELD]: DUE_STATUS,
      [DUE_AT_FIELD]: { $lte: now },
      [DELETED_AT_FIELD]: { $exists: false },
    },
    sort: { [DUE_AT_FIELD]: 1 },
    limit: take,
    /* [FIX-20260823-BCASTSCANKIND] `send_kind` rides along: the runner refuses
       a job without it, so leaving it out of the projection refused EVERY job
       — measured against the real scheduler on 23/08. Still three small
       columns plus one short string; the body this projection exists to keep
       out is untouched. ต้อง project มาด้วย ไม่งั้นถูกปฏิเสธทุกงาน. */
    projection: {
      _id: 1,
      [STATUS_FIELD]: 1,
      [DUE_AT_FIELD]: 1,
      [SEND_KIND_FIELD]: 1,
    },
  };
}

/**
 * The same rule as `buildDueScanQuery`, applied to ONE row already in hand.
 *
 * 🔑 WHY BOTH EXIST — this is not a copy for the tests' benefit. Between the
 * scan and the claim the row can change (another instance takes it, an admin
 * cancels it, someone soft-deletes it), so the runner re-checks the document it
 * actually claimed before it sends anything. The two must agree, and the spec
 * asserts they do case by case.
 *
 * Fails closed at every step: an unreadable date, a missing date, a status that
 * is not exactly `scheduled` ⇒ false. There is no input that makes this answer
 * true by accident.
 */
export function isDueNow(
  row: BroadcastScheduleRow | null | undefined,
  now: Date,
  enabled: boolean = BROADCAST_SCHEDULER_ENABLED,
): boolean {
  if (!enabled) return false;
  const at = readDate(now);
  if (at === null) return false;
  if (!row) return false;
  if (row.status !== DUE_STATUS) return false;
  // Soft delete: any value at all means deleted. `null` is not a value the
  // schema writes, but treating it as "deleted" is the closed answer anyway.
  if (row.deleted_at !== undefined) return false;
  /**
   * 🔴 THROUGH THE CONSTANT, not by name. This line read `row.scheduled_at`
   * while `buildDueScanQuery` filtered on `DUE_AT_FIELD` — so once the owner
   * approved `next_run_at`, the scan would select a job and this function would
   * answer "not due" about the very same row. Silent, permanent, and invisible
   * to a spec that fed both the same field. เลือกด้วยคอลัมน์หนึ่ง เช็คซ้ำด้วยอีกคอลัมน์ = ไม่ยิงเลย.
   */
  const due = readDate((row as Record<string, unknown>)[DUE_AT_FIELD]);
  if (due === null) return false;
  return due.getTime() <= at.getTime();
}

/**
 * Find runs whose holder died, and say what to write back.
 *
 * The FILTER is `claim.ts`'s `buildStaleClaimFilter` — imported, not retyped,
 * so `sending` and the `lease_until < now` test have exactly one definition in
 * the codebase. This adds only what a SCAN needs on top: the soft-delete guard,
 * a bounded sort and limit, and the recovery update.
 *
 * ⚠️ WHY THE UPDATE CANNOT REUSE `buildReleaseQuery`: that one filters on
 * `claimed_by`, because a process may only release its OWN claim. A sweep is
 * the opposite situation — the owner is DEAD and will never come back — so it
 * must be able to take the row from whoever holds it. Same columns cleared,
 * different authority. คนละสิทธิ์ ถึงต้องเป็นคนละ query.
 *
 * 🔴🔴 THE RE-FIRE TRAP — this is why `nextDueAt` is a required argument.
 * Putting a crashed job straight back to `scheduled` while its due date is
 * still in the past means the very next scan finds it due and sends it AGAIN,
 * immediately. §11b.4 records this exact failure ("ตัวกู้คืนเป็น scheduled ⇒
 * next_run_at ยังเป็นค่าเดิมที่เป็นอดีต ⇒ ยิงซ้ำทันทีในรอบถัดไป"). So the
 * recovered due instant is written in the SAME update, never in a second one
 * that a crash could skip:
 *   · `nextDueAt` is a Date ⇒ back to `scheduled`, armed for that instant
 *   · `nextDueAt` is null  ⇒ `failed`. No next round, so re-arming it would
 *     mean a job that fires forever with nothing to fire at.
 * กู้คืนต้องเซ็ตเวลาใหม่ในคำสั่งเดียวกัน ไม่งั้นยิงซ้ำทันที.
 *
 * ⚠️ Whether the recovered instant is stored in `scheduled_at` is the OWNER'S
 * call, not this file's — see the note on `DUE_AT_FIELD`. If `next_run_at` is
 * approved, this update writes that column instead and `scheduled_at` stops
 * being touched. One constant changes.
 */
export function buildStaleRunSweep(
  now: Date,
  nextDueAt: Date | null,
  limit: number = DUE_SCAN_LIMIT,
  enabled: boolean = BROADCAST_SCHEDULER_ENABLED,
): SweepQuery | null {
  if (!enabled) return null;
  const stale = buildStaleClaimFilter(now);
  if (!stale) return null;

  const take = Number.isInteger(limit) && limit > 0 ? limit : DUE_SCAN_LIMIT;
  const armed = readDate(nextDueAt);

  const $set: Record<string, unknown> = armed
    ? { [STATUS_FIELD]: SWEEP_RECOVER_STATUS, [DUE_AT_FIELD]: armed }
    : { [STATUS_FIELD]: SWEEP_DEAD_STATUS };

  return {
    filter: { ...stale, [DELETED_AT_FIELD]: { $exists: false } },
    update: {
      $set,
      $unset: {
        [CLAIMED_AT_FIELD]: '',
        [CLAIMED_BY_FIELD]: '',
        [LEASE_UNTIL_FIELD]: '',
      },
    },
    // Longest-dead first — those have been stuck the longest.
    sort: { [LEASE_UNTIL_FIELD]: 1 },
    limit: take,
  };
}

/**
 * The same rule as `buildStaleRunSweep`, applied to ONE row already in hand.
 *
 * A row is sweepable only if it is `sending` AND its lease has already expired.
 * A live lease means the holder is still working — reclaiming it there is the
 * failure `broadcast.schema.ts:151-155` warns about: the customer gets the
 * campaign twice and nothing in the logs looks wrong.
 */
export function isSweepable(
  row: BroadcastScheduleRow | null | undefined,
  now: Date,
  enabled: boolean = BROADCAST_SCHEDULER_ENABLED,
): boolean {
  if (!enabled) return false;
  const at = readDate(now);
  if (at === null) return false;
  if (!row) return false;
  if (row.status !== CLAIMED_STATE) return false;
  if (row.deleted_at !== undefined) return false;
  const lease = readDate(row.lease_until);
  // No readable lease ⇒ NOT sweepable. Fail closed: a row in `sending` with no
  // lease we can read might be a run that is very much alive, and sweeping it
  // sends the campaign a second time.
  if (lease === null) return false;
  return lease.getTime() < at.getTime();
}
