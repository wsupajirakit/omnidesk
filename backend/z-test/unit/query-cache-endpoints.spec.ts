import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// [FEAT-20260808-QCACHE] Before/after IDENTITY proofs at each wired endpoint.
//
// For every cached endpoint (insight-report, webhook-log, audit-log) this asserts
// the owner's non-negotiable bar:
//   (a) cache MISS returns EXACTLY what the un-cached path returns today,
//   (b) cache HIT === that same payload (served without re-querying the DB),
//   (c) TTL=0/unset ⇒ behaves exactly as today (live query every call, bypass).
// plus the no-cross-scope-leak property per endpoint.
//
// The DB layer under each endpoint is mocked (no Mongo, no network). The cache is
// the REAL ScopedQueryCacheService backed by the in-memory FakeRedis, so the code
// path exercised is the production wiring, not a re-implementation.

import { type Model, Types } from 'mongoose';

import type { AuthenticatedUser } from '@/common';
import { ScopedQueryCacheService } from '@/infra/query-cache';
import type { RedisService } from '@/infra/redis';
// Barrel where the symbol is exported; deep import (matching the existing spec
// convention, e.g. chat-media-outbound-log.spec.ts) only where it is not.
import { AuditLogController, type AuditLogService } from '@/modules/audit';
import type { HookDocument } from '@/modules/hooks';
import { type WebhookLogService } from '@/modules/system';
import { WebhookLogController } from '@/modules/system/webhook-log.controller';
import type { OaAccessService } from '@/modules/system/oa-access.service';
import type { WebhookStatsService } from '@/modules/system/webhook-stats.service';
import { InsightReportsService } from '@/modules/tickets/insight-reports.service';

import { FakeRedisClient, fakeRedisService } from '../lib/fake-redis';

const TTL_ON = {
  ttlDashboardSeconds: 120,
  ttlInsightSeconds: 300,
  ttlWebhookLogSeconds: 30,
  ttlAuditSeconds: 30,
  jitterPct: 0,
};
const TTL_OFF = { ...TTL_ON, ttlWebhookLogSeconds: 0, ttlAuditSeconds: 0 };

/* [FIX-20260905-REDISNS] Fixed inputs for the environment segment of the key.
   Both services in the cross-scope case below MUST share these, or they would
   land on different keys for a reason that has nothing to do with scope. */
const REALTIME = { wsEnv: 'dev' } as never;
const MONGO = { uri: 'mongodb://127.0.0.1:27017/testdb' } as never;

function cacheWith(config = TTL_ON): {
  cache: ScopedQueryCacheService;
  redis: FakeRedisClient;
} {
  const redis = new FakeRedisClient();
  const cache = new ScopedQueryCacheService(
    fakeRedisService(redis) as unknown as RedisService,
    config,
    REALTIME,
    MONGO,
  );
  return { cache, redis };
}

/** Minimal typed shim: an AuthenticatedUser is only partially populated in tests. */
const asUser = (u: Partial<AuthenticatedUser>): AuthenticatedUser =>
  u as unknown as AuthenticatedUser;

const superUser = asUser({
  roleName: 'superadmin',
  permissions: ['*'],
  groups: [],
});
const scopedUser = asUser({
  roleName: 'operator',
  permissions: ['webhook_log.manage', 'system.manage'],
  groups: ['grp-1'],
});
const otherScopedUser = asUser({
  roleName: 'operator',
  permissions: ['webhook_log.manage', 'system.manage'],
  groups: ['grp-2'],
});

// ─────────────────────────────── webhook-log ───────────────────────────────

describe('webhook-log list — before/after identity + no leak', () => {
  const LIVE = {
    data: [{ _id: 'w1', action_type: 'push_message' }],
    pagination: { page: 1, limit: 20, total: 1, total_pages: 1 },
  };

  function makeController(
    listLogs: jest.Mock,
    config = TTL_ON,
  ): { controller: WebhookLogController; redis: FakeRedisClient } {
    const { cache, redis } = cacheWith(config);
    const logService = { listLogs } as unknown as WebhookLogService;
    const statsService = {} as unknown as WebhookStatsService;
    const oaAccess = {
      ensureHookAccess: jest.fn().mockResolvedValue(undefined),
    } as unknown as OaAccessService;
    const controller = new WebhookLogController(
      logService,
      statsService,
      oaAccess,
      cache,
    );
    return { controller, redis };
  }

  const call = (c: WebhookLogController, user: AuthenticatedUser) =>
    c.listLogs(
      undefined, // hook_id
      undefined, // hook_alias
      undefined, // channel
      undefined, // action_type
      undefined, // status
      undefined, // from
      undefined, // to
      '1', // page
      '20', // limit
      undefined, // sort
      undefined, // meta_key
      undefined, // meta_value
      undefined, // search  [FEAT-20260828-LOGSEARCH]
      user,
    );

  it('(a) MISS === today, (b) HIT === MISS with no re-query', async () => {
    const listLogs = jest.fn().mockResolvedValue(LIVE);
    const { controller } = makeController(listLogs);
    const miss = await call(controller, scopedUser);
    expect(miss).toEqual(LIVE); // identical to the un-cached path
    expect(listLogs).toHaveBeenCalledTimes(1);

    const hit = await call(controller, scopedUser);
    expect(hit).toEqual(miss); // byte-identical
    expect(listLogs).toHaveBeenCalledTimes(1); // served from cache, DB untouched
  });

  it('(c) TTL=0 ⇒ live query every call (bypass, identical to today)', async () => {
    const listLogs = jest.fn().mockResolvedValue(LIVE);
    const { controller, redis } = makeController(listLogs, TTL_OFF);
    await call(controller, scopedUser);
    await call(controller, scopedUser);
    expect(listLogs).toHaveBeenCalledTimes(2);
    expect(redis.countSets()).toBe(0);
  });

  it('no cross-scope leak: grp-2 never reads grp-1 cached rows', async () => {
    const listLogs = jest
      .fn()
      .mockResolvedValueOnce({ data: [{ _id: 'grp1-row' }], pagination: {} })
      .mockResolvedValueOnce({ data: [{ _id: 'grp2-row' }], pagination: {} });
    const { controller } = makeController(listLogs);
    const r1 = await call(controller, scopedUser); // grp-1 populates
    const r2 = await call(controller, otherScopedUser); // grp-2 must miss
    expect(r1).toEqual({ data: [{ _id: 'grp1-row' }], pagination: {} });
    expect(r2).toEqual({ data: [{ _id: 'grp2-row' }], pagination: {} });
    expect(listLogs).toHaveBeenCalledTimes(2); // both ran their own query
  });

  it('super and scoped user get different buckets for identical params', async () => {
    const listLogs = jest
      .fn()
      .mockResolvedValueOnce({ data: ['ALL'], pagination: {} })
      .mockResolvedValueOnce({ data: ['SCOPED'], pagination: {} });
    const { controller } = makeController(listLogs);
    const asSuper = await call(controller, superUser);
    const asScoped = await call(controller, scopedUser);
    expect(asSuper).toEqual({ data: ['ALL'], pagination: {} });
    expect(asScoped).toEqual({ data: ['SCOPED'], pagination: {} });
    expect(listLogs).toHaveBeenCalledTimes(2);
  });
});

// ──────────────────────────────── audit-log ────────────────────────────────

describe('audit-log list — before/after identity + no leak', () => {
  const LIVE = {
    data: [{ _id: 'a1', action: 'update' }],
    pagination: { page: 1, limit: 20, total: 1, total_pages: 1 },
  };

  function makeController(
    listAuditLogs: jest.Mock,
    config = TTL_ON,
  ): { controller: AuditLogController } {
    const { cache } = cacheWith(config);
    const auditLogService = { listAuditLogs } as unknown as AuditLogService;
    const hookModel = {} as unknown as Model<HookDocument>;
    const controller = new AuditLogController(
      auditLogService,
      hookModel,
      cache,
    );
    return { controller };
  }

  const call = (c: AuditLogController, user: AuthenticatedUser) =>
    c.listLogs({ page: '1', limit: '20' }, user);

  it('(a) MISS === today, (b) HIT === MISS with no re-query', async () => {
    const listAuditLogs = jest.fn().mockResolvedValue(LIVE);
    const { controller } = makeController(listAuditLogs);
    const miss = await call(controller, scopedUser);
    expect(miss).toEqual(LIVE);
    expect(listAuditLogs).toHaveBeenCalledTimes(1);

    const hit = await call(controller, scopedUser);
    expect(hit).toEqual(miss);
    expect(listAuditLogs).toHaveBeenCalledTimes(1);
  });

  it('(c) TTL=0 ⇒ live query every call (bypass)', async () => {
    const listAuditLogs = jest.fn().mockResolvedValue(LIVE);
    const { controller } = makeController(listAuditLogs, TTL_OFF);
    await call(controller, scopedUser);
    await call(controller, scopedUser);
    expect(listAuditLogs).toHaveBeenCalledTimes(2);
  });

  it('no cross-scope leak: grp-2 never reads grp-1 audit rows', async () => {
    const listAuditLogs = jest
      .fn()
      .mockResolvedValueOnce({ data: ['grp1-audit'], pagination: {} })
      .mockResolvedValueOnce({ data: ['grp2-audit'], pagination: {} });
    const { controller } = makeController(listAuditLogs);
    const r1 = await call(controller, scopedUser);
    const r2 = await call(controller, otherScopedUser);
    expect(r1).toEqual({ data: ['grp1-audit'], pagination: {} });
    expect(r2).toEqual({ data: ['grp2-audit'], pagination: {} });
    expect(listAuditLogs).toHaveBeenCalledTimes(2);
  });
});

// ───────────────────────── insight-report (service) ─────────────────────────
// The insight service resolves scope via getAllowedHookIds (its own hookModel
// query), so the cache is exercised at the SERVICE layer. We stub the hookModel
// to fix the scope and spy on the aggregation-producing half (computeTicketInsights)
// so we can count how often the DB work runs behind the cache without Mongo.

/** Spy the private aggregation half without widening its public signature. */
type ComputeSpy = {
  computeTicketInsights: (...args: unknown[]) => Promise<unknown>;
};
const asComputeSpy = (s: InsightReportsService): ComputeSpy =>
  s as unknown as ComputeSpy;

describe('insight-report — before/after identity + no leak (service layer)', () => {
  // getAllowedHookIds keeps only VALID ObjectId groups, and scopeHookIds maps the
  // returned hook ids through `new Types.ObjectId(id)` — so both must be real oids.
  const GRP_1 = new Types.ObjectId().toString();
  const GRP_2 = new Types.ObjectId().toString();
  const HOOK_A = new Types.ObjectId().toString();
  const HOOK_B = new Types.ObjectId().toString();

  // hookModel.find(...).select(...).lean() → the caller's allowed hook ids.
  function hookModelFor(ids: string[]): Model<HookDocument> {
    return {
      find: () => ({
        select: () => ({
          lean: () => Promise.resolve(ids.map((id) => ({ _id: id }))),
        }),
      }),
    } as unknown as Model<HookDocument>;
  }

  // The five collections the aggregation touches are stubbed empty — every test
  // replaces computeTicketInsights, so they are never dereferenced. `as never`
  // makes the empty object assignable to each concrete Model<...> param position.
  const stub = {} as never;

  // A service whose heavy aggregation half is spy-able.
  function makeService(
    allowedIds: string[],
    cache: ScopedQueryCacheService,
  ): InsightReportsService {
    return new InsightReportsService(
      stub, // ticketModel
      stub, // assignHistoryModel
      stub, // chatMessageModel
      stub, // chatRoomModel
      stub, // userModel
      hookModelFor(allowedIds), // hookModel (drives getAllowedHookIds scope)
      cache,
      // [FEAT-20260808-GROUPB-INSIGHTCAT] systemConfig — every test replaces
      // computeTicketInsights, so the flag read is never reached; stub is fine.
      stub, // systemConfig
    );
  }

  const nonSuper = asUser({ roleName: 'operator', groups: [GRP_1] });
  const nonSuperOther = asUser({ roleName: 'operator', groups: [GRP_2] });

  it('(a) MISS runs the aggregation; (b) HIT reuses it; (c) TTL=0 bypasses', async () => {
    const service = makeService([HOOK_A], cacheWith().cache);
    const payload = { success: true, data: { presets: {} } };
    const spy = jest
      .spyOn(asComputeSpy(service), 'computeTicketInsights')
      .mockResolvedValue(payload);

    const miss = await service.getTicketInsights({}, nonSuper);
    expect(miss).toEqual(payload);
    expect(spy).toHaveBeenCalledTimes(1);

    const hit = await service.getTicketInsights({}, nonSuper);
    expect(hit).toEqual(miss); // identical, no re-aggregation
    expect(spy).toHaveBeenCalledTimes(1);

    // TTL off ⇒ live aggregation every call.
    const liveService = makeService(
      [HOOK_A],
      cacheWith({ ...TTL_ON, ttlInsightSeconds: 0 }).cache,
    );
    const liveSpy = jest
      .spyOn(asComputeSpy(liveService), 'computeTicketInsights')
      .mockResolvedValue(payload);
    await liveService.getTicketInsights({}, nonSuper);
    await liveService.getTicketInsights({}, nonSuper);
    expect(liveSpy).toHaveBeenCalledTimes(2);
  });

  it('no cross-scope leak: a hook-A scope never serves a hook-B scope', async () => {
    // Two services with DIFFERENT allowed-hook sets share ONE Redis so a leak,
    // if it existed, would surface as a shared cache hit.
    const redis = new FakeRedisClient();
    const cache = new ScopedQueryCacheService(
      fakeRedisService(redis) as unknown as RedisService,
      TTL_ON,
      REALTIME,
      MONGO,
    );
    const svcA = makeService([HOOK_A], cache);
    const svcB = makeService([HOOK_B], cache);
    jest
      .spyOn(asComputeSpy(svcA), 'computeTicketInsights')
      .mockResolvedValue({ data: 'A-DATA' });
    const bSpy = jest
      .spyOn(asComputeSpy(svcB), 'computeTicketInsights')
      .mockResolvedValue({ data: 'B-DATA' });

    const a = await svcA.getTicketInsights({}, nonSuper);
    const b = await svcB.getTicketInsights({}, nonSuperOther);
    expect(a).toEqual({ data: 'A-DATA' });
    expect(b).toEqual({ data: 'B-DATA' }); // B did NOT read A's entry
    expect(bSpy).toHaveBeenCalledTimes(1);
  });
});

/**
 * [FIX-20260818-INSIGHTSCOPE] plan §8 = T3-3 of fix_plan_18_aug
 *
 * A SIXTH copy of the OA-scope rule lived here, and like the others it had lost
 * the per-user `allowed_hooks` tier — the plan's inventory named five sites and
 * missed this one, which is exactly how the first leak survived being fixed.
 * The insight aggregates are per-OA counts, so an operator whitelisted to one OA
 * was reading totals that included OAs they were walled off from.
 *
 * The copy is deleted rather than repaired; this file now drives the shared
 * resolver through the service, so the whitelist tier cannot go missing here
 * again without the shared spec going red too.
 */
describe('[INSIGHTSCOPE] insight uses the one shared OA-scope resolver', () => {
  /**
   * ⚠️ WHAT THIS PROVES, AND WHAT IT DOES NOT. This is a structural pin, not a
   * behaviour test, and it is written that way on purpose: driving
   * `getTicketInsights` end to end needs five models, a cache and a config
   * service, and a harness that heavy would be asserting on my own stubs rather
   * than on the code. The BEHAVIOUR of the resolver is already covered where it
   * lives — the whitelist tier has its own red-first cases in
   * `httponly-auth-s1.spec.ts` — so what is worth pinning HERE is the thing that
   * actually went wrong: this file had its own private copy of the rule, and the
   * copy had lost that tier.
   *
   * A sixth copy is how the first leak survived being fixed: the plan's inventory
   * named five sites and missed this one. If someone reintroduces a local
   * resolver here, this case fails and says why.
   */
  const SRC = join(
    process.cwd(),
    'src/modules/tickets/insight-reports.service.ts',
  );
  const source = readFileSync(SRC, 'utf8');

  it('⭐ defines no local getAllowedHookIds — the copy is gone', () => {
    expect(source).not.toContain('function getAllowedHookIds');
  });

  it('⭐ imports the shared resolver from the hooks barrel', () => {
    expect(source).toContain('getAllowedHookIds');
    expect(source).toContain("from '@/modules/hooks'");
    // a deep path would bypass the barrel and is an eslint error anyway
    expect(source).not.toContain('oa-access/allowed-hook-ids');
  });

  it('no longer re-implements the group query the resolver owns', () => {
    expect(source).not.toContain('group: { $in: groupIds }');
  });
});
