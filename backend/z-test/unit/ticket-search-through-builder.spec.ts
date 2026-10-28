/**
 * [PERF-20260821-MEMBERSEARCH] listTickets asks the members collection through
 * buildMemberSearchQuery — and in legacy mode sends the 19/08 query unchanged.
 * Real service, stubbed models.
 */
import { TicketsService } from '@/modules/tickets';

const HOOK = 'a0d000000000000000000017';

function build(members: Array<{ _id: string }>) {
  const memberCalls: Array<{ filter: unknown; limit: number | null }> = [];
  const memberModel = {
    find: jest.fn((filter: unknown) => {
      const rec = { filter, limit: null as number | null };
      memberCalls.push(rec);
      const q = {
        limit: (n: number) => {
          rec.limit = n;
          return q;
        },
        lean: () => Promise.resolve(members),
      };
      return q;
    }),
  };
  const ticketFinds: unknown[] = [];
  const q: Record<string, unknown> = {};
  for (const m of ['populate', 'select', 'sort', 'skip', 'limit', 'lean'])
    q[m] = jest.fn(() => (m === 'lean' ? Promise.resolve([]) : q));
  const ticketModel = {
    find: jest.fn((f: unknown) => {
      ticketFinds.push(f);
      return q;
    }),
    countDocuments: jest.fn(() => Promise.resolve(0)),
  };
  // ctor order: ticket, assignHistory, chatRoom, chatMessage, MEMBER, customerTag, hook, realtime, audit
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

describe('listTickets search → members lookup', () => {
  it('legacy mode (shipping): the ten-field unanchored `i` regex, NO limit, no search_truncated key', async () => {
    const h = build([{ _id: 'm1' }]);
    const res = await h.service.listTickets({ search: 'Som' }, HOOK);
    expect(h.memberCalls).toHaveLength(1);
    const or = (
      h.memberCalls[0]!.filter as { $or: Array<Record<string, RegExp>> }
    ).$or;
    expect(or).toHaveLength(10);
    // every path, in the 19/08 order, same RegExp — not just branch [0] (review finding)
    expect(or.map((b) => Object.keys(b)[0])).toEqual([
      'display_name',
      'nickname',
      'member_user_id',
      'full_name',
      'phone_number',
      'contract_code',
      'detail',
      'raw_profile_data.data.profile.phone',
      'raw_profile_data.data.profile.bank.account_no',
      'raw_profile_data.data.profile.bank.account_name',
    ]);
    for (const b of or)
      expect(Object.values(b)[0]).toEqual(new RegExp('Som', 'i'));
    expect(h.memberCalls[0]!.limit).toBeNull();
    expect(
      (h.ticketFinds[0] as Record<string, unknown>)['chat_user_id'],
    ).toEqual({ $in: ['m1'] });
    expect(res).not.toHaveProperty('search_truncated');
  });
  it('a blank search term asks nothing (as before)', async () => {
    const h = build([]);
    await h.service.listTickets({ search: '   ' }, HOOK);
    expect(h.memberCalls).toHaveLength(0);
  });
});

/**
 * [PERF-20260826-TKTSEARCHHYBRID] 📖 docs/bottleneck_26_aug.md (S3) — the
 * shipping DEFAULT does not move, and the hybrid extras stay invisible to it.
 * The hybrid mechanism itself is proven in member-search-hybrid.spec.ts (which
 * mocks the mode); these two pins are what make that code deploy-safe today.
 */
describe('[TKTSEARCHHYBRID] shipping default is untouched', () => {
  it('⭐ MEMBER_SEARCH_MODE ships as legacy_regex — flipping it is an owner decision, not a side effect', () => {
    const util = jest.requireActual('@/modules/tickets/member-search.util');
    expect(util.MEMBER_SEARCH_MODE).toBe('legacy_regex');
  });

  it('⭐ legacy mode leaks NO search_mode key — the response stays byte-identical', async () => {
    const h = build([{ _id: 'm1' }]);
    const res = await h.service.listTickets({ search: 'Som' }, HOOK);
    expect(res).not.toHaveProperty('search_mode');
  });
});
