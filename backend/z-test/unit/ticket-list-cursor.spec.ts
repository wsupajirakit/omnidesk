/**
 * [PERF-20260821-TICKETCURSOR] Keyset (cursor) paging for the ticket list.
 *
 * Owner (21/08): the ticket-support page must carry high load, "seamless to
 * stg ห้ามพัง", realtime untouched. So:
 *   · NO cursor, NO change: `limit=all` and page/limit produce the exact query,
 *     sort and response they produced before (pinned first, case by case).
 *   · WITH `cursor`: a seek on (created_at desc, _id desc) — O(page) at any
 *     depth, stable under inserts — and a response that says `has_more` +
 *     `next_cursor`. `limit` is clamped to TICKET_LIST_MAX_PAGE.
 *   · `TICKET_LIST_HARD_MAX` (code, default 0 = unbounded) can later cap
 *     `limit=all`; at 0 nothing is capped, which is what ships.
 */
import { Types } from 'mongoose';

import {
  TicketsService,
  TICKET_LIST_MAX_PAGE,
  TICKET_LIST_HARD_MAX,
  encodeTicketCursor,
  decodeTicketCursor,
} from '@/modules/tickets';

const HOOK = 'a0d000000000000000000017';

function stub(rows: Array<Record<string, unknown>>) {
  const calls: Record<string, unknown[]> = {
    find: [],
    sort: [],
    skip: [],
    limit: [],
    count: [],
  };
  const q: Record<string, unknown> = {};
  for (const m of ['populate', 'select', 'sort', 'skip', 'limit', 'lean']) {
    q[m] = jest.fn((...a: unknown[]) => {
      if (m in calls) calls[m]!.push(a[0]);
      return m === 'lean' ? Promise.resolve(rows) : q;
    });
  }
  const ticketModel = {
    find: jest.fn((f: unknown) => {
      calls['find']!.push(f);
      return q;
    }),
    countDocuments: jest.fn((f: unknown) => {
      calls['count']!.push(f);
      return Promise.resolve(rows.length);
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
    .mockImplementation((r: unknown) => Promise.resolve(r) as never);
  return { service, calls };
}

const row = (i: number, at: string) => ({
  _id: new Types.ObjectId(`6a8${String(i).padStart(21, '0')}`),
  created_at: new Date(at),
});

describe('⭐ seamless: without a cursor nothing moved', () => {
  it('limit=all → same filter, sort {created_at:-1}, no skip/limit, pagination shape as before', async () => {
    const { service, calls } = stub([row(1, '2026-08-21T10:00:00Z')]);
    const res = await service.listTickets(
      { job_status: '2', limit: 'all' },
      HOOK,
    );
    expect(calls['find']![0]).toEqual({ hook_id: HOOK, job_status: 2 });
    expect(calls['sort']![0]).toEqual({ created_at: -1 });
    expect(calls['skip']).toHaveLength(0);
    expect(calls['limit']).toHaveLength(0);
    expect(res['pagination']).toEqual({
      total: 1,
      page: 1,
      limit: 'all',
      pages: 1,
      total_pages: 1,
    });
  });
  it('page/limit → skip/limit exactly as before', async () => {
    const { service, calls } = stub([]);
    await service.listTickets({ page: '3', limit: '20' }, HOOK);
    expect(calls['skip']![0]).toBe(40);
    expect(calls['limit']![0]).toBe(20);
    expect(calls['sort']![0]).toEqual({ created_at: -1 });
  });
  it('the hard max ships at 0 = unbounded', () => {
    expect(TICKET_LIST_HARD_MAX).toBe(0);
  });
});

describe('cursor paging', () => {
  it('first page: no cursor but `limit` + cursor mode → sort adds the _id tiebreaker, limit+1 is fetched to learn has_more', async () => {
    const rows = [
      row(3, '2026-08-21T10:03:00Z'),
      row(2, '2026-08-21T10:02:00Z'),
      row(1, '2026-08-21T10:01:00Z'),
    ];
    const { service, calls } = stub(rows);
    const res = await service.listTickets(
      { job_status: '2', limit: '2', cursor: '' },
      HOOK,
    );
    expect(calls['sort']![0]).toEqual({ created_at: -1, _id: -1 });
    expect(calls['limit']![0]).toBe(3); // limit + 1
    expect(calls['skip']).toHaveLength(0);
    const data = res['data'] as unknown[];
    expect(data).toHaveLength(2); // the +1 row is not returned, only used
    const p = res['pagination'] as Record<string, unknown>;
    expect(p['has_more']).toBe(true);
    expect(p['limit']).toBe(2);
    expect(decodeTicketCursor(p['next_cursor'] as string)).toEqual({
      created_at: rows[1]!.created_at,
      _id: String(rows[1]!._id),
    });
  });

  it('next page: the cursor becomes a seek on (created_at, _id) — never a skip', async () => {
    const { service, calls } = stub([]);
    const c = encodeTicketCursor({
      created_at: new Date('2026-08-21T10:02:00Z'),
      _id: 'a0d000000000000000000087',
    });
    await service.listTickets({ job_status: '2', limit: '2', cursor: c }, HOOK);
    const f = calls['find']![0] as Record<string, unknown>;
    expect(f['hook_id']).toBe(HOOK);
    expect(f['$or']).toEqual([
      { created_at: { $lt: new Date('2026-08-21T10:02:00Z') } },
      {
        created_at: new Date('2026-08-21T10:02:00Z'),
        _id: { $lt: new Types.ObjectId('a0d000000000000000000087') },
      },
    ]);
    expect(calls['skip']).toHaveLength(0);
  });

  it('cursor + within_days: the scope stays and the seek is ANDed, not overwritten', async () => {
    const { service, calls } = stub([]);
    const c = encodeTicketCursor({
      created_at: new Date('2026-08-21T10:02:00Z'),
      _id: 'a0d000000000000000000087',
    });
    await service.listTickets(
      { job_status: '2', limit: '2', cursor: c, within_days: '3' },
      HOOK,
    );
    const f = calls['find']![0] as Record<string, unknown>;
    expect(f['created_at']).toMatchObject({ $gte: expect.any(Date) }); // the scope
    expect(f['$or']).toBeDefined(); // the seek
  });

  it('last page: fewer than limit+1 rows → has_more false, no next_cursor', async () => {
    const { service } = stub([row(1, '2026-08-21T10:01:00Z')]);
    const res = await service.listTickets({ limit: '2', cursor: '' }, HOOK);
    const p = res['pagination'] as Record<string, unknown>;
    expect(p['has_more']).toBe(false);
    expect(p['next_cursor']).toBeNull();
  });

  it('limit is clamped to TICKET_LIST_MAX_PAGE', async () => {
    const { service, calls } = stub([]);
    await service.listTickets({ limit: '999999', cursor: '' }, HOOK);
    expect(calls['limit']![0]).toBe(TICKET_LIST_MAX_PAGE + 1);
  });

  it('a garbage cursor → 400, nothing queried', async () => {
    const { service, calls } = stub([]);
    await expect(
      service.listTickets({ limit: '2', cursor: 'not-a-cursor' }, HOOK),
    ).rejects.toMatchObject({ status: 400 });
    expect(calls['find']).toHaveLength(0);
  });

  it('total is still the count of the whole filter (the tab badge reads it), not of the page', async () => {
    const { service, calls } = stub([row(1, '2026-08-21T10:01:00Z')]);
    const c = encodeTicketCursor({
      created_at: new Date('2026-08-21T10:02:00Z'),
      _id: 'a0d000000000000000000087',
    });
    await service.listTickets({ job_status: '2', limit: '2', cursor: c }, HOOK);
    expect(calls['count']![0]).toEqual({ hook_id: HOOK, job_status: 2 }); // no $or on the count
  });
});

describe('cursor codec', () => {
  it('round-trips and is opaque (base64url, no raw ids in the URL)', () => {
    const c = encodeTicketCursor({
      created_at: new Date('2026-08-21T10:02:00Z'),
      _id: 'a0d000000000000000000087',
    });
    expect(c).not.toContain('a0d000000000000000000087');
    expect(decodeTicketCursor(c)).toEqual({
      created_at: new Date('2026-08-21T10:02:00Z'),
      _id: 'a0d000000000000000000087',
    });
    expect(decodeTicketCursor('')).toBeNull();
    expect(decodeTicketCursor('%%%')).toBeUndefined();
    // review finding: a well-formed cursor whose ms is out of Date range must be
    // rejected HERE (400), not cast by Mongoose into a 500
    const outOfRange = Buffer.from(
      '9000000000000000.a0d000000000000000000087',
      'utf8',
    ).toString('base64url');
    expect(decodeTicketCursor(outOfRange)).toBeUndefined();
    const sloppy = Buffer.from('1e3.a0d000000000000000000087', 'utf8').toString(
      'base64url',
    );
    expect(decodeTicketCursor(sloppy)).toBeUndefined();
  });
});
