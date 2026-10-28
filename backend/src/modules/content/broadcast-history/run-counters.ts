/**
 * [FEAT-20260822-BCASTCOUNTERS] What a run did — the numbers every history row
 * must carry.
 * ===========================================================================
 * A pure decision. No database, no I/O, no clock.
 *
 * เจ้าของ 22/08: "history ของ broadcast + multi ต้องมี log เก็บทุกอย่าง
 * ว่าทำไปเท่าไหร่ หรืออะไรครบไหม".
 *
 * TWO QUESTIONS A HISTORY ROW MUST ANSWER WITHOUT ANYONE GUESSING:
 *   1. ทำไปเท่าไหร่ — matched / targeted / sent / failed / unsent, and the
 *      requests and chunks behind them
 *   2. ครบไหม       — `summarizeRun` turns those into one status, and it is
 *      DERIVED, never hand-set, so the status can never disagree with the counts
 *
 * ⚠️ COUNTED, NOT MEASURED FROM AN ARRAY. A run streams its recipients (a
 *    cursor, then chunks of 500), so nothing ever holds the full list to call
 *    `.length` on. Every number here is incremented as the run goes.
 *    ห้ามใช้ array.length — นับระหว่างวน.
 *
 * ⚠️ The ID LISTS are deliberately NOT here — see `recipient-ledger.ts`.
 *
 * revert: delete this file with the rest of `broadcast-history/`.
 */

export interface RunCounters {
  /** Selected by the audience rules. */
  readonly matched: number;
  /** Left after dropping blanks and duplicates — what we actually aimed at. */
  readonly targeted: number;
  /** Recipients LINE accepted. */
  readonly sent: number;
  /** Recipients in chunks LINE rejected. */
  readonly failed: number;
  /** Targeted but never attempted — stopped early, refused, chunk skipped. */
  readonly unsent: number;
  readonly requestsPlanned: number;
  readonly requestsMade: number;
  readonly chunksPlanned: number;
  readonly chunksDone: number;
  /** Image URLs swapped for the fallback — 0 means every picture was usable. */
  readonly imagesReplaced: number;
}

export const EMPTY_COUNTERS: RunCounters = {
  matched: 0,
  targeted: 0,
  sent: 0,
  failed: 0,
  unsent: 0,
  requestsPlanned: 0,
  requestsMade: 0,
  chunksPlanned: 0,
  chunksDone: 0,
  imagesReplaced: 0,
};

export type RunStatus =
  /** Everything targeted was accepted. */
  | 'success'
  /** Some accepted, some not — the honest middle that success/error cannot say. */
  | 'partial'
  /** Nothing was accepted although we tried. */
  | 'error'
  /** Never started: over a ceiling, or an impossible combination. */
  | 'refused'
  /** Started and stopped before finishing — a restart, a kill switch. */
  | 'stopped';

export interface RunSummary {
  readonly status: RunStatus;
  /** Did every targeted recipient get an attempt? */
  readonly complete: boolean;
  /** sent / targeted, 0-1. 0 when nothing was targeted. */
  readonly deliveredRatio: number;
}

/**
 * Derive the status from the counts.
 *
 * `refused` is passed in rather than inferred: a run that never started has all
 * zeroes, which is indistinguishable from a run that matched nobody — and those
 * two mean very different things to whoever reads the row.
 * ศูนย์เพราะโดนปฏิเสธ กับ ศูนย์เพราะไม่มีใครเข้าเงื่อนไข ต้องแยกให้ออก.
 */
export function summarizeRun(
  c: RunCounters,
  opts: { readonly refused?: boolean; readonly stopped?: boolean } = {},
): RunSummary {
  const targeted = safeCount(c.targeted);
  const sent = safeCount(c.sent);
  const failed = safeCount(c.failed);

  // Clamped to 0-1 as documented. Review found `{targeted:10, sent:20}`
  // reporting 2 — a ratio outside its own stated range is a number nobody can
  // read. เกิน 1 แปลว่าตัวนับพัง ไม่ใช่ส่งได้เกิน.
  const deliveredRatio =
    targeted > 0 ? Math.min(1, Math.max(0, sent / targeted)) : 0;
  const complete = targeted > 0 && sent + failed >= targeted;

  if (opts.refused)
    return { status: 'refused', complete: false, deliveredRatio };
  if (opts.stopped)
    return { status: 'stopped', complete: false, deliveredRatio };

  if (targeted === 0) {
    // 🔴 Review caught this: the old code short-circuited here and reported
    // `success · 0 delivered` for a run that HAD sent 500 messages but whose
    // `targeted` counter was never incremented. Zero targeted with a non-zero
    // send is a broken counter, and the row must say so rather than lie.
    if (sent > 0 || failed > 0) {
      return { status: 'partial', complete: false, deliveredRatio: 0 };
    }
    return { status: 'success', complete: true, deliveredRatio: 0 };
  }

  if (sent === 0) return { status: 'error', complete, deliveredRatio };
  if (sent < targeted) return { status: 'partial', complete, deliveredRatio };
  return { status: 'success', complete, deliveredRatio };
}

/**
 * A counter that is missing, negative or not a number is a BUG upstream, and it
 * must not spread. `Math.trunc(NaN)` is `NaN`, and one NaN poisons every later
 * count and the whole history row — found in review.
 */
function safeCount(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

/** Fold one chunk's outcome in. Immutable — no counter is mutated in place. */
export function addChunkResult(
  c: RunCounters,
  chunkSize: number,
  ok: boolean,
  /**
   * What the render measured for this chunk.
   *
   * ⚠️ `undefined` means NOT MEASURED and must not be read as zero — the sink
   * that sends nothing (a preview) measures nothing, and a row that cannot tell
   * "no broken pictures" from "nobody looked" is a row that lies.
   * ไม่ได้วัด ≠ วัดแล้วเป็นศูนย์.
   */
  measured?: { readonly imagesReplaced?: number },
): RunCounters {
  const size = safeCount(chunkSize);
  const replaced = measured?.imagesReplaced;
  return {
    ...c,
    sent: safeCount(c.sent) + (ok ? size : 0),
    failed: safeCount(c.failed) + (ok ? 0 : size),
    requestsMade: safeCount(c.requestsMade) + 1,
    chunksDone: safeCount(c.chunksDone) + 1,
    unsent: Math.max(0, safeCount(c.unsent) - size),
    /**
     * ⚠️ A NUMBER CANNOT SAY "I DID NOT LOOK".
     *
     * An earlier version branched on `undefined` here to preserve that
     * distinction — and a mutation proved the branch was dead, because
     * `safeCount(undefined)` is already 0. Both arms computed the same thing.
     * The distinction is real, so it lives where it CAN be expressed: the
     * executor tracks whether any chunk reported a measurement, and the
     * history row leaves `images_replaced` out entirely when none did.
     * ตัวเลขบอก "ไม่ได้วัด" ไม่ได้ ⇒ ต้องไปบอกที่แถว ด้วยการไม่เขียน field นั้นเลย.
     */
    imagesReplaced: safeCount(c.imagesReplaced) + safeCount(replaced),
  };
}

/**
 * Add one OA's counts into the run's total.
 *
 * ⚠️ WHY PER-OA COUNTERS EXIST AT ALL: `broadcasts_histories` keeps one row per
 * OA (`hook_id` is a single field, not an array), so a run that threaded ONE
 * accumulator through every OA could never answer "how did OA #3 do?" — the
 * exact question the history table was approved to answer. Each OA counts for
 * itself and the run adds them up. นับแยกราย OA แล้วค่อยรวม ไม่ใช่รวมตั้งแต่ต้น.
 *
 * `matched` and `targeted` are set here rather than summed, because they are
 * decided before any OA runs.
 */
export function mergeCounters(run: RunCounters, oa: RunCounters): RunCounters {
  return {
    matched: safeCount(run.matched),
    targeted: safeCount(run.targeted),
    sent: safeCount(run.sent) + safeCount(oa.sent),
    failed: safeCount(run.failed) + safeCount(oa.failed),
    unsent: Math.max(
      0,
      safeCount(run.targeted) -
        safeCount(run.sent) -
        safeCount(oa.sent) -
        safeCount(run.failed) -
        safeCount(oa.failed),
    ),
    requestsPlanned: safeCount(run.requestsPlanned),
    requestsMade: safeCount(run.requestsMade) + safeCount(oa.requestsMade),
    chunksPlanned: safeCount(run.chunksPlanned),
    chunksDone: safeCount(run.chunksDone) + safeCount(oa.chunksDone),
    imagesReplaced:
      safeCount(run.imagesReplaced) + safeCount(oa.imagesReplaced),
  };
}

/** The counts one OA starts with, from what the plan says it will do. */
export function countersForOa(
  recipients: number,
  requests: number,
): RunCounters {
  const r = safeCount(recipients);
  return {
    ...EMPTY_COUNTERS,
    targeted: r,
    unsent: r,
    requestsPlanned: safeCount(requests),
    chunksPlanned: safeCount(requests),
  };
}
