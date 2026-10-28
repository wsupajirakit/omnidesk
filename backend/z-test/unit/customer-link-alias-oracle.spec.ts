/**
 * [FIX-20260818-ALIASORACLE] The public routes stop resolving an OA by alias.
 * audit_18_aug H6.
 *
 * ## What the audit says, and what is actually there
 * The entry reads "/customer-link/health hands the integration map to anyone".
 * True, and three things make it worse than that sentence:
 *
 *   1. `health` is the ONLY route in the file without `@CustomerLinkRateLimit`,
 *      so the class guard short-circuits and it can be hit without limit.
 *   2. The whole `/customer-link` prefix is exempt from the proxy gate.
 *   3. `?alias=` is accepted on THREE public routes, not one — `health`,
 *      `profile` and `match` — so the leak is not confined to the one named.
 *
 * With `?alias=` an unauthenticated caller resolves a real OA by name and gets
 * `describe()` back: `enabled`, `has_tool`, `tool_id`, `web_code_source`,
 * `target` and `endpoints`. A name that exists answers differently from one that
 * does not, which is an enumeration oracle for the customer list on its own.
 *
 * ## Why removing it is a deletion rather than a trade
 * `resolveHook`'s own docstring calls alias "dev/testing only"
 * (`customer-link.service.ts:483-484`). The route that actually matters,
 * `admin/edit`, already takes `link_token` and nothing else — the token-only
 * shape is the house pattern here, and these three simply predate it.
 *
 * Nothing calls them with an alias: the landing page always arrives with `?t=`
 * (`customer-register.handler.ts:115,118`), no FE call site passes one, and no
 * spec exercised the branch. So the alias input is removed outright rather than
 * guarded — the smallest surface is no surface.
 *
 * ## What still works
 * Liveness with no parameters at all, and the full config for anyone holding a
 * minted token. Both are pinned below.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CustomerLinkService } from '@/modules/customer-link';

const REAL_ALIAS = 'omnideskdevoa';

/** Answers a hook for ANY alias — so a surviving lookup cannot hide. */
function makeService(): {
  svc: CustomerLinkService;
  aliasLookups: () => number;
} {
  let lookups = 0;
  const hookModel = {
    findOne: (filter: Record<string, unknown>) => {
      if ('alias' in filter) lookups += 1;
      return {
        lean: () => ({
          exec: () =>
            Promise.resolve({
              _id: 'hook-1',
              alias: REAL_ALIAS,
              customer_link_enabled: true,
              customer_link_web_code: 'demo-omnidesk',
            }),
        }),
      };
    },
    findById: () => ({ lean: () => ({ exec: () => Promise.resolve(null) }) }),
  };

  const svc = new CustomerLinkService(
    hookModel as never,
    {} as never, // memberModel
    { safeDecrypt: (v: string) => v } as never, // crypto
    {} as never, // customToolService
    { create: jest.fn().mockResolvedValue({}) } as never, // webhookLogModel
    {} as never, // realtime
    {} as never, // lineApi
    {} as never, // chatHistory
  );
  return { svc, aliasLookups: () => lookups };
}

/** Called through a widened signature so this runs against the pre-fix service
 *  and goes red on BEHAVIOUR — a surviving lookup — not on argument arity. */
type Resolve = (input: Record<string, unknown>) => Promise<{ hook?: unknown }>;

describe('[ALIASORACLE] an alias no longer resolves an OA', () => {
  it('⭐ a real alias resolves nothing, and costs no database lookup', async () => {
    const { svc, aliasLookups } = makeService();

    const resolved = await (svc.resolveHook.bind(svc) as Resolve)({
      alias: REAL_ALIAS,
    });

    expect(resolved.hook ?? null).toBeNull();
    // The lookup itself is the leak: an alias that exists answers differently
    // from one that does not, whatever the body ends up saying.
    expect(aliasLookups()).toBe(0);
  });

  it('⭐ an alias alongside an invalid token still resolves nothing', async () => {
    // This one was ALREADY safe and is kept as a pin, not claimed as a fix: an
    // unreadable token returns `{invalid: true}` before the alias branch is
    // reached (`customer-link.service.ts:497`). Pinned so the short-circuit is
    // not lost if that ordering is ever rearranged.
    const { svc, aliasLookups } = makeService();

    const resolved = await (svc.resolveHook.bind(svc) as Resolve)({
      linkToken: 'not-a-real-token',
      alias: REAL_ALIAS,
    });

    expect(resolved.hook ?? null).toBeNull();
    expect(aliasLookups()).toBe(0);
  });

  it('no parameters at all still answers — liveness is unchanged', async () => {
    const { svc } = makeService();

    const resolved = await (svc.resolveHook.bind(svc) as Resolve)({});

    // `hook: null` is the shape `health` turns into a 200 liveness body.
    expect(resolved).toEqual({ hook: null });
  });
});

describe('[ALIASORACLE] the public routes do not accept an alias', () => {
  // Structural, because the leak is the ROUTE accepting the parameter — a
  // service that ignores it is only half the story if a handler still reads it.
  const source = readFileSync(
    join(
      __dirname,
      '../../src/modules/customer-link/customer-link.controller.ts',
    ),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('no handler reads an alias from the query or the body', () => {
    expect(source).not.toContain("@Query('alias')");
    expect(source).not.toContain("alias: query['alias']");
    expect(source).not.toContain("alias: b['alias']");
  });

  it('the token is still read, so the minted link keeps working', () => {
    expect(source).toContain("linkToken: query['t']");
    expect(source).toContain("linkToken: b['link_token']");
  });
});
