/**
 * [FIX-20260818-BODYOPERATOR] A Mongo operator posted in a JSON body never
 * reaches a filter. audit_18_aug M20.
 *
 * ## The audit's six sites are not the problem — the body is
 * M20 lists six query-string payloads of the form `?hook_id[$ne]=x`. On this
 * stack they cannot fire, and that was verified rather than assumed:
 *
 *   express 5.2.1 · lib/application.js:97 → `this.set('query parser', 'simple')`
 *   main.ts never overrides it
 *   node:querystring.parse('hook_id[$ne]=zzz') → { 'hook_id[$ne]': 'zzz' }
 *                                              → `hook_id` is undefined
 *
 * The audit was written against express 4 semantics, where the default parser is
 * `qs` and brackets DO become nested objects. Its prescribed fix does not apply
 * either: `@Query('x') x?: string` fails to compile at four of the six sites,
 * because a required parameter follows (`error TS1016`).
 *
 * The BODY is a different story. body-parser produces real nested objects, so
 * `{"channel_user_id": {"$regex": "^U1a2b"}}` arrives as an object and a bare
 * TypeScript cast does nothing about it at runtime.
 *
 * ## The two sinks this pins
 * 1. `POST /customer-link/match` is `@Public()`. Its channel id flowed into
 *    `alreadyLinked()` → `memberModel.findOne({ line_user_id: <that value> })`.
 *    `line_user_id` is a plain String property, so `$regex` casts cleanly and the
 *    409-vs-anything-else answer is an oracle for walking LINE user ids one
 *    character at a time, with no account at all.
 * 2. `upsertOverride` put `target_key` straight into a `findOneAndUpdate` filter
 *    carrying `upsert: true`. An operator there matches a DIFFERENT row and the
 *    `$set` overwrites the override that row was holding.
 *
 * ## Where the coercion goes, and why not the controller
 * At the SINK, in the service. `asText` is module-local to
 * `customer-link.service.ts`, so guarding in the controller would have meant
 * exporting a helper purely to reach it — and would have left the next caller of
 * `alreadyLinked` unprotected. `handoff-chain.service.ts` already imports
 * `coerceString` and already uses it two lines above for `hook_id`, so that side
 * is one token per site with no new import.
 *
 * Nothing new is created for either.
 */

import { CustomerLinkService } from '@/modules/customer-link';
// Deep import for the same reason the sibling handoff/hook specs use one: the
// service is not on the module barrel, and adding it there for a test would be a
// wiring decision rather than a test detail.
// eslint-disable-next-line no-restricted-imports
import { HandoffChainService } from '@/modules/handoff/handoff-chain.service';

/** The shapes an attacker can post that a bare cast lets through. */
const OPERATORS: ReadonlyArray<[string, unknown]> = [
  ['$regex prefix walk', { $regex: '^U1a2b' }],
  ['$ne everything', { $ne: null }],
  ['$gt everything', { $gt: '' }],
];

describe('[BODYOPERATOR] customer-link: a posted operator never reaches the member filter', () => {
  function makeService(): {
    svc: CustomerLinkService;
    filters: Array<Record<string, unknown>>;
  } {
    const filters: Array<Record<string, unknown>> = [];
    const memberModel = {
      findOne: (filter: Record<string, unknown>) => {
        filters.push(filter);
        return {
          select: () => ({
            lean: () => ({ exec: () => Promise.resolve(null) }),
          }),
        };
      },
    };
    const svc = new CustomerLinkService(
      {} as never, // hookModel
      memberModel as never,
      { safeDecrypt: (v: string) => v } as never, // crypto
      {} as never, // customToolService
      { create: jest.fn().mockResolvedValue({}) } as never, // webhookLogModel
      {} as never, // realtime
      {} as never, // lineApi
      {} as never, // chatHistory
    );
    return { svc, filters };
  }

  // No cast is needed here any more: the fix widened `alreadyLinked` to take
  // `unknown`, which is the honest signature — the value really does arrive
  // unvalidated from a public JSON body.

  it.each(OPERATORS)(
    '⭐ %s is neutralised before the query',
    async (_label, payload) => {
      const { svc, filters } = makeService();

      await svc.alreadyLinked.bind(svc)(payload);

      expect(filters).toHaveLength(1);
      const value = filters[0]?.['line_user_id'];
      // A string can carry no operator. What the string CONTAINS does not matter —
      // Mongo only treats an OBJECT as an operator expression.
      expect(typeof value).toBe('string');
    },
  );

  it('⭐ findLinkedMember is the same sink and is coerced too', async () => {
    // Reached from the mint route. A read, so it leaks rather than writes — but
    // it is the same bare cast feeding the same String property.
    const { svc, filters } = makeService();

    await (
      svc.findLinkedMember as unknown as (v: unknown) => Promise<unknown>
    ).call(svc, { $regex: '^U1a2b' });

    expect(filters).toHaveLength(1);
    expect(typeof filters[0]?.['line_user_id']).toBe('string');
  });

  it('⭐ clearStoredProfile is a WRITE and must not take an operator', async () => {
    // The worst of the three: an operator here selects rows the caller never
    // named and `$unset`s their stored profile.
    const updates: Array<Record<string, unknown>> = [];
    const svc = Object.create(
      CustomerLinkService.prototype,
    ) as CustomerLinkService;
    Object.assign(svc, {
      memberModel: {
        updateOne: (filter: Record<string, unknown>) => {
          updates.push(filter);
          return { exec: () => Promise.resolve({ modifiedCount: 0 }) };
        },
      },
    });

    await svc.clearStoredProfile.call(svc, { $ne: null });

    expect(updates).toHaveLength(1);
    expect(typeof updates[0]?.['line_user_id']).toBe('string');
  });

  it('an ordinary LINE user id still queries for exactly that id', async () => {
    const { svc, filters } = makeService();

    await svc.alreadyLinked.bind(svc)('U1a2b3c4d5e6f');

    expect(filters[0]).toEqual({ line_user_id: 'U1a2b3c4d5e6f' });
  });
});

describe('[BODYOPERATOR] handoff override: a posted operator never reaches the upsert filter', () => {
  const HOOK_ID = 'a0d00000000000000000005d';

  function makeService(): {
    svc: Record<string, unknown>;
    filters: Array<Record<string, unknown>>;
  } {
    const filters: Array<Record<string, unknown>> = [];
    const overrideModel = {
      findOneAndUpdate: (filter: Record<string, unknown>) => {
        filters.push(filter);
        return {
          lean: () => ({ exec: () => Promise.resolve({ _id: 'o1' }) }),
        };
      },
    };
    const svc = Object.create(HandoffChainService.prototype) as Record<
      string,
      unknown
    >;
    Object.assign(svc, {
      overrideModel,
      crypto: { encrypt: (v: string) => v },
      // `upsertOverride` gates on this before it queries. Without it the call
      // died on an undefined collaborator, the filter was never reached, and
      // BOTH cases below passed while asserting nothing — caught by probing what
      // the stub actually reached rather than trusting a green tick.
      oaAccess: { ensureHookAccess: () => Promise.resolve(undefined) },
      hookModel: {
        findById: () => ({
          select: () => ({
            lean: () => ({ exec: () => Promise.resolve({ _id: HOOK_ID }) }),
          }),
        }),
      },
    });
    return { svc, filters };
  }

  type Upsert = (
    body: Record<string, unknown>,
    auth?: unknown,
  ) => Promise<unknown>;

  it('⭐ an operator in target_key cannot select another row to overwrite', async () => {
    const { svc, filters } = makeService();

    await (svc['upsertOverride'] as Upsert)
      .bind(svc)(
        { hook_id: HOOK_ID, target_key: { $ne: null } },
        { roleName: 'superadmin' },
      )
      .catch(() => undefined);

    // The filter must actually have been built — an empty list would mean this
    // case proves nothing, which is exactly how it first passed.
    expect(filters).toHaveLength(1);
    expect(typeof filters[0]?.['target_key']).toBe('string');
  });

  it('an ordinary target_key still selects its own row', async () => {
    const { svc, filters } = makeService();

    await (svc['upsertOverride'] as Upsert)
      .bind(svc)(
        { hook_id: HOOK_ID, target_key: 'walletpay' },
        { roleName: 'superadmin' },
      )
      .catch(() => undefined);

    expect(filters).toHaveLength(1);
    expect(filters[0]?.['target_key']).toBe('walletpay');
  });
});
