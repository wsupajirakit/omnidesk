/* [FIX-20260818-CTXATTEMPT] one pass's audit row must never overwrite another's
 * ===========================================================================
 * WHY THIS EXISTS. `_context` found the job to attach to with
 * `{chain_run_id, chain_step}` newest-first, and its no-job upsert keyed on
 * `(chain_run_id, chain_step, target_key)`. Neither knew that a run can walk the
 * SAME step more than once — which is exactly what the [ลองใหม่] button makes it
 * do, because `_resume` re-enters LEG 1 and then LEG 2.
 *
 * On production run `a0d000000000000000000041` (owner-reported 18/08/2026) the
 * resume never POSTed to walletpay, so it created no job; `_context` then wrote its
 * `walletpay_exhausted` verdict onto the row belonging to the FIRST pass — a row
 * whose stored request was a walletpay POST that had answered 200
 * `SINGLE_NOT_MATCHED`. The audit page showed a `review` verdict sitting on a
 * successful upload, and the resume itself left no trace at all.
 *
 * WHAT IS PINNED
 *   1. a second pass does NOT attach to the first pass's job
 *   2. a second pass upserts under its own `attempt`, so the first row survives
 *   3. a second pass that never ran still gets its `not_sent` marker — the whole
 *      reason the row has to exist
 *   4. the FIRST pass is byte-identical to the old behaviour: it finds its job
 *      and updates by `_id`, exactly as before
 *   5. rows written BEFORE `attempt` existed still read as the first pass
 *      (`$in: [0, null]`, because `null` matches a missing field in MongoDB and
 *      `0` does not) — an in-flight run that resumes across the deploy must not
 *      be duplicated
 *   6. `attempt` is always in `$set`, because MongoDB does not build a field
 *      from an `$in` clause when an upsert inserts
 *
 * ⚠️ THE MONEY PATH IS NOT UNDER TEST HERE AND MUST NOT BE. `_context` writes an
 * audit row; it chooses no statement, sends no request and moves no slip lock.
 * เทสชุดนี้เป็นเรื่อง log ล้วน ๆ ไม่ใช่เส้นเงิน.
 */
import { Types } from 'mongoose';

/* The runner is reached directly: `_context` is private, and the payment barrel
   exports the module, not the class. Same import the sibling
   `step-not-run-log.spec.ts` already uses. */
// eslint-disable-next-line no-restricted-imports
import { PaymentRunnerService } from '@/modules/payment/payment-runner.service';

type ContextProbe = {
  jobModel: unknown;
  resultModel: unknown;
  _context: (
    runId: Types.ObjectId,
    slip: unknown,
    chainStep: number,
    role: string,
    cursor: number,
    extra: Record<string, unknown>,
    generation?: number,
  ) => Promise<void>;
};

const RUN_ID = new Types.ObjectId();
const AUTO_JOB_ID = new Types.ObjectId();
const SLIP = {
  _id: new Types.ObjectId(),
  sender_member_user_id: 'Uca2fc4d67057116b569bc11d7a60fd61',
} as never;

type JobRow = Record<string, unknown>;

/**
 * A stand-in for MongoDB's matcher, not a stub that says yes.
 *
 * The point of these tests is that `_context` puts `attempt` in its filter, and
 * a `findOne` mock that ignores the filter would pass whether it did or not —
 * the class of green-but-meaningless test this repo has already been bitten by.
 * So the fake applies equality and `$in` for real, and a missing field reads as
 * `null` exactly as MongoDB treats it.
 */
const idOf = (v: unknown): string | null =>
  v instanceof Types.ObjectId ? v.toHexString() : null;

/** Equal by value, with ObjectId compared by its hex — never by stringifying. */
const same = (want: unknown, got: unknown): boolean => {
  const wantId = idOf(want);
  if (wantId !== null) return wantId === idOf(got);
  return want === (got ?? null);
};

/** Mongo resolves a dotted key by walking into the document; a flat `row[key]`
 *  would read `undefined` for `'snapshot.stmt_idx'` and silently fail to match
 *  every job. [FIX-20260820-CTXCURSOR] put such a key into the lookup. */
const at = (row: JobRow, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (o, k) => (o as Record<string, unknown> | undefined)?.[k],
      row as unknown,
    );

const matches = (row: JobRow, filter: Record<string, unknown>): boolean =>
  Object.entries(filter).every(([key, want]) => {
    const got = at(row, key) ?? null;
    if (want && typeof want === 'object' && '$in' in want) {
      return (want as { $in: unknown[] }).$in.some((v) => same(v, got));
    }
    return same(want, got);
  });

function makeRunner(jobs: JobRow[]) {
  const calls: Array<{
    filter: Record<string, unknown>;
    update: Record<string, unknown>;
  }> = [];
  const lookups: Array<Record<string, unknown>> = [];

  const svc = Object.create(
    PaymentRunnerService.prototype,
  ) as unknown as ContextProbe;

  svc.jobModel = {
    findOne: (filter: Record<string, unknown>) => {
      lookups.push(filter);
      const hit = jobs.filter((j) => matches(j, filter)).at(-1) ?? null;
      return {
        sort: () => ({ lean: () => ({ exec: () => Promise.resolve(hit) }) }),
      };
    },
  };
  svc.resultModel = {
    updateOne: (
      filter: Record<string, unknown>,
      update: Record<string, unknown>,
    ) => {
      calls.push({ filter, update });
      return { exec: () => Promise.resolve({ upsertedCount: 1 }) };
    },
  };
  return { svc, calls, lookups };
}

/** The auto pass POSTed to walletpay, so its job exists.
 *
 *  [FIX-20260820-CTXCURSOR] `snapshot.stmt_idx` was added to these fixtures when
 *  the `_context` lookup learned the walk position. It is not a concession to
 *  the new filter — it is what `_logLeg` has ALWAYS written (`snapshot: {
 *  stmt_idx: a.cursor }`, present in this file's first commit, and `cursor` is a
 *  required `number`). `_logLeg` is the only `jobModel.create` in the repo, so a
 *  job row without it cannot exist; verified on the dev db — 197/197 rows carry
 *  it, 0 missing, across both steps. The fixtures were simply thinner than the
 *  real thing and the old lookup never noticed. fixture เดิมบางกว่าแถวจริง.
 */
const AUTO_WALLETPAY_JOB: JobRow = {
  _id: AUTO_JOB_ID,
  chain_run_id: RUN_ID,
  chain_step: 2,
  attempt: 0,
  snapshot: { stmt_idx: 0 },
  triggered_by: 'auto',
};

/** The same job as written before `attempt` was added to the schema. */
const LEGACY_WALLETPAY_JOB: JobRow = {
  _id: AUTO_JOB_ID,
  chain_run_id: RUN_ID,
  chain_step: 2,
  snapshot: { stmt_idx: 0 },
  triggered_by: 'auto',
};

const report = async (
  jobs: JobRow[],
  generation: number | undefined,
  extra: Record<string, unknown> = { outcome: 'TRUE', reason: '' },
) => {
  const { svc, calls, lookups } = makeRunner(jobs);
  await svc._context(RUN_ID, SLIP, 2, 'pay_walletpay', 0, extra, generation);
  return { call: calls[0]!, lookup: lookups[0]! };
};

const setOf = (u: Record<string, unknown>) =>
  u['$set'] as Record<string, unknown>;

describe('[CTXATTEMPT] a resume does not overwrite the first pass', () => {
  it('does not attach to the first pass job when reporting a later pass', async () => {
    const { call, lookup } = await report([AUTO_WALLETPAY_JOB], 1);

    // The auto job is the only one there; asking for pass 1 must not find it.
    expect(lookup['attempt']).toBe(1);
    expect(call.filter['_id']).toBeUndefined();
  });

  it('upserts the later pass under its own attempt, leaving the first row alone', async () => {
    const { call } = await report([AUTO_WALLETPAY_JOB], 1);

    expect(call.filter).toMatchObject({
      chain_step: 2,
      target_key: 'pay_walletpay',
      attempt: 1,
    });
    expect(String(call.filter['chain_run_id'])).toBe(String(RUN_ID));
    expect(setOf(call.update)['attempt']).toBe(1);
  });

  it('gives the resume its own not_sent marker instead of silence', async () => {
    const { call } = await report([AUTO_WALLETPAY_JOB], 1, {
      outcome: 'TRUE',
      reason: 'walletpay_exhausted',
    });

    const final = (
      call.update['$setOnInsert'] as
        | { final?: { received_via?: string; parsed?: { reason?: string } } }
        | undefined
    )?.final;
    expect(final?.received_via).toBe('not_sent');
    expect(final?.parsed?.reason).toBe('walletpay_exhausted');
  });
});

describe('[CTXATTEMPT] the first pass keeps its old behaviour exactly', () => {
  it('finds its own job and updates by _id, as before', async () => {
    const { call } = await report([AUTO_WALLETPAY_JOB], undefined);

    expect(String(call.filter['_id'])).toBe(String(AUTO_JOB_ID));
    expect(call.filter['attempt']).toBeUndefined();
    // No `$setOnInsert`: a leg that RAN owns its `final` via `_storeRaw`, and
    // overwriting it would destroy the record of a real money call.
    expect(call.update['$setOnInsert']).toBeUndefined();
  });

  it('treats generation 0 the same as generation undefined', async () => {
    const explicit = await report([AUTO_WALLETPAY_JOB], 0);
    const implicit = await report([AUTO_WALLETPAY_JOB], undefined);

    expect(String(explicit.call.filter['_id'])).toBe(
      String(implicit.call.filter['_id']),
    );
  });

  it('still stamps attempt on the job path so the row can be grouped', async () => {
    const { call } = await report([AUTO_WALLETPAY_JOB], undefined);

    expect(setOf(call.update)['attempt']).toBe(0);
  });
});

describe('[CTXATTEMPT] rows written before the field existed still work', () => {
  it('matches a legacy job that carries no attempt at all', async () => {
    const { call } = await report([LEGACY_WALLETPAY_JOB], undefined);

    // Plain `attempt: 0` would miss it and upsert a duplicate row instead.
    expect(String(call.filter['_id'])).toBe(String(AUTO_JOB_ID));
  });

  it('asks with $in so a missing field counts as the first pass', async () => {
    const { lookup } = await report([LEGACY_WALLETPAY_JOB], undefined);

    expect(lookup['attempt']).toEqual({ $in: [0, null] });
  });

  it('does not let a legacy job answer for a resume', async () => {
    const { call } = await report([LEGACY_WALLETPAY_JOB], 1);

    expect(call.filter['_id']).toBeUndefined();
    expect(call.filter['attempt']).toBe(1);
  });
});
