/**
 * [FEAT-20260902-NOWBLOCK] The holiday table — shape, and the guard against silent expiry.
 *
 * A hardcoded calendar has one failure mode that no ordinary test can catch: it
 * stops being true on a date nobody is watching. From the first day past its
 * coverage every public holiday reads as an ordinary working day — no error, no log
 * line, no failing assertion, just a wrong answer to a customer. The last block in
 * this file exists to make that failure arrive early, on a developer's screen.
 *
 * revert: delete this file with the `now-block/` folder.
 */
import {
  HOLIDAYS_PENDING,
  TH_HOLIDAYS,
  TH_HOLIDAYS_LAST_COVERED,
  staticHolidaySource,
} from '@/modules/webhook/now-block/calendar/th-holidays';
import { NOW_BLOCK_DEFAULT_MODE } from '@/modules/webhook/now-block/now-block.mode';
import { businessToday } from '@/common/utils/date-range';

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

describe('[NOWBLOCK] the table is shaped so a lookup cannot miss quietly', () => {
  const rows = Object.entries(TH_HOLIDAYS);

  it('has rows', () => {
    expect(rows.length).toBeGreaterThan(0);
  });

  it.each(rows)('%s is a well-formed Bangkok calendar key', (key) => {
    expect(key).toMatch(DATE_KEY);
    // and it is a real date, not 2026-02-31
    const [y, m, d] = key.split('-').map(Number) as [number, number, number];
    const asDate = new Date(Date.UTC(y, m - 1, d));
    expect(asDate.getUTCFullYear()).toBe(y);
    expect(asDate.getUTCMonth()).toBe(m - 1);
    expect(asDate.getUTCDate()).toBe(d);
  });

  it.each(rows)('%s carries a name a customer could read', (_key, name) => {
    expect(typeof name).toBe('string');
    expect(name.trim().length).toBeGreaterThan(0);
    // the same two hazards the builder sanitises for — caught at the source too
    expect(name).not.toContain('{{');
    expect(name).not.toMatch(/[\r\n]/);
  });

  it('answers null for an ordinary day', () => {
    expect(staticHolidaySource.lookup('2026-09-02')).toBeNull();
  });

  it('answers the name for a day it knows', () => {
    const [firstKey, firstName] = rows[0] as [string, string];
    expect(staticHolidaySource.lookup(firstKey)).toBe(firstName);
  });

  it('reports the last day it can speak for, and that matches the table', () => {
    const maxKey = rows.map(([k]) => k).sort()[rows.length - 1];
    expect(TH_HOLIDAYS_LAST_COVERED).toBe(maxKey);
    expect(staticHolidaySource.lastCoveredDate()).toBe(
      TH_HOLIDAYS_LAST_COVERED,
    );
  });
});

describe('[NOWBLOCK] the calendar is incomplete, and the switch is off because of it', () => {
  /* The lunar-calendar holidays move each year and are announced, not derived.
     They are listed rather than guessed, because a guessed date is worse than a
     missing one: it declares a holiday on an ordinary working day.

     This is the invariant that keeps that honest — while anything is still pending,
     the feature's default must remain off. It goes red the moment someone flips the
     default without finishing the table. */
  it('while holidays are still pending, the default mode stays off', () => {
    if (HOLIDAYS_PENDING.length > 0) {
      expect(NOW_BLOCK_DEFAULT_MODE).toBe('off');
    } else {
      expect(HOLIDAYS_PENDING).toHaveLength(0);
    }
  });

  it('a pending holiday is not also already in the table', () => {
    const names = new Set(Object.values(TH_HOLIDAYS));
    for (const pending of HOLIDAYS_PENDING)
      expect(names.has(pending)).toBe(false);
  });
});

describe('[NOWBLOCK] the expiry guard', () => {
  /* ⚠️ TIME-DEPENDENT ON PURPOSE — that is the entire mechanism. Every other test
     in this feature is deterministic; this one is a calendar alarm. It compares the
     table's coverage against the real current Bangkok day and fails while there is
     still time to append rows, rather than on the first working day of the new year
     when the answers have already gone wrong.

     WHEN IT GOES RED: append next year's rows to `TH_HOLIDAYS` and move
     `TH_HOLIDAYS_LAST_COVERED`. Do not raise the threshold to silence it — a
     threshold that gets raised whenever it is inconvenient measures nothing. */
  const WARN_DAYS = 60;

  it(`covers at least ${WARN_DAYS} more days from today`, () => {
    const today = businessToday(new Date());
    const horizon = new Date(Date.now() + WARN_DAYS * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    expect(TH_HOLIDAYS_LAST_COVERED >= today).toBe(true);
    expect(TH_HOLIDAYS_LAST_COVERED >= horizon).toBe(true);
  });
});
