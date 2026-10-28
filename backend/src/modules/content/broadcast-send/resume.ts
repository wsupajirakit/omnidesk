/**
 * [FEAT-20260822-BCASTRESUME] Carrying on after a restart without messaging
 * anybody twice — and without storing a copy of the audience.
 * ===========================================================================
 * A pure decision. It builds cursor SHAPES; the caller runs them.
 *
 * ═══ TWO HALVES, AND ONLY ONE OF THEM IS LIVE (23/08/2026) ═══
 *
 * LIVE — used on every run, by `oa-executor.ts`:
 *   `FRESH_RESUME` · `advanceResume` · `ResumePoint`
 *   They move the cursor from chunk to chunk INSIDE one run, and they decide
 *   what a finished OA reports as "everything up to here was delivered".
 *
 * RESERVED PIPE — built, tested, exported, and called by nobody yet:
 *   `AudienceCursor` · `buildAudienceCursor` · `canResendChunk`
 *   These are for picking a stopped run back up on a LATER round.
 *
 * 🔴 The owner decided on 23/08 that continuing a stopped run automatically is
 *    NOT required: a run that stops is sent again from the beginning, and what
 *    matters instead is that the log says clearly WHY it stopped and WHICH OA.
 *
 *    They are kept rather than deleted, deliberately, because the decision is
 *    cheap to reverse and the pipe is already proven. Deleting them would mean
 *    re-deriving the keyset argument below from scratch the day somebody wants
 *    "carry on from where it stopped".
 *
 * ⚠️ SO: nothing in `src/` calls the reserved half. Do not read a passing spec
 *    for it as evidence that resuming works end to end — it proves the SHAPES
 *    are right, not that anything runs them. An audit traced two live-path
 *    defects (a cursor walking past unsent people, and one retry key covering
 *    two different groups) partly to attention spent on a green suite that was
 *    watching this half.
 *    ครึ่งที่สงวนไว้ยังไม่มีใครเรียก — เทสเขียวไม่ได้แปลว่าฟีเจอร์ทำงาน.
 *
 * TO TURN THE RESERVED HALF ON, three things are needed and none exist yet:
 *   1. persist the `ResumePoint` an OA returns (nothing stores it today —
 *      `run-broadcast.ts` only passes one IN)
 *   2. give an OA that finished WITH a gap a stop reason, so a scheduler can
 *      tell "done" from "stopped early" (`executeRun` reports `undefined` now)
 *   3. decide what the send button means: "send again" or "carry on"
 *   เผื่อท่อไว้แล้ว แต่ยังไม่ต่อ — ต่อเมื่อไหร่ต้องทำครบสามข้อนี้.
 *
 * 🔑 THE PROBLEM THIS REPLACES (D52 in the plan)
 * The plan proposed snapshotting every recipient id at send time so a retried
 * chunk would hold exactly the same people. That works, but it costs a new
 * collection, a TTL, ~4-6 MB per large run, and its own approval — and it
 * exists only to make an INDEX stable. There is a cheaper way that needs no
 * storage at all.
 *
 * 🔑 KEYSET RESUME INSTEAD OF A SNAPSHOT
 * Sort the audience by `_id` and remember the last id a chunk actually
 * completed. To carry on, ask for `_id > lastId`. Two properties make this safe:
 *
 *   1. FORWARD ONLY. A resumed run never revisits a chunk it finished, so it
 *      cannot re-send to anyone whose id is already behind the cursor.
 *   2. THE UNFINISHED CHUNK IS SAFE TO REPEAT. If the process died mid-request
 *      we do not know whether LINE received it, so the resumed run sends that
 *      chunk again with the SAME `retryKey` — LINE recognises it and answers
 *      409, which the core already counts as success. Nobody is messaged twice.
 *      ตายกลางก้อน ⇒ ส่งก้อนเดิมซ้ำได้ เพราะ key เดิม.
 *
 * ⚠️ WHAT THIS DELIBERATELY DOES NOT PROMISE
 * The audience is live, so a resumed run is not identical to the original: a
 * member who joined the condition after the restart sorts AFTER the cursor and
 * WILL be included; one who left is simply skipped. That is the same "select at
 * send time" behaviour the design chose everywhere else (§4), not a defect —
 * but it must be written down rather than discovered. คัดสด = รายชื่อขยับได้.
 *
 * ⚠️ ObjectId sorts by creation time, so `_id` order is "oldest member first".
 *    That is a stable order, which is all resume needs; it is not a priority.
 *
 * revert: delete this file with the rest of `broadcast-send/`.
 */

/** Where a run got to, per OA. Lives on the run's history row — no new storage. */
export interface ResumePoint {
  readonly hookId: string;
  /** `_id` of the last member in the last COMPLETED chunk. null = not started. */
  readonly afterId: string | null;
  /** Index the next chunk will carry — part of its retry key. */
  readonly nextChunkIndex: number;
}

export const FRESH_RESUME = (hookId: string): ResumePoint => ({
  hookId,
  afterId: null,
  nextChunkIndex: 0,
});

/**
 * 🔵 RESERVED PIPE — see the file header. Nothing in `src/` builds one of these
 * today; it exists so "carry on from where it stopped" is a wiring job rather
 * than a redesign. ท่อเผื่อไว้ ยังไม่มีใครใช้.
 */
export interface AudienceCursor {
  readonly filter: Record<string, unknown>;
  readonly sort: { readonly _id: 1 };
  readonly limit: number;
}

/**
 * Build the next page of the audience for one OA.
 *
 * ⚠️ The sort is not decoration. Without a deterministic order, "everything
 * after X" is meaningless and a resumed run would re-send and skip at random.
 * ห้ามลืม sort — ไม่งั้น resume ไม่มีความหมาย.
 */
/**
 * 🔵 RESERVED PIPE — zero callers in `src/`. The cursor a LIVE run uses is
 * built by `withCursor` in `adapters/recipient.pager.ts`; this one is for a
 * future round that resumes a stopped run. Keep them in step if either changes.
 * ท่อเผื่อไว้ · ตัวที่ใช้จริงคือ `withCursor`.
 */
export function buildAudienceCursor(
  baseFilter: Record<string, unknown>,
  point: ResumePoint,
  pageSize: number,
): AudienceCursor | null {
  if (!baseFilter || typeof baseFilter !== 'object') return null;
  if (!Number.isFinite(pageSize) || pageSize < 1) return null;

  const filter: Record<string, unknown> =
    point.afterId === null
      ? { ...baseFilter }
      : { ...baseFilter, _id: { $gt: point.afterId } };

  return { filter, sort: { _id: 1 }, limit: Math.floor(pageSize) };
}

/**
 * Advance the point after a chunk was ACCEPTED by LINE.
 *
 * 🔴 Only call this on success. Advancing on a failed or unknown chunk is how a
 * resumed run silently skips 500 people: the cursor moves past them and nothing
 * ever comes back for them. เลื่อนเฉพาะตอนสำเร็จเท่านั้น.
 */
export function advanceResume(
  point: ResumePoint,
  lastIdOfChunk: string,
): ResumePoint {
  if (!lastIdOfChunk) return point;
  return {
    hookId: point.hookId,
    afterId: lastIdOfChunk,
    nextChunkIndex: point.nextChunkIndex + 1,
  };
}

/**
 * Is it safe to send this chunk again after a crash?
 *
 * Yes, and only, when it carries the same retry key it had the first time —
 * that is what lets LINE recognise the repeat. A chunk whose key could not be
 * built (see `retry-key.ts`) must not be resent, because a fresh key would
 * deliver it twice.
 */
/**
 * 🔵 RESERVED PIPE — zero callers in `src/`. Answers "is this chunk safe to
 * send again?" for a resumed round. The live path never asks, because it never
 * resumes: a stopped run is sent again from the start.
 * ท่อเผื่อไว้ · เส้นทางจริงยังไม่ถามคำถามนี้.
 */
export function canResendChunk(retryKey: string | null): boolean {
  return typeof retryKey === 'string' && retryKey.length > 0;
}
