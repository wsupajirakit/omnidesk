/* [FIX-20260818-CTXSLOT] one walk position = one audit row (log-only fix)
 * ===========================================================================
 * Found live on the beta lane while planting a walletpay statement: the no-job
 * upsert filter in `_context` was `{run, step, target, attempt}` — NO walk
 * position — so every no-job row of one pass (each per-statement skip AND the
 * end-of-walk summary) collapsed into a single document. The vendor's answer
 * survived inside `final`, but the per-statement story was overwritten; the
 * summary also wrote at a hard-coded cursor 0, mislabelling itself as ใบแรก.
 *
 * Money safety, verified before this change: nothing decision-making reads
 * these rows — resume claims on `handoff_chain_runs.status/resume_cursor`,
 * callback/job services address results by `_id`, and the two readers
 * (chain log page, walletpay history) are display. จอแสดงผลเท่านั้น เงินไม่เกี่ยว.
 *
 * The fix, and what these specs pin:
 *  1. the no-job filter carries `'context.stmt_idx': cursor` — one row per
 *     walk position, so ใบ 0 / ใบ 1 / summary can coexist;
 *  2. same position re-written in the same pass still merges (that dedupe is
 *     the point of the upsert);
 *  3. the summary writes at stmt_idx -1 — "the whole walk", never a real ใบ.
 *     -1 also never matches a statement in walletpay-history's fallback picker,
 *     which is the correct blank for a summary row;
 *  4. the JOB path (money legs) is untouched: same `{_id}` filter as before.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Types } from 'mongoose';

// eslint-disable-next-line no-restricted-imports -- same import the sibling context specs use
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
const SLIP = {
  _id: new Types.ObjectId(),
  sender_member_user_id: 'U1',
} as never;

type Row = Record<string, unknown>;

function makeRunner(jobs: Row[]) {
  const calls: Array<{ filter: Row; update: Row }> = [];
  const svc = Object.create(PaymentRunnerService.prototype) as ContextProbe;
  svc.jobModel = {
    findOne: () => ({
      sort: () => ({
        lean: () => ({ exec: () => Promise.resolve(jobs.at(-1) ?? null) }),
      }),
    }),
  };
  svc.resultModel = {
    updateOne: (filter: Row, update: Row) => {
      calls.push({ filter, update });
      return { exec: () => Promise.resolve({ upsertedCount: 1 }) };
    },
  };
  return { svc, calls };
}

describe('[FIX-20260818-CTXSLOT] the no-job filter carries the walk position', () => {
  it('two positions in one pass get two DIFFERENT filters', async () => {
    const { svc, calls } = makeRunner([]);
    await svc._context(RUN_ID, SLIP, 2, 'pay_walletpay', 0, {
      reason: 'walletpay_no_ref_id',
    });
    await svc._context(RUN_ID, SLIP, 2, 'pay_walletpay', 1, {
      reason: 'walletpay_txn_not_found',
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.filter['context.stmt_idx']).toBe(0);
    expect(calls[1]!.filter['context.stmt_idx']).toBe(1);
    // and the rest of the filter still scopes to the pass, as before
    for (const c of calls) {
      expect(c.filter['chain_run_id']).toBe(RUN_ID);
      expect(c.filter['chain_step']).toBe(2);
      expect(c.filter['target_key']).toBe('pay_walletpay');
      expect(c.filter['attempt']).toBeDefined();
    }
  });

  it('the same position re-written still merges (identical filter)', async () => {
    const { svc, calls } = makeRunner([]);
    await svc._context(RUN_ID, SLIP, 2, 'pay_walletpay', 1, { reason: 'a' });
    await svc._context(RUN_ID, SLIP, 2, 'pay_walletpay', 1, { reason: 'b' });
    expect(calls[0]!.filter).toEqual(calls[1]!.filter);
  });

  it('a summary slot (-1) never collides with a real ใบ', async () => {
    const { svc, calls } = makeRunner([]);
    await svc._context(RUN_ID, SLIP, 2, 'pay_walletpay', 0, {
      reason: 'walletpay_txn_not_found',
    });
    await svc._context(RUN_ID, SLIP, 2, 'pay_walletpay', -1, {
      reason: 'walletpay_stale_statements',
    });
    expect(calls[0]!.filter['context.stmt_idx']).toBe(0);
    expect(calls[1]!.filter['context.stmt_idx']).toBe(-1);
    expect(calls[0]!.filter).not.toEqual(calls[1]!.filter);
  });

  it('the summary NEVER attaches to a leg job, even when one exists', async () => {
    // Found live, second layer of the same collision: with a sent leg in the
    // pass, the summary's job lookup found that leg's job and overwrote the
    // leg row's per-ใบ context. A summary is not about any leg — it must take
    // the no-job path unconditionally.
    const jobId = new Types.ObjectId();
    const { svc, calls } = makeRunner([{ _id: jobId, attempt: 0 }]);
    await svc._context(RUN_ID, SLIP, 2, 'pay_walletpay', -1, {
      reason: 'walletpay_stale_statements',
    });
    expect(calls[0]!.filter['_id']).toBeUndefined();
    expect(calls[0]!.filter['context.stmt_idx']).toBe(-1);
  });

  it('the job path still updates by _id — money legs untouched', async () => {
    const jobId = new Types.ObjectId();
    const { svc, calls } = makeRunner([{ _id: jobId, attempt: 0 }]);
    await svc._context(RUN_ID, SLIP, 2, 'pay_walletpay', 1, {
      reason: 'no_matching_statement',
    });
    expect(calls[0]!.filter).toEqual({ _id: jobId });
    expect(calls[0]!.filter['context.stmt_idx']).toBeUndefined();
  });
});

describe('[FIX-20260818-CTXSLOT] the walk summary names its own slot', () => {
  /** Comments stripped so the assertion can only match real code. */
  const src = readFileSync(
    join(
      __dirname,
      '..',
      '..',
      'src',
      'modules',
      'payment',
      'payment-runner.service.ts',
    ),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('_statementFallback writes its summary at -1, not on ใบแรก', () => {
    // The fallback's _context call: step 2, pay_walletpay, then the slot.
    expect(src).toMatch(
      /await this\._context\(\s*runId,\s*slip,\s*2,\s*'pay_walletpay',\s*-1,/,
    );
    // and the old hard-coded 0 call is gone
    expect(src).not.toMatch(
      /await this\._context\(\s*runId,\s*slip,\s*2,\s*'pay_walletpay',\s*0,/,
    );
  });
});
