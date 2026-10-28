/**
 * [FEAT-20260826-TKTACTIVITYSORT] 📖 docs/bottleneck_26_aug.md (S7 · layer 3 · 3c)
 * Opt-in activity order for the cursor walk — option ก, owner-approved 26/08.
 * ============================================================================
 * WHY `updated_at` AND NOT A NEW COLUMN. The screen's order is
 * `activityAt(updated_at, lastMsgAt)` folded CLIENT-side; no ticket column
 * carries lastMsgAt and stamping one would add a write to the hottest path
 * (option ข, rejected). Under ก the server pages by (updated_at desc, _id
 * desc) — every cause that moves updated_at (claim/transfer/close/edit)
 * already emits ticket:updated and the ids-fetch pulls the row, and 3d adds
 * the line_user_id float-up fetch for messages hitting unloaded cards — so
 * the display order the operator sees stays the client fold, identical.
 *
 * SHAPE. `sort=activity` is recognised ONLY in cursor mode; absent (or any
 * other value, or non-cursor requests) walks the byte-identical created_at
 * path — pinned here. The cursor token stays time+id (field-agnostic); in
 * activity mode the time IS the row's updated_at (created_at fallback for a
 * hypothetical stampless row — never a crash).
 *
 * THE INDEX. {hook_id, job_status, updated_at desc, _id desc} — the seek's
 * own shape, declared in ticket.schema.ts. ⚠️ stg/prod must build it
 * manually in background BEFORE booting the code that declares it.
 */
import { Types } from 'mongoose';

import {
  TicketsService,
  TicketSchema,
  decodeTicketCursor,
  encodeTicketCursor,
} from '@/modules/tickets';

const HOOK = 'a0d000000000000000000017';

function stub(rows: Array<Record<string, unknown>>) {
  const calls = { find: [] as unknown[], sort: [] as unknown[] };
  const q: Record<string, unknown> = {};
  for (const m of ['populate', 'select', 'sort', 'skip', 'limit', 'lean']) {
    q[m] = jest.fn((...a: unknown[]) => {
      if (m === 'sort') calls.sort.push(a[0]);
      return m === 'lean' ? Promise.resolve(rows) : q;
    });
  }
  const ticketModel = {
    find: jest.fn((f: unknown) => {
      calls.find.push(f);
      return q;
    }),
    countDocuments: jest.fn(() => Promise.resolve(rows.length)),
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

const row = (i: number, created: string, updated: string) => ({
  _id: new Types.ObjectId(`6a8${String(i).padStart(21, '0')}`),
  created_at: new Date(created),
  updated_at: new Date(updated),
});

describe('⭐ absent sort: the created_at walk, byte for byte', () => {
  it('cursor mode without sort keeps {created_at:-1,_id:-1} and a created_at seek', async () => {
    const at = new Date('2026-08-26T10:00:00Z');
    const token = encodeTicketCursor({
      created_at: at,
      _id: String(row(1, '2026-08-26T09:00:00Z', '2026-08-26T09:00:00Z')._id),
    });
    const { service, calls } = stub([]);
    await service.listTickets(
      { job_status: '0,1', cursor: token, limit: '50' },
      HOOK,
    );
    expect(calls.sort[0]).toEqual({ created_at: -1, _id: -1 });
    const or = (calls.find[0] as { $or: Array<Record<string, unknown>> }).$or;
    expect(Object.keys(or[0]!)).toEqual(['created_at']);
  });

  it('sort=activity OUTSIDE cursor mode is ignored — the legacy list is untouched', async () => {
    const { service, calls } = stub([]);
    await service.listTickets(
      { job_status: '0,1', limit: 'all', sort: 'activity' },
      HOOK,
    );
    expect(calls.sort[0]).toEqual({ created_at: -1 });
    expect(JSON.stringify(calls.find[0])).not.toContain('updated_at');
  });
});

describe('⭐ sort=activity in cursor mode: the updated_at walk', () => {
  it('first page sorts {updated_at:-1,_id:-1}', async () => {
    const { service, calls } = stub([]);
    await service.listTickets(
      { job_status: '0,1', cursor: '', limit: '50', sort: 'activity' },
      HOOK,
    );
    expect(calls.sort[0]).toEqual({ updated_at: -1, _id: -1 });
  });

  it('the seek walks updated_at, tiebroken by _id', async () => {
    const at = new Date('2026-08-26T10:00:00Z');
    const anchor = row(1, '2026-08-01T00:00:00Z', '2026-08-26T10:00:00Z');
    const token = encodeTicketCursor({
      created_at: at,
      _id: String(anchor._id),
    });
    const { service, calls } = stub([]);
    await service.listTickets(
      { job_status: '0,1', cursor: token, limit: '50', sort: 'activity' },
      HOOK,
    );
    const or = (calls.find[0] as { $or: Array<Record<string, unknown>> }).$or;
    expect(or[0]).toEqual({ updated_at: { $lt: at } });
    expect(or[1]).toEqual({
      updated_at: at,
      _id: { $lt: anchor._id },
    });
  });

  it('next_cursor carries the LAST row updated_at — resumable where the walk stopped', async () => {
    const rows = [
      row(3, '2026-08-01T00:00:00Z', '2026-08-26T12:00:00Z'),
      row(2, '2026-08-20T00:00:00Z', '2026-08-26T11:00:00Z'),
      row(1, '2026-08-25T00:00:00Z', '2026-08-26T10:00:00Z'), // the +1 probe row
    ];
    const { service } = stub(rows);
    const res = await service.listTickets(
      { job_status: '0,1', cursor: '', limit: '2', sort: 'activity' },
      HOOK,
    );
    const pag = res['pagination'] as { has_more: boolean; next_cursor: string };
    expect(pag.has_more).toBe(true);
    const decoded = decodeTicketCursor(pag.next_cursor)!;
    expect(decoded.created_at.getTime()).toBe(
      new Date('2026-08-26T11:00:00Z').getTime(), // row 2's UPDATED_at, not its created_at
    );
  });

  it('a stampless row falls back to created_at in the token — never a crash', async () => {
    const bare = {
      _id: new Types.ObjectId('a0d000000000000000000083'),
      created_at: new Date('2026-08-10T00:00:00Z'),
      // no updated_at at all
    };
    const { service } = stub([
      row(3, '2026-08-01T00:00:00Z', '2026-08-26T12:00:00Z'),
      bare,
      row(1, '2026-08-25T00:00:00Z', '2026-08-26T10:00:00Z'),
    ]);
    const res = await service.listTickets(
      { job_status: '0,1', cursor: '', limit: '2', sort: 'activity' },
      HOOK,
    );
    const pag = res['pagination'] as { next_cursor: string };
    const decoded = decodeTicketCursor(pag.next_cursor)!;
    expect(decoded.created_at.getTime()).toBe(
      new Date('2026-08-10T00:00:00Z').getTime(),
    );
  });
});

describe('⭐ the index the walk stands on', () => {
  it('ticket schema declares {hook_id, job_status, updated_at:-1, _id:-1} in that exact order', () => {
    const declared = TicketSchema.indexes() as Array<
      [Record<string, number>, Record<string, unknown>?]
    >;
    const match = declared.find((i) => {
      const keys = Object.keys(i[0]);
      return (
        keys.length === 4 &&
        keys[0] === 'hook_id' &&
        keys[1] === 'job_status' &&
        keys[2] === 'updated_at' &&
        keys[3] === '_id' &&
        i[0]['updated_at'] === -1 &&
        i[0]['_id'] === -1
      );
    });
    expect(match).toBeDefined();
  });
});
