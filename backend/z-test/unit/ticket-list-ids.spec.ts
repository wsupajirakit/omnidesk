/**
 * [PERF-20260822-TKTIDSFETCH] BEFORE/AFTER proof for the optional `ids` param
 * on the ticket list.
 *
 * THE PROPERTY THAT MATTERS: `ids` may only NARROW. Everything the request
 * already asked for — hook scope, job_status, search, within_days — must still
 * be in the filter alongside it, so a caller cannot pull in a ticket outside
 * its scope, outside its search, or belonging to another OA, by naming an id.
 * That is what makes a partial fetch a strict SUBSET of the full refetch, which
 * is the whole reason the dashboard is allowed to merge its result into a list
 * it already holds.
 *
 * AND: absent `ids` must leave the query byte-identical to today. These assert
 * on the filter objects captured at runtime, not on the source text.
 */
import {
  TicketsService,
  parseTicketIds,
  TICKET_IDS_MAX,
} from '@/modules/tickets';

const HOOK = 'a0d000000000000000000017';
const ID_A = 'a0d00000000000000000000a';
const ID_B = 'a0d000000000000000000089';

function makeQueryStub(resolved: unknown[]): Record<string, unknown> {
  const q: Record<string, unknown> = {};
  for (const m of ['populate', 'select', 'sort', 'skip', 'limit', 'lean']) {
    q[m] = jest.fn(() => (m === 'lean' ? Promise.resolve(resolved) : q));
  }
  return q;
}

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
  jest
    .spyOn(service as never, 'resolveScopeHookIds')
    .mockResolvedValue([HOOK] as never);
  jest
    .spyOn(service as never, 'enrichTicketRows')
    .mockResolvedValue([] as never);
  return { service, findFilters, countFilters };
}

describe('parseTicketIds — an optimisation hint, never a reason to 400', () => {
  it('absent / empty → no ids', () => {
    expect(parseTicketIds(undefined)).toEqual([]);
    expect(parseTicketIds('')).toEqual([]);
    expect(parseTicketIds(',,  ,')).toEqual([]);
  });

  it('a malformed id is DROPPED, the valid ones survive', () => {
    // 400-ing the list over one bad hint would take the screen down for
    // something it can live without.
    const out = parseTicketIds(`${ID_A},not-an-id,${ID_B}`);
    expect(out.map(String)).toEqual([ID_A, ID_B]);
  });

  it('every entry malformed → [] → the caller falls back to no id filter', () => {
    expect(parseTicketIds('x,y,z')).toEqual([]);
  });

  it('duplicates collapse — the same id twice must not double the $in', () => {
    expect(parseTicketIds(`${ID_A},${ID_A},${ID_B}`).map(String)).toEqual([
      ID_A,
      ID_B,
    ]);
  });

  it('over the cap is truncated, not rejected', () => {
    const many = Array.from(
      { length: TICKET_IDS_MAX + 20 },
      (_, i) => '507f1f77bcf86cd7994' + String(39011 + i).padStart(5, '0'),
    ).join(',');
    expect(parseTicketIds(many)).toHaveLength(TICKET_IDS_MAX);
  });

  it('whitespace around an id is tolerated', () => {
    expect(parseTicketIds(` ${ID_A} , ${ID_B} `).map(String)).toEqual([
      ID_A,
      ID_B,
    ]);
  });
});

describe('⭐ SEAMLESS: no `ids` → the query is byte-identical to today', () => {
  it('the filter has no _id key at all, on find AND count', async () => {
    const { service, findFilters, countFilters } = buildService();
    await service.listTickets({}, HOOK);
    expect(findFilters[0]).toEqual({ hook_id: HOOK });
    expect(countFilters[0]).toEqual({ hook_id: HOOK });
  });

  it('an ids value that parses to nothing is the same as absent', async () => {
    const { service, findFilters } = buildService();
    await service.listTickets({ ids: 'garbage,also-garbage' }, HOOK);
    expect(findFilters[0]).toEqual({ hook_id: HOOK });
  });
});

describe('⭐ `ids` NARROWS — it can never widen what the caller may see', () => {
  it('the _id filter is ADDED, the hook scope is still there', async () => {
    const { service, findFilters } = buildService();
    await service.listTickets({ ids: ID_A }, HOOK);
    const f = findFilters[0] as Record<string, unknown>;
    expect(f['hook_id']).toBe(HOOK);
    expect((f['_id'] as { $in: unknown[] }).$in.map(String)).toEqual([ID_A]);
  });

  it('job_status still applies — naming an id cannot resurrect a closed ticket', async () => {
    const { service, findFilters } = buildService();
    await service.listTickets({ ids: ID_A, job_status: '0,1' }, HOOK);
    const f = findFilters[0] as Record<string, unknown>;
    expect(f['job_status']).toBeDefined();
    expect(f['_id']).toBeDefined();
  });

  it('within_days still applies — naming an id cannot escape the date scope', async () => {
    const { service, findFilters } = buildService();
    await service.listTickets({ ids: ID_A, within_days: '3' }, HOOK);
    const f = findFilters[0] as Record<string, unknown>;
    expect(f['created_at']).toBeDefined();
    expect(f['_id']).toBeDefined();
  });

  it('category still applies', async () => {
    const { service, findFilters } = buildService();
    await service.listTickets({ ids: ID_A, category: 'Payment' }, HOOK);
    const f = findFilters[0] as Record<string, unknown>;
    expect(f['category']).toBeDefined();
    expect(f['_id']).toBeDefined();
  });

  it('the count is narrowed the same way, so list and total stay coherent', async () => {
    const { service, findFilters, countFilters } = buildService();
    await service.listTickets({ ids: `${ID_A},${ID_B}` }, HOOK);
    expect(countFilters[0]).toEqual(findFilters[0]);
  });

  it('the hook scope is resolved BEFORE ids — an out-of-scope request still returns nothing', async () => {
    // resolveScopeHookIds returning [] short-circuits to an empty response, and
    // `ids` never gets a chance to run. Naming ids from another OA therefore
    // cannot reach the database at all.
    const { service, findFilters } = buildService();
    jest
      .spyOn(service as never, 'resolveScopeHookIds')
      .mockResolvedValue([] as never);
    const res = (await service.listTickets({ ids: ID_A }, HOOK)) as {
      data: unknown[];
    };
    expect(res.data).toEqual([]);
    expect(findFilters).toHaveLength(0);
  });
});
