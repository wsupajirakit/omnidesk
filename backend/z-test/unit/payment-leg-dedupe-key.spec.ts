/**
 * [FIX-20260817-RESUMEDEDUPE] A [ลองใหม่] resume must be able to log its legs.
 *
 * ══ WHAT BROKE (observed live, 17/08, the first time the button ever rendered) ══
 * Tapping [ลองใหม่] answered with silence. The log said:
 *
 *   ERROR [PAYRUN] resume error: E11000 duplicate key
 *     collection: handoff_jobs  index: dedupe_key_1
 *     dup key: { dedupe_key: "chain:6a82d7b1…:1:0" }
 *
 * `_logLeg` builds `chain:<runId>:<chainStep>:<cursor>`. LEG 1 (topup) is logged
 * with a HARD-CODED `cursor: 0` (payment-runner.service.ts:1324-1325), and a
 * resume deliberately RE-ENTERS LEG 1 with the same stored slip — the runner's
 * own header says so. So the second attempt of the same run produced a key
 * identical to the first attempt's, hit the unique index, and threw.
 *
 * ══ WHY IT WAS INVISIBLE UNTIL NOW ══
 * It sits BEHIND the missing-button bug ([FIX-20260817-RETRYRESUME]): no button
 * ever rendered, so no resume ever ran, so this line never executed. Retry has
 * never completed end to end in this system.
 *
 * ══ THE FIX, AND WHY THIS SHAPE ══
 * The key gains the attempt generation — the run's `startCursor`, which is 0 on a
 * first run and the resume index afterwards. Deterministic (no timestamps, no
 * randomness), so the key still identifies exactly one real attempt and the
 * unique index keeps doing its job.
 *
 * 🔴 THE FIRST-RUN KEY IS UNCHANGED, BYTE FOR BYTE. The suffix is appended ONLY
 * when the generation is non-zero, so every key an ordinary save produces today
 * is exactly what it produces after this change. That is asserted below and is
 * the whole reason for this shape rather than always appending `:0`.
 * flow ปกติต้องไม่เปลี่ยนแม้แต่ตัวอักษรเดียว
 *
 * ══ SAFETY REVIEW OF TOUCHING THIS KEY (it is a money path) ══
 * `dedupe_key` is WRITTEN in exactly one place and READ by no code at all
 * (`grep -rn dedupe_key src/` → the schema's index and `_logLeg`); its only
 * enforcement is the sparse unique index. `_logLeg` is "create leg job → storeRaw
 * → finishJob" — a LOG row, not a queued unit of work. Double-credit is prevented
 * elsewhere: the run's `cursor`/`resume_cursor` ledger, the CAS claim in
 * `_resume`, and `_stampLock`. Widening this key therefore cannot let a slip pay
 * twice; it lets the SECOND attempt record that it happened instead of crashing.
 */
import { buildLegDedupeKey } from '@/modules/payment';

describe('[FIX-20260817-RESUMEDEDUPE] leg dedupe key', () => {
  const RUN = 'a0d000000000000000000075';

  it('🔴 a first run produces exactly the key it always did', () => {
    // the two real keys from a live first run, copied out of handoff_jobs
    expect(buildLegDedupeKey(RUN, 1, 0, 0)).toBe(`chain:${RUN}:1:0`);
    expect(buildLegDedupeKey(RUN, 2, 0, 0)).toBe(`chain:${RUN}:2:0`);
    expect(buildLegDedupeKey(RUN, 2, 1, 0)).toBe(`chain:${RUN}:2:1`);
  });

  it('an absent generation behaves like a first run', () => {
    expect(buildLegDedupeKey(RUN, 1, 0, undefined)).toBe(`chain:${RUN}:1:0`);
  });

  it('⭐ a resume no longer collides with the first attempt on LEG 1', () => {
    const first = buildLegDedupeKey(RUN, 1, 0, 0);
    const resumed = buildLegDedupeKey(RUN, 1, 0, 1);
    expect(resumed).not.toBe(first);
    expect(resumed).toBe(`chain:${RUN}:1:0:1`);
  });

  it('every attempt of every leg stays distinct — nothing is overwritten', () => {
    const keys = [
      buildLegDedupeKey(RUN, 1, 0, 0), // first run, topup
      buildLegDedupeKey(RUN, 2, 0, 0), // first run, walletpay stmt 0
      buildLegDedupeKey(RUN, 1, 0, 1), // resume 1, topup again
      buildLegDedupeKey(RUN, 2, 1, 1), // resume 1, walletpay stmt 1
      buildLegDedupeKey(RUN, 1, 0, 2), // resume 2, topup again
      buildLegDedupeKey(RUN, 2, 2, 2), // resume 2, walletpay stmt 2
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('two different runs never share a key', () => {
    expect(buildLegDedupeKey('AAA', 1, 0, 1)).not.toBe(
      buildLegDedupeKey('BBB', 1, 0, 1),
    );
  });

  it('the same attempt asked twice is still the SAME key — the guard still guards', () => {
    // idempotency is the point of the index: a genuine duplicate must still clash
    expect(buildLegDedupeKey(RUN, 2, 1, 1)).toBe(
      buildLegDedupeKey(RUN, 2, 1, 1),
    );
  });
});

/**
 * [FIX-20260817-RETRYTRIGGER] The handoff log must say WHO started each leg.
 *
 * THE GAP: `_logLeg` hard-coded `triggered_by: 'auto'` on every row, so once the
 * retry loop finally worked (see [FIX-20260817-RETRYRESUME] and
 * [FIX-20260817-RESUMEDEDUPE]) the history showed four identical-looking steps
 * with no way to tell which two came from the customer tapping [ลองใหม่].
 * Confirmed against the live database: 134 rows, every one `auto`.
 *
 * NO NEW FIELD, NO FRONTEND CHANGE. `HandoffHistory.tsx:320` already prints
 * `{s.triggered_by}` on every step row, and the schema's enum already offers
 * `'auto' | 'manual' | 'resend'`. Only the VALUE was untruthful.
 *
 * The generation added for the dedupe key doubles as the signal: 0 = the run the
 * slip itself started, >0 = a leg the customer asked for.
 * แถวปกติต้องยังเป็น auto เป๊ะ — ห้ามเปลี่ยนความหมายของของเดิม
 */
import { legTriggeredBy } from '@/modules/payment';

describe('[FIX-20260817-RETRYTRIGGER] who started this leg', () => {
  it('🔴 a first run is still `auto` — the 134 existing rows keep their meaning', () => {
    expect(legTriggeredBy(0)).toBe('auto');
    expect(legTriggeredBy(undefined)).toBe('auto');
  });

  it('a leg run because the customer tapped [ลองใหม่] is `manual`', () => {
    expect(legTriggeredBy(1)).toBe('manual');
    expect(legTriggeredBy(2)).toBe('manual');
  });

  it('the value stays inside the schema enum', () => {
    const allowed = ['auto', 'manual', 'resend'];
    for (const g of [undefined, 0, 1, 5]) {
      expect(allowed).toContain(legTriggeredBy(g));
    }
  });
});
