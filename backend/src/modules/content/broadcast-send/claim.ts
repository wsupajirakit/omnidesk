/**
 * [FEAT-20260822-BCASTCLAIM] Taking a job, holding it, and giving it back.
 * ===========================================================================
 * A pure decision. It builds query SHAPES; the caller runs them. That keeps the
 * hardest part — getting the filters exactly right — testable without Mongo.
 *
 * 🔑 THE FILTER IS THE LOCK, NOT A CHECK BEFORE THE WRITE.
 * `findOneAndUpdate({_id, status:'scheduled'}, {$set:{status:'sending'}})` is
 * atomic: whichever process gets there first flips the status, and the second
 * one matches nothing and receives `null`. Reading "is it running?" and then
 * writing would let both processes read `false` and both send — the customer is
 * messaged twice, and nothing in the logs looks wrong.
 * เงื่อนไขคือด่าน ไม่ใช่การเช็คก่อนเขียน.
 *
 * ⚠️ `retryKey` does NOT cover this. It makes ONE chunk idempotent within one
 *    run; two runs have two run ids and therefore two keys.
 *
 * 🔑 WHY NO `$exists` ANYWHERE, AND WHY NO BACKFILL
 * The claim turns on `status`, which every row already has. `lease_until` is
 * only ever read for rows in `sending`, and only this code writes that state,
 * so a row that predates the feature can never be caught by the sweep. That is
 * what makes adding the three columns invisible to every existing job.
 *
 * revert: delete this file with the rest of `broadcast-send/`.
 */
import { computeLeaseMs } from './limits';

/** States a run may be taken from. `draft` is not one — it was never scheduled. */
export const CLAIMABLE_FROM = ['scheduled'] as const;
export const CLAIMED_STATE = 'sending';

export interface ClaimUpdate {
  readonly $set: Record<string, unknown>;
  /** Present only on release — a job at rest carries no claim columns. */
  readonly $unset?: Record<string, ''>;
}

export interface ClaimQuery {
  readonly filter: Record<string, unknown>;
  readonly update: ClaimUpdate;
  /** `findOneAndUpdate` must return the row AFTER the write, or we cannot use it. */
  readonly options: { readonly new: true };
}

/**
 * Take the job, or find out somebody else already has it.
 *
 * `null` from the caller's `findOneAndUpdate` means "not ours" — it is the
 * normal answer when two processes race, not an error.
 *
 * ⚠️ `deleted_at` is part of the filter because `deleteBroadcast` soft-deletes
 * without touching `status`: a scheduled job that was deleted still looks
 * claimable forever otherwise.
 */
export function buildClaimQuery(
  jobId: unknown,
  ownerId: string,
  now: Date,
  leaseMs: number = computeLeaseMs(),
): ClaimQuery | null {
  if (jobId === null || jobId === undefined || jobId === '') return null;
  if (!ownerId) return null;
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return null;
  const lease =
    Number.isFinite(leaseMs) && leaseMs > 0 ? leaseMs : computeLeaseMs();

  return {
    filter: {
      _id: jobId,
      status: { $in: [...CLAIMABLE_FROM] },
      deleted_at: { $exists: false },
    },
    update: {
      $set: {
        status: CLAIMED_STATE,
        claimed_at: now,
        claimed_by: ownerId,
        lease_until: new Date(now.getTime() + lease),
      },
    },
    options: { new: true },
  };
}

/**
 * Keep a long run's claim alive.
 *
 * ⚠️ Filters on `claimed_by` so a process can only extend ITS OWN claim. Without
 * that, a process whose lease already expired and was swept could push the new
 * holder's lease out and both would be sending.
 */
export function buildHeartbeatQuery(
  jobId: unknown,
  ownerId: string,
  now: Date,
  leaseMs: number = computeLeaseMs(),
): ClaimQuery | null {
  const base = buildClaimQuery(jobId, ownerId, now, leaseMs);
  if (!base) return null;
  return {
    filter: {
      _id: jobId,
      status: CLAIMED_STATE,
      claimed_by: ownerId,
    },
    update: { $set: { lease_until: base.update.$set['lease_until'] } },
    options: { new: true },
  };
}

/**
 * Hand the job back when the run ends.
 *
 * `finalStatus` is what the run decided — `sent`, `failed`, or back to
 * `scheduled` for a repeat that will come round again. The claim columns are
 * cleared with `$unset` rather than left behind, so a job at rest carries no
 * trace of who ran it last; the history row is where that belongs.
 */
export function buildReleaseQuery(
  jobId: unknown,
  ownerId: string,
  finalStatus: string,
): ClaimQuery | null {
  if (jobId === null || jobId === undefined || jobId === '') return null;
  if (!ownerId || !finalStatus) return null;
  return {
    filter: { _id: jobId, status: CLAIMED_STATE, claimed_by: ownerId },
    update: {
      $set: { status: finalStatus },
      $unset: { claimed_at: '', claimed_by: '', lease_until: '' },
    },
    options: { new: true },
  };
}

/**
 * Find runs whose holder died — the sweep.
 *
 * ⚠️ Only rows in `sending` can match, and only this code writes that state, so
 * the sweep can never touch a job that predates the feature. No `$exists`, no
 * backfill, no surprise.
 */
export function buildStaleClaimFilter(
  now: Date,
): Record<string, unknown> | null {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return null;
  return { status: CLAIMED_STATE, lease_until: { $lt: now } };
}
