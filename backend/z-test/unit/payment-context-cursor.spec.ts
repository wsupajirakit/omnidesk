/* [FIX-20260820-CTXCURSOR] the job lookup finally learns the walk position
 * ===========================================================================
 * The audit row for one statement of a walletpay walk was landing on ANOTHER
 * statement's leg. `[FIX-20260818-CTXSLOT]` fixed exactly half of this: it put
 * `'context.stmt_idx': cursor` into the NO-JOB upsert filter, so the rows that
 * have no leg of their own stopped collapsing into one. The JOB path was left
 * as it was —
 *     findOne({ chain_run_id, chain_step, attempt }).sort({created_at:-1})
 *     … then updateOne({ _id: job._id })
 * — with no walk position anywhere in it. So any caller reporting about a
 * position that has no leg of its own still found the newest leg of the pass
 * and overwrote its context. ครึ่งเดียวที่แก้ไปคือฝั่งไม่มี job · ฝั่งมี job ยังไม่รู้จัก cursor.
 *
 * MEASURED ON LIVE DATA BEFORE THE FIX (local dev db, `handoff_results` joined
 * to `handoff_jobs` on chain_run_id + chain_step=2):
 *     53 result rows could be joined to a job
 *     12 of them carried context.stmt_idx = job.snapshot.stmt_idx + 1
 *     all 12 were review_reason 'walletpay_exhausted', i.e. the end-of-walk verdict
 *     sitting on top of a real POSTed leg
 *      0 rows carried reason 'walletpay_no_ref_id' — the per-statement skip that
 *        the earlier note blamed has never actually happened here
 * So the trigger in production was NOT the rare skip: it was the walk summary,
 * every single time a walletpay walk ran out of candidates.
 *
 * WHY THE SUMMARY GOT PAST THE -1 GUARD. `_walletpayReview` is handed `total`
 * (`candidates.length`) as its cursor by both of its call sites, which is one
 * PAST the last real index — never -1 — so the `cursor === -1` ternary that was
 * meant to send summaries down the no-job path never fired for it.
 *
 * THE FIX, both halves together:
 *   · the job lookup narrows by `'snapshot.stmt_idx': cursor` — the value
 *     `_logLeg` itself writes (197 of 197 job rows carry it), so a leg is found
 *     only by the caller reporting about THAT leg;
 *   · `_walletpayReview` reports at -1, the slot CTXSLOT already defined as "the
 *     whole walk, not any one ใบ", instead of inventing an out-of-range index.
 *
 * ⚠️ MONEY IS NOT TOUCHED, and this file does not claim otherwise: `_context`
 * chooses no statement, makes no HTTP call, moves no slip lock and builds no
 * customer reply — its own header says "Filter and audit only". The two readers
 * of these rows are the chain-log page and the walletpay history feed, both
 * display-only. เส้นเงินไม่ถูกแตะ · แถวพวกนี้มีไว้ให้คนอ่าน.
 *
 * ⚠️ WHY THIS FILE EXISTS INSTEAD OF EXTENDING THE SIBLING SPEC. The harness in
 * `payment-context-slot.spec.ts` mocks `findOne` so that it IGNORES the filter
 * and always returns the last job handed to it. That is why a case there could
 * assert the job path while passing a job with no `stmt_idx` at all — the mock
 * never applied a filter, so the bug was invisible to it. The harness below
 * honours the filter, which is the only way to prove a lookup narrowed.
 * mock เดิมไม่กรองตาม filter ⇒ พิสูจน์เรื่อง lookup ไม่ได้เลย ต้องมีตัวที่กรองจริง.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Types } from 'mongoose';

// eslint-disable-next-line no-restricted-imports -- same import the sibling context specs use
import { PaymentRunnerService } from '@/modules/payment/payment-runner.service';

type Row = Record<string, unknown>;
/* Standalone, NOT `PaymentRunnerService & {...}`: intersecting with the class
   collapses to `never` because these members are private on it. โครงเดียวกับสเปกพี่น้อง. */
type ContextProbe = {
  jobModel: unknown;
  resultModel: unknown;
  _context: (
    runId: Types.ObjectId,
    slip: unknown,
    chainStep: number,
    role: string,
    cursor: number,
    extra: Row,
    generation?: number,
  ) => Promise<void>;
};

const RUN_ID = new Types.ObjectId();
const SLIP = {
  _id: new Types.ObjectId(),
  sender_member_user_id: 'U1',
} as never;

/** Two legs of one walk, carrying every field `_logLeg` really writes — the
 * run and step included, because `_context` filters on them and a fixture that
 * omits them proves nothing. */
const leg = (idx: number, attempt: number | undefined = 0) => ({
  _id: new Types.ObjectId(),
  chain_run_id: RUN_ID,
  chain_step: 2,
  ...(attempt === undefined ? {} : { attempt }),
  snapshot: { stmt_idx: idx },
});
const LEG_0 = leg(0);
const LEG_1 = leg(1);

/**
 * A `jobModel` that actually applies the filter, including the dotted path.
 * Returns the newest match, the same order the real query sorts by.
 */
function makeRunner(jobs: Row[]) {
  const calls: Array<{ filter: Row; update: Row }> = [];
  const seenFilters: Row[] = [];
  const matches = (job: Row, filter: Row): boolean =>
    Object.entries(filter).every(([path, want]) => {
      const got = path
        .split('.')
        .reduce<unknown>((o, k) => (o as Row | undefined)?.[k], job);
      if (want && typeof want === 'object' && '$in' in (want as Row)) {
        return (want as { $in: unknown[] }).$in.some(
          (v) => v === got || (v === null && got === undefined),
        );
      }
      if (want instanceof Types.ObjectId) return String(got) === String(want);
      return got === want;
    });

  const svc = Object.create(
    PaymentRunnerService.prototype,
  ) as unknown as ContextProbe;
  svc.jobModel = {
    findOne: (filter: Row) => {
      seenFilters.push(filter);
      const hit = jobs.filter((j) => matches(j, filter)).at(-1) ?? null;
      return {
        sort: () => ({ lean: () => ({ exec: () => Promise.resolve(hit) }) }),
      };
    },
  };
  svc.resultModel = {
    updateOne: (filter: Row, update: Row) => {
      calls.push({ filter, update });
      return { exec: () => Promise.resolve({ upsertedCount: 1 }) };
    },
  };
  return { svc, calls, seenFilters };
}

describe('⭐ a report about one ใบ lands on THAT ใบ', () => {
  it('the leg that ran at this position still updates by its own _id', async () => {
    /* the money-leg path, unchanged: same row, same filter shape as before. */
    const { svc, calls } = makeRunner([LEG_0, LEG_1]);
    await svc._context(RUN_ID, SLIP, 2, 'pay_walletpay', 1, {
      outcome: 'TRUE',
    });
    expect(calls[0]!.filter).toEqual({ _id: LEG_1._id });
  });

  it('…and ใบ 0 lands on ใบ 0, not on the newest leg of the pass', async () => {
    /* BEFORE the fix this wrote onto LEG_1 — the lookup sorted newest-first and
       had no position in it, so the older ใบ could never be addressed at all. */
    const { svc, calls } = makeRunner([LEG_0, LEG_1]);
    await svc._context(RUN_ID, SLIP, 2, 'pay_walletpay', 0, {
      outcome: 'FALSE',
    });
    expect(calls[0]!.filter).toEqual({ _id: LEG_0._id });
  });

  it('⭐ the lookup carries the walk position — this is the whole fix', () => {
    const { svc, seenFilters } = makeRunner([LEG_0]);
    void svc._context(RUN_ID, SLIP, 2, 'pay_walletpay', 0, {});
    expect(seenFilters[0]).toMatchObject({ 'snapshot.stmt_idx': 0 });
  });
});

describe('⭐ a report about NO ใบ never lands on someone else`s leg', () => {
  it('⭐ a position with no leg of its own takes the no-job path', async () => {
    /* the per-statement skip: statement 1 had no ref id, statement 0 did POST.
       Before the fix this found LEG_0 and overwrote the answer LINE gave it. */
    const { svc, calls } = makeRunner([LEG_0]);
    await svc._context(RUN_ID, SLIP, 2, 'pay_walletpay', 1, {
      reason: 'walletpay_no_ref_id',
    });
    expect(calls[0]!.filter['_id']).toBeUndefined();
    expect(calls[0]!.filter['context.stmt_idx']).toBe(1);
  });

  it('⭐ the end-of-walk summary takes it too, with a leg present', async () => {
    /* the trigger that actually fired 12 times in the live data. */
    const { svc, calls } = makeRunner([LEG_0, LEG_1]);
    await svc._context(RUN_ID, SLIP, 2, 'pay_walletpay', -1, {
      review_reason: 'walletpay_exhausted',
    });
    expect(calls[0]!.filter['_id']).toBeUndefined();
    expect(calls[0]!.filter['context.stmt_idx']).toBe(-1);
  });

  it('a pass with no legs at all still records its outcome', async () => {
    /* [FEAT-20260810-CTXNOJOB] must keep working — these are the runs that abort
       before the walletpay job is created. */
    const { svc, calls } = makeRunner([]);
    await svc._context(RUN_ID, SLIP, 2, 'pay_walletpay', 0, {
      reason: 'no_matching_statement',
    });
    expect(calls[0]!.filter['_id']).toBeUndefined();
    expect(calls[0]!.filter['chain_run_id']).toEqual(RUN_ID);
  });
});

describe('⭐ the pass filter from CTXATTEMPT is still applied', () => {
  it('a second pass does not address the first pass`s leg', async () => {
    const { svc, calls } = makeRunner([LEG_0]);
    await svc._context(RUN_ID, SLIP, 2, 'pay_walletpay', 0, {}, 1);
    expect(calls[0]!.filter['_id']).toBeUndefined();
  });

  it('the first pass still matches rows written before `attempt` existed', async () => {
    /* rows written before `attempt` existed carry no such field at all */
    const legacyLeg = leg(0, undefined);
    const { svc, calls } = makeRunner([legacyLeg]);
    await svc._context(RUN_ID, SLIP, 2, 'pay_walletpay', 0, {}, 0);
    expect(calls[0]!.filter).toEqual({ _id: legacyLeg._id });
  });
});

describe('⭐ the verdict stays VISIBLE after it moves off the leg', () => {
  /* `walletpay-history.service.ts:134` pages by the TOP-LEVEL `member_user_id`.
     The no-job upsert never wrote it, so moving the verdict there would have
     made it silently disappear from the operator's screen — a clean row nobody
     can read is not a fix. 83 of 134 step-2 rows are invisible for this reason
     today; this change refuses to add the verdict to that pile. */

  it('⭐ the summary row carries the member id the page filters on', async () => {
    const { svc, calls } = makeRunner([LEG_0, LEG_1]);
    await svc._context(RUN_ID, SLIP, 2, 'pay_walletpay', -1, {
      review_reason: 'walletpay_exhausted',
    });
    const set = calls[0]!.update['$set'] as Row;
    expect(set['member_user_id']).toBe('U1');
  });

  it('⭐ [FIX-20260821-SKIPVISIBLE] a per-statement skip IS surfaced now', () => {
    /* ⚠️ เคสนี้เคย assert ตรงข้ามจนถึง 21/08 · การกลับด้านคือ **การตัดสินใจ** ไม่ใช่ผลพลอยได้
  
       โน้ตเดิมเขียนว่าการเติมทุกแถวที่ไม่มี job จะ "ดัน 83 แถวขึ้นหน้าที่ไม่เคยแสดง"
       วัดใหม่ก่อนแก้แล้วไม่จริงอีกต่อไป: 83 แถวนั้นมีแค่ 2 reason —
       `no_matching_statement` (82) กับ `no_walletpay_endpoint` (1) — และเป็น **แถวสรุป**
       ที่เขียนก่อน `FIX-20260818-CTXSLOT` กับ `a04ff4b` จะลง · แถวสรุปมองเห็นตั้งแต่
       20/08 แล้ว และไม่มีแถวมองไม่เห็นเกิดใหม่อีกเลย
  
       สิ่งที่ guard ยังบังอยู่คือ **เส้นเดียว**: `walletpay_no_ref_id`
       (`payment-runner.service.ts:1869`) ซึ่งรัน **ก่อน** `_logLeg` ของ walk (`:1909`)
       จึงไม่มี job · อีกสาม reason (`walletpay_txn_not_found` :1962 ·
       `walletpay_invalid_ref` :1988 · `no_match` :2052) รัน **หลัง** จึงมี job และ
       มองเห็นอยู่แล้วไม่ว่าจะมี guard หรือไม่
  
       และเส้นนั้น **ยังไม่เคยเกิดสักครั้ง** — 0 แถวในฐานข้อมูลถือ reason นี้
       ⇒ ท่วมจอไม่ได้ · มันเปิดให้เห็นแถวที่แอดมินซึ่งกำลังไล่ว่า "ทำไมสลิปถูกข้าม"
       ต้องการ และไม่มีทางเห็นถ้าไม่เปิด · จำนวนแถวที่เพิ่มวันนี้ = ศูนย์
  
       ⚠️ 83 แถวเก่าไม่ถูกแตะ — มีอยู่แล้วโดย id ระดับบนว่าง · มีแต่ backfill เท่านั้น
       ที่จะดันขึ้นมา ซึ่งเป็นการแก้ข้อมูลที่ต้องขออนุมัติแยก */
    const { svc, calls } = makeRunner([LEG_0]);
    void svc._context(RUN_ID, SLIP, 2, 'pay_walletpay', 1, {
      reason: 'walletpay_no_ref_id',
    });
    return Promise.resolve().then(() => {
      const set = calls[0]!.update['$set'] as Row;
      expect(set['member_user_id']).toBe('U1');
    });
  });

  it('the leg row is never given one — it already has the real value', async () => {
    const { svc, calls } = makeRunner([LEG_0, LEG_1]);
    await svc._context(RUN_ID, SLIP, 2, 'pay_walletpay', 1, {
      outcome: 'TRUE',
    });
    expect((calls[0]!.update['$set'] as Row)['member_user_id']).toBeUndefined();
  });

  it('a slip with no sender id adds nothing rather than an empty string', async () => {
    const bare = { _id: new Types.ObjectId() } as never;
    const { svc, calls } = makeRunner([]);
    await svc._context(RUN_ID, bare, 2, 'pay_walletpay', -1, {});
    expect((calls[0]!.update['$set'] as Row)['member_user_id']).toBeUndefined();
  });
});

describe('⭐ the walk verdict reports at the summary slot', () => {
  const src = readFileSync(
    join(process.cwd(), 'src/modules/payment/payment-runner.service.ts'),
    'utf8',
  );

  it('⭐ _walletpayReview audits at WALK_SUMMARY_CURSOR, not at its stmtIdx', () => {
    /* Both call sites hand it `candidates.length` — one PAST the last index, so
       it could never name a real ใบ and it slipped past the -1 guard. */
    const body = src.slice(src.indexOf('private async _walletpayReview'));
    const ctxCall = body.slice(
      body.indexOf('this._context('),
      body.indexOf('outcome:'),
    );
    expect(ctxCall).toContain('WALK_SUMMARY_CURSOR');
    expect(ctxCall.replace(/\/\*[\s\S]*?\*\//g, '')).not.toContain('stmtIdx');
  });

  it('⭐ …while the SLIP lock still records how far the walk got', () => {
    /* `_stampLock` writes `consumed_stmt_idx`, a different field with a
       different meaning. This fix must not touch it. ค่าบนสลิปต้องคงเดิม. */
    const body = src.slice(src.indexOf('private async _walletpayReview'));
    expect(body.slice(0, body.indexOf('this._context('))).toContain(
      "this._stampLock(slip._id, runId, 'review', stmtIdx)",
    );
  });

  it('the summary slot is a named constant, not a bare -1', () => {
    expect(src).toContain('const WALK_SUMMARY_CURSOR = -1;');
  });
});
