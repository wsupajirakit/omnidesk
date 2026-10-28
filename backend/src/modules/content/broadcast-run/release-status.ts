/**
 * [FEAT-20260822-BCASTRELSTATUS] What the `broadcasts` row says once the run
 * lets go of it.
 * ===========================================================================
 * A pure decision. No database, no I/O, no clock.
 *
 * 🔑 TWO VOCABULARIES, AND THIS IS THE ONLY PLACE THEY MEET.
 *   · `RunStatus`  — what the RUN did: success / partial / error / refused /
 *                    stopped. Derived by `summarizeRun` from the counters, and
 *                    never hand-set (`run-counters.ts`).
 *   · `status`     — what the JOB is: draft / scheduled / sending / sent /
 *                    failed / cancelled. The enum on `broadcast.schema.ts:107`.
 * A run's outcome is not a job's state, so translating is a decision with its
 * own reasons — written down here rather than inlined in the runner where the
 * next reader would have to reverse-engineer them. คนละคำศัพท์ ต้องแปล ไม่ใช่ยัด.
 *
 * revert: delete this file with the rest of `broadcast-run/`.
 */
import type { RunStatus } from '../broadcast-history';

/** The `broadcasts.status` values a finished run may hand back. */
export const RELEASE_SENT = 'sent';
export const RELEASE_FAILED = 'failed';
export const RELEASE_SCHEDULED = 'scheduled';

/**
 * What a run that CRASHED hands back.
 *
 * 🔴 `failed`, NOT `scheduled`, and this is the opposite of what "just try
 * again" suggests. A resumed run only avoids re-sending because it starts from
 * the resume point on its history row — and a crash is exactly the case where
 * that row may never have been written. Rescheduling then starts from the
 * beginning under a NEW run id, so every chunk gets a NEW retry key, LINE
 * recognises none of them, and everyone already messaged is messaged again.
 * ⇒ a crash needs a person to look, not an automatic retry.
 * พังกลางทาง = ให้คนมาดู ห้ามให้ระบบยิงซ้ำเอง.
 */
export const RELEASE_ON_CRASH = RELEASE_FAILED;

/**
 * Turn what the run did into what the job now is.
 *
 * ⚠️ `partial` rests at `sent`, deliberately. Marking the whole job `failed`
 *    because 100 of 10,000 chunks were rejected reads as "nothing went out",
 *    and a scheduler that retried it would message the other 9,900 twice. The
 *    history row is where partial is visible, with the counts behind it.
 *    ส่งไปแล้วบางส่วน ≠ ล้มเหลว — ตัวเลขอยู่ที่ history.
 *
 * ⚠️ `stopped` goes back to `scheduled` so the next round CARRIES ON: the run
 *    ended early with a live resume point, and only a claimable job can use it.
 *
 * ⚠️ `refused` goes back to `scheduled` too. It never started, so anything else
 *    would retire a job that nobody cancelled. The 60-second cooldown in
 *    `abuse-guard.ts` is what stops it being retried in a tight loop.
 */
export function releaseStatusFor(
  status: RunStatus,
  opts: { readonly repeating?: boolean } = {},
): string {
  if (status === 'refused' || status === 'stopped') return RELEASE_SCHEDULED;
  // A repeating job is never finished — it is only between rounds.
  if (opts.repeating === true) return RELEASE_SCHEDULED;
  if (status === 'error') return RELEASE_FAILED;
  return RELEASE_SENT;
}
