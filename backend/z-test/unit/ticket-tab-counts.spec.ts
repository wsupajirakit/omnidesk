/**
 * [FEAT-20260826-TKTTABCOUNTS] 📖 docs/bottleneck_26_aug.md (S6 · layer 3 · 3b)
 * The open tab's badges get a server truth — opt-in, absent = byte-identical.
 * ============================================================================
 * WHY. Once 3d pages the open tab, the screen no longer holds every row, and
 * "count the loaded rows" (counts memo, TicketChat.tsx:2032) silently becomes
 * "count the loaded PAGE" — the exact badge lie fe_todo73 §1.3 predicts. The
 * BE must answer the tab numbers under the SAME filter set the list request
 * carries (scope ∩ oa/tag/tier/search/category/dates from S5).
 *
 * SHAPE. `counts` present (even '') ⇒ the response gains
 *   tab_counts: { waiting, active, mine, ended }
 * from ONE aggregate over the request's filter WITHOUT its job_status and
 * WITHOUT its `ids` subset — badges describe the whole tab family even when
 * the fetch is a named subset (ids) or a single status. `mine` = job_status 1
 * owned by the caller. Absent ⇒ no aggregate call, no new key (pinned).
 *
 * SCOPE GUARD. waiting/active/mine feed the OPEN tab only; `ended` rides the
 * same $group for free. The บอทดูแล badge keeps its own two-source formula
 * (botCountDeps.value.test.ts) — NOT touched here. ห้ามกระทบแท็บอื่น.
 */
import { Types } from 'mongoose';

import { TicketsService } from '@/modules/tickets';

const H1 = new Types.ObjectId('a0d000000000000000000017');
const ADMIN = 'a0d000000000000000000039';

function stub(opts: {
  aggRows?: Array<{ _id: number; n: number; mine: number }>;
  tagMembers?: Types.ObjectId[];
}) {
  const calls = {
    find: [] as unknown[],
    aggregate: [] as unknown[],
  };
  const q: Record<string, unknown> = {};
  for (const m of ['populate', 'select', 'sort', 'skip', 'limit', 'lean'])
    q[m] = jest.fn(() => (m === 'lean' ? Promise.resolve([]) : q));
  const ticketModel = {
    find: jest.fn((f: unknown) => {
      calls.find.push(f);
      return q;
    }),
    countDocuments: jest.fn(() => Promise.resolve(0)),
    aggregate: jest.fn((pipeline: unknown) => {
      calls.aggregate.push(pipeline);
      return Promise.resolve(opts.aggRows ?? []);
    }),
    distinct: jest.fn(() => Promise.resolve([])),
  };
  const customerTagModel = {
    distinct: jest.fn(() => Promise.resolve(opts.tagMembers ?? [])),
  };
  const service = new TicketsService(
    ticketModel as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    customerTagModel as never,
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
    .mockResolvedValue([H1] as never);
  jest
    .spyOn(service as never, 'enrichTicketRows')
    .mockResolvedValue([] as never);
  return { service, calls };
}

const auth = { userId: ADMIN } as never;

describe('⭐ absent `counts`: byte-identical — no aggregate, no new key', () => {
  it('the response has no tab_counts and the model was never aggregated', async () => {
    const { service, calls } = stub({});
    const res = await service.listTickets(
      { job_status: '0,1', limit: 'all' },
      String(H1),
      undefined,
      auth,
    );
    expect(calls.aggregate).toHaveLength(0);
    expect(res).not.toHaveProperty('tab_counts');
  });
});

describe('⭐ counts mode: one aggregate answers the whole tab family', () => {
  it('groups by job_status over the filter WITHOUT job_status, and maps the rows', async () => {
    const { service, calls } = stub({
      aggRows: [
        { _id: 0, n: 5, mine: 0 },
        { _id: 1, n: 3, mine: 2 },
        { _id: 2, n: 7, mine: 0 },
      ],
    });
    const res = await service.listTickets(
      { job_status: '0,1', limit: 'all', counts: '' },
      String(H1),
      undefined,
      auth,
    );

    expect(calls.aggregate).toHaveLength(1);
    const pipeline = calls.aggregate[0] as Array<Record<string, unknown>>;
    const match = pipeline[0]!['$match'] as Record<string, unknown>;
    // the tab family spans every status — its own job_status must not leak in
    expect(match['job_status']).toBeUndefined();
    expect(match['hook_id']).toEqual(H1);

    expect(res['tab_counts']).toEqual({
      waiting: 5,
      active: 3,
      mine: 2,
      ended: 7,
    });
  });

  it('⭐ the `ids` subset never shrinks the badges', async () => {
    const { service, calls } = stub({ aggRows: [] });
    await service.listTickets(
      {
        job_status: '0,1',
        limit: 'all',
        counts: '',
        ids: 'a0d00000000000000000008a',
      },
      String(H1),
      undefined,
      auth,
    );
    const match = (calls.aggregate[0] as Array<Record<string, unknown>>)[0]![
      '$match'
    ] as Record<string, unknown>;
    expect(match['_id']).toBeUndefined();
    // ...while the list find itself IS the subset — unchanged
    expect((calls.find[0] as Record<string, unknown>)['_id']).toBeDefined();
  });

  it('S5 member constraints (tag) DO scope the badges', async () => {
    const m1 = new Types.ObjectId('a0d00000000000000000008b');
    const { service, calls } = stub({ aggRows: [], tagMembers: [m1] });
    await service.listTickets(
      { job_status: '0,1', limit: 'all', counts: '', tag: 'tag-1' },
      String(H1),
      undefined,
      auth,
    );
    const match = (calls.aggregate[0] as Array<Record<string, unknown>>)[0]![
      '$match'
    ] as Record<string, unknown>;
    expect(match['chat_user_id']).toEqual({ $in: [m1] });
  });

  it('`mine` counts job_status 1 owned by the CALLER; no caller → mine 0 and no crash', async () => {
    const { service, calls } = stub({ aggRows: [{ _id: 1, n: 4, mine: 0 }] }); // $sum:0 ⇒ DB can only ever return 0 here
    const res = await service.listTickets(
      { limit: 'all', counts: '' },
      String(H1),
      undefined,
      undefined, // no auth
    );
    const pipeline = calls.aggregate[0] as Array<Record<string, unknown>>;
    const group = pipeline[1]!['$group'] as Record<string, unknown>;
    expect(group['_id']).toBe('$job_status');
    // without a caller the mine accumulator must be a literal zero
    expect(JSON.stringify(group['mine'])).not.toContain('admin_user_id');
    expect((res['tab_counts'] as Record<string, unknown>)['mine']).toBe(0);
  });

  it('with a caller, mine requires BOTH job_status 1 AND ownership', async () => {
    const { service, calls } = stub({ aggRows: [] });
    await service.listTickets(
      { limit: 'all', counts: '' },
      String(H1),
      undefined,
      auth,
    );
    const group = (calls.aggregate[0] as Array<Record<string, unknown>>)[1]![
      '$group'
    ] as Record<string, unknown>;
    const mineExpr = JSON.stringify(group['mine']);
    expect(mineExpr).toContain('admin_user_id');
    expect(mineExpr).toContain('"$job_status",1');
  });
});
