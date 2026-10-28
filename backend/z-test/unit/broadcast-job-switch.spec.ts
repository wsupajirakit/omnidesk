/**
 * [FIX-20260824-BCASTJOBSWITCH] The per-job on/off switch, and the `null` that
 * silently turned every repeat off.
 * ===========================================================================
 * Owner, 24/08: *"ต้องมีนะทำสิ เพราะ job มันแยกกันไม่เกี่ยวกันแต่ละงาน …
 * ต้องอ่านจริง ตั้งได้จริง ควบคุมได้จริง"*.
 */
import {
  computeNextRun,
  isJobScheduleEnabled,
} from '@/modules/content/broadcast-schedule';

const RULE = {
  mode: 'repeat',
  every_minutes: 10,
  days_of_week: [0, 1, 2, 3, 4, 5, 6],
  window_start_min: 0,
  window_end_min: 1440,
  tz_offset_min: 420,
} as const;

const AFTER = new Date('2026-08-24T07:44:00.000Z');

describe('isJobScheduleEnabled — absent means ON', () => {
  it('🔴 `null` is ABSENT, not "off" — the bug that stopped every repeat', () => {
    /* Mongoose materialises a DECLARED-but-unset path as `null`, so a rule saved
       without touching the switch reads back `enabled: null` and NEVER
       `undefined`. Reading that as "off" told Gate 2 the job was switched off,
       so a repeating campaign ran once and quietly stopped.
       Measured on a real job 24/08. null ต้องแปลว่า "ไม่ได้ตั้ง" = เปิด. */
    expect(isJobScheduleEnabled({ ...RULE, enabled: null })).toBe(true);
  });

  it('a rule that never mentions the switch is on', () => {
    expect(isJobScheduleEnabled(RULE as never)).toBe(true);
    expect(isJobScheduleEnabled(undefined)).toBe(true);
    expect(isJobScheduleEnabled(null)).toBe(true);
  });

  it('🔴 only an explicit `false` turns it off', () => {
    expect(isJobScheduleEnabled({ ...RULE, enabled: false })).toBe(false);
    expect(isJobScheduleEnabled({ ...RULE, enabled: true })).toBe(true);
  });

  it('a non-boolean in the slot is refused, never guessed', () => {
    /* A row holding a string here is one nobody wrote on purpose, and guessing
       which way it meant is how a campaign keeps sending after someone stopped
       it. เดาไม่ได้ ⇒ ถือว่าปิดไว้ก่อน. */
    expect(isJobScheduleEnabled({ ...RULE, enabled: 'yes' })).toBe(false);
    expect(isJobScheduleEnabled({ ...RULE, enabled: 1 })).toBe(false);
  });
});

describe('computeNextRun — the switch decides whether a round comes back', () => {
  it('🔴 a rule with `enabled: null` STILL schedules the next round', () => {
    /* The regression this file exists for: this returned `null` before the fix,
       so `armNextRun` cleared the cursor and the campaign never came back.
       Every repeating job in the database was in this state. */
    expect(computeNextRun({ ...RULE, enabled: null }, AFTER, 0)).toEqual(
      new Date('2026-08-24T07:50:00.000Z'),
    );
  });

  it('🔴 `enabled: false` stops the next round — the switch works', () => {
    expect(computeNextRun({ ...RULE, enabled: false }, AFTER, 0)).toBeNull();
  });

  it('turning it back on resumes with the SAME rule, nothing re-entered', () => {
    /* Off is a pause, not a delete: the cadence, days and window are untouched,
       so switching back on picks up exactly where it was.
       ปิด = พัก ไม่ใช่ลบ. */
    const paused = { ...RULE, enabled: false };
    expect(computeNextRun(paused as never, AFTER, 0)).toBeNull();
    expect(computeNextRun({ ...paused, enabled: true }, AFTER, 0)).toEqual(
      new Date('2026-08-24T07:50:00.000Z'),
    );
  });
});

describe('🔴 the rule as MONGO stores it — null everywhere, not undefined', () => {
  /**
   * [FIX-20260824-BCASTNULLABSENT] The regression that made every repeat run
   * exactly once.
   *
   * Mongoose materialises a DECLARED-but-unset path as `null`, never
   * `undefined`. Every optional reader in `next-run.ts` tested
   * `value === undefined` alone and failed closed on anything else — so the
   * SAME rule answered a Date when built in memory and `null` when read back
   * out of the database. Every test in this repo built rules in memory, so
   * nothing caught it. เทสสร้าง object เอง เลยไม่มีวันเจอ null ที่ Mongo เขียน.
   */
  const STORED = {
    mode: 'repeat',
    enabled: null,
    every_minutes: 10,
    days_of_week: [0, 1, 2, 3, 4, 5, 6],
    window_start_min: 0,
    window_end_min: 1440,
    tz_offset_min: 420,
    starts_at: null,
    ends_at: null,
    max_runs: 3,
  };
  const AT = new Date('2026-08-24T07:51:00.000Z');

  it('🔴 schedules the next round despite every optional field being null', () => {
    expect(computeNextRun(STORED as never, AT, 1)).toEqual(
      new Date('2026-08-24T08:00:00.000Z'),
    );
  });

  it('🔴 `max_runs` still stops it — widening "absent" did not widen "acceptable"', () => {
    expect(computeNextRun(STORED as never, AT, 3)).toBeNull();
  });

  it('a null `ends_at` means NO end date, not an unreadable one', () => {
    const { max_runs: _drop, ...noBrake } = STORED;
    expect(computeNextRun(noBrake as never, AT, 99)).toEqual(
      new Date('2026-08-24T08:00:00.000Z'),
    );
  });

  it('🔴 a REAL value in an optional field is still honoured', () => {
    /* The fix must not turn every optional field into "ignored". */
    const ended = { ...STORED, ends_at: '2026-08-24T07:00:00.000Z' };
    expect(computeNextRun(ended as never, AT, 0)).toBeNull();
  });

  it('🔴 garbage is still refused — fail-closed is intact', () => {
    expect(
      computeNextRun({ ...STORED, every_minutes: 'ten' }, AT, 0),
    ).toBeNull();
    expect(
      computeNextRun({ ...STORED, days_of_week: 'everyday' }, AT, 0),
    ).toBeNull();
  });
});
