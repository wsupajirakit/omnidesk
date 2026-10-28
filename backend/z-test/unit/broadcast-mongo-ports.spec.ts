/**
 * [FEAT-20260822-BCASTPORTS] The queries the run actually sends to Mongo.
 * ===========================================================================
 * Fake models capture what was asked for, so the SHAPE of every query is
 * asserted rather than hoped for. The cases that matter are the ones where a
 * wrong query still returns a number: a count that quietly includes every OA,
 * or a read failure that answers 0 and waves the run through a ceiling.
 */
import { buildRunPorts, DryRunChunkSink } from '@/modules/content';

const NOW = 1_700_000_000_000;
const clock = { now: () => NOW };

function models(over: Record<string, unknown> = {}) {
  const seen = {
    member: [] as unknown[],
    room: [] as unknown[],
    history: [] as unknown[],
  };
  const chain = (rows: unknown[]) => ({
    find: (f: unknown) => {
      seen.room.push(f);
      return chain(rows);
    },
    select: () => chain(rows),
    sort: () => chain(rows),
    limit: () => chain(rows),
    lean: () => chain(rows),
    exec: () => Promise.resolve(rows),
  });
  return {
    seen,
    deps: {
      broadcastModel: {
        countDocuments: jest.fn().mockResolvedValue(0),
        findOneAndUpdate: jest.fn().mockReturnValue({
          lean: () => ({ exec: () => Promise.resolve({ _id: 'b1' }) }),
        }),
      },
      hookModel: {
        findById: () => ({
          select: () => ({
            lean: () => ({ exec: () => Promise.resolve(null) }),
          }),
        }),
      },
      memberModel: {
        find: (f: unknown) => {
          seen.member.push(f);
          return chain([{ _id: 'm1' }, { _id: 'm2' }]);
        },
      },
      chatRoomModel: {
        find: (f: unknown) => {
          seen.room.push(f);
          return chain([{ line_user_id: 'U1' }]);
        },
        countDocuments: jest.fn((f: unknown) => {
          // ⚠️ `countRecipients` counts with `countDocuments`, not `find` — an
          // earlier fixture only captured `find` and the assertion read
          // `undefined`. จับให้ตรงกับสิ่งที่โค้ดเรียกจริง.
          seen.room.push(f);
          return Promise.resolve(2);
        }),
      },
      historyModel: {
        countDocuments: jest.fn().mockResolvedValue(3),
        findOne: () => ({
          sort: () => ({
            select: () => ({
              lean: () => ({ exec: () => Promise.resolve(null) }),
            }),
          }),
        }),
        find: (f: unknown) => {
          seen.history.push(f);
          return chain([{ sent: 10, requests_made: 1 }]);
        },
        insertMany: jest.fn().mockResolvedValue([]),
      },
      safeDecrypt: (v: string) => v,
      toCursor: (id: string) => id,
      ...over,
    },
  };
}

const extras = {
  sink: new DryRunChunkSink(),
  clock,
  audienceFilter: { status: 'active' },
  jobId: 'b1',
  userId: 'u1',
};

const build = (m = models()) => ({
  ports: buildRunPorts(m.deps as never, extras),
  seen: m.seen,
  deps: m.deps,
});

describe('countRecipients — never counts straight from members', () => {
  it('🔴 goes through chat_rooms, because members has no hook_id', async () => {
    const { ports, seen } = build();
    const n = await ports.countRecipients('h1', { status: 'active' });

    expect(seen.member[0]).toEqual({ status: 'active' });
    // the chat_rooms lookup is scoped to THIS OA
    const scoped = seen.room.find(
      (f) => (f as Record<string, unknown>)['hook_id'] === 'h1',
    );
    expect(scoped).toBeDefined();
    expect(n).toBe(2);
  });

  it('🔴 answers NaN when the OA cannot be scoped — never a number a guard waves through', async () => {
    const { ports } = build();
    expect(await ports.countRecipients('', { status: 'active' })).toBeNaN();
  });

  it('🔴 a read that THROWS is NaN, not 0', async () => {
    /* Zero is a real answer meaning "nobody", and every ceiling lets it pass.
       A Mongo hiccup answering 0 would look like an empty audience to planRun
       and a quiet hour to checkAbuse. อ่านไม่ได้ = NaN ไม่ใช่ 0. */
    const m = models({
      memberModel: {
        find: () => {
          throw new Error('mongo down');
        },
      },
    });
    const { ports } = build(m);
    expect(await ports.countRecipients('h1', {})).toBeNaN();
  });
});

describe('readAbuseState — the counters the flood guard reads', () => {
  it('fills every field the guard asks for', async () => {
    const { ports } = build();
    const s = await ports.readAbuseState();
    expect(Object.keys(s).sort()).toEqual(
      [
        'jobIsRunning',
        'lastRunFinishedAtMs',
        'runsByThisUserLastHour',
        'runsInFlightGlobal',
        'runsOfThisJobLastHour',
      ].sort(),
    );
    /* 🔴 and NOT `nowMs`: the clock is the caller's, so a port that returned
       one would let a run be judged against a different "now" than the one it
       was planned with. `AbuseState` omits it deliberately. */
    expect(s).not.toHaveProperty('nowMs');
  });

  it('a job with no finished run reports null, not 0', async () => {
    // 0 would read as "finished at the epoch", i.e. cooldown long expired.
    const { ports } = build();
    expect((await ports.readAbuseState()).lastRunFinishedAtMs).toBeNull();
  });

  it('🔴 an unreadable counter is NaN, so the guard refuses', async () => {
    const m = models({
      historyModel: {
        countDocuments: jest.fn().mockRejectedValue(new Error('down')),
        findOne: () => ({
          sort: () => ({
            select: () => ({
              lean: () => ({ exec: () => Promise.resolve(null) }),
            }),
          }),
        }),
      },
    });
    const { ports } = build(m);
    expect((await ports.readAbuseState()).runsOfThisJobLastHour).toBeNaN();
  });
});

describe('readQuotaUsage — hour and day, from the history rows', () => {
  it('sums sent and requests_made per window', async () => {
    const { ports } = build();
    const u = await ports.readQuotaUsage();
    expect(u.lastHour).toEqual({ recipients: 10, requests: 1 });
    expect(u.lastDay).toEqual({ recipients: 10, requests: 1 });
  });

  it('🔴 unreadable usage looks like a FULL quota, never an empty one', async () => {
    const m = models({
      historyModel: {
        countDocuments: jest.fn().mockResolvedValue(0),
        findOne: () => ({
          sort: () => ({
            select: () => ({
              lean: () => ({ exec: () => Promise.resolve(null) }),
            }),
          }),
        }),
        find: () => {
          throw new Error('down');
        },
      },
    });
    const { ports } = build(m);
    const u = await ports.readQuotaUsage();
    expect(u.lastHour.recipients).toBeNaN();
    expect(u.lastDay.requests).toBeNaN();
  });
});

describe('saveHistory', () => {
  it('writes every row in one call', async () => {
    const { ports, deps } = build();
    await ports.saveHistory([{ run_id: 'r1' }, { run_id: 'r1' }] as never);
    expect(deps.historyModel.insertMany).toHaveBeenCalledTimes(1);
  });

  it('does not touch Mongo when there is nothing to write', async () => {
    const { ports, deps } = build();
    await ports.saveHistory([]);
    expect(deps.historyModel.insertMany).not.toHaveBeenCalled();
  });
});

describe('[FIX-20260823-BCASTCRONACTOR] a run with no user is 0, not unreadable', () => {
  /**
   * 🔴 FOUND BY RUNNING THE REAL SCHEDULER. `countRunsOfUser` answers `null`
   * for two different situations — an unreadable clock, and NO USER AT ALL —
   * and feeding `NaN` for the second made the abuse guard refuse every
   * scheduled run with "a run counter could not be read" while every counter
   * was perfectly readable.
   *
   * A cron run carries `triggered_by: 'scheduler'` and deliberately no
   * `triggered_by_user`, so a history row can never claim a person pressed a
   * button they did not. It therefore has no per-user history to count, and 0
   * is that answer. ไม่มีผู้ใช้ = 0 · อ่านไม่ได้ = คนละเรื่อง.
   */
  const models = (counts: number) => ({
    broadcastModel: {
      countDocuments: () => Promise.resolve(counts),
      findOne: () => ({
        sort: () => ({
          select: () => ({
            lean: () => ({ exec: () => Promise.resolve(null) }),
          }),
        }),
      }),
    },
    historyModel: {
      countDocuments: () => Promise.resolve(counts),
      findOne: () => ({
        sort: () => ({
          select: () => ({
            lean: () => ({ exec: () => Promise.resolve(null) }),
          }),
        }),
      }),
    },
  });

  const build = (userId: unknown) =>
    buildRunPorts(
      models(0) as never,
      {
        clock: { now: () => Date.parse('2026-08-23T00:00:00Z') },
        audienceFilter: {},
        jobId: 'job1',
        userId,
        toCursor: (id: string) => id as never,
        safeDecrypt: (v: string) => v,
      } as never,
    );

  it('🔴 the scheduler (no user) gets 0 — the guard can read it', async () => {
    const state = await build(undefined).readAbuseState();
    expect(state?.runsByThisUserLastHour).toBe(0);
    expect(Number.isNaN(state?.runsByThisUserLastHour)).toBe(false);
  });

  it('null is the same answer — both mean "nobody pressed anything"', async () => {
    const state = await build(null).readAbuseState();
    expect(state?.runsByThisUserLastHour).toBe(0);
  });

  it('a real user still counts their own runs', async () => {
    const state = await build('admin-1').readAbuseState();
    expect(state?.runsByThisUserLastHour).toBe(0); // the fake returns 0 rows
    expect(Number.isNaN(state?.runsByThisUserLastHour)).toBe(false);
  });
});

describe('[FIX-20260823-BCASTPREFETCH] the prefetch survives the factory', () => {
  /**
   * 🔴 FOUND BY A REAL SEND. `new-send.service` passed a `prefetchRecipients`
   * and `run-broadcast` read one, and the factory in between never carried it:
   * the extras type did not declare the key, and TypeScript does not object to
   * an extra property reaching an object literal through a spread. Every
   * personalised card then rendered with no values and failed to send, while
   * the suite stayed green — because each side was tested and the HOP between
   * them was not. ทดสอบสองฝั่ง แต่ไม่ได้ทดสอบรอยต่อ.
   */
  const models = {
    broadcastModel: { countDocuments: () => Promise.resolve(0) },
    historyModel: { countDocuments: () => Promise.resolve(0) },
    memberModel: {},
    chatRoomModel: {},
    safeDecrypt: (v: string) => v,
    hookModel: {},
  };
  const base = {
    sink: {} as never,
    clock: { now: () => 0 },
    audienceFilter: {},
    jobId: 'job1',
    userId: 'u1',
    toCursor: (id: string) => id as never,
  };

  it('🔴 a prefetch handed in comes back out', async () => {
    const seen: string[] = [];
    const ports = buildRunPorts(models as never, {
      ...base,
      prefetchRecipients: (hookId: string) => {
        seen.push(hookId);
        return Promise.resolve();
      },
    });

    expect(typeof ports.prefetchRecipients).toBe('function');
    await ports.prefetchRecipients?.('hookA', ['U1']);
    expect(seen).toEqual(['hookA']);
  });

  it('🔴 and an absent one stays ABSENT — not a no-op', async () => {
    /* The executor checks for the port and skips the call entirely when there
       is none. A no-op would cost a call per page and do nothing.
       ไม่มี port = ไม่เรียกเลย ไม่ใช่เรียกแล้วไม่ทำอะไร. */
    const ports = buildRunPorts(models as never, base);
    expect(ports.prefetchRecipients).toBeUndefined();
  });
});
