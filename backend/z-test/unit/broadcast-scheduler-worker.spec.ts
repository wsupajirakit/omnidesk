/**
 * [FEAT-20260822-BCASTTICK] The scheduler's loop, pinned.
 * ===========================================================================
 * A scheduler fails in two silent ways — it fires when it should not, or it
 * stops firing and nobody notices — and the LOOP adds four more that no pure
 * function can have: a round on top of a round, a throw that wedges the flag
 * forever, more work per tick than the system can run, and something moving
 * while the kill switch is off. Every case below asserts a LITERAL value for
 * exactly one of those.
 *
 * ⚠️ NO TIMERS, REAL OR FAKE. `tick(now)` is an ordinary method and `now` is an
 * argument, so overlap is proven with a promise that has not resolved yet —
 * not with `jest.useFakeTimers()`. That is the point of the design: the
 * dangerous part is testable without a clock and without Mongo.
 *
 * ⚠️ `ON` is passed explicitly everywhere except the kill-switch block. The
 * shipped switch is OFF, so a worker built with the default refuses — which is
 * itself one of the assertions.
 */
import {
  BROADCAST_SCHEDULER_ENABLED,
  BroadcastSchedulerWorker,
  DUE_AT_FIELD,
  DUE_SCAN_LIMIT,
  DUE_STATUS,
  type BroadcastJobRunner,
  type BroadcastSchedule,
  type DueJobRow,
  type DueScanQuery,
  type SchedulerWorkerPorts,
  type SweepQuery,
} from '@/modules/content';

/** Saturday 2026-08-22 17:00 Bangkok — the same instant the sibling spec uses. */
const NOW = new Date('2026-08-22T10:00:00.000Z');
const PAST = new Date('2026-08-22T09:00:00.000Z');
const FUTURE = new Date('2026-08-22T11:00:00.000Z');

const ON = true;
const OFF = false;

const EVERY_HOUR: BroadcastSchedule = { mode: 'repeat', every_minutes: 60 };

/** A row exactly as the scan's projection returns it: three columns, no more. */
const dueRow = (id: string, at: Date = PAST): DueJobRow => ({
  _id: id,
  status: DUE_STATUS,
  [DUE_AT_FIELD]: at,
});

interface StubCalls {
  readonly scans: DueScanQuery[];
  readonly sweeps: SweepQuery[];
  readonly runs: { job: DueJobRow; now: Date }[];
}

interface StubOptions {
  rows?: readonly DueJobRow[] | null;
  scanThrows?: boolean;
  swept?: number | null;
  sweepThrows?: boolean;
  run?: BroadcastJobRunner;
}

/**
 * A whole tick's worth of I/O as a plain object. No Mongo, no LINE, no Nest.
 * Every port records what it was handed so the spec can assert on the SHAPE the
 * worker passed down, not merely on the number it got back.
 */
const makeStub = (
  opts: StubOptions = {},
): { ports: SchedulerWorkerPorts; calls: StubCalls } => {
  const calls: StubCalls = { scans: [], sweeps: [], runs: [] };
  const ports: SchedulerWorkerPorts = {
    scanDue: (query) => {
      calls.scans.push(query);
      if (opts.scanThrows)
        return Promise.reject(new Error('mongo unreachable'));
      return Promise.resolve(opts.rows === undefined ? [] : opts.rows);
    },
    sweepStale: (query) => {
      calls.sweeps.push(query);
      if (opts.sweepThrows)
        return Promise.reject(new Error('mongo unreachable'));
      return Promise.resolve(opts.swept === undefined ? 0 : opts.swept);
    },
    runJob: (job, now) => {
      calls.runs.push({ job, now });
      return opts.run ? opts.run(job, now) : Promise.resolve(null);
    },
  };
  return { ports, calls };
};

/** A promise the test resolves by hand — how "still running" is expressed. */
const deferred = (): { promise: Promise<void>; release: () => void } => {
  let release = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    release = () => resolve();
  });
  return { promise, release };
};

describe('kill switch — off means the ports are never even touched', () => {
  /**
   * ⚠️ REWRITTEN 23/08. The first case asserted the constant ships `false`; the
   * owner turned it on and what protects existing campaigns became `next_run_at`
   * (a column none of them carry), not the switch. Pinning the old value would
   * now fail for a deliberate decision while the real property went unguarded —
   * `broadcast-schedule.spec.ts` owns that one. This block keeps doing its own
   * job: proving the OFF branch still stops everything, one edit away.
   */
  it('the constant is a real boolean, so both branches stay compilable', () => {
    const flag: boolean = BROADCAST_SCHEDULER_ENABLED;
    expect(typeof flag).toBe('boolean');
  });

  it('🔴 off ⇒ no scan, no sweep, and the runner is never called', async () => {
    const { ports, calls } = makeStub({ rows: [dueRow('a')] });
    const worker = new BroadcastSchedulerWorker(ports, DUE_SCAN_LIMIT, OFF);

    const report = await worker.tick(NOW);

    expect(report.ran).toBe(false);
    expect(report.refused).toBe('disabled');
    // The proof is not the report — it is that nothing downstream was asked.
    expect(calls.scans).toHaveLength(0);
    expect(calls.sweeps).toHaveLength(0);
    expect(calls.runs).toHaveLength(0);
  });

  it('🔴 the SAME worker with the switch on does all three', async () => {
    const { ports, calls } = makeStub({ rows: [dueRow('a')] });
    const worker = new BroadcastSchedulerWorker(ports, DUE_SCAN_LIMIT, ON);

    const report = await worker.tick(NOW);

    expect(report.ran).toBe(true);
    expect(calls.scans).toHaveLength(1);
    expect(calls.sweeps).toHaveLength(1);
    expect(calls.runs).toHaveLength(1);
  });
});

describe('a due job is handed to the runner it was GIVEN', () => {
  it('hands the row and the tick clock, and counts it once', async () => {
    const { ports, calls } = makeStub({ rows: [dueRow('job-1')] });
    const worker = new BroadcastSchedulerWorker(ports, DUE_SCAN_LIMIT, ON);

    const report = await worker.tick(NOW);

    expect(calls.runs).toHaveLength(1);
    expect(calls.runs[0]?.job._id).toBe('job-1');
    // The tick's own clock, not one the worker read for itself.
    expect(calls.runs[0]?.now).toBe(NOW);
    expect(report.scanned).toBe(1);
    expect(report.handed).toBe(1);
    expect(report.rejected).toBe(0);
    expect(report.failed).toBe(0);
  });

  it('asks the database with the shape `due-query.ts` owns', async () => {
    const { ports, calls } = makeStub();
    const worker = new BroadcastSchedulerWorker(ports, DUE_SCAN_LIMIT, ON);

    await worker.tick(NOW);

    expect(calls.scans[0]?.filter).toEqual({
      status: 'scheduled',
      next_run_at: { $lte: NOW },
      deleted_at: { $exists: false },
    });
    expect(calls.scans[0]?.limit).toBe(DUE_SCAN_LIMIT);
  });

  it('🔴 a row the scan surfaced but that is no longer due is REFUSED', async () => {
    // A race: cancelled between the scan and this line. The in-memory recheck
    // is what stops the runner being handed work it must not do.
    const { ports, calls } = makeStub({
      rows: [
        { _id: 'cancelled', status: 'draft', [DUE_AT_FIELD]: PAST },
        { _id: 'not-yet', status: DUE_STATUS, [DUE_AT_FIELD]: FUTURE },
        {
          _id: 'deleted',
          status: DUE_STATUS,
          [DUE_AT_FIELD]: PAST,
          deleted_at: PAST,
        },
      ],
    });
    const worker = new BroadcastSchedulerWorker(ports, DUE_SCAN_LIMIT, ON);

    const report = await worker.tick(NOW);

    expect(calls.runs).toHaveLength(0);
    expect(report.scanned).toBe(3);
    expect(report.handed).toBe(0);
    expect(report.rejected).toBe(3);
  });
});

describe('🔴 danger 1 — a tick must never run beside another tick', () => {
  it('drops the second tick, counts it, and does not scan twice', async () => {
    const gate = deferred();
    const entered = deferred();
    const { ports, calls } = makeStub({
      rows: [dueRow('slow')],
      run: async () => {
        entered.release();
        await gate.promise;
        return null;
      },
    });
    const worker = new BroadcastSchedulerWorker(ports, DUE_SCAN_LIMIT, ON);

    // First tick is started and deliberately NOT awaited. `entered` is what
    // makes this deterministic rather than a race on microtask ordering: the
    // second tick arrives while the first is provably inside the runner.
    const first = worker.tick(NOW);
    await entered.promise;
    const second = await worker.tick(NOW);

    expect(worker.busy).toBe(true);
    expect(second.ran).toBe(false);
    expect(second.refused).toBe('busy');
    expect(second.skippedTicks).toBe(1);
    // The second tick asked the database NOTHING — that is the whole point:
    // two scans on one connection pool is what §11b.6.1 forbids.
    expect(calls.scans).toHaveLength(1);
    expect(calls.runs).toHaveLength(1);

    gate.release();
    const firstReport = await first;
    expect(firstReport.ran).toBe(true);
    expect(firstReport.handed).toBe(1);
    expect(firstReport.skippedTicks).toBe(1);
    expect(worker.busy).toBe(false);
  });

  it('and the flag clears, so the round after the slow one runs', async () => {
    const gate = deferred();
    const entered = deferred();
    const { ports, calls } = makeStub({
      rows: [dueRow('slow')],
      run: async () => {
        entered.release();
        await gate.promise;
        return null;
      },
    });
    const worker = new BroadcastSchedulerWorker(ports, DUE_SCAN_LIMIT, ON);

    const first = worker.tick(NOW);
    await entered.promise;
    await worker.tick(NOW);
    gate.release();
    await first;

    const third = await worker.tick(NOW);
    expect(third.ran).toBe(true);
    expect(third.handed).toBe(1);
    expect(calls.runs).toHaveLength(2);
    expect(worker.skipped).toBe(1);
  });
});

describe('🔴 danger 2 — one bad job cannot stop every later round', () => {
  it('a runner that THROWS is reported, not propagated', async () => {
    const { ports } = makeStub({
      rows: [dueRow('bad')],
      run: () => Promise.reject(new Error('LINE said no')),
    });
    const worker = new BroadcastSchedulerWorker(ports, DUE_SCAN_LIMIT, ON);

    const report = await worker.tick(NOW);

    expect(report.ran).toBe(true);
    expect(report.handed).toBe(1);
    expect(report.failed).toBe(1);
    // A round that threw tells us nothing we may act on ⇒ no next round.
    expect(report.nextRuns).toEqual([{ id: 'bad', nextRunAt: null }]);
    expect(worker.busy).toBe(false);
  });

  it('🔴 and the scheduler can tick again afterwards', async () => {
    let boom = true;
    const { ports, calls } = makeStub({
      rows: [dueRow('flaky')],
      run: () =>
        boom
          ? Promise.reject(new Error('LINE said no'))
          : Promise.resolve(null),
    });
    const worker = new BroadcastSchedulerWorker(ports, DUE_SCAN_LIMIT, ON);

    await worker.tick(NOW);
    boom = false;
    const second = await worker.tick(NOW);

    expect(second.ran).toBe(true);
    expect(second.handed).toBe(1);
    expect(second.failed).toBe(0);
    expect(calls.runs).toHaveLength(2);
  });

  it('the jobs BEHIND the bad one still get their round', async () => {
    const { ports, calls } = makeStub({
      rows: [dueRow('bad'), dueRow('good')],
      run: (job) =>
        job._id === 'bad'
          ? Promise.reject(new Error('LINE said no'))
          : Promise.resolve(null),
    });
    const worker = new BroadcastSchedulerWorker(ports, 2, ON);

    const report = await worker.tick(NOW);

    expect(report.handed).toBe(2);
    expect(report.failed).toBe(1);
    expect(calls.runs.map((c) => c.job._id)).toEqual(['bad', 'good']);
  });
});

describe('🔴 danger 3 — never more work in a tick than can be run', () => {
  it('the per-tick limit is a real ceiling, not a hint to the database', async () => {
    // A port that ignores the limit it was handed — a bad `.limit()`, a `$or`
    // merged in the app, a stub. The worker must still stop at the ceiling.
    const rows = Array.from({ length: 10 }, (_, i) => dueRow(`job-${i}`));
    const { ports, calls } = makeStub({ rows });
    const worker = new BroadcastSchedulerWorker(ports, DUE_SCAN_LIMIT, ON);

    // Guard: if the shipped ceiling ever reached 10 this test would prove
    // nothing at all. It fails loudly instead of passing vacuously.
    expect(DUE_SCAN_LIMIT).toBeLessThan(rows.length);

    const report = await worker.tick(NOW);

    expect(report.scanned).toBe(10);
    expect(report.handed).toBe(DUE_SCAN_LIMIT);
    expect(calls.runs).toHaveLength(DUE_SCAN_LIMIT);
  });

  it('an explicit limit is honoured, and it is the one the port is handed', async () => {
    const rows = Array.from({ length: 6 }, (_, i) => dueRow(`job-${i}`));
    const { ports, calls } = makeStub({ rows });
    const worker = new BroadcastSchedulerWorker(ports, 2, ON);

    const report = await worker.tick(NOW);

    expect(calls.scans[0]?.limit).toBe(2);
    expect(report.handed).toBe(2);
    expect(calls.runs.map((c) => c.job._id)).toEqual(['job-0', 'job-1']);
  });
});

describe('the sweep — a crashed run is put back, and never re-armed blindly', () => {
  it('sweeps with the stale shape and reports the count', async () => {
    const { ports, calls } = makeStub({ swept: 2 });
    const worker = new BroadcastSchedulerWorker(ports, DUE_SCAN_LIMIT, ON);

    const report = await worker.tick(NOW);

    expect(report.swept).toBe(2);
    expect(calls.sweeps).toHaveLength(1);
    expect(calls.sweeps[0]?.filter).toEqual({
      status: 'sending',
      lease_until: { $lt: NOW },
      deleted_at: { $exists: false },
    });
    /**
     * 🔴 `failed`, NOT `scheduled`. One bulk update cannot know each row's own
     * repeat rule, and re-arming with a stale date makes the next scan send the
     * campaign again immediately (the re-fire trap on `buildStaleRunSweep`).
     */
    expect(calls.sweeps[0]?.update.$set).toEqual({ status: 'failed' });
    expect(calls.sweeps[0]?.update.$unset).toEqual({
      claimed_at: '',
      claimed_by: '',
      lease_until: '',
    });
    expect(calls.sweeps[0]?.limit).toBe(DUE_SCAN_LIMIT);
  });

  it('a count it cannot read is reported as 0, not guessed at', async () => {
    const { ports } = makeStub({ swept: null });
    const worker = new BroadcastSchedulerWorker(ports, DUE_SCAN_LIMIT, ON);

    expect((await worker.tick(NOW)).swept).toBe(0);
  });

  it('🔴 and a count that is not a whole number of rows is 0 as well', async () => {
    // A driver that answers `-1` or `1.5` is answering nonsense: rows recovered
    // is a count. Passing it straight into the report would put a number into
    // an ops log that nobody can act on, and it would hide the broken driver.
    const negative = new BroadcastSchedulerWorker(
      makeStub({ swept: -1 }).ports,
      DUE_SCAN_LIMIT,
      ON,
    );
    const fractional = new BroadcastSchedulerWorker(
      makeStub({ swept: 1.5 }).ports,
      DUE_SCAN_LIMIT,
      ON,
    );

    expect((await negative.tick(NOW)).swept).toBe(0);
    expect((await fractional.tick(NOW)).swept).toBe(0);
  });

  it('a sweep that throws does not cost the round its jobs', async () => {
    const { ports, calls } = makeStub({
      rows: [dueRow('job-1')],
      sweepThrows: true,
    });
    const worker = new BroadcastSchedulerWorker(ports, DUE_SCAN_LIMIT, ON);

    const report = await worker.tick(NOW);

    expect(report.ran).toBe(true);
    expect(report.swept).toBe(0);
    expect(report.handed).toBe(1);
    expect(calls.runs).toHaveLength(1);
  });
});

describe('🔴 danger 6 — anything unreadable means the tick does nothing', () => {
  it('a clock that is not a date ⇒ no scan, no sweep, no runner', async () => {
    const { ports, calls } = makeStub({ rows: [dueRow('job-1')] });
    const worker = new BroadcastSchedulerWorker(ports, DUE_SCAN_LIMIT, ON);

    const report = await worker.tick(new Date('not-a-date'));

    expect(report.ran).toBe(false);
    expect(report.refused).toBe('unreadable-clock');
    expect(calls.scans).toHaveLength(0);
    expect(calls.sweeps).toHaveLength(0);
    expect(calls.runs).toHaveLength(0);
  });

  it('🔴 a scan that answers nothing is NOT "nothing is due"', async () => {
    // `null` back means the database did not answer. Treating it as an empty
    // list would let the tick sweep on the strength of a read that failed.
    const { ports, calls } = makeStub({ rows: null });
    const worker = new BroadcastSchedulerWorker(ports, DUE_SCAN_LIMIT, ON);

    const report = await worker.tick(NOW);

    expect(report.ran).toBe(false);
    expect(report.refused).toBe('unreadable-scan');
    expect(calls.runs).toHaveLength(0);
    expect(calls.sweeps).toHaveLength(0);
  });

  it('a scan that THROWS behaves the same, and the tick still resolves', async () => {
    const { ports, calls } = makeStub({ scanThrows: true });
    const worker = new BroadcastSchedulerWorker(ports, DUE_SCAN_LIMIT, ON);

    await expect(worker.tick(NOW)).resolves.toMatchObject({
      ran: false,
      refused: 'unreadable-scan',
    });
    expect(calls.sweeps).toHaveLength(0);
    expect(worker.busy).toBe(false);
  });
});

describe('each job’s next run is computed and REPORTED, never invented', () => {
  const runReturning: (o: {
    schedule?: BroadcastSchedule;
    finishedAt?: Date | null;
    runsSoFar?: number;
  }) => BroadcastJobRunner = (o) => () => Promise.resolve(o);

  it('a repeat rule comes back with its next instant', async () => {
    const { ports } = makeStub({
      rows: [dueRow('job-1')],
      run: runReturning({ schedule: EVERY_HOUR, finishedAt: NOW }),
    });
    const worker = new BroadcastSchedulerWorker(ports, DUE_SCAN_LIMIT, ON);

    const report = await worker.tick(NOW);

    // 17:00 Bangkok, hourly, no window ⇒ 18:00 Bangkok = 11:00Z.
    expect(report.nextRuns).toHaveLength(1);
    expect(report.nextRuns[0]?.id).toBe('job-1');
    expect(report.nextRuns[0]?.nextRunAt?.toISOString()).toBe(
      '2026-08-22T11:00:00.000Z',
    );
  });

  it('a one-shot job has no next round', async () => {
    const { ports } = makeStub({
      rows: [dueRow('job-1')],
      run: runReturning({ schedule: { mode: 'once' }, finishedAt: NOW }),
    });
    const worker = new BroadcastSchedulerWorker(ports, DUE_SCAN_LIMIT, ON);

    expect((await worker.tick(NOW)).nextRuns).toEqual([
      { id: 'job-1', nextRunAt: null },
    ]);
  });

  it('🔴 a finish time it cannot read ⇒ no next round, never a guess', async () => {
    const { ports } = makeStub({
      rows: [dueRow('job-1')],
      run: runReturning({ schedule: EVERY_HOUR, finishedAt: null }),
    });
    const worker = new BroadcastSchedulerWorker(ports, DUE_SCAN_LIMIT, ON);

    expect((await worker.tick(NOW)).nextRuns).toEqual([
      { id: 'job-1', nextRunAt: null },
    ]);
  });

  it('a runner that reports nothing is not an error', async () => {
    const { ports } = makeStub({ rows: [dueRow('job-1')] });
    const worker = new BroadcastSchedulerWorker(ports, DUE_SCAN_LIMIT, ON);

    const report = await worker.tick(NOW);

    expect(report.failed).toBe(0);
    expect(report.nextRuns).toEqual([{ id: 'job-1', nextRunAt: null }]);
  });
});
