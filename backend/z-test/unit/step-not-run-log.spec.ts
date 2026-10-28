/* [FEAT-20260815-STEPNORUNLOG] a leg that never ran must still record WHY
 * ===========================================================================
 * OWNER-REPORTED 15/08/2026, twice: "step 2 ไม่เก็บถ้าไม่มี candidate" and
 * "มันต้องมี log บอกว่า walletpay step 2 ปิด".
 *
 * `[FEAT-20260810-CTXNOJOB]` already created the audit row for a leg that
 * aborted before its job existed — but it wrote `context` only. `final` kept
 * the schema default `{redacted_fields:[]}`, and the chain-log UI reads `final`
 * to decide there is anything to show, so step 2 rendered as though it never
 * happened. Confirmed on run 6a802c00…62e9: the row was in Mongo carrying
 * `reason:'no_walletpay_endpoint'`, and the screen showed step 1 alone.
 *
 * WHAT IS PINNED
 *   1. no job (the leg never ran)  ⇒ `final` is written, carrying the reason
 *   2. a job exists (the leg RAN)  ⇒ `final` is NOT touched — `_storeRaw` owns
 *      the real request/response and overwriting it would destroy the audit
 *      record of an actual money call
 *   3. `http_status` is absent on a skipped step — that absence is how a reader
 *      tells "never sent" from "sent and answered"; faking a status would make
 *      the two indistinguishable
 *   4. it is `$setOnInsert`, so a re-delivery cannot rewrite the first record
 *   5. every reason reaches the row — including `no_walletpay_endpoint`, the
 *      "walletpay is switched off" case the owner asked about by name
 *
 * ⚠️ THE SCHEMA TRAP THIS GUARDS. `final` is a TYPED subdocument
 * (handoff-result.schema.ts:166-183). Undeclared keys are dropped silently by
 * Mongoose — the write reports success and stores nothing, which is the very
 * failure mode being fixed. Case 6 pins that the payload rides in `parsed`
 * (declared `Mixed`), so it survives the round trip without a schema change.
 */
import { Types } from 'mongoose';

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
  ) => Promise<void>;
};

const RUN_ID = new Types.ObjectId();
const SLIP = {
  _id: new Types.ObjectId(),
  sender_member_user_id: 'U-member',
} as never;

/** `jobExists: false` reproduces a leg that aborted before its job was created. */
function makeRunner(jobExists: boolean) {
  const calls: Array<{ filter: unknown; update: Record<string, unknown> }> = [];

  const svc = Object.create(
    PaymentRunnerService.prototype,
  ) as unknown as ContextProbe;

  svc.jobModel = {
    findOne: () => ({
      sort: () => ({
        lean: () => ({
          exec: () =>
            Promise.resolve(jobExists ? { _id: new Types.ObjectId() } : null),
        }),
      }),
    }),
  };
  svc.resultModel = {
    updateOne: (filter: unknown, update: Record<string, unknown>) => {
      calls.push({ filter, update });
      return { exec: () => Promise.resolve({ upsertedCount: 1 }) };
    },
  };
  return { svc, calls };
}

const runStep2 = async (jobExists: boolean, reason: string) => {
  const { svc, calls } = makeRunner(jobExists);
  await svc._context(RUN_ID, SLIP, 2, 'pay_walletpay', 0, {
    outcome: 'FALSE',
    reason,
  });
  return calls[0]!;
};

const finalOf = (call: { update: Record<string, unknown> }) =>
  (
    call.update['$setOnInsert'] as
      { final?: Record<string, unknown> } | undefined
  )?.final;

describe('[STEPNORUNLOG] a skipped walletpay leg records why', () => {
  it('writes `final` when the leg never ran', async () => {
    const call = await runStep2(false, 'no_matching_statement');

    const fin = finalOf(call);
    expect(fin).toBeDefined();
    expect(fin!['received_via']).toBe('not_sent');
    expect((fin!['parsed'] as { reason?: string })?.reason).toBe(
      'no_matching_statement',
    );
  });

  /* THE CASE THE OWNER NAMED: walletpay switched off entirely. */
  it('records the reason when walletpay is switched off', async () => {
    const call = await runStep2(false, 'no_walletpay_endpoint');

    const parsed = finalOf(call)!['parsed'] as {
      reason?: string;
      skipped?: boolean;
      note?: string;
    };
    expect(parsed.reason).toBe('no_walletpay_endpoint');
    expect(parsed.skipped).toBe(true);
    expect(String(parsed.note)).toMatch(/not sent/i); // a human sentence, not a code
  });

  it.each([
    'walletpay_tool_invalid',
    'no_matching_statement',
    'no_walletpay_endpoint',
  ])('carries reason %s through to the row', async (reason) => {
    const parsed = finalOf(await runStep2(false, reason))!['parsed'] as {
      reason?: string;
    };
    expect(parsed.reason).toBe(reason);
  });

  /* THE SAFETY PROPERTY. A leg that really ran owns its own `final`. */
  it('never touches `final` when the leg DID run', async () => {
    const call = await runStep2(true, 'anything');

    expect(call.update['$setOnInsert']).toBeUndefined();
    expect(call.update['$set']).toBeDefined(); // context still written, as before
  });

  it('omits http_status so "never sent" stays distinguishable from "answered"', async () => {
    const fin = finalOf(await runStep2(false, 'no_walletpay_endpoint'))!;

    expect(fin['http_status']).toBeUndefined();
  });

  /* $setOnInsert, so a re-delivery cannot rewrite the first record. */
  it('uses $setOnInsert, not $set, for the skip record', async () => {
    const call = await runStep2(false, 'no_matching_statement');

    expect(call.update['$setOnInsert']).toBeDefined();
    const set = call.update['$set'] as Record<string, unknown>;
    expect(set['final']).toBeUndefined();
  });

  /* THE SCHEMA TRAP: only keys declared on the `final` subdocument survive
     Mongoose. Anything bespoke must sit inside `parsed` (Mixed). */
  it('keeps bespoke keys inside `parsed`, where the schema allows them', async () => {
    const fin = finalOf(await runStep2(false, 'no_walletpay_endpoint'))!;

    const declared = [
      'received_via',
      'received_at',
      'redacted_fields',
      'parsed',
    ];
    expect(Object.keys(fin).sort()).toEqual(declared.sort());
  });

  it('still records the context row exactly as before', async () => {
    const call = await runStep2(false, 'no_walletpay_endpoint');

    const set = call.update['$set'] as Record<string, unknown>;
    const ctx = set['context'] as Record<string, unknown>;
    expect(ctx['reason']).toBe('no_walletpay_endpoint');
    expect(ctx['target_key']).toBe('pay_walletpay');
    expect(set['chain_step']).toBe(2);
  });
});
