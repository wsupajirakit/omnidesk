/**
 * [FEAT-20260822-BCASTSCHED] The scheduler's contracts, pinned.
 * ===========================================================================
 * Two things go wrong in a scheduler and both are silent:
 *   · it fires when it should not — a campaign nobody asked for, twice
 *   · it never fires at all — and nobody notices until an admin complains
 * So every case below asserts a LITERAL expected value: a wrong field name, a
 * flipped comparison or a lost `deleted_at` clause has to turn something red,
 * not merely re-state whatever the code just produced.
 *
 * ⚠️ IMPORT PATH — deliberately relative. `content/index.ts` does not export
 * this folder yet (the orchestrator wires the barrel), and a deep import of a
 * module's internals is blocked by `no-restricted-imports`. Once the barrel
 * carries it, this becomes
 * `from '@/modules/content'` like `broadcast-claim.spec.ts` does.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BROADCAST_SCHEDULER_ENABLED,
  DUE_AT_FIELD,
  DUE_SCAN_LIMIT,
  DUE_STATUS,
  MIN_EVERY_MINUTES,
  SWEEP_DEAD_STATUS,
  SWEEP_RECOVER_STATUS,
  buildDueScanQuery,
  buildStaleRunSweep,
  computeNextRun,
  isDueNow,
  isSweepable,
  nextRunAfterRound,
  type BroadcastSchedule,
} from '@/modules/content';

/** Saturday 2026-08-22 17:00 Bangkok. */
const NOW = new Date('2026-08-22T10:00:00.000Z');
const PAST = new Date('2026-08-22T09:00:00.000Z');
const FUTURE = new Date('2026-08-22T11:00:00.000Z');

/** Monday 2026-08-24, 17:30 Bangkok. Used for the day-boundary arithmetic. */
const MON_1730_BKK = new Date('2026-08-24T10:30:00.000Z');
/** Monday 2026-08-24, 23:45 Bangkok — the LOCAL day rolls, the UTC day does not. */
const MON_2345_BKK = new Date('2026-08-24T16:45:00.000Z');

/** ON is passed explicitly everywhere: the shipped switch is OFF. */
const ON = true;

/** 09:00-18:00 Bangkok, every two hours — the owner's example shape. */
const OFFICE_HOURS: BroadcastSchedule = {
  mode: 'repeat',
  every_minutes: 120,
  window_start_min: 540,
  window_end_min: 1080,
};

const EVERY_HOUR: BroadcastSchedule = { mode: 'repeat', every_minutes: 60 };

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

describe('kill switch — the off branch is real code, and still reachable', () => {
  /**
   * ⚠️ REWRITTEN 23/08. These cases asserted the switch ships OFF, which was
   * the right thing to pin while OFF was what protected everyone. The owner
   * turned it on, and the protection moved: the scan can only ever return jobs
   * carrying `next_run_at`, and no campaign had that column before 22/08. So
   * the property worth guarding is no longer "the switch is off", it is
   * **"a job nobody scheduled is invisible either way"** — the case below.
   * เจตนาเดิมยังถูก แต่กลไกที่ป้องกันเปลี่ยนไปแล้ว.
   */
  const OFF = false;

  it('🔴 a job nobody scheduled is never due — switch ON', () => {
    /* Every campaign stored before 22/08 is this row: no `next_run_at` at all.
       A missing field never matches a date comparison, which is the whole
       reason turning the scheduler on moved nothing.
       ไม่มี next_run_at = ไม่มีวันตรงเงื่อนไข. */
    expect(isDueNow({ status: DUE_STATUS }, NOW, ON)).toBe(false);
    expect(
      isDueNow({ status: DUE_STATUS, [DUE_AT_FIELD]: null }, NOW, ON),
    ).toBe(false);
  });

  it('🔴 and the scan itself asks only for rows that carry the column', () => {
    const q = buildDueScanQuery(NOW, DUE_SCAN_LIMIT, ON);
    expect(q?.filter[DUE_AT_FIELD]).toEqual({ $lte: NOW });
  });

  it('🔴 OFF ⇒ the database is never even asked', () => {
    /* The switch is still the one-edit revert: `null` back means no query is
       built at all. ปิดแล้วไม่ถาม DB เลย. */
    expect(buildDueScanQuery(NOW, DUE_SCAN_LIMIT, OFF)).toBeNull();
    expect(buildStaleRunSweep(NOW, null, DUE_SCAN_LIMIT, OFF)).toBeNull();
  });

  it('🔴 OFF ⇒ nothing is ever due, however perfect the row', () => {
    const perfect = { status: DUE_STATUS, [DUE_AT_FIELD]: PAST };
    expect(isDueNow(perfect, NOW, OFF)).toBe(false);
    // ...and the SAME row is due once the switch is on. If the constant were
    // typed as the literal `false` this pair could not both exist.
    expect(isDueNow(perfect, NOW, ON)).toBe(true);
  });

  it('🔴 OFF ⇒ a crashed run is not swept either', () => {
    const crashed = { status: 'sending', lease_until: PAST };
    expect(isSweepable(crashed, NOW, OFF)).toBe(false);
    expect(isSweepable(crashed, NOW, ON)).toBe(true);
  });

  it('the constant is a real boolean, so both branches stay compilable', () => {
    const flag: boolean = BROADCAST_SCHEDULER_ENABLED;
    expect(typeof flag).toBe('boolean');
  });
});

describe('[FIX-20260823-BCASTSCANKIND] the scan carries what the runner needs', () => {
  /**
   * 🔴 FOUND BY RUNNING THE REAL SCHEDULER, NOT BY A TEST.
   *
   * `runJob` refuses a due job that carries no `send_kind` — the legacy sender
   * has no claim, so two instances would send it twice. The scan projects a
   * deliberately tiny set of columns (`flex_json` is `Mixed` and tens of KB per
   * row), and `send_kind` was not among them, so the field was ABSENT from
   * every scanned row and EVERY job was refused as "never opted in".
   *
   * The driver's own spec passed throughout, because its fake handed the runner
   * a FULL document — something the real scan never does. A fake more capable
   * than the thing it stands in for proves the wrong system.
   * fake ที่ใจดีกว่าของจริง = พิสูจน์ระบบที่ไม่มีอยู่.
   */
  it('🔴 projects `send_kind`, or every job is refused as not-opted-in', () => {
    const q = buildDueScanQuery(NOW, DUE_SCAN_LIMIT, ON);
    expect(q?.projection).toHaveProperty('send_kind', 1);
  });

  it('and still keeps the message body OUT — that is what it is for', () => {
    /* The projection exists to stop `flex_json` crossing the network 1,440
       times a day. One short string is not the thing it guards against. */
    const keys = Object.keys(
      buildDueScanQuery(NOW, DUE_SCAN_LIMIT, ON)?.projection ?? {},
    );
    expect(keys).not.toContain('message');
    expect(keys).not.toContain('flex_json');
    expect(keys.length).toBeLessThanOrEqual(5);
  });
});

describe('due query — the shape a caller hands to Mongo', () => {
  it('names the real columns, and only those three', () => {
    const q = buildDueScanQuery(NOW, DUE_SCAN_LIMIT, ON);
    expect(q?.filter).toEqual({
      status: 'scheduled',
      [DUE_AT_FIELD]: { $lte: NOW },
      deleted_at: { $exists: false },
    });
    // 🔴 A fourth key would be a bug, not extra safety: a lease clause on
    // `scheduled` rows (which carry no lease column) makes the scan return
    // nothing forever, and it is not in the index either.
    expect(Object.keys(q?.filter ?? {})).toEqual([
      'status',
      DUE_AT_FIELD,
      'deleted_at',
    ]);
  });

  it('sorts on the date key so the index serves the sort for free', () => {
    const q = buildDueScanQuery(NOW, DUE_SCAN_LIMIT, ON);
    expect(q?.sort).toEqual({ [DUE_AT_FIELD]: 1 });
  });

  it('projects four small fields — flex_json is tens of KB and never needed here', () => {
    /* ⚠️ WAS THREE. `send_kind` joined them on 23/08 because the runner refuses
       a job without it, and leaving it out refused every job in production
       while this assertion stayed green — see the block above.
       เพิ่มมาเพราะ runner ต้องใช้ ไม่ใช่เพราะอยากได้เพิ่ม. */
    const q = buildDueScanQuery(NOW, DUE_SCAN_LIMIT, ON);
    expect(q?.projection).toEqual({
      _id: 1,
      status: 1,
      [DUE_AT_FIELD]: 1,
      send_kind: 1,
    });
  });

  it('takes no more jobs per round than the system can actually run', () => {
    // 3 = MAX_CONCURRENT_RUNS_GLOBAL (abuse-guard.ts). If that number moves,
    // this goes red on purpose — read the derivation in schedule-limits.ts.
    expect(buildDueScanQuery(NOW, undefined, ON)?.limit).toBe(3);
  });

  it('a nonsense limit falls back rather than taking zero or everything', () => {
    expect(buildDueScanQuery(NOW, 0, ON)?.limit).toBe(3);
    expect(buildDueScanQuery(NOW, -5, ON)?.limit).toBe(3);
    expect(buildDueScanQuery(NOW, Number.NaN, ON)?.limit).toBe(3);
    expect(buildDueScanQuery(NOW, 1.5, ON)?.limit).toBe(3);
    expect(buildDueScanQuery(NOW, 7, ON)?.limit).toBe(7);
  });

  it('refuses to build a query it cannot make safely', () => {
    expect(buildDueScanQuery(new Date('nope'), DUE_SCAN_LIMIT, ON)).toBeNull();
  });

  it('🔴 the column names come from the schema — read, not remembered', () => {
    /* ⚠️ REWRITTEN 22/08. The old version compared the constant to a literal
       typed into this file, which is a change-detector wearing the title of a
       schema check: both sides could drift together and stay green. It DID
       catch the switch to `next_run_at`, but only by accident of being noisy.
       Now it opens the schema and proves the column is declared there.
       ชื่อเทสบอกว่าอ่านจากสคีมา ⇒ ต้องอ่านจริง ไม่ใช่เทียบกับตัวอักษรที่พิมพ์ไว้เอง. */
    const schema = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        'src/modules/content/schemas/broadcast.schema.ts',
      ),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, ' ');

    expect(DUE_AT_FIELD).toBe('next_run_at');
    expect(schema).toMatch(
      new RegExp(`^\\s*${DUE_AT_FIELD}\\?:\\s*Date;`, 'm'),
    );
    expect(DUE_STATUS).toBe('scheduled');
    expect(schema).toMatch(new RegExp(`'${DUE_STATUS}'`));
    // และต้องมี index ที่รองรับ query นี้จริง ไม่ใช่แค่คอลัมน์ลอย ๆ
    expect(schema).toMatch(/name: 'broadcast_due'/);
    expect(schema).toMatch(
      /partialFilterExpression: \{ status: 'scheduled' \}/,
    );
  });
});

describe('due selection — who runs now, who waits, who is untouchable', () => {
  it('a job whose time has passed is selected', () => {
    expect(
      isDueNow({ status: 'scheduled', [DUE_AT_FIELD]: PAST }, NOW, ON),
    ).toBe(true);
  });

  it('due exactly now counts as due — the comparison is $lte, not $lt', () => {
    expect(
      isDueNow({ status: 'scheduled', [DUE_AT_FIELD]: NOW }, NOW, ON),
    ).toBe(true);
  });

  it('🔴 a job due in the FUTURE is not selected', () => {
    expect(
      isDueNow({ status: 'scheduled', [DUE_AT_FIELD]: FUTURE }, NOW, ON),
    ).toBe(false);
  });

  it('🔴 a job another process holds a LIVE lease on is not selected', () => {
    // buildClaimQuery flipped it to `sending` when it took it, so the status
    // equality is what excludes it — no date clause is involved.
    expect(
      isDueNow(
        { status: 'sending', [DUE_AT_FIELD]: PAST, lease_until: FUTURE },
        NOW,
        ON,
      ),
    ).toBe(false);
  });

  it('a job whose lease already EXPIRED is still not "due" — it is sweepable', () => {
    expect(
      isDueNow(
        { status: 'sending', [DUE_AT_FIELD]: PAST, lease_until: PAST },
        NOW,
        ON,
      ),
    ).toBe(false);
  });

  it('only `scheduled` is taken — draft was never scheduled, the rest are done', () => {
    for (const status of [
      'draft',
      'sent',
      'failed',
      'cancelled',
      'Scheduled',
    ]) {
      expect(isDueNow({ status, [DUE_AT_FIELD]: PAST }, NOW, ON)).toBe(false);
    }
  });

  it('🔴 a soft-deleted job is never selected — deleteBroadcast leaves status alone', () => {
    expect(
      isDueNow(
        { status: 'scheduled', [DUE_AT_FIELD]: PAST, deleted_at: PAST },
        NOW,
        ON,
      ),
    ).toBe(false);
  });
});

describe('fail closed — unreadable input can never mean "send it"', () => {
  it('a missing date is not due', () => {
    expect(isDueNow({ status: 'scheduled' }, NOW, ON)).toBe(false);
  });

  it('a NaN date is not due', () => {
    expect(
      isDueNow(
        { status: 'scheduled', [DUE_AT_FIELD]: new Date('nope') },
        NOW,
        ON,
      ),
    ).toBe(false);
  });

  it('a STRING where a Date belongs is not due — that row bypassed the schema', () => {
    expect(
      isDueNow(
        { status: 'scheduled', scheduled_at: '2026-08-22T09:00:00.000Z' },
        NOW,
        ON,
      ),
    ).toBe(false);
  });

  it('a number, a null and an object where a Date belongs are not due', () => {
    for (const bad of [0, 1_755_000_000_000, null, {}, []]) {
      expect(
        isDueNow({ status: 'scheduled', [DUE_AT_FIELD]: bad }, NOW, ON),
      ).toBe(false);
    }
  });

  it('a missing status, a missing row and a null row are not due', () => {
    expect(isDueNow({ [DUE_AT_FIELD]: PAST }, NOW, ON)).toBe(false);
    expect(isDueNow(null, NOW, ON)).toBe(false);
    expect(isDueNow(undefined, NOW, ON)).toBe(false);
  });

  it('an unreadable CLOCK is not due — we do not guess what time it is', () => {
    expect(
      isDueNow(
        { status: 'scheduled', [DUE_AT_FIELD]: PAST },
        new Date('x'),
        ON,
      ),
    ).toBe(false);
  });
});

describe('sweep — a crashed run is recoverable, a live one is not', () => {
  it('🔴 an EXPIRED lease is sweepable', () => {
    expect(isSweepable({ status: 'sending', lease_until: PAST }, NOW, ON)).toBe(
      true,
    );
  });

  it('🔴 a LIVE lease is not — the holder is still sending to real people', () => {
    expect(
      isSweepable({ status: 'sending', lease_until: FUTURE }, NOW, ON),
    ).toBe(false);
  });

  it('a lease expiring exactly now is still live — the test is $lt, not $lte', () => {
    expect(isSweepable({ status: 'sending', lease_until: NOW }, NOW, ON)).toBe(
      false,
    );
  });

  it('no readable lease ⇒ not sweepable, because the run may be alive', () => {
    expect(isSweepable({ status: 'sending' }, NOW, ON)).toBe(false);
    expect(
      isSweepable({ status: 'sending', lease_until: new Date('x') }, NOW, ON),
    ).toBe(false);
    expect(
      isSweepable({ status: 'sending', lease_until: '2020-01-01' }, NOW, ON),
    ).toBe(false);
  });

  it('a job that is not `sending` holds no claim to sweep', () => {
    for (const status of ['scheduled', 'draft', 'sent', 'failed']) {
      expect(isSweepable({ status, lease_until: PAST }, NOW, ON)).toBe(false);
    }
  });

  it('a soft-deleted row is left alone', () => {
    expect(
      isSweepable(
        { status: 'sending', lease_until: PAST, deleted_at: PAST },
        NOW,
        ON,
      ),
    ).toBe(false);
  });

  it('the sweep filter reuses claim.ts and adds only the soft-delete guard', () => {
    const s = buildStaleRunSweep(NOW, null, DUE_SCAN_LIMIT, ON);
    expect(s?.filter).toEqual({
      status: 'sending',
      lease_until: { $lt: NOW },
      deleted_at: { $exists: false },
    });
    expect(s?.sort).toEqual({ lease_until: 1 });
    expect(s?.limit).toBe(3);
  });

  it('🔴 recovery re-arms the due date IN THE SAME UPDATE, or the job re-fires at once', () => {
    const armed = new Date('2026-08-25T02:00:00.000Z');
    const s = buildStaleRunSweep(NOW, armed, DUE_SCAN_LIMIT, ON);
    expect(s?.update.$set).toEqual({
      status: 'scheduled',
      [DUE_AT_FIELD]: armed,
    });
    expect(s?.update.$unset).toEqual({
      claimed_at: '',
      claimed_by: '',
      lease_until: '',
    });
  });

  it('🔴 no next round ⇒ `failed`, and the due date is NOT rewritten', () => {
    const s = buildStaleRunSweep(NOW, null, DUE_SCAN_LIMIT, ON);
    expect(s?.update.$set).toEqual({ status: 'failed' });
    expect(Object.keys(s?.update.$set ?? {})).not.toContain('scheduled_at');
  });

  it('an unreadable re-arm date is treated as "no next round", not as now', () => {
    const s = buildStaleRunSweep(NOW, new Date('x'), DUE_SCAN_LIMIT, ON);
    expect(s?.update.$set).toEqual({ status: 'failed' });
  });

  it('an unreadable clock builds nothing', () => {
    expect(
      buildStaleRunSweep(new Date('x'), null, DUE_SCAN_LIMIT, ON),
    ).toBeNull();
  });

  it('the recovery statuses are the ones the schema enum actually allows', () => {
    expect(SWEEP_RECOVER_STATUS).toBe('scheduled');
    expect(SWEEP_DEAD_STATUS).toBe('failed');
  });
});

describe('next round — arithmetic on a fixed grid, never on the last run', () => {
  it('🔴 rolls to the next LOCAL day even when the UTC day does not change', () => {
    // Mon 23:45 Bangkok, hourly, whole-day window ⇒ Tue 00:00 Bangkok,
    // which is still Monday 17:00 in UTC.
    expect(iso(computeNextRun(EVERY_HOUR, MON_2345_BKK))).toBe(
      '2026-08-24T17:00:00.000Z',
    );
  });

  it('🔴 rolls past a closed window to the next day, at the window opening', () => {
    // Mon 17:30 Bangkok: 09:00 + k*120 gives 17:00 (past) then 19:00 (closed)
    // ⇒ Tue 09:00 Bangkok = 02:00Z. The slot is the WINDOW's, not "+2h".
    expect(iso(computeNextRun(OFFICE_HOURS, MON_1730_BKK))).toBe(
      '2026-08-25T02:00:00.000Z',
    );
  });

  it('🔴 window_end_min is EXCLUSIVE — a slot landing on it belongs to tomorrow', () => {
    // 09:00-18:00 every three hours puts a slot exactly on 18:00. Treating the
    // end as inclusive would send at closing time, one slot later than the
    // admin drew the window, every single day.
    const threeHourly = { ...OFFICE_HOURS, every_minutes: 180 };
    const monday1500 = new Date('2026-08-24T08:00:00.000Z'); // 15:00 Bangkok
    expect(iso(computeNextRun(threeHourly, monday1500))).toBe(
      '2026-08-25T02:00:00.000Z',
    );
  });

  it('walks forward to the next allowed weekday', () => {
    const mondaysOnly = { ...OFFICE_HOURS, days_of_week: [1] };
    expect(iso(computeNextRun(mondaysOnly, MON_1730_BKK))).toBe(
      '2026-08-31T02:00:00.000Z',
    );
  });

  it('an empty days_of_week means every day, not no day', () => {
    expect(
      iso(computeNextRun({ ...EVERY_HOUR, days_of_week: [] }, MON_2345_BKK)),
    ).toBe('2026-08-24T17:00:00.000Z');
  });

  it('🔴 the default timezone is Bangkok, and it changes the answer', () => {
    // Same rule, same instant, offset 0 ⇒ a different slot entirely. If the
    // default were UTC these two would agree and the assertion would be empty.
    expect(iso(computeNextRun(OFFICE_HOURS, MON_1730_BKK))).toBe(
      '2026-08-25T02:00:00.000Z',
    );
    expect(
      iso(computeNextRun({ ...OFFICE_HOURS, tz_offset_min: 0 }, MON_1730_BKK)),
    ).toBe('2026-08-24T11:00:00.000Z');
  });

  it('starts_at in the future moves the search forward instead of refusing', () => {
    const later = {
      ...EVERY_HOUR,
      starts_at: new Date('2026-09-01T00:00:00.000Z'),
    };
    expect(iso(computeNextRun(later, MON_2345_BKK))).toBe(
      '2026-09-01T00:00:00.000Z',
    );
  });

  it('ends_at is a hard stop', () => {
    const ending = {
      ...EVERY_HOUR,
      ends_at: new Date('2026-08-24T16:50:00.000Z'),
    };
    expect(computeNextRun(ending, MON_2345_BKK)).toBeNull();
  });

  it('max_runs stops the job — and only once it is actually reached', () => {
    const capped = { ...EVERY_HOUR, max_runs: 3 };
    expect(iso(computeNextRun(capped, MON_2345_BKK, 2))).toBe(
      '2026-08-24T17:00:00.000Z',
    );
    expect(computeNextRun(capped, MON_2345_BKK, 3)).toBeNull();
    expect(computeNextRun(capped, MON_2345_BKK, 4)).toBeNull();
  });

  it('the cadence floor is the fastest the flood guard would ever honour', () => {
    // 10 = ceil(60 / MAX_RUNS_PER_JOB_PER_HOUR). Anything tighter would be
    // accepted here and then refused by checkAbuse — a scheduler that looks
    // broken rather than limited.
    expect(MIN_EVERY_MINUTES).toBe(10);
    expect(
      computeNextRun({ ...OFFICE_HOURS, every_minutes: 9 }, MON_1730_BKK),
    ).toBeNull();
    expect(
      iso(computeNextRun({ ...OFFICE_HOURS, every_minutes: 10 }, MON_1730_BKK)),
    ).toBe('2026-08-24T10:40:00.000Z');
  });
});

describe('next round — the repeat setting absent, or unusable', () => {
  it('no schedule at all ⇒ no next round', () => {
    expect(computeNextRun(undefined, MON_1730_BKK)).toBeNull();
    expect(computeNextRun(null, MON_1730_BKK)).toBeNull();
    expect(computeNextRun({}, MON_1730_BKK)).toBeNull();
  });

  it('🔴 a legacy row reads mode as undefined and must stay a ONE-OFF', () => {
    // This is the `!==` trap: `mode !== "once"` would make every job in the
    // collection start repeating the day this ships.
    expect(computeNextRun({ every_minutes: 60 }, MON_1730_BKK)).toBeNull();
    expect(
      computeNextRun({ mode: 'once', every_minutes: 60 }, MON_1730_BKK),
    ).toBeNull();
    expect(
      computeNextRun({ mode: 'REPEAT', every_minutes: 60 }, MON_1730_BKK),
    ).toBeNull();
  });

  it('the per-job switch turns it off, and a non-boolean turns it off too', () => {
    expect(
      computeNextRun({ ...EVERY_HOUR, enabled: false }, MON_2345_BKK),
    ).toBeNull();
    expect(
      iso(computeNextRun({ ...EVERY_HOUR, enabled: true }, MON_2345_BKK)),
    ).toBe('2026-08-24T17:00:00.000Z');
    /**
     * ⚠️ `null` LEFT THIS LIST ON 24/08, and removing it fixed a real outage.
     *
     * Mongoose materialises a DECLARED-but-unset path as `null`, never
     * `undefined` — so EVERY repeat rule saved through the API reads back with
     * `enabled: null`. Treating that as "off" made `computeNextRun` refuse,
     * `armNextRun` clear the cursor, and every repeating campaign run exactly
     * ONCE. Measured on a live job before the fix; a repeat now survives five
     * unattended rounds with nobody touching it.
     *
     * The rest of the list stays: a string, a number or an object here is a
     * row nobody wrote on purpose, and guessing which way it meant is how a
     * campaign keeps sending after someone stopped it.
     * null = ไม่ได้ตั้ง (Mongo เขียนให้เอง) · ที่เหลือยังปฏิเสธเหมือนเดิม.
     */
    for (const junk of ['true', 1, 0, {}]) {
      expect(
        computeNextRun({ ...EVERY_HOUR, enabled: junk }, MON_2345_BKK),
      ).toBeNull();
    }
  });

  it('an unusable cadence ⇒ no next round', () => {
    for (const bad of [undefined, Number.NaN, '60', 60.5, 0, -60, 1441, null]) {
      expect(
        computeNextRun({ mode: 'repeat', every_minutes: bad }, MON_1730_BKK),
      ).toBeNull();
    }
  });

  it('an unusable window ⇒ no next round', () => {
    const bad = (w: Partial<BroadcastSchedule>) =>
      computeNextRun({ ...EVERY_HOUR, ...w }, MON_1730_BKK);
    // crossing midnight is refused (D24), and so is a zero-length window
    expect(bad({ window_start_min: 1380, window_end_min: 120 })).toBeNull();
    expect(bad({ window_start_min: 540, window_end_min: 540 })).toBeNull();
    expect(bad({ window_start_min: '09:00' })).toBeNull();
    expect(bad({ window_start_min: Number.NaN })).toBeNull();
    expect(bad({ window_end_min: 1441 })).toBeNull();
    expect(bad({ window_start_min: -1 })).toBeNull();
  });

  it('an unusable weekday list ⇒ no next round', () => {
    const bad = (d: unknown) =>
      computeNextRun({ ...EVERY_HOUR, days_of_week: d }, MON_1730_BKK);
    expect(bad([7])).toBeNull();
    expect(bad([-1])).toBeNull();
    expect(bad(['1'])).toBeNull();
    expect(bad([1, Number.NaN])).toBeNull();
    expect(bad(1)).toBeNull();
    expect(bad('mon')).toBeNull();
  });

  it('an unusable offset or boundary date ⇒ no next round', () => {
    const bad = (w: Partial<BroadcastSchedule>) =>
      computeNextRun({ ...EVERY_HOUR, ...w }, MON_1730_BKK);
    expect(bad({ tz_offset_min: 'Asia/Bangkok' })).toBeNull();
    expect(bad({ tz_offset_min: Number.NaN })).toBeNull();
    expect(bad({ tz_offset_min: 900 })).toBeNull();
    expect(bad({ starts_at: '2026-09-01' })).toBeNull();
    expect(bad({ ends_at: new Date('nope') })).toBeNull();
    expect(bad({ max_runs: 'many' })).toBeNull();
    expect(bad({ max_runs: 0 })).toBeNull();
  });

  it('an unreadable `after`, or a nonsense run count, ⇒ no next round', () => {
    expect(computeNextRun(EVERY_HOUR, new Date('nope'))).toBeNull();
    expect(computeNextRun(EVERY_HOUR, MON_2345_BKK, -1)).toBeNull();
    expect(computeNextRun(EVERY_HOUR, MON_2345_BKK, Number.NaN)).toBeNull();
    expect(computeNextRun(EVERY_HOUR, MON_2345_BKK, 1.5)).toBeNull();
  });
});

describe('nextRunAfterRound — missed rounds are gone, on purpose', () => {
  const FINISHED_LONG_AGO = new Date('2026-08-24T09:00:00.000Z');

  it('🔴 counts forward from NOW, not from the round that finished', () => {
    expect(
      iso(nextRunAfterRound(EVERY_HOUR, FINISHED_LONG_AGO, MON_2345_BKK)),
    ).toBe('2026-08-24T17:00:00.000Z');
  });

  it('🔴 and that is a real choice — catch-up would answer differently', () => {
    // Same inputs, catch-up on: the search restarts from the old finish time
    // and lands hours in the past. That is the burst the owner ruled out.
    expect(
      iso(
        nextRunAfterRound(EVERY_HOUR, FINISHED_LONG_AGO, MON_2345_BKK, 0, true),
      ),
    ).toBe('2026-08-24T10:00:00.000Z');
  });

  it('a finish time in the FUTURE wins, so a skewed clock cannot look overdue', () => {
    const skewed = new Date('2026-08-24T18:00:00.000Z');
    expect(iso(nextRunAfterRound(EVERY_HOUR, skewed, MON_2345_BKK))).toBe(
      '2026-08-24T19:00:00.000Z',
    );
  });

  it('unreadable inputs ⇒ no next round', () => {
    expect(
      nextRunAfterRound(EVERY_HOUR, new Date('x'), MON_2345_BKK),
    ).toBeNull();
    expect(
      nextRunAfterRound(EVERY_HOUR, FINISHED_LONG_AGO, new Date('x')),
    ).toBeNull();
    expect(nextRunAfterRound(undefined, FINISHED_LONG_AGO, NOW)).toBeNull();
  });
});
