/**
 * [FEAT-20260816-WALLETPAYSTMT] + [FEAT-20260816-WALLETPAYTRACE]
 *
 * The WalletPay card answers two operator questions that the leg row alone cannot:
 *   · WHICH deposit did this leg fire against?  → `statement_id` (+ its amount)
 *   · WHERE is this in the handoff log?         → `run_id` + `job_ref`
 *
 * `statement_id` is joined from the run's OWN snapshot (`raw_transaction.
 * statement[]`), matched by refId first and by cursor position only as a
 * fallback — never "probably the first one".
 *
 * Shapes here are copied from real rows read out of `local_db_10_aug_26`
 * (16/08): the statement carries the id under `statement_id`, the refId under
 * `info.trade_no` / `info.response.data.id`, and `ref_id` is the OTHER uuid that
 * walletpay rejects — so a match on `ref_id` alone would be the wrong row.
 */
import { WalletpayHistoryService } from '@/modules/chat/walletpay-history/walletpay-history.service';

const REF = '00000000-0000-4000-8000-000000000029';
const OTHER_REF = '00000000-0000-4000-8000-000000000020';
const RUN_ID = 'a0d000000000000000000090';

const statement = (id: string, tradeNo: string, amount: number) => ({
  statement_id: id,
  amount,
  status: 'waiting-deposit',
  provider_code: 'walletpay',
  ref_id: 'f26da23a-6e3b-456e-87fa-5aa65d5213084', // the uuid walletpay rejects
  info: { trade_no: tradeNo, response: { data: { id: tradeNo } } },
});

/** result doc as stored, for the leg that fired `ref` at cursor `idx` */
const resultDoc = (ref: string, idx: number) => ({
  _id: 'RESULT_1',
  chain_run_id: RUN_ID,
  job_ref: 'hj_c_1k04rir9f_aa91dd3381',
  target_key: 'pay_walletpay',
  created_at: new Date('2026-08-16T08:39:02.196Z'),
  context: { outcome: 'TRUE', statement_ref: ref, stmt_idx: idx },
  final: { http_status: 200 },
});

/** minimal model doubles — the service only reads. */
function makeService(opts: {
  results: unknown[];
  runs: unknown[];
  runsThrow?: boolean;
}) {
  const chain = (val: unknown) => ({
    sort: () => chain(val),
    skip: () => chain(val),
    limit: () => chain(val),
    lean: () => chain(val),
    exec: () => Promise.resolve(val),
  });
  const resultModel = {
    countDocuments: () => ({
      exec: () => Promise.resolve(opts.results.length),
    }),
    find: () => chain(opts.results),
  };
  const runModel = {
    find: () =>
      opts.runsThrow
        ? {
            lean: () => ({
              exec: () => Promise.reject(new Error('mongo down')),
            }),
          }
        : chain(opts.runs),
  };
  return new WalletpayHistoryService(resultModel as never, runModel as never);
}

const runDoc = (...stmts: unknown[]) => ({
  _id: RUN_ID,
  raw_transaction: { statement: stmts },
});

describe('[WALLETPAYCARD] statement + trace join', () => {
  /* [FIX-20260816-REFIDSOURCE] the shape of a REAL stored row (read from
     local_db_10_aug_26, 16/08): `context.statement_ref` is absent, the refId
     lives in `request.body.refId`, and `stmt_idx` points PAST a one-item
     snapshot. The first implementation resolved nothing for these — this case
     is the regression guard. */
  it('(J0 ⭐ REAL ROW) resolves from request.body.refId with stmt_idx past the end', async () => {
    const realRow = {
      _id: 'a0d000000000000000000091',
      chain_run_id: RUN_ID,
      job_ref: 'hj_c_1k04rir9f_aa91dd3381',
      target_key: 'pay_walletpay',
      created_at: new Date('2026-08-16T08:39:02.196Z'),
      context: {
        outcome: 'TRUE',
        stmt_idx: 1,
        review_reason: 'walletpay_exhausted',
      },
      request: { body: { refId: REF } },
      final: { http_status: 200, raw: { refId: REF } },
    };
    const svc = makeService({
      results: [realRow],
      runs: [runDoc(statement('01KY4R7EQEBKHBAXYWN8WF339B', REF, 400))],
    });
    const page = await svc.list('U1', 1, 10);
    expect(page.rows[0]?.ref).toBe(REF);
    expect(page.rows[0]?.statement_id).toBe('01KY4R7EQEBKHBAXYWN8WF339B');
    expect(page.rows[0]?.statement_amount).toBe(400);
  });

  it('(J1 ⭐) joins the statement the leg actually fired at, matched by refId', async () => {
    const svc = makeService({
      results: [resultDoc(REF, 0)],
      // the WRONG row sits first on purpose — position must not decide the match
      runs: [
        runDoc(
          statement('01OTHER', OTHER_REF, 100),
          statement('01KY4R7EQ', REF, 400),
        ),
      ],
    });
    const page = await svc.list('U1', 1, 10);
    expect(page.rows[0]?.statement_id).toBe('01KY4R7EQ');
    expect(page.rows[0]?.statement_amount).toBe(400);
  });

  it('(J2) falls back to the cursor position when the leg stored no refId', async () => {
    const svc = makeService({
      results: [resultDoc('', 1)],
      runs: [
        runDoc(statement('01A', OTHER_REF, 100), statement('01B', REF, 400)),
      ],
    });
    const page = await svc.list('U1', 1, 10);
    expect(page.rows[0]?.statement_id).toBe('01B');
  });

  it('(J3) no statement in the snapshot ⇒ blanks, never a guess', async () => {
    const svc = makeService({ results: [resultDoc(REF, 0)], runs: [runDoc()] });
    const page = await svc.list('U1', 1, 10);
    expect(page.rows[0]?.statement_id).toBe('');
    expect(page.rows[0]?.statement_amount).toBeNull();
  });

  it('(J4 ⭐ STAND-ALONE) the run lookup failing does NOT fail the page', async () => {
    const svc = makeService({
      results: [resultDoc(REF, 0)],
      runs: [],
      runsThrow: true,
    });
    const page = await svc.list('U1', 1, 10);
    expect(page.rows).toHaveLength(1); // the leg still renders
    expect(page.rows[0]?.statement_id).toBe('');
  });

  it('(J5) carries the handoff trace handles so the row can be found in the log', async () => {
    const svc = makeService({
      results: [resultDoc(REF, 0)],
      runs: [runDoc(statement('01KY4R7EQ', REF, 400))],
    });
    const page = await svc.list('U1', 1, 10);
    /* [FIX-20260816-TRACEBLUR] flipped: the handles are blurred BEFORE the
       response leaves the service, so the assertion is "recognisable ends",
       not "equal to the raw id". */
    expect(page.rows[0]?.run_id).not.toBe(RUN_ID);
    expect(page.rows[0]?.run_id).toContain('…');
    expect(page.rows[0]?.job_ref).toContain('hj_c');
    expect(page.rows[0]?.id).toContain('…');
    // refId is readable on purpose — an admin pastes it into walletpay's console
    expect(page.rows[0]?.ref).toBe(REF);
  });
});

/* ⭐ [FIX-20260816-TRACEBLUR] THE RESPONSE ITSELF MUST BE MASKED.
 * An earlier version blurred the trace handles in the browser — the real values
 * still travelled over the wire. These cases assert on the SERVICE OUTPUT, i.e.
 * exactly what gets serialised to the client, so a regression that moves the
 * blur back to the UI fails here. */
describe('[WALLETPAYCARD] the payload leaving the service is already masked', () => {
  const RESULT_ID = 'a0d000000000000000000091';
  const JOB_REF = 'hj_c_1k04rir9f_aa91dd3381';
  const LINE_ID = 'Ubd88e26129e244f2b63527b834e94dd7';
  const S3_OBJ = '1b91875fd9205d10961fc60a551ba96d';

  const row = {
    _id: RESULT_ID,
    chain_run_id: RUN_ID,
    job_ref: JOB_REF,
    target_key: 'pay_walletpay',
    created_at: new Date('2026-08-16T08:39:02.196Z'),
    context: { outcome: 'TRUE', stmt_idx: 0 },
    request: {
      body: { refId: REF, line_user_id: LINE_ID },
      url: `https://api.walletpay.example.com/api/v1/public/payin/${REF}/slip`,
    },
    final: {
      http_status: 200,
      raw: {
        refId: REF,
        uploadResult: [{ path: `s3:uploads/bank_slips/20260816/${S3_OBJ}` }],
      },
    },
  };

  it('(T1 ⭐) trace handles are blurred IN the payload, not on screen', async () => {
    const svc = makeService({
      results: [row],
      runs: [runDoc(statement('01KY4R7EQ', REF, 400))],
    });
    const page = await svc.list('U1', 1, 10);
    const wire = JSON.stringify(page); // exactly what the client receives
    expect(wire).not.toContain(RESULT_ID);
    expect(wire).not.toContain(JOB_REF);
    expect(wire).not.toContain(RUN_ID);
    // …but both ends survive, so an operator can still compare rows by eye
    expect(page.rows[0]?.job_ref).toContain('hj_c');
    expect(page.rows[0]?.job_ref).toContain('…');
  });

  it('(T2 ⭐) customer identity and storage locations never reach the wire', async () => {
    const svc = makeService({
      results: [row],
      runs: [runDoc(statement('01KY4R7EQ', REF, 400))],
    });
    const wire = JSON.stringify(await svc.list('U1', 1, 10));
    expect(wire).not.toContain(LINE_ID);
    expect(wire).not.toContain(S3_OBJ);
  });

  it('(T3 PIN) refId and statement_id stay readable — the job needs them', async () => {
    const svc = makeService({
      results: [row],
      runs: [runDoc(statement('01KY4R7EQ', REF, 400))],
    });
    const page = await svc.list('U1', 1, 10);
    expect(page.rows[0]?.ref).toBe(REF);
    expect(page.rows[0]?.statement_id).toBe('01KY4R7EQ');
  });
});
