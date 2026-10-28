/**
 * [FEAT-20260808-TKTSCOPE] BEFORE/AFTER proof for the optional `within_days`
 * date-scope param on the TICKET list + tab-count aggregations only. NEW
 * additive param, not a legacy parity port. (assign-history is intentionally
 * NOT scoped — owner decision.)
 *
 * The seamless property the owner requires: OMITTED `within_days` = "ทั้งหมด" =
 * EXACTLY today's behaviour. These tests capture the actual Mongo filter /
 * $match objects the services build and assert:
 *   (a) omitted  → NO `created_at` scope is added → byte-identical to today,
 *   (b) present  → the SAME `created_at >= now - N*24h` cutoff is applied to the
 *       list, to countDocuments, and to every count aggregation, so list and
 *       badges stay coherent.
 *
 * This is a READ-ONLY filter: no DB writes, no schema change. It asserts on the
 * captured query args at runtime, not on the source text.
 */

import {
  resolveWithinDaysCutoff,
  TicketsService,
  WITHIN_DAYS_ALLOWED,
} from '@/modules/tickets';

// A chainable Mongoose-query stub: every builder method returns `this`, and the
// filter passed to find()/aggregate() is recorded for assertion.
function makeQueryStub(resolved: unknown[]): Record<string, unknown> {
  const q: Record<string, unknown> = {};
  for (const m of ['populate', 'select', 'sort', 'skip', 'limit', 'lean']) {
    q[m] = jest.fn(() => (m === 'lean' ? Promise.resolve(resolved) : q));
  }
  return q;
}

describe('within_days util — allowed set + safe fallback', () => {
  const NOW = new Date('2026-08-08T00:00:00.000Z');

  it('omitted / empty / null → null (unbounded)', () => {
    expect(resolveWithinDaysCutoff(undefined, NOW)).toBeNull();
    expect(resolveWithinDaysCutoff('', NOW)).toBeNull();
    expect(resolveWithinDaysCutoff(null, NOW)).toBeNull();
  });

  it('out-of-set / non-integer / injection-ish → null (ignored, never widens)', () => {
    for (const bad of [
      '1',
      '6',
      '8',
      '30',
      '0',
      '-3',
      '3.5',
      'abc',
      '3;drop',
    ]) {
      expect(resolveWithinDaysCutoff(bad, NOW)).toBeNull();
    }
  });

  it('each allowed value → now - N*24h', () => {
    for (const n of WITHIN_DAYS_ALLOWED) {
      const cut = resolveWithinDaysCutoff(String(n), NOW);
      expect(cut).toEqual(new Date(NOW.getTime() - n * 86_400_000));
    }
  });
});

describe('TicketsService.listTickets — within_days scope', () => {
  const HOOK = 'a0d000000000000000000017';

  function buildService(): {
    service: TicketsService;
    findFilters: unknown[];
    countFilters: unknown[];
  } {
    const findFilters: unknown[] = [];
    const countFilters: unknown[] = [];
    const ticketModel = {
      find: jest.fn((f: unknown) => {
        findFilters.push(f);
        return makeQueryStub([]);
      }),
      countDocuments: jest.fn((f: unknown) => {
        countFilters.push(f);
        return Promise.resolve(0);
      }),
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
    // Scope resolution + row enrichment are unrelated to this feature; stub them
    // so the test isolates the filter the feature builds.
    jest
      .spyOn(service as never, 'resolveScopeHookIds')
      .mockResolvedValue([HOOK] as never);
    jest
      .spyOn(service as never, 'enrichTicketRows')
      .mockResolvedValue([] as never);
    return { service, findFilters, countFilters };
  }

  it('OMITTED → identical to today: no created_at on find OR count', async () => {
    const { service, findFilters, countFilters } = buildService();
    await service.listTickets({}, HOOK);
    // The critical seamless property: nothing about the query changed — the
    // filter is exactly `{ hook_id }`, with NO created_at key, on find AND count.
    expect(findFilters[0]).toEqual({ hook_id: HOOK });
    expect(countFilters[0]).toEqual({ hook_id: HOOK });
    expect(Object.keys(findFilters[0] as object)).not.toContain('created_at');
  });

  it('within_days=3 → same created_at >= now-3d on BOTH find and count', async () => {
    const { service, findFilters, countFilters } = buildService();
    const before = Date.now();
    await service.listTickets({ within_days: '3' }, HOOK);
    const after = Date.now();

    const f = findFilters[0] as { created_at?: { $gte?: Date } };
    const c = countFilters[0] as { created_at?: { $gte?: Date } };
    expect(f.created_at?.$gte).toBeInstanceOf(Date);
    // list and count are scoped by the identical cutoff → coherent
    expect(c.created_at?.$gte?.getTime()).toBe(f.created_at?.$gte?.getTime());

    const gte = f.created_at!.$gte!.getTime();
    const lo = before - 3 * 86_400_000;
    const hi = after - 3 * 86_400_000;
    expect(gte).toBeGreaterThanOrEqual(lo);
    expect(gte).toBeLessThanOrEqual(hi);
  });

  it('out-of-set within_days=6 → ignored, identical to today', async () => {
    const { service, findFilters } = buildService();
    await service.listTickets({ within_days: '6' }, HOOK);
    expect(findFilters[0]).toEqual({ hook_id: HOOK });
  });
});

describe('TicketsService.getTicketMeta — within_days scope (tab counts)', () => {
  const HOOK = 'a0d000000000000000000018';

  function buildService(): { service: TicketsService; matches: unknown[] } {
    const matches: unknown[] = [];
    const ticketModel = {
      aggregate: jest.fn((pipeline: Array<{ $match?: unknown }>) => {
        matches.push(pipeline[0]?.$match);
        return Promise.resolve([]);
      }),
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
    jest
      .spyOn(service as never, 'resolveScopeHookIds')
      .mockResolvedValue([HOOK] as never);
    return { service, matches };
  }

  it('OMITTED → $match has only hook_id (identical to today)', async () => {
    const { service, matches } = buildService();
    await service.getTicketMeta(HOOK, undefined, undefined);
    expect(matches[0]).toEqual({ hook_id: { $in: [HOOK] } });
  });

  it('within_days=3 → $match adds created_at >= now-3d', async () => {
    const { service, matches } = buildService();
    await service.getTicketMeta(HOOK, undefined, undefined, '3');
    const m = matches[0] as { created_at?: { $gte?: Date } };
    expect(m.created_at?.$gte).toBeInstanceOf(Date);
  });

  it('invalid within_days → identical to today', async () => {
    const { service, matches } = buildService();
    await service.getTicketMeta(HOOK, undefined, undefined, '999');
    expect(matches[0]).toEqual({ hook_id: { $in: [HOOK] } });
  });
});
