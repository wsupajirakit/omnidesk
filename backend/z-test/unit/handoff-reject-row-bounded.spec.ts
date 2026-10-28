/**
 * [FIX-20260818-REJECTROW] A refused callback cannot choose its own row.
 * audit_18_aug H8.
 *
 * ## The audit's headline is wrong, and the real defect is narrower and worse
 * H8 reads "handoff writes Mongo before checking the HMAC". It does not:
 * `verifyInbound` runs first, in program order. And storing a refused callback
 * is DELIBERATE — the code says so where it does it: "a rejected callback is
 * exactly the thing an operator needs to see". That intent is kept.
 *
 * What is wrong is the SHAPE of that row, and it is wrong twice:
 *
 * 1. THE ATTACKER PICKS THE PRIMARY KEY. `upsertInbox` keys on `event_id`, which
 *    is read straight from the caller's own `x-event-id` header on a request
 *    that has not authenticated, and `event_id` carries a UNIQUE index. Because
 *    the write is `$setOnInsert`, whoever gets there first owns the row's raw
 *    evidence — so posting a predicted event id ahead of the genuine callback
 *    locks in the attacker's `raw_sha256`, which `applyMatchedCallback` later
 *    copies into the permanent result history. Replaying a live event id with a
 *    bad signature is the same bug pointed the other way: the `$set` moves a
 *    genuine row's status.
 *
 * 2. THE ROW NEVER EXPIRES. The reject path writes `match_status: 'unmatched'`,
 *    and the deployed TTL is PARTIAL — verified against the live index, not the
 *    comment:
 *      created_at_1 · expireAfterSeconds 2592000
 *      partial: { match_status: { $in: ['matched','pending','dismissed'] } }
 *    `unmatched` is deliberately outside it so undecided evidence cannot vanish
 *    on a timer. The schema comment promises a sweeper that ages stale unmatched
 *    rows into `dismissed`; that sweeper DOES NOT EXIST — grepping finds only
 *    the field it would set. So an unauthenticated caller can write permanent
 *    rows without limit.
 *
 * ## The fix, and why it needs no migration
 * A refused callback is recorded under a key derived from what the SERVER knows
 * — target, a hash of the remote address, and the hour — prefixed so it can
 * never collide with a real event id, and with `match_status: 'dismissed'`,
 * which is already in the schema enum AND already inside the deployed partial
 * TTL. No collMod, no dropIndex, no backfill. The collection holds 0 rows today.
 *
 * The authenticated path is untouched: it still keys on the sender's event id
 * and still records its own evidence.
 */

import { createHash } from 'node:crypto';

// Deep import: the service is not on the handoff barrel, and adding it there
// for a test would be a wiring decision rather than a test detail.
// eslint-disable-next-line no-restricted-imports
import { HandoffCallbackService } from '@/modules/handoff/handoff-callback.service';

const TARGET_KEY = 'walletpay';
const ATTACKER_EVENT_ID = 'evt_the_real_one_will_use_this';
const SECRET = 's3cret';
/** What a genuine sender presents once the target is on bearer mode. */
const AUTHED = { authorization: `Bearer ${SECRET}` };

type Upsert = {
  filter: Record<string, unknown>;
  update: Record<string, unknown>;
};

function makeService(authOk: boolean): {
  svc: HandoffCallbackService;
  upserts: Upsert[];
} {
  const upserts: Upsert[] = [];
  const svc = Object.create(
    HandoffCallbackService.prototype,
  ) as HandoffCallbackService;

  Object.assign(svc, {
    callbackModel: {
      findOneAndUpdate: (
        filter: Record<string, unknown>,
        update: Record<string, unknown>,
      ) => {
        upserts.push({ filter, update });
        return {
          lean: () => ({ exec: () => Promise.resolve({ _id: 'row1' }) }),
        };
      },
    },
    targetModel: {
      findOne: () => ({
        lean: () => ({
          exec: () =>
            Promise.resolve({
              key: TARGET_KEY,
              // `mode` defaults to 'hmac' when absent (inbound-auth.ts:101), so
              // an empty object NEVER authenticates. The first version of this
              // stub used `{}` for the "authenticated" case, which quietly sent
              // both describes down the reject path — and they passed anyway,
              // because before the fix both branches used the same key. Bearer
              // with a matching secret is the smallest honest way in.
              inbound_auth: authOk ? { mode: 'bearer' } : { mode: 'hmac' },
              inbound_secret: authOk ? 'enc' : '',
            }),
        }),
      }),
    },
    jobModel: {
      find: () => ({ lean: () => ({ exec: () => Promise.resolve([]) }) }),
    },
    resultModel: {},
    crypto: {
      tryDecryptSecret: () => ({ ok: true, value: authOk ? SECRET : '' }),
    },
    // The rate limiter is consulted before any of this; keep it open so the
    // path under test is the one that runs.
    isRateLimitedByKey: () => Promise.resolve(false),
  });
  return { svc, upserts };
}

const receive = (
  svc: HandoffCallbackService,
  headers: Record<string, string>,
) =>
  (svc.receive.bind(svc) as (i: unknown) => Promise<{ status: number }>)({
    targetKey: TARGET_KEY,
    rawBody: Buffer.from('{"ref":"x"}'),
    headers,
    query: {},
    remoteIp: '203.0.113.9',
  });

describe('[REJECTROW] a refused callback does not choose the row it lands in', () => {
  it('⭐ the caller`s x-event-id is not used as the key', async () => {
    const { svc, upserts } = makeService(false);

    await receive(svc, { 'x-event-id': ATTACKER_EVENT_ID });

    expect(upserts).toHaveLength(1);
    expect(upserts[0]?.filter['event_id']).not.toBe(ATTACKER_EVENT_ID);
  });

  it('⭐ the row lands on a status the deployed TTL actually expires', async () => {
    // `unmatched` sits OUTSIDE the partial filter on purpose, and the sweeper
    // that would age it does not exist — so a refused row written as unmatched
    // is permanent.
    const { svc, upserts } = makeService(false);

    await receive(svc, { 'x-event-id': ATTACKER_EVENT_ID });

    const set = upserts[0]?.update['$set'] as Record<string, unknown>;
    expect(['matched', 'pending', 'dismissed']).toContain(
      set['match_status'] as string,
    );
  });

  it('⭐ repeated refusals from one source collapse into one row', async () => {
    // Bounded: without this an unauthenticated caller writes a new permanent row
    // per request, for as long as they care to keep going.
    const a = makeService(false);
    const b = makeService(false);

    await receive(a.svc, { 'x-event-id': 'one' });
    await receive(b.svc, { 'x-event-id': 'two' });

    expect(a.upserts[0]?.filter['event_id']).toBe(
      b.upserts[0]?.filter['event_id'],
    );
  });

  it('the key cannot collide with a genuine event id', async () => {
    const { svc, upserts } = makeService(false);

    await receive(svc, {});

    const key = String(upserts[0]?.filter['event_id']);
    // A real id is either the sender's own or `sha1_<hash>`; the refused key
    // must be neither.
    expect(key.startsWith('rej_')).toBe(true);
  });

  it('a refusal still answers 401, and the operator still gets a record', async () => {
    // The documented intent — "a rejected callback is exactly the thing an
    // operator needs to see" — is preserved, not traded away.
    const { svc, upserts } = makeService(false);

    const out = await receive(svc, { 'x-event-id': ATTACKER_EVENT_ID });

    expect(out.status).toBe(401);
    expect(upserts).toHaveLength(1);
  });
});

describe('[REJECTROW] the authenticated path is untouched', () => {
  it('an accepted callback still keys on the sender`s own event id', async () => {
    const { svc, upserts } = makeService(true);

    await receive(svc, { ...AUTHED, 'x-event-id': 'genuine-123' });

    expect(upserts.length).toBeGreaterThan(0);
    expect(upserts[0]?.filter['event_id']).toBe('genuine-123');
  });

  it('with no event id it still falls back to the body hash, as before', async () => {
    const { svc, upserts } = makeService(true);

    await receive(svc, AUTHED);

    const expected = `sha1_${createHash('sha1')
      .update(Buffer.from('{"ref":"x"}'))
      .digest('hex')}`;
    expect(upserts[0]?.filter['event_id']).toBe(expected);
  });
});
