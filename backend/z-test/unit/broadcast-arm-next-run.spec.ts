/**
 * [FEAT-20260824-BCASTREPEAT] The round that was computed gets STORED.
 * ===========================================================================
 * Owner, 24/08: *"repeat ด้วยต้องตั้งค่าได้จริงใ้ชได้จริง"* · *"ตั้งจริงๆ repeat cron
 * จริง / ห้าม inject"*.
 *
 * 🔴 WHY THIS FILE EXISTS. Every part of repeat was already written — the rule
 * shape, `nextRunAfterRound`, the `broadcast_due` index keyed on `next_run_at` —
 * and the computed instant was handed back in a report and thrown away. A grep
 * for `next_run_at` across `src/` on 24/08 found a `@Prop`, an index and a
 * constant, and NOT ONE WRITE. These cases are the ones that would have failed.
 * ทุกชิ้นมีอยู่แล้ว ขาดแค่คนเขียนลง DB — เทสนี้คือชิ้นที่หายไป.
 */
import {
  BroadcastSchedulerWorker,
  type JobNextRun,
  type SchedulerWorkerPorts,
} from '@/modules/content/broadcast-schedule';

/**
 * A job the scan would really return.
 *
 * ⚠️ `next_run_at` IN THE PAST IS REQUIRED. The worker re-checks dueness in
 * memory after the scan (`isDueNow`), so a fixture without a cursor is refused
 * before the run loop is reached — which is the guard working, not a bug. The
 * first version of this file left it out and every case here failed for that
 * reason. ต้องมี cursor เป็นอดีต ไม่งั้น recheck ปฏิเสธก่อนถึงลูป.
 */
const JOB = {
  _id: 'job-1',
  send_kind: 'multicast',
  status: 'scheduled',
  next_run_at: new Date(Date.now() - 60_000),
};

/** A worker whose scan returns one job and whose run always succeeds. */
function worker(
  extra: Partial<SchedulerWorkerPorts> = {},
  jobs: Record<string, unknown>[] = [JOB],
) {
  const ports: SchedulerWorkerPorts = {
    scanDue: () => Promise.resolve(jobs),
    sweepStale: () => Promise.resolve(0),
    runJob: () => Promise.resolve({ ok: true } as never),
    ...extra,
  };
  return new BroadcastSchedulerWorker(ports);
}

/** Captures what `armNextRun` was handed. */
function recorder(answer: number | null = 1) {
  const seen: JobNextRun[][] = [];
  return {
    seen,
    port: (rows: readonly JobNextRun[]) => {
      seen.push([...rows]);
      return Promise.resolve(answer);
    },
  };
}

describe('armNextRun — the write that was missing', () => {
  it('🔴 is CALLED with the rounds the tick computed', async () => {
    /* The one assertion that would have failed before today. Everything else in
       this feature was already correct. ก่อนหน้านี้ไม่มีใครเรียกเลย. */
    const r = recorder();
    const report = await worker({ armNextRun: r.port }).tick(new Date());

    expect(r.seen).toHaveLength(1);
    expect(r.seen[0]).toHaveLength(1);
    expect(r.seen[0]?.[0]?.id).toBe('job-1');
    expect(report.armed).toBe(1);
  });

  it('🔴 `armed` and `nextRuns` are SEPARATE numbers', async () => {
    /* Computed vs stored. They were identical for as long as nobody stored
       anything — which was the bug. A report that only carried the computed
       count could not tell a working cadence from a silent one.
       คำนวณกับเขียนลงจริง ต้องเป็นสองตัวเลข. */
    const report = await worker({
      armNextRun: () => Promise.resolve(0),
    }).tick(new Date());

    expect(report.nextRuns).toHaveLength(1);
    expect(report.armed).toBe(0);
  });

  it('🔴 no writer supplied ⇒ `armed` is null, and the tick still runs', async () => {
    /* Seamless: a caller with no writer gets exactly today's behaviour — one
       run per job — not a crash. `null` ≠ `0`: nothing was written, as opposed
       to "there was nothing to write". absent ≠ 0. */
    const report = await worker().tick(new Date());

    expect(report.armed).toBeNull();
    expect(report.ran).toBe(true);
    expect(report.handed).toBe(1);
  });

  it('🔴 a writer that THROWS does not fail the tick', async () => {
    /* The sends already happened. A cursor that could not be written is a job
       that repeats late — never a campaign that goes out twice.
       เขียนไม่ได้ = ซ้ำช้า ไม่ใช่ยิงซ้ำ. */
    const report = await worker({
      armNextRun: () => Promise.reject(new Error('mongo down')),
    }).tick(new Date());

    expect(report.ran).toBe(true);
    expect(report.handed).toBe(1);
    expect(report.armed).toBeNull();
  });

  it('is not called at all when the round had no jobs', async () => {
    const r = recorder();
    const report = await worker({ armNextRun: r.port }, []).tick(new Date());

    expect(r.seen).toEqual([]);
    expect(report.armed).toBeNull();
  });
});

describe('armNextRun — ordering is a safety property', () => {
  it('🔴 arms AFTER the job ran, never before', async () => {
    /* Arming first would make the job eligible for the very next tick while
       this round is still sending. ติดอาวุธก่อนจบ = รอบถัดไปคาบกัน. */
    const order: string[] = [];
    const report = await worker({
      runJob: () => {
        order.push('ran');
        return Promise.resolve({ ok: true } as never);
      },
      armNextRun: () => {
        order.push('armed');
        return Promise.resolve(1);
      },
    }).tick(new Date());

    expect(order).toEqual(['ran', 'armed']);
    expect(report.armed).toBe(1);
  });
});

describe('armNextRun — a round that threw must not be re-armed', () => {
  it('🔴 hands `nextRunAt: null` for a job whose run threw', async () => {
    /* `scheduler.worker.ts` pushes `null` on a throw and its comment says why:
       the process that held the job may still be sending, so the lease and the
       sweep decide — not this. The writer then CLEARS the cursor instead of
       leaving a past instant that the `$lte: now` scan would match every single
       tick, forever. งานที่ throw ต้องไม่ถูกติดอาวุธใหม่ · cursor เก่าค้าง = ยิงซ้ำทุกนาที. */
    const r = recorder();
    await worker({
      runJob: () => Promise.reject(new Error('send blew up')),
      armNextRun: r.port,
    }).tick(new Date());

    expect(r.seen[0]?.[0]).toMatchObject({ id: 'job-1', nextRunAt: null });
  });
});
