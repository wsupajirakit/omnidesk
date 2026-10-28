/**
 * [FEAT-20260808-P3xxx] BEFORE/AFTER guards for the SEAMLESS P3 hardening/perf
 * ports. Each block pins BOTH that the new behaviour works AND that the default
 * (opt-out / flag-off) path is byte-identical to before the change.
 *
 * All fakes — no Mongo, no Redis, no external keys.
 */
import type { Request, Response } from 'express';

import { buildGlobalRateLimitMiddleware } from '@/infra/rate-limit/global-rate-limit.middleware';
import type { RateLimitService } from '@/infra/rate-limit/rate-limit.service';
import { CustomToolsService } from '@/modules/hooks';
import { ConfigCacheInvalidator, SystemConfigService } from '@/modules/system';

describe('[P3TOOLCACHE] custom-tool per-process cache', () => {
  const TOOL_ID = 'a0d000000000000000000014';

  function buildService() {
    const findOneExec = jest.fn();
    // Each findOne(...).populate().populate().lean().exec() resolves findOneExec.
    const customToolModel = {
      findOne: jest.fn(() => ({
        populate: () => ({
          populate: () => ({
            lean: () => ({ exec: findOneExec }),
          }),
        }),
      })),
    };
    const service = new CustomToolsService(
      customToolModel as never,
      {} as never, // hookModel
      {} as never, // crypto
      {} as never, // audit
      { invalidateHookCache: async () => {} } as never, // [FIX-20260812-ASSIGNCACHE] hookCache
    );
    return { service, findOneExec, customToolModel };
  }

  const activeHook = { custom_tool_status: true, custom_tool_id: TOOL_ID };

  it('serves the second resolve from cache — one DB read, identical result', async () => {
    const { service, findOneExec } = buildService();
    findOneExec.mockResolvedValue({ _id: TOOL_ID, status: true, name: 'T' });

    const first = await service.getToolForHook(activeHook);
    const second = await service.getToolForHook(activeHook);

    expect(findOneExec).toHaveBeenCalledTimes(1); // cache hit on the 2nd call
    expect(second).toEqual(first); // identical result
    expect(second).toMatchObject({ _id: TOOL_ID, name: 'T' });
  });

  it('AFTER a mutation the cache is dropped — next resolve re-reads (edit visible at once)', async () => {
    const { service, findOneExec } = buildService();
    findOneExec.mockResolvedValueOnce({
      _id: TOOL_ID,
      status: true,
      name: 'v1',
    });
    await service.getToolForHook(activeHook); // warms cache

    // Simulate a config edit invalidating just this tool id.
    (
      service as unknown as { invalidateToolCache: (id: string) => void }
    ).invalidateToolCache(TOOL_ID);

    findOneExec.mockResolvedValueOnce({
      _id: TOOL_ID,
      status: true,
      name: 'v2',
    });
    const after = await service.getToolForHook(activeHook);

    expect(findOneExec).toHaveBeenCalledTimes(2); // re-read, not 60s-stale
    expect(after).toMatchObject({ name: 'v2' });
  });

  it('caches the disabled→null kill switch, and a load failure is NOT cached', async () => {
    const { service, findOneExec } = buildService();
    // disabled tool → null, cached
    findOneExec.mockResolvedValueOnce({ _id: TOOL_ID, status: false });
    expect(await service.getToolForHook(activeHook)).toBeNull();
    expect(await service.getToolForHook(activeHook)).toBeNull();
    expect(findOneExec).toHaveBeenCalledTimes(1); // null was cached

    (
      service as unknown as { invalidateToolCache: () => void }
    ).invalidateToolCache();

    // load failure → null, but NOT cached (transient blip must not pin null)
    findOneExec.mockRejectedValueOnce(new Error('db blip'));
    expect(await service.getToolForHook(activeHook)).toBeNull();
    findOneExec.mockResolvedValueOnce({
      _id: TOOL_ID,
      status: true,
      name: 'ok',
    });
    expect(await service.getToolForHook(activeHook)).toMatchObject({
      name: 'ok',
    });
  });

  it('disabled hook (custom_tool_status !== true) never touches the DB — unchanged', async () => {
    const { service, findOneExec } = buildService();
    expect(
      await service.getToolForHook({
        custom_tool_status: false,
        custom_tool_id: TOOL_ID,
      }),
    ).toBeNull();
    expect(findOneExec).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Item 2 — updateTicket ?minimal=true fast-path (opt-in; default unchanged)
// ─────────────────────────────────────────────────────────────────────────────
import { TicketsService } from '@/modules/tickets';

describe('[P3MINIMAL] updateTicket minimal fast-path', () => {
  const ID = 'a0d000000000000000000016';

  function buildService(rawTicket: Record<string, unknown>) {
    const populateCalls: string[] = [];
    // findOneAndUpdate returns a chainable query; .populate records the field,
    // .lean resolves the raw ticket.
    const query: Record<string, unknown> = {
      populate: jest.fn((field: string) => {
        populateCalls.push(field);
        return query;
      }),
      lean: jest.fn(() => Promise.resolve(rawTicket)),
    };
    const ticketModel = {
      findById: () => ({
        select: () => ({ lean: () => Promise.resolve(null) }),
      }),
      findOneAndUpdate: jest.fn(() => query),
    };
    const service = new TicketsService(
      ticketModel as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      /* [FEAT-20260905-CUSTPROV PART 3] the tier reader takes its paths from the
       active provider now. This suite is not about tiers, so the default entry
       is enough — but it must be PRESENT, or the service cannot construct. */
      {
        resolve: () => ({
          tierPaths: ['data.profile.tier', 'profile.tier', 'tier'],
        }),
      } as never,
    );
    const publishSpy = jest
      .spyOn(service as never, 'publishScopedTicketEvent')
      .mockReturnValue(undefined as never);
    const populateAttachedSpy = jest
      .spyOn(service as never, 'populateAttachedFiles')
      .mockImplementation(((t: unknown) =>
        Promise.resolve({ ...(t as object), _enriched: true })) as never);
    return { service, populateCalls, publishSpy, populateAttachedSpy };
  }

  it('DEFAULT (param absent) → populates + populateAttachedFiles, unchanged', async () => {
    const raw = { _id: ID, job_status: 1, hook_id: 'h1' };
    const { service, populateCalls, populateAttachedSpy } = buildService(raw);

    const res = await service.updateTicket(ID, { note: 'x' });

    expect(populateCalls).toEqual(['chat_user_id', 'hook_id', 'admin_user_id']);
    expect(populateAttachedSpy).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ success: true, data: { _enriched: true } });
  });

  it('minimal=true → skips populates AND populateAttachedFiles, returns raw ticket', async () => {
    const raw = { _id: ID, job_status: 1, hook_id: 'h1', category: 'c' };
    const { service, populateCalls, populateAttachedSpy, publishSpy } =
      buildService(raw);

    const res = await service.updateTicket(ID, { note: 'x' }, undefined, true);

    expect(populateCalls).toEqual([]); // no relational populates
    expect(populateAttachedSpy).not.toHaveBeenCalled(); // no attachment enrich
    expect(res).toEqual({ success: true, data: raw }); // raw doc, not enriched
    // publish still fires with the same four-key payload
    expect(publishSpy).toHaveBeenCalledWith('ticket:updated', {
      _id: ID,
      job_status: 1,
      hook_id: 'h1',
      category: 'c',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Item 3 — global per-IP rate limiter wiring (default-OFF = passthrough parity)
// ─────────────────────────────────────────────────────────────────────────────
describe('[P3GLOBALRL] global rate-limit middleware', () => {
  function fakeRes(): Response & { statusCode?: number; body?: unknown } {
    const res = {
      statusCode: undefined as number | undefined,
      body: undefined as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.body = payload;
        return this;
      },
    };
    return res as unknown as Response & { statusCode?: number; body?: unknown };
  }

  function fakeReq(path: string): Request {
    return { path, headers: {}, ip: '9.9.9.9' } as unknown as Request;
  }

  it('OFF (default) → bare passthrough, consume() never called (byte-identical to today)', () => {
    const consume = jest.fn();
    const rl = {
      isGlobalEnabled: () => false,
      resolveClientIp: () => '9.9.9.9',
      consume,
    } as unknown as RateLimitService;
    const mw = buildGlobalRateLimitMiddleware(rl);
    const next = jest.fn();
    const res = fakeRes();

    mw(fakeReq('/api/tickets'), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(consume).not.toHaveBeenCalled();
    expect(res.statusCode).toBeUndefined(); // no 429
  });

  it('ON + under limit → next(); ON + over limit → 429 with legacy body', async () => {
    const consume = jest
      .fn()
      .mockResolvedValueOnce({ limited: false })
      .mockResolvedValueOnce({ limited: true });
    const rl = {
      isGlobalEnabled: () => true,
      resolveClientIp: () => '9.9.9.9',
      consume,
    } as unknown as RateLimitService;
    const mw = buildGlobalRateLimitMiddleware(rl);

    const next1 = jest.fn();
    const res1 = fakeRes();
    mw(fakeReq('/api/tickets'), res1, next1);
    await new Promise(setImmediate);
    expect(next1).toHaveBeenCalledTimes(1);
    expect(res1.statusCode).toBeUndefined();

    const next2 = jest.fn();
    const res2 = fakeRes();
    mw(fakeReq('/api/tickets'), res2, next2);
    await new Promise(setImmediate);
    expect(next2).not.toHaveBeenCalled();
    expect(res2.statusCode).toBe(429);
    expect(res2.body).toEqual({ error: 'rate limit exceeded' });
  });

  it('ON but bypass path (webhook / handoff callback) → passthrough, no consume', () => {
    const consume = jest.fn();
    const rl = {
      isGlobalEnabled: () => true,
      resolveClientIp: () => '9.9.9.9',
      consume,
    } as unknown as RateLimitService;
    const mw = buildGlobalRateLimitMiddleware(rl);

    for (const p of ['/webhook', '/my-oa/webhook', '/api/handoff/callback/x']) {
      const next = jest.fn();
      mw(fakeReq(p), fakeRes(), next);
      expect(next).toHaveBeenCalledTimes(1);
    }
    expect(consume).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Item 4 — system-config immediate cache invalidation registry
// ─────────────────────────────────────────────────────────────────────────────
describe('[P3CFGINVAL] ConfigCacheInvalidator', () => {
  it('fire() calls every registered listener; unsubscribe stops it', () => {
    const inv = new ConfigCacheInvalidator();
    const a = jest.fn();
    const b = jest.fn();
    inv.register(a);
    const off = inv.register(b);

    inv.fire();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    off();
    inv.fire();
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(1); // unsubscribed
  });

  it('a throwing listener is isolated — others still fire (best-effort, never fails the write)', () => {
    const inv = new ConfigCacheInvalidator();
    const boom = jest.fn(() => {
      throw new Error('listener blew up');
    });
    const ok = jest.fn();
    inv.register(boom);
    inv.register(ok);

    expect(() => inv.fire()).not.toThrow();
    expect(ok).toHaveBeenCalledTimes(1);
  });
});

describe('[P3CFGINVAL] SystemConfigService fires invalidation on writes', () => {
  const OBJ_ID = 'a0d000000000000000000014';

  function build(deletedDoc: unknown = { _id: OBJ_ID, key: 'acme_category' }) {
    const fire = jest.fn();
    const invalidator = { fire } as unknown as ConfigCacheInvalidator;
    const configModel = {
      // assertNotProtected reads key: return a non-protected key so writes proceed.
      findById: jest.fn(() => ({
        select: () => ({
          lean: () => ({
            exec: () => Promise.resolve({ key: 'acme_category' }),
          }),
        }),
      })),
      findByIdAndUpdate: jest.fn(() => ({
        lean: () => ({
          exec: () => Promise.resolve({ _id: OBJ_ID, value: 'true' }),
        }),
      })),
      findByIdAndDelete: jest.fn(() => ({
        lean: () => ({ exec: () => Promise.resolve(deletedDoc) }),
      })),
      create: jest.fn(() =>
        Promise.resolve({ toObject: () => ({ _id: OBJ_ID, key: 'x' }) }),
      ),
    };
    const service = new SystemConfigService(configModel as never, invalidator);
    return { service, fire };
  }

  it('updateConfigById fires the invalidator after a successful write', async () => {
    const { service, fire } = build();
    await service.updateConfigById(OBJ_ID, { value: 'true' });
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('createConfig fires the invalidator', async () => {
    const { service, fire } = build();
    await service.createConfig({ key: 'k', value: 'v' });
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('deleteConfigById fires ONLY when a doc was actually deleted (legacy guard)', async () => {
    const hit = build();
    await hit.service.deleteConfigById(OBJ_ID);
    expect(hit.fire).toHaveBeenCalledTimes(1);

    const miss = build(null); // nothing deleted
    await miss.service.deleteConfigById(OBJ_ID);
    expect(miss.fire).not.toHaveBeenCalled();
  });
});
