/**
 * [FEAT-20260905-CUSTPROV PART 4] 📖 todo/task/05092026/todo3_05092026_
 * profile_panel_module.md §18-23 — the tier FILTER and the tier BADGE are
 * switchable through the active `CustomerProvider`, default = today (`shopapi_v1`
 * declares both `true`, byte-identical to the current screen).
 * ============================================================================
 * This proves the WIRE half only: `TicketsService.listTickets()` stamps
 * `show_tier_badge` / `show_tier_filter` from `CustomerProviderService
 * .resolve()` at every exit of the method, and flipping either switch never
 * changes which rows are fetched, sorted or counted — hiding a CONTROL must
 * never hide a ROW (§20). The render half (control/badge actually disappears,
 * row count on screen unchanged) is proven on the FE side by
 * `test/tierSwitch.dom.test.tsx` in omnidesk-console.
 *
 * Harness style: ticket-list-filter-params.spec.ts (real service, stubbed
 * models, `resolveScopeHookIds`/`enrichTicketRows` spied so only the response
 * envelope — not the Mongo plumbing already covered elsewhere — is exercised).
 */
import { Types } from 'mongoose';

import { TicketsService } from '@/modules/tickets';

const H1 = new Types.ObjectId('a0d000000000000000000017');

/**
 * Builds a real `TicketsService` with every collaborator except the active
 * provider stubbed to a no-op. `resolveScopeHookIds` and `enrichTicketRows`
 * are spied exactly like `ticket-list-filter-params.spec.ts` does, so the
 * Mongo query shape (already pinned by that file and by
 * `customer-provider-tier.spec.ts`) is out of scope here — this file asks one
 * question only: does the chosen provider's two switches reach the response,
 * and do they ride ALONGSIDE `data`/`pagination` rather than inside them.
 */
function makeService(opts: {
  showTierBadge: boolean;
  showTierFilter: boolean;
  scope?: Types.ObjectId[];
  rows?: Array<Record<string, unknown>>;
}) {
  const rows = opts.rows ?? [{ _id: 't1' }, { _id: 't2' }];
  const q: Record<string, unknown> = {};
  for (const m of ['populate', 'select', 'sort', 'skip', 'limit'])
    q[m] = jest.fn(() => q);
  q['lean'] = jest.fn(() => Promise.resolve([]));

  const ticketModel = {
    find: jest.fn(() => q),
    countDocuments: jest.fn(() => Promise.resolve(rows.length)),
    distinct: jest.fn(() => Promise.resolve([])),
  };
  const service = new TicketsService(
    ticketModel as never,
    {} as never, // assignHistoryModel — unused, no case-history read here
    {} as never, // chatRoomModel — unused, enrichTicketRows is spied below
    {} as never, // chatMessageModel — unused
    {} as never, // memberModel — unused: no tag/tier query param in this file
    {} as never, // customerTagModel — unused
    {} as never, // hookModel — unused, resolveScopeHookIds is spied below
    {} as never, // realtimePublisher — unused
    {} as never, // auditLogService — unused
    /* [FEAT-20260905-CUSTPROV PART 4] the ONE thing under test: a fake
       provider entry whose two switches are set per-case, exactly like
       `ticket-list-filter-params.spec.ts` overrides `tierPaths` for PART 3.
       `tierPaths` is included so the shape matches a real `CustomerProvider`
       even though no case here sends a `tier` query param. */
    {
      resolve: () => ({
        showTierBadge: opts.showTierBadge,
        showTierFilter: opts.showTierFilter,
        tierPaths: ['data.profile.tier', 'profile.tier', 'tier'],
      }),
    } as never,
  );
  jest
    .spyOn(service as never, 'resolveScopeHookIds')
    .mockResolvedValue((opts.scope ?? [H1]) as never);
  jest
    .spyOn(service as never, 'enrichTicketRows')
    .mockResolvedValue(rows as never);
  return { service };
}

describe('⭐ [FEAT-20260905-CUSTPROV PART 4] the ticket-list response carries both tier switches', () => {
  it('default (shopapi_v1: both true) reaches the response untouched — byte-identical to today', async () => {
    const { service } = makeService({
      showTierBadge: true,
      showTierFilter: true,
    });
    const res = await service.listTickets({ limit: 'all' }, String(H1));
    expect(res['show_tier_badge']).toBe(true);
    expect(res['show_tier_filter']).toBe(true);
  });

  it('🔴 a fake provider with showTierFilter: false changes ONLY that key in the payload', async () => {
    const { service } = makeService({
      showTierBadge: true,
      showTierFilter: false,
    });
    const res = await service.listTickets({ limit: 'all' }, String(H1));
    expect(res['show_tier_filter']).toBe(false);
    expect(res['show_tier_badge']).toBe(true);
  });

  it('showTierBadge: false flips independently of showTierFilter — [FIX-20260810-TIERSOURCE] rule: neither switch may leak into the other', async () => {
    const { service } = makeService({
      showTierBadge: false,
      showTierFilter: true,
    });
    const res = await service.listTickets({ limit: 'all' }, String(H1));
    expect(res['show_tier_badge']).toBe(false);
    expect(res['show_tier_filter']).toBe(true);
  });

  it('🔴 both switches off at once — the payload says so, nothing throws', async () => {
    const { service } = makeService({
      showTierBadge: false,
      showTierFilter: false,
    });
    const res = await service.listTickets({ limit: 'all' }, String(H1));
    expect(res['show_tier_badge']).toBe(false);
    expect(res['show_tier_filter']).toBe(false);
  });

  it('🔴 ROWS are identical whether the switches are true or false — hiding a control must never hide a row (§20)', async () => {
    const rows = [{ _id: 'a' }, { _id: 'b' }, { _id: 'c' }];
    const on = await makeService({
      showTierBadge: true,
      showTierFilter: true,
      rows,
    }).service.listTickets({ limit: 'all' }, String(H1));
    const off = await makeService({
      showTierBadge: false,
      showTierFilter: false,
      rows,
    }).service.listTickets({ limit: 'all' }, String(H1));
    expect(on['data']).toEqual(off['data']);
    expect((on['data'] as unknown[]).length).toBe(3);
    expect((off['data'] as unknown[]).length).toBe(3);
    // pagination must not move either — a hidden filter narrowing the count
    // would be the exact regression §20 forbids.
    expect(on['pagination']).toEqual(off['pagination']);
  });

  it('the empty-scope early return also stamps both switches (every exit, not just the happy path)', async () => {
    const { service } = makeService({
      showTierBadge: false,
      showTierFilter: true,
      scope: [],
    });
    const res = await service.listTickets({ limit: 'all' }, String(H1));
    expect(res['data']).toEqual([]);
    expect(res['show_tier_badge']).toBe(false);
    expect(res['show_tier_filter']).toBe(true);
  });

  it('the unknown channel_user_id early return (the OTHER early-return branch) also stamps both switches', async () => {
    /* [FIX-20260827-CHANNELUSERPARAM] this is the second of the two early
       returns in `listTickets` — an unresolved `channel_user_id` answers the
       empty shape from a DIFFERENT return statement than the empty-scope
       case above. Both were edited to add the two switches; this proves the
       second one was not missed. */
    const { service } = makeService({
      showTierBadge: false,
      showTierFilter: false,
      scope: [H1],
    });
    const memberFindOne = jest.fn(() => ({
      select: () => ({
        lean: () => ({ exec: () => Promise.resolve(null) }),
      }),
    }));
    (service as unknown as { memberModel: unknown }).memberModel = {
      findOne: memberFindOne,
    };
    const res = await service.listTickets(
      {
        limit: 'all',
        channel_user_id: 'Uunknown00000000000000000000000',
      } as never,
      String(H1),
    );
    expect(memberFindOne).toHaveBeenCalled();
    expect(res['data']).toEqual([]);
    expect(res['show_tier_badge']).toBe(false);
    expect(res['show_tier_filter']).toBe(false);
  });
});
