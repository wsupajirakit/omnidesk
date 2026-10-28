/**
 * [FEAT-20260816-WALLETPAYCARD] ⭐ SHAPE ROBUSTNESS — the card must survive ANY
 * step-2 document, not just the one shape walletpay writes today.
 *
 * WHY THIS EXISTS (owner 16/08: "ลองรับ dynamic step 2 json ทุกแบบไม่พังนะ"):
 * `handoff_results` is a log — a second step-2 target, a provider changing its
 * envelope, or an old row written before a field existed all land in the SAME
 * feed. This path is read-only decoration on a ticket screen, so the rule is
 * absolute: a weird document yields blanks, never an exception, never a page
 * that fails to render. รูปแบบแปลก = ช่องว่าง ห้าม throw.
 *
 * Every case below feeds `list()` a document that breaks one assumption and
 * asserts the page still comes back with a row.
 */
import { WalletpayHistoryService } from '@/modules/chat/walletpay-history/walletpay-history.service';

function makeService(results: unknown[], runs: unknown[] = []) {
  const chain = (val: unknown) => ({
    sort: () => chain(val),
    skip: () => chain(val),
    limit: () => chain(val),
    lean: () => chain(val),
    exec: () => Promise.resolve(val),
  });
  return new WalletpayHistoryService(
    {
      countDocuments: () => ({ exec: () => Promise.resolve(results.length) }),
      find: () => chain(results),
    } as never,
    { find: () => chain(runs) } as never,
  );
}

/** every one of these has broken SOMETHING a naive reader would assume */
const HOSTILE: Array<[string, Record<string, unknown>]> = [
  ['empty document', {}],
  ['context missing entirely', { _id: 'A', chain_run_id: 'R' }],
  ['context is a string, not an object', { _id: 'B', context: 'nope' }],
  ['context is null', { _id: 'C', context: null }],
  ['final missing', { _id: 'D', context: { outcome: 'TRUE' } }],
  ['final is an array', { _id: 'E', context: {}, final: [1, 2, 3] }],
  [
    'http_status is a string',
    { _id: 'F', context: {}, final: { http_status: '200' } },
  ],
  [
    'created_at is garbage',
    { _id: 'G', context: {}, created_at: 'not-a-date' },
  ],
  [
    'numbers where strings are expected',
    {
      _id: 'H',
      job_ref: 42,
      target_key: 7,
      context: { outcome: 1, reason: 2 },
    },
  ],
  [
    'statement_ref is an object',
    { _id: 'I', context: { statement_ref: { nope: true } } },
  ],
  [
    'stmt_idx is negative',
    { _id: 'J', context: { stmt_idx: -5, statement_ref: '' } },
  ],
  [
    'stmt_idx beyond the array',
    { _id: 'K', context: { stmt_idx: 999, statement_ref: '' } },
  ],
  [
    'deeply nested unknown envelope',
    {
      _id: 'L',
      context: {},
      final: { raw: { a: { b: { c: { d: { e: [{ f: 'x' }] } } } } } },
    },
  ],
  [
    'arrays where objects are expected',
    { _id: 'M', context: [], final: { http_status: 200 } },
  ],
  [
    'a different step-2 target',
    {
      _id: 'N',
      target_key: 'pay_something_else',
      context: { outcome: 'TRUE' },
    },
  ],
];

/** run docs that are equally broken — the join must not care */
const HOSTILE_RUNS: unknown[] = [
  {},
  { _id: 'R', raw_transaction: null },
  { _id: 'R2', raw_transaction: { statement: 'not-an-array' } },
  { _id: 'R3', raw_transaction: { statement: [null, 5, 'x', { info: null }] } },
];

describe('[WALLETPAYCARD] dynamic step-2 shapes never break the feed', () => {
  it.each(HOSTILE)('(S) survives: %s', async (_label, doc) => {
    const svc = makeService([doc], HOSTILE_RUNS);
    const page = await svc.list('U1', 1, 10);
    expect(page.rows).toHaveLength(1);
    const row = page.rows[0]!;
    // the contract holds whatever came in: strings are strings, nulls are nulls
    expect(typeof row.id).toBe('string');
    expect(typeof row.outcome).toBe('string');
    expect(typeof row.statement_id).toBe('string');
    expect(typeof row.run_id).toBe('string');
    expect(
      row.http_status === null || typeof row.http_status === 'number',
    ).toBe(true);
    expect(
      row.statement_amount === null || typeof row.statement_amount === 'number',
    ).toBe(true);
    expect(row.at === null || typeof row.at === 'string').toBe(true);
  });

  it('(S-ALL) a whole page of mixed hostile documents renders in one go', async () => {
    const svc = makeService(
      HOSTILE.map(([, d]) => d),
      HOSTILE_RUNS,
    );
    const page = await svc.list('U1', 1, 50);
    expect(page.rows).toHaveLength(HOSTILE.length);
    expect(() => JSON.stringify(page)).not.toThrow(); // serialisable for the wire
  });

  it('(S-PAGE) absurd paging input is clamped, never fatal', async () => {
    const svc = makeService([{ _id: 'A', context: {} }]);
    for (const [p, l] of [
      [0, 0],
      [-3, -9],
      [NaN, NaN],
      [1e9, 1e9],
    ] as const) {
      const page = await svc.list('U1', p, l);
      expect(page.page).toBeGreaterThanOrEqual(1);
      expect(page.limit).toBeGreaterThanOrEqual(1);
      expect(page.limit).toBeLessThanOrEqual(50);
    }
  });
});
