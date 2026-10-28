/* [FIX-20260818-STEPTIMEORDER] the audit page must show steps in the order they HAPPENED
 * ===========================================================================
 * WHY THIS EXISTS. `getRun` sorted `steps` on `chain_step` alone. That read
 * correctly while a run walked its legs exactly once (1 then 2) — which is why
 * every existing spec stayed green and this defect survived: no fixture ever
 * had a run enter the same leg twice.
 *
 * The [ลองใหม่] button makes that happen. A resume re-enters LEG 1, so a real
 * run is:
 *     step1(auto) → step2(auto) → step1(manual)
 * and the old comparator rendered it as
 *     step1(auto) → step1(manual) → step2(auto)
 * splicing the second attempt into the first: the resume's topup appeared
 * BEFORE a walletpay call that had already happened two and a half minutes
 * earlier. An operator could not tell which pass a row belonged to.
 *
 * Owner-reported 18/08/2026 against production run `a0d000000000000000000041`
 * (member Uca2fc4d6…fd61, slip 100 THB). THE FIXTURES BELOW ARE THAT RUN — its
 * three stored legs with their real timestamps, not invented shapes. See the
 * note above `RunProbe` for why there is no fourth row.
 *
 * WHAT IS PINNED
 *   1. steps come out in real-time order across attempts
 *   2. `occurred_at` is exposed so the ordering is auditable, not magic
 *   3. FALLBACK: rows with no usable timestamp keep the old `chain_step` order
 *      — this is the guarantee that nothing already stored can be reordered
 *      into nonsense
 *   4. a row with a broken timestamp is treated as "no timestamp", never as 0
 *      (epoch would sort it to the front of every run)
 *   5. ties fall through to `chain_step`
 *
 * ⚠️ DISPLAY ONLY. Nothing here touches which statement is tried or how a slip
 * is locked — this suite must never need a money assertion.
 */
import { Types } from 'mongoose';

/* The handoff barrel deliberately keeps the service internal, so a unit test
   has to reach for the class directly. Widening the barrel to satisfy a lint
   rule would grow the module's public surface for a test — the wrong trade.
   Same import the sibling `chain-steps-nojob.spec.ts` already uses. */
// eslint-disable-next-line no-restricted-imports
import { HandoffChainService } from '@/modules/handoff/handoff-chain.service';

const RUN_ID = new Types.ObjectId();

/** Real timestamps from run 6a83e019…1131, in the order they occurred. */
const T_TOPUP_AUTO = '2026-08-18T04:31:22.156Z';
const T_WALLETPAY_AUTO = '2026-08-18T04:31:22.816Z';
const T_TOPUP_MANUAL = '2026-08-18T04:33:51.568Z';

const job = (
  id: Types.ObjectId,
  chainStep: number,
  targetKey: string,
  triggeredBy: string,
  createdAt: string | null,
) => ({
  _id: id,
  job_ref: `hj_${targetKey}_${triggeredBy}`,
  chain_run_id: RUN_ID,
  chain_step: chainStep,
  target_key: targetKey,
  triggered_by: triggeredBy,
  status: 'done',
  outcome_code: 'FALSE',
  snapshot: { stmt_idx: 0 },
  created_at: createdAt,
});

const resultFor = (
  id: Types.ObjectId,
  chainStep: number,
  targetKey: string,
) => ({
  _id: id,
  chain_run_id: RUN_ID,
  chain_step: chainStep,
  target_key: targetKey,
  context: { reason: 'account-not-match' },
  request: { method: 'POST', url: 'https://shop-api/validate-slip' },
  final: { received_via: 'sync', http_status: 200 },
});

const ID_TOPUP_AUTO = new Types.ObjectId();
const ID_WALLETPAY_AUTO = new Types.ObjectId();
const ID_TOPUP_MANUAL = new Types.ObjectId();

/* ⚠️ THE RUN HAS ONLY THREE ROWS, AND THAT IS THE BUG NEXT DOOR — NOT A GAP HERE.
 * The resume's walletpay leg produced NO row of its own: it never POSTed, so no job
 * was created, and `_context`'s no-job upsert keys on
 * (chain_run_id, chain_step, target_key) — which matches the AUTO attempt's row
 * and overwrites its `context` instead of inserting a fourth row. That is why
 * the live page shows `step2 · auto` carrying a `walletpay_exhausted` verdict on top
 * of a request that genuinely succeeded.
 * Separating the attempts needs an attempt field on `handoff_results`, i.e. a
 * schema change, so it is deliberately NOT part of this display-only fix. When
 * that lands, add the fourth row here and extend the expectations below.
 * รอบ retry ยังไม่มีแถวของตัวเอง — ต้องเพิ่ม field ก่อน ถึงจะแยกได้. */

type RunProbe = {
  chainRunModel: unknown;
  jobModel: unknown;
  resultModel: unknown;
  slipModel: unknown;
  attachMembers: (runs: unknown[]) => Promise<unknown[]>;
  assertObjectId: (id: unknown) => void;
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
  /* Mirrors the real query: jobs arrive already sorted `created_at: 1`. */
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

/** `step<n> <target> <auto|manual>` — the shape an operator reads off the page. */
const label = (s: Record<string, unknown>) => {
  const by = s['triggered_by'];
  return `step${String(s['chain_step'])} ${String(s['target_key'])} ${
    typeof by === 'string' ? by : 'skipped'
  }`;
};

describe('[STEPTIMEORDER] steps render in the order they happened', () => {
  const JOBS_REAL = [
    job(ID_TOPUP_AUTO, 1, 'pay_topup', 'auto', T_TOPUP_AUTO),
    job(ID_WALLETPAY_AUTO, 2, 'pay_walletpay', 'auto', T_WALLETPAY_AUTO),
    job(ID_TOPUP_MANUAL, 1, 'pay_topup', 'manual', T_TOPUP_MANUAL),
  ];
  const RESULTS_REAL = [
    resultFor(ID_TOPUP_AUTO, 1, 'pay_topup'),
    resultFor(ID_WALLETPAY_AUTO, 2, 'pay_walletpay'),
    resultFor(ID_TOPUP_MANUAL, 1, 'pay_topup'),
  ];

  it('keeps the two attempts apart instead of grouping by step number', async () => {
    const steps = await getSteps(JOBS_REAL, RESULTS_REAL);

    // The old comparator produced auto/manual/auto — the resume's LEG 1 was
    // pulled up next to the first attempt's LEG 1, ahead of a walletpay call that
    // had already happened two and a half minutes earlier.
    expect(steps.map(label)).toEqual([
      'step1 pay_topup auto',
      'step2 pay_walletpay auto',
      'step1 pay_topup manual',
    ]);
  });

  it('exposes occurred_at so the ordering can be checked, not trusted', async () => {
    const steps = await getSteps(JOBS_REAL, RESULTS_REAL);

    expect(steps.map((s) => s['occurred_at'])).toEqual([
      T_TOPUP_AUTO,
      T_WALLETPAY_AUTO,
      T_TOPUP_MANUAL,
    ]);
  });

  it('puts the walletpay call BEFORE the resume topup, not after it', async () => {
    const steps = await getSteps(JOBS_REAL, RESULTS_REAL);
    const walletpayAt = steps.findIndex(
      (s) => s['target_key'] === 'pay_walletpay',
    );
    const resumeAt = steps.findIndex((s) => s['triggered_by'] === 'manual');

    expect(walletpayAt).toBeLessThan(resumeAt);
  });
});

describe('[STEPTIMEORDER] fallback — nothing already stored gets reordered', () => {
  it('falls back to chain_step order when no row carries a timestamp', async () => {
    const jobs = [
      job(ID_WALLETPAY_AUTO, 2, 'pay_walletpay', 'auto', null),
      job(ID_TOPUP_AUTO, 1, 'pay_topup', 'auto', null),
    ];
    const steps = await getSteps(jobs, [
      resultFor(ID_WALLETPAY_AUTO, 2, 'pay_walletpay'),
      resultFor(ID_TOPUP_AUTO, 1, 'pay_topup'),
    ]);

    expect(steps.map((s) => s['chain_step'])).toEqual([1, 2]);
  });

  /* The broken row is paired with a GOOD one on purpose. Two broken rows both
     collapse to the same value whatever the fallback is, so that pairing can
     never tell `NaN` from `0` — it looked like a test and measured nothing. */
  it('treats an unparseable timestamp as absent, never as epoch 0', async () => {
    const jobs = [
      job(ID_WALLETPAY_AUTO, 2, 'pay_walletpay', 'auto', 'not-a-date'),
      job(ID_TOPUP_AUTO, 1, 'pay_topup', 'auto', T_TOPUP_AUTO),
    ];
    const steps = await getSteps(jobs, [
      resultFor(ID_WALLETPAY_AUTO, 2, 'pay_walletpay'),
      resultFor(ID_TOPUP_AUTO, 1, 'pay_topup'),
    ]);

    // Epoch 0 would beat every real timestamp and drag step 2 to the front.
    expect(steps.map((s) => s['chain_step'])).toEqual([1, 2]);
  });

  it('orders a step that never ran by its own row timestamp', async () => {
    /* The shape `[FIX-20260815-STEPNOJOBVISIBLE]` made visible: LEG 2 stopped
       before any job existed, so only a `not_sent` result row records it. It
       still has to land in time order like everything else. */
    const skipped = {
      _id: new Types.ObjectId(),
      chain_run_id: RUN_ID,
      chain_step: 2,
      target_key: 'pay_walletpay',
      created_at: T_WALLETPAY_AUTO,
      context: { reason: 'no_matching_statement', stmt_idx: 0 },
      final: {
        received_via: 'not_sent',
        parsed: { skipped: true, reason: 'no_matching_statement' },
      },
    };
    const jobs = [
      job(ID_TOPUP_MANUAL, 1, 'pay_topup', 'manual', T_TOPUP_MANUAL),
      job(ID_TOPUP_AUTO, 1, 'pay_topup', 'auto', T_TOPUP_AUTO),
    ];
    const steps = await getSteps(jobs, [
      resultFor(ID_TOPUP_MANUAL, 1, 'pay_topup'),
      resultFor(ID_TOPUP_AUTO, 1, 'pay_topup'),
      skipped,
    ]);

    // Without `occurred_at` on the skipped row it falls back to chain_step and
    // sinks to the end, behind a topup that ran two minutes later.
    expect(steps.map(label)).toEqual([
      'step1 pay_topup auto',
      'step2 pay_walletpay skipped',
      'step1 pay_topup manual',
    ]);
    expect(steps[1]!['occurred_at']).toBe(T_WALLETPAY_AUTO);
  });

  it('falls back to chain_step when two rows share a timestamp', async () => {
    const same = '2026-08-18T04:31:22.000Z';
    const jobs = [
      job(ID_WALLETPAY_AUTO, 2, 'pay_walletpay', 'auto', same),
      job(ID_TOPUP_AUTO, 1, 'pay_topup', 'auto', same),
    ];
    const steps = await getSteps(jobs, [
      resultFor(ID_WALLETPAY_AUTO, 2, 'pay_walletpay'),
      resultFor(ID_TOPUP_AUTO, 1, 'pay_topup'),
    ]);

    expect(steps.map((s) => s['chain_step'])).toEqual([1, 2]);
  });

  it('orders a timestamped row against an untimestamped one by chain_step', async () => {
    const jobs = [
      job(ID_TOPUP_AUTO, 1, 'pay_topup', 'auto', T_TOPUP_AUTO),
      job(ID_WALLETPAY_AUTO, 2, 'pay_walletpay', 'auto', null),
    ];
    const steps = await getSteps(jobs, [
      resultFor(ID_TOPUP_AUTO, 1, 'pay_topup'),
      resultFor(ID_WALLETPAY_AUTO, 2, 'pay_walletpay'),
    ]);

    expect(steps.map((s) => s['chain_step'])).toEqual([1, 2]);
  });
});
