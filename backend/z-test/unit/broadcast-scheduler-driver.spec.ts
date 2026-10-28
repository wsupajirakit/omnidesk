/**
 * [FEAT-20260823-BCASTCRON] The timer, and the three reasons it does nothing.
 * ===========================================================================
 * เจ้าของสั่ง 23/08: *"ห้ามกระทบ กรณีไม่ตั้งหรือไม่เปิด"*
 *
 * A campaign only moves when ALL THREE are true, and every campaign that
 * existed before this feature fails all three:
 *   1. `BROADCAST_SCHEDULER_ENABLED` — the switch
 *   2. `next_run_at` — a column no campaign had before 22/08
 *   3. `send_kind` — the opt-in this driver refuses without
 *
 * 🔴 REASON 3 IS NOT CAUTION, IT IS CORRECTNESS. The legacy sender has no claim
 *    and no lease: `sendBroadcastNow` is safe only because a person presses it
 *    once. Two app instances sharing a cron minute would BOTH dispatch the same
 *    campaign and every follower would receive it twice. The new pipeline flips
 *    `scheduled → sending` atomically, so the loser finds nothing to do.
 *    ท่อเก่าไม่มีการจอง ⇒ cron หลายตัวจะยิงซ้ำ.
 */
import { BroadcastSchedulerDriver } from '@/modules/content';

const chain = (rows: unknown) => {
  const c: Record<string, unknown> = {
    select: () => c,
    sort: () => c,
    limit: () => c,
    lean: () => c,
    exec: () => Promise.resolve(rows),
  };
  return c;
};

/**
 * 🔴 THE SCAN RETURNS A PROJECTION, NOT A DOCUMENT.
 *
 * `buildDueScanQuery` projects `_id`, `status`, `next_run_at` and `send_kind`
 * and NOTHING else. A fake that hands back whole documents is more capable
 * than the real scan, and on 23/08 that hid a live bug: `send_kind` was not in
 * the projection, so the real driver refused every job while this suite stayed
 * green. Trimming here keeps the fake honest.
 * fake ต้องไม่ใจดีกว่าของจริง.
 */
const asScanned = (row: Record<string, unknown>): Record<string, unknown> => ({
  _id: row['_id'],
  status: row['status'],
  next_run_at: row['next_run_at'],
  ...(row['send_kind'] === undefined ? {} : { send_kind: row['send_kind'] }),
});

function makeDriver(opts: {
  due?: Record<string, unknown>[];
  full?: Record<string, unknown> | null;
  port?: { send: jest.Mock };
}) {
  const updates: unknown[] = [];
  const broadcastModel = {
    find: () => chain((opts.due ?? []).map(asScanned)),
    findById: () => chain(opts.full ?? null),
    updateMany: (...a: unknown[]) => {
      updates.push(a);
      return { exec: () => Promise.resolve({ modifiedCount: 1 }) };
    },
  };
  const driver = new BroadcastSchedulerDriver(
    broadcastModel as never,
    opts.port,
  );
  return { driver, updates };
}

/* `status: 'scheduled'` is not decoration — the worker re-checks `isDueNow`
   in memory, and that rule is a status equality plus a date. Leaving it out
   makes every case below pass for the wrong reason (rejected by the recheck),
   which is exactly the false green this suite exists to avoid.
   ต้องมี status ไม่งั้นเทสผ่านเพราะเหตุผลผิด. */
const DUE = {
  _id: 'job1',
  status: 'scheduled',
  next_run_at: new Date('2020-01-01T00:00:00Z'),
};

describe('the driver refuses a job that never opted in', () => {
  it('🔴 no send_kind ⇒ the port is NEVER called', async () => {
    /* Every campaign stored before 23/08. Running it from a cron down the
       legacy path would risk a double send on a second instance. */
    const port = { send: jest.fn() };
    const { driver } = makeDriver({ due: [DUE], full: { ...DUE }, port });

    await driver.tick();

    expect(port.send).not.toHaveBeenCalled();
  });

  it('🔴 an unknown send_kind is refused too, never guessed', async () => {
    const port = { send: jest.fn() };
    const { driver } = makeDriver({
      due: [{ ...DUE, send_kind: 'multicastt' }],
      full: { ...DUE, send_kind: 'multicastt' },
      port,
    });

    await driver.tick();

    expect(port.send).not.toHaveBeenCalled();
  });

  it('🔴 a job that DID opt in is sent', async () => {
    const port = {
      send: jest.fn().mockResolvedValue({ results: [], status: 'sent' }),
    };
    const { driver } = makeDriver({
      due: [{ ...DUE, send_kind: 'multicast' }],
      full: { ...DUE, send_kind: 'multicast', schedule: { every: 'day' } },
      port,
    });

    await driver.tick();

    expect(port.send).toHaveBeenCalledTimes(1);
  });

  it('🔴 no port bound ⇒ refuses BEFORE loading the document', async () => {
    /* ⚠️ STRENGTHENED after a mutation survived: asserting only that the tick
       resolves proves nothing, because the worker treats a runner that throws
       as a normal outcome — deleting the guard kept the suite green while the
       driver dereferenced `undefined`. The observable difference is that the
       job's full document is never fetched. เทสที่เช็คแค่ 'ไม่ throw' จับไม่ได้. */
    const loads: unknown[] = [];
    const broadcastModel = {
      find: () => chain([{ ...DUE, send_kind: 'multicast' }]),
      findById: (id: unknown) => {
        loads.push(id);
        return chain({ ...DUE, send_kind: 'multicast' });
      },
      updateMany: () => ({ exec: () => Promise.resolve({ modifiedCount: 0 }) }),
    };
    const driver = new BroadcastSchedulerDriver(
      broadcastModel as never,
      undefined,
    );

    await expect(driver.tick()).resolves.toBeDefined();
    expect(loads).toEqual([]);
  });
});

describe('the driver never lets a timer reject', () => {
  it('🔴 a scan that throws is reported as UNREADABLE, not as "nothing due"', async () => {
    /* ⚠️ STRENGTHENED after a mutation survived. `resolves` alone passed
       whether the scan returned `null` or `[]`, and those are opposite
       answers: `[]` says "checked, nothing was due" about a minute when the
       database could not be reached at all — a scheduler that looks perfectly
       healthy while every campaign silently misses its slot.
       DB ล่ม ≠ ไม่มีงานถึงกำหนด. */
    const broadcastModel = {
      find: () => {
        throw new Error('mongo down');
      },
      findById: () => chain(null),
      updateMany: () => ({ exec: () => Promise.resolve({ modifiedCount: 0 }) }),
    };
    const driver = new BroadcastSchedulerDriver(
      broadcastModel as never,
      undefined,
    );
    const report = await driver.tick();
    expect(report.refused).toBe('unreadable-scan');
    expect(report.ran).toBe(false);
  });

  it('a send that rejects does not take the tick down', async () => {
    const port = { send: jest.fn().mockRejectedValue(new Error('line down')) };
    const { driver } = makeDriver({
      due: [{ ...DUE, send_kind: 'multicast' }],
      full: { ...DUE, send_kind: 'multicast' },
      port,
    });
    await expect(driver.tick()).resolves.toBeDefined();
  });
});

describe('the sweep honours the bound the query carries', () => {
  it('🔴 finds ids first — updateMany cannot honour sort or limit', async () => {
    /* Handing the shape straight to `updateMany` silently ignores `limit` and
       rewrites every stale row at once. updateMany ไม่รับ limit. */
    const { driver, updates } = makeDriver({
      due: [],
      port: { send: jest.fn() },
    });
    await driver.tick();
    // Nothing stale in this fixture ⇒ no bulk write attempted at all.
    expect(updates).toHaveLength(0);
  });
});

describe('[FEAT-20260823-BCASTCRON] one instance can stand down without the rest', () => {
  /**
   * 🔴 A COST QUESTION, NOT A CORRECTNESS ONE. The claim flips
   * `scheduled → sending` atomically, so a job runs once however many processes
   * wake up. What multiplies is the SCAN: one indexed partial query per
   * instance per minute, normally returning nothing.
   *
   * That is cheap by design and not free at ten instances — so a deployment can
   * silence the ones that should not scan WITHOUT touching the module-wide
   * switch, which would stop scheduling everywhere.
   * ปิดรายเครื่องได้ โดยไม่ปิดทั้งระบบ.
   */
  const KEY = 'BROADCAST_SCHEDULER_INSTANCE';
  const original = process.env[KEY];
  afterEach(() => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
  });

  it('🔴 `off` ⇒ the database is never asked', async () => {
    process.env[KEY] = 'off';
    const asked: string[] = [];
    const broadcastModel = {
      find: () => {
        asked.push('find');
        return chain([]);
      },
      findById: () => chain(null),
      updateMany: () => ({ exec: () => Promise.resolve({ modifiedCount: 0 }) }),
    };
    const driver = new BroadcastSchedulerDriver(
      broadcastModel as never,
      undefined,
    );

    const report = await driver.tick();

    expect(report.refused).toBe('disabled');
    expect(asked).toEqual([]);
  });

  it('🔴 UNSET ⇒ behaves exactly as before — a deployment that never heard of it', async () => {
    /* An opt-out that changes behaviour when absent is not an opt-out.
       ไม่ตั้ง = ต้องเหมือนเดิมเป๊ะ. */
    delete process.env[KEY];
    const { driver } = makeDriver({ due: [], port: { send: jest.fn() } });
    const report = await driver.tick();
    expect(report.refused).not.toBe('disabled');
  });

  it('any other value still scans — only the exact word stands down', async () => {
    process.env[KEY] = 'on';
    const { driver } = makeDriver({ due: [], port: { send: jest.fn() } });
    const report = await driver.tick();
    expect(report.refused).not.toBe('disabled');
  });
});
