/* [FIX-20260815-STEPNOJOBVISIBLE] the audit page must show BOTH kinds of step
 * ===========================================================================
 * `getRun` built `steps` from `jobs.map(...)`, and fetched results by job id.
 * Both halves assume every step has a job. A leg that aborts BEFORE its job is
 * created (`no_matching_statement`, `no_walletpay_endpoint`, `walletpay_tool_invalid`)
 * never gets one, so its row — written by `[FEAT-20260810-CTXNOJOB]` and keyed
 * on (chain_run_id, chain_step, target_key) — was filtered out and the step
 * vanished from the page.
 *
 * Owner-reported 15/08/2026 ("log step สองก็ไม่โผล่"), confirmed on run
 * 6a802de9…3c05: Mongo held step 2 with `reason:'no_matching_statement'` and a
 * populated `final.parsed`, while the screen showed step 1 alone.
 *
 * OWNER'S REQUIREMENT, PINNED HERE: "ต้องแสดงผลทั้งแบบเดิม + ใหม่ คู่ แสดงทั้งหมด"
 * — the ran-legs must keep rendering EXACTLY as before, and the skipped legs
 * appear alongside them. Not one replacing the other.
 *
 * WHAT IS PINNED
 *   1. both kinds appear together, in `chain_step` order
 *      — [FIX-20260818-STEPTIMEORDER] `getRun` now orders on real time first and
 *        uses `chain_step` only as the FALLBACK. None of the rows below carry a
 *        `created_at`, so they take that fallback and these expectations are
 *        unchanged on purpose: this suite is now also the guard that nothing
 *        already stored gets reordered. Time-ordering itself is pinned in
 *        `chain-step-time-order.spec.ts`.
 *   2. a job-backed step keeps every field it had before (regression guard)
 *   3. a skipped step carries its reason and its `final`
 *   4. `request` stays null on a skipped step — the absence IS the information
 *      ("nothing was ever sent"); faking it would hide a real never-sent leg
 *   5. no duplicates when a step has both a job and a result row
 *   6. a run with only job-backed steps is byte-identical to the old behaviour
 */
import { Types } from 'mongoose';

import { HandoffChainService } from '@/modules/handoff/handoff-chain.service';

const RUN_ID = new Types.ObjectId();
const JOB_ID = new Types.ObjectId();

const JOB_ROW = {
  _id: JOB_ID,
  job_ref: 'hj_step1',
  chain_run_id: RUN_ID,
  chain_step: 1,
  target_key: 'pay_topup',
  triggered_by: 'auto',
  status: 'done',
  outcome_code: 'FALSE',
  snapshot: { stmt_idx: 0, statement_ref: 'ST-1' },
};

/** The result row that belongs to the job above. */
const JOB_RESULT = {
  _id: JOB_ID,
  chain_run_id: RUN_ID,
  chain_step: 1,
  target_key: 'pay_topup',
  context: { reason: 'account-not-match' },
  request: { method: 'POST', url: 'https://shop-api/validate-slip' },
  final: { received_via: 'sync', http_status: 200 },
};

/** The orphan: a leg that stopped before any job was created. */
const SKIPPED_RESULT = {
  _id: new Types.ObjectId(),
  chain_run_id: RUN_ID,
  chain_step: 2,
  target_key: 'pay_walletpay',
  context: { reason: 'no_matching_statement', stmt_idx: 0 },
  final: {
    received_via: 'not_sent',
    parsed: {
      skipped: true,
      reason: 'no_matching_statement',
      note: 'ไม่ได้ยิง',
    },
  },
};

type RunProbe = {
  chainRunModel: unknown;
  jobModel: unknown;
  resultModel: unknown;
  slipModel: unknown;
  attachMembers: (runs: unknown[]) => Promise<unknown[]>;
  assertObjectId: (id: unknown) => void;
  /** The controller-shaped envelope: `{ data: { run, steps, slip } }`. */
  getRun: (
    id: string,
  ) => Promise<{ data: { steps: Array<Record<string, unknown>> } }>;
};

function makeService(jobs: unknown[], results: unknown[]) {
  const svc = Object.create(
    HandoffChainService.prototype,
  ) as unknown as RunProbe;

  svc.assertObjectId = () => undefined;
  svc.attachMembers = (runs: unknown[]) => Promise.resolve(runs);
  svc.chainRunModel = {
    findById: () => ({
      lean: () => ({ exec: () => Promise.resolve({ _id: RUN_ID }) }),
    }),
  };
  svc.jobModel = {
    find: () => ({
      sort: () => ({ lean: () => ({ exec: () => Promise.resolve(jobs) }) }),
    }),
  };
  svc.resultModel = {
    find: () => ({ lean: () => ({ exec: () => Promise.resolve(results) }) }),
  };
  svc.slipModel = {
    findById: () => ({
      lean: () => ({ exec: () => Promise.resolve(null), catch: () => null }),
    }),
  };
  return svc;
}

const getSteps = async (jobs: unknown[], results: unknown[]) =>
  (await makeService(jobs, results).getRun(String(RUN_ID))).data.steps;

describe('[STEPNOJOBVISIBLE] ran legs and skipped legs are shown together', () => {
  it('returns BOTH kinds, in chain_step order', async () => {
    const steps = await getSteps([JOB_ROW], [JOB_RESULT, SKIPPED_RESULT]);

    expect(steps).toHaveLength(2);
    expect(steps.map((s) => s['chain_step'])).toEqual([1, 2]);
    expect(steps.map((s) => s['target_key'])).toEqual([
      'pay_topup',
      'pay_walletpay',
    ]);
  });

  /* REGRESSION GUARD: the ran leg must be untouched by this change. */
  it('a job-backed step keeps every field it had before', async () => {
    const [step1] = await getSteps([JOB_ROW], [JOB_RESULT, SKIPPED_RESULT]);

    expect(step1!['job_ref']).toBe('hj_step1');
    expect(step1!['status']).toBe('done');
    expect(step1!['outcome_code']).toBe('FALSE');
    expect(step1!['stmt_idx']).toBe(0);
    expect(step1!['statement_ref']).toBe('ST-1');
    expect(step1!['request']).toEqual(JOB_RESULT.request);
    expect(step1!['final']).toEqual(JOB_RESULT.final);
    expect(step1!['context']).toEqual(JOB_RESULT.context);
  });

  it('a skipped step carries its reason and its final', async () => {
    const steps = await getSteps([JOB_ROW], [JOB_RESULT, SKIPPED_RESULT]);
    const step2 = steps[1]!;

    expect(step2['status']).toBe('skipped');
    expect(step2['outcome_code']).toBe('no_matching_statement');
    expect(
      (step2['final'] as { parsed?: { reason?: string } })?.parsed?.reason,
    ).toBe('no_matching_statement');
  });

  /* The absence of `request` is the information: nothing was ever sent. */
  it('leaves request null on a skipped step rather than faking one', async () => {
    const steps = await getSteps([JOB_ROW], [JOB_RESULT, SKIPPED_RESULT]);

    expect(steps[1]!['request']).toBeNull();
    expect(steps[1]!['job_ref']).toBeNull();
  });

  it('does not duplicate a step that has both a job and a result', async () => {
    const steps = await getSteps([JOB_ROW], [JOB_RESULT]);

    expect(steps).toHaveLength(1);
    expect(steps[0]!['job_ref']).toBe('hj_step1');
  });

  /* A run whose legs all ran must behave exactly as it did before the fix. */
  it('a run with only job-backed steps is unchanged', async () => {
    const steps = await getSteps([JOB_ROW], [JOB_RESULT]);

    expect(steps.every((s) => s['status'] !== 'skipped')).toBe(true);
  });

  it('shows a skipped step even when NO leg ran at all', async () => {
    const steps = await getSteps([], [SKIPPED_RESULT]);

    expect(steps).toHaveLength(1);
    expect(steps[0]!['chain_step']).toBe(2);
    expect(steps[0]!['status']).toBe('skipped');
  });
});

/* [FIX-20260818-CTXATTEMPT] a later pass's skipped leg must not be filtered out
 * ===========================================================================
 * CAUGHT LIVE, not by reasoning: after `_context` started giving each pass its
 * own row, run `6a82e187…a955` held FOUR rows in Mongo while
 * `GET /api/handoff/chain-runs/:id` returned three. The missing one was the
 * resume's `step2 · not_sent` — precisely the evidence that the retry never
 * called walletpay, which is the whole reason the row exists.
 *
 * WHY IT VANISHED: `jobStepKeys` was built from `(chain_step, target_key)`, so
 * the FIRST pass's walletpay job claimed every step-2 result row in the run. The
 * key now carries `attempt` as well.
 *
 * ⚠️ This is the second time this filter has hidden a real row (see
 * `[FIX-20260815-STEPNOJOBVISIBLE]` at the top). Both times the data was in
 * Mongo and the page was the liar. อย่าเชื่อหน้าจอ ให้เทียบกับแถวจริงเสมอ.
 */
describe('[CTXATTEMPT] a skipped leg from a later pass still appears', () => {
  const AUTO_WALLETPAY_JOB = {
    _id: new Types.ObjectId(),
    job_ref: 'hj_walletpay_auto',
    chain_run_id: RUN_ID,
    chain_step: 2,
    target_key: 'pay_walletpay',
    triggered_by: 'auto',
    attempt: 0,
    status: 'done',
    snapshot: { stmt_idx: 0 },
  };
  const AUTO_WALLETPAY_RESULT = {
    _id: AUTO_WALLETPAY_JOB._id,
    chain_run_id: RUN_ID,
    chain_step: 2,
    target_key: 'pay_walletpay',
    attempt: 0,
    context: { reason: 'no_match' },
    request: { method: 'POST', url: 'https://walletpay/payin/x/slip' },
    final: { received_via: 'sync', http_status: 200 },
  };
  /** The resume stopped before its own POST, so it has a row but no job. */
  const RESUME_WALLETPAY_SKIPPED = {
    _id: new Types.ObjectId(),
    chain_run_id: RUN_ID,
    chain_step: 2,
    target_key: 'pay_walletpay',
    attempt: 1,
    context: { reason: 'no_matching_statement', stmt_idx: 0 },
    final: {
      received_via: 'not_sent',
      parsed: { skipped: true, reason: 'no_matching_statement' },
    },
  };

  const bothPasses = () =>
    getSteps(
      [AUTO_WALLETPAY_JOB],
      [AUTO_WALLETPAY_RESULT, RESUME_WALLETPAY_SKIPPED],
    );

  it('shows both the pass that ran and the pass that did not', async () => {
    const steps = await bothPasses();

    expect(steps).toHaveLength(2);
    expect(steps.map((s) => s['attempt'])).toEqual([0, 1]);
  });

  it('keeps the ran pass intact — its request is not replaced', async () => {
    const [ran] = await bothPasses();

    expect(ran!['status']).toBe('done');
    expect(ran!['request']).toEqual(AUTO_WALLETPAY_RESULT.request);
    expect((ran!['context'] as { reason?: string }).reason).toBe('no_match');
  });

  it('marks the later pass as skipped and never sent', async () => {
    const steps = await bothPasses();
    const resume = steps[1]!;

    expect(resume['status']).toBe('skipped');
    expect(resume['request']).toBeNull();
    expect((resume['final'] as { received_via?: string }).received_via).toBe(
      'not_sent',
    );
  });
});
