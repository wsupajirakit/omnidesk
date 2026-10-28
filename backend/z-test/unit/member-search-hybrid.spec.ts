/**
 * [PERF-20260826-TKTSEARCHHYBRID] 📖 docs/bottleneck_26_aug.md (S3) — hybrid
 * search: tokens first, and NOBODY with a presence can stop being findable.
 * ============================================================================
 * THE PROBLEM WITH FLIPPING TO `tokens` DIRECTLY (be_todo72 ชั้น 2): the
 * `search.*` buckets are written only when a member row is WRITTEN after the
 * bucket code shipped — no backfill, owner's rule — so an untouched legacy
 * member simply does not exist to the tokens query. That is the quietest
 * possible "เคสไม่ครบ".
 *
 * HYBRID: run tokens (index range scan). Fall back to the byte-identical
 * legacy ten-field regex walk when (a) tokens found NOTHING, or (b) the term
 * is too short for tokens. The response says which leg answered
 * (`search_mode`) so the owner can measure the fallback share on stg before
 * ever making tokens the only leg.
 *
 * ⚠️ KNOWN, DELIBERATE EDGE (recorded, not hidden): if tokens finds SOME
 * members but a bucket-less legacy member ALSO matches the term, hybrid
 * returns only the tokens hits — the fallback triggers on zero, not on
 * "maybe incomplete". That is why the DEFAULT STAYS `legacy_regex` and the
 * flip is gated on the stg parity proof (P2.1, prove-search-parity.mjs) +
 * the bucket-gap count (P2.3), per the plan. This spec proves the mechanism;
 * the numbers decide the flip.
 *
 * This file mocks MEMBER_SEARCH_MODE='hybrid' (module-scoped); the shipping
 * default is pinned in ticket-search-through-builder.spec.ts.
 */
import { TicketsService } from '@/modules/tickets';
import { MEMBER_SEARCH_RESULT_CAP } from '@/modules/tickets/member-search.util';

jest.mock('@/modules/tickets/member-search.util', () => ({
  ...jest.requireActual('@/modules/tickets/member-search.util'),
  MEMBER_SEARCH_MODE: 'hybrid',
}));

const HOOK = 'a0d000000000000000000017';

/** memberModel that answers each find() from a queue, recording every filter. */
function build(resultsQueue: Array<Array<{ _id: string }>>) {
  const memberCalls: Array<{ filter: unknown; limit: number | null }> = [];
  const memberModel = {
    find: jest.fn((filter: unknown) => {
      const rec = { filter, limit: null as number | null };
      memberCalls.push(rec);
      const rows = resultsQueue[memberCalls.length - 1] ?? [];
      const q = {
        limit: (n: number) => {
          rec.limit = n;
          return q;
        },
        lean: () => Promise.resolve(rows),
      };
      return q;
    }),
  };
  const tq: Record<string, unknown> = {};
  for (const m of ['populate', 'select', 'sort', 'skip', 'limit', 'lean'])
    tq[m] = jest.fn(() => (m === 'lean' ? Promise.resolve([]) : tq));
  const ticketFinds: unknown[] = [];
  const ticketModel = {
    find: jest.fn((f: unknown) => {
      ticketFinds.push(f);
      return tq;
    }),
    countDocuments: jest.fn(() => Promise.resolve(0)),
  };
  const service = new TicketsService(
    ticketModel as never,
    {} as never,
    {} as never,
    {} as never,
    memberModel as never,
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
  return { service, memberCalls, ticketFinds };
}

const isLegacyFilter = (f: unknown): boolean => {
  const or = (f as { $or?: Array<Record<string, unknown>> }).$or ?? [];
  return or.length === 10 && Object.keys(or[0] ?? {})[0] === 'display_name';
};
const isTokensFilter = (f: unknown): boolean => {
  const or = (f as { $or?: Array<Record<string, unknown>> }).$or ?? [];
  return (
    or.length === 8 && String(Object.keys(or[0] ?? {})[0]).startsWith('search.')
  );
};

describe('⭐ hybrid: tokens answers when it can', () => {
  it('a tokens hit is final — ONE member query, search_mode reports tokens', async () => {
    const h = build([[{ _id: 'm1' }]]);
    const res = await h.service.listTickets({ search: 'somchai' }, HOOK);

    expect(h.memberCalls).toHaveLength(1);
    expect(isTokensFilter(h.memberCalls[0]!.filter)).toBe(true);
    expect(h.memberCalls[0]!.limit).toBe(MEMBER_SEARCH_RESULT_CAP);
    expect(
      (h.ticketFinds[0] as Record<string, unknown>)['chat_user_id'],
    ).toEqual({ $in: ['m1'] });
    expect(res).toHaveProperty('search_mode', 'tokens');
  });
});

describe('⭐ hybrid: the legacy walk catches everyone tokens cannot see', () => {
  it('tokens ZERO → the exact legacy query runs and its hits ship', async () => {
    const h = build([[], [{ _id: 'legacy-only' }]]);
    const res = await h.service.listTickets({ search: 'somchai' }, HOOK);

    expect(h.memberCalls).toHaveLength(2);
    expect(isTokensFilter(h.memberCalls[0]!.filter)).toBe(true);
    expect(isLegacyFilter(h.memberCalls[1]!.filter)).toBe(true);
    expect(h.memberCalls[1]!.limit).toBeNull(); // legacy walk is uncapped, as shipped
    expect(
      (h.ticketFinds[0] as Record<string, unknown>)['chat_user_id'],
    ).toEqual({ $in: ['legacy-only'] });
    expect(res).toHaveProperty('search_mode', 'legacy_regex');
    expect(res).not.toHaveProperty('search_truncated'); // legacy leg never truncates
  });

  it('a term too short for tokens goes STRAIGHT to legacy — one query, not two', async () => {
    const h = build([[{ _id: 'm9' }]]);
    const res = await h.service.listTickets({ search: 'x' }, HOOK);

    expect(h.memberCalls).toHaveLength(1);
    expect(isLegacyFilter(h.memberCalls[0]!.filter)).toBe(true);
    expect(res).toHaveProperty('search_mode', 'legacy_regex');
  });

  it('a blank term still asks nothing and reports nothing', async () => {
    const h = build([]);
    const res = await h.service.listTickets({ search: '   ' }, HOOK);

    expect(h.memberCalls).toHaveLength(0);
    expect(res).not.toHaveProperty('search_mode');
  });
});
