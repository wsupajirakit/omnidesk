/**
 * [FIX-20260817-RESUMEDEDUPE] The `handoff_jobs.dedupe_key` a payment leg logs
 * under.
 *
 * ══ THE BUG THIS CLOSES ═══════════════════════════════════════════════════════
 * The key used to be `chain:<runId>:<chainStep>:<cursor>`. LEG 1 (topup) is
 * logged with a HARD-CODED `cursor: 0` (payment-runner.service.ts:1324-1325),
 * and a [ลองใหม่] resume deliberately RE-ENTERS LEG 1 with the same stored slip
 * — the runner's own header states that contract. So the second attempt of one
 * run built a key identical to the first attempt's, hit the sparse unique index
 * on `dedupe_key`, and threw:
 *
 *     E11000 duplicate key … dup key: { dedupe_key: "chain:6a82d7b1…:1:0" }
 *
 * `resumeForRetry` catches, returns `{ ran: false, skipped: 'error' }`, and the
 * customer gets NO reply — the tap looks like a dead button. Observed live on
 * 17/08, the first time the retry button ever rendered (it was hidden behind
 * [FIX-20260817-RETRYRESUME], so this line had never executed before).
 *
 * ══ THE SHAPE, AND WHY ════════════════════════════════════════════════════════
 * The key now carries the ATTEMPT GENERATION — the run's `startCursor`: 0 on a
 * first run, the resume index on each retry. Deterministic: no timestamp, no
 * randomness, so one real attempt still maps to exactly one key and the unique
 * index keeps rejecting a genuine double-log.
 *
 * 🔴 A FIRST RUN'S KEY IS UNCHANGED, BYTE FOR BYTE. The suffix is appended ONLY
 * when the generation is non-zero. Every key an ordinary save writes today is
 * identical after this change — that is why the suffix is conditional instead of
 * always present, and it is pinned by test.
 * flow ปกติต้องไม่เปลี่ยนแม้แต่ตัวอักษรเดียว
 *
 * ══ WHY WIDENING THIS KEY IS SAFE ON A MONEY PATH ═════════════════════════════
 * `dedupe_key` is written in ONE place (`_logLeg`) and read by NO code — its only
 * enforcement is the index (`grep -rn dedupe_key src/`). `_logLeg` records a leg
 * that already happened ("create leg job → storeRaw → finishJob"); it does not
 * queue work. Paying twice is prevented by the run's `cursor` / `resume_cursor`
 * ledger, the CAS claim in `_resume`, and `_stampLock`. This change lets the
 * second attempt RECORD itself instead of crashing; it grants no new write.
 *
 * revert: inline `chain:${runId}:${chainStep}:${cursor}` back into `_logLeg` and
 * delete this file — the retry tap then goes silent again.
 */

/**
 * @param runId        the chain run
 * @param chainStep    1 = topup, 2 = walletpay
 * @param cursor       statement index this leg acted on (LEG 1 always 0)
 * @param generation   the run's `startCursor`: 0/undefined on a first run, the
 *                     resume index on a retry
 */
export function buildLegDedupeKey(
  runId: string,
  chainStep: number,
  cursor: number,
  generation?: number,
): string {
  const base = `chain:${runId}:${chainStep}:${cursor}`;
  // Conditional on purpose — see the note above: a first run must keep the exact
  // key it has always written.
  return generation ? `${base}:${generation}` : base;
}

/**
 * [FIX-20260817-RETRYTRIGGER] Who started this leg, for the handoff history.
 *
 * `_logLeg` used to stamp every row `'auto'`, so once the retry loop finally
 * worked the history showed four indistinguishable steps and an operator could
 * not tell which two the CUSTOMER asked for by tapping [ลองใหม่].
 *
 * No new field and no frontend work: `HandoffHistory.tsx:320` already prints
 * `triggered_by` on each step row, and the schema's enum already carries
 * `'auto' | 'manual' | 'resend'`. Only the value was untruthful.
 *
 * The same generation the dedupe key uses answers the question:
 *   0 / absent → the run the incoming slip started      ⇒ 'auto'
 *   > 0        → a leg the customer asked for by tapping ⇒ 'manual'
 *
 * 'manual' rather than 'resend': nothing in this codebase writes either value
 * today (134 of 134 rows are 'auto'), and 'resend' reads as an operator pushing
 * the same job out again, which is not what happened — a person asked for the
 * next statement to be tried. แถวเก่าทั้งหมดยังเป็น auto ตามความจริงเดิม
 */
export function legTriggeredBy(generation?: number): 'auto' | 'manual' {
  return generation ? 'manual' : 'auto';
}
