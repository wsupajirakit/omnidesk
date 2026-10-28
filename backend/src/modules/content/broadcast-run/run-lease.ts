/**
 * [FEAT-20260822-BCASTRUNLEASE] Taking the job, holding it, giving it back.
 * ===========================================================================
 * `claim.ts` builds the query SHAPES and owns every rule about them; this file
 * only runs them through the ports and makes sure a failure never becomes an
 * exception. Nothing here assembles a filter by hand — the filter IS the lock,
 * and a hand-built one is how the same customer gets messaged twice.
 *
 * revert: delete this file with the rest of `broadcast-run/`.
 */
import {
  buildClaimQuery,
  buildHeartbeatQuery,
  buildReleaseQuery,
  type ResumePoint,
} from '../broadcast-send';

import { message, safeNow } from './run-io';
import type { BroadcastRunInput, BroadcastRunPorts } from './run-ports';

export interface ClaimAttempt {
  /** null ⇒ the shape could not even be built (bad job id, owner or clock). */
  readonly buildable: boolean;
  /** What the port answered. null/undefined ⇒ somebody else holds the job. */
  readonly doc: unknown;
  /** The port threw. We do NOT know whether the write landed. */
  readonly error: string | null;
}

export async function claimJob(
  input: BroadcastRunInput,
  ports: BroadcastRunPorts,
  now: Date,
): Promise<ClaimAttempt> {
  const query = buildClaimQuery(input.jobId, input.ownerId, now);
  if (query === null) return { buildable: false, doc: null, error: null };
  try {
    return { buildable: true, doc: await ports.claim(query), error: null };
  } catch (e) {
    return { buildable: true, doc: null, error: message(e) };
  }
}

/**
 * Hand the job back.
 *
 * A release that throws is the one failure nothing else can rescue, so it is
 * reported rather than thrown — the lease will expire and the sweep
 * (`buildStaleClaimFilter`) picks the row up. คืนไม่สำเร็จ ให้ sweep เก็บ.
 */
export async function releaseJob(
  input: BroadcastRunInput,
  ports: BroadcastRunPorts,
  finalStatus: string,
): Promise<boolean> {
  const query = buildReleaseQuery(input.jobId, input.ownerId, finalStatus);
  if (query === null) return false;
  try {
    await ports.release(query);
    return true;
  } catch {
    return false;
  }
}

/**
 * Keep the claim alive while a long run works through its OAs.
 *
 * ⚠️ A failed renewal does NOT stop the run. The messages already sent cannot
 *    be un-sent, and abandoning the list halfway is strictly worse than letting
 *    the lease lapse — the sweep exists for the lapse. ต่ออายุไม่ได้ ก็ส่งต่อ.
 *
 * ⚠️ The resume point is deliberately not persisted per chunk: it lands on the
 *    history row at the end of the run (`history-row.ts`), so the heartbeat has
 *    nothing to carry and only pushes the lease out.
 */
export function heartbeatFor(
  input: BroadcastRunInput,
  ports: BroadcastRunPorts,
): (hookId: string, point: ResumePoint) => Promise<void> {
  return async (_hookId: string, _point: ResumePoint) => {
    void _hookId;
    void _point;
    const at = safeNow(ports.clock);
    if (!Number.isFinite(at)) return;
    const query = buildHeartbeatQuery(input.jobId, input.ownerId, new Date(at));
    if (query === null) return;
    try {
      await ports.renewLease?.(query);
    } catch {
      // Reported by the lease lapsing, not by killing the campaign.
    }
  };
}
