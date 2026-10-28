/**
 * [FEAT-20260902-NOWBLOCK] The decision itself — boundaries, precedence, and the
 * timezone promise.
 *
 * These cases are the reason the feature exists. Each one describes a moment a
 * model previously had to reason about and now does not.
 *
 * ⚠️ EVERY case builds its instant from an explicit UTC epoch, never from a local
 * date literal. `new Date('2026-09-02T14:00:00')` means 14:00 in the PROCESS zone,
 * which is Bangkok on this machine and UTC in CI and in the deploy image — a spec
 * written that way passes here and asserts something different there. Building from
 * `Date.UTC(...)` and subtracting the Bangkok offset states the intent exactly once.
 *
 * revert: delete this file with the `now-block/` folder.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  resolveNowStatus,
  shouldAppendTimeSuffix,
} from '@/modules/webhook/now-block/policy/now-status';
import {
  OFFICE_CLOSE_MIN,
  OFFICE_OPEN_MIN,
} from '@/modules/webhook/now-block/policy/office-hours';

/** A UTC instant for the given Bangkok wall clock on 2 Sep 2026 (an ordinary Wednesday). */
const bangkok = (hh: number, mm = 0, day = 2): Date =>
  new Date(Date.UTC(2026, 8, day, hh - 7, mm, 0));

const minuteOfDay = (hh: number, mm = 0): number => hh * 60 + mm;

const statusAt = (hh: number, mm = 0, isHoliday = false, day = 2): string =>
  resolveNowStatus({
    instant: bangkok(hh, mm, day),
    minuteOfDay: minuteOfDay(hh, mm),
    isHoliday,
  });

describe('[NOWBLOCK] the window boundaries', () => {
  it('09:59 — one minute before opening is BEFORE_OPEN', () => {
    expect(statusAt(9, 59)).toBe('BEFORE_OPEN');
  });

  it('10:00 — the opening minute is already OPEN (start is inclusive)', () => {
    expect(statusAt(10, 0)).toBe('OPEN');
  });

  it('14:00 — the middle of the day is OPEN', () => {
    expect(statusAt(14, 0)).toBe('OPEN');
  });

  /* The single most likely off-by-one in this feature, and the one the owner
     stated explicitly: the closing minute itself is still open. It is also where
     the borrowed window helper and this file disagree by design —
     `noticeTimeWindow`'s end is exclusive, so `now-status.ts` passes close + 1. */
  it('19:00 — the closing minute is still OPEN, not AFTER_CLOSE', () => {
    expect(statusAt(19, 0)).toBe('OPEN');
  });

  it('19:01 — one minute later it is AFTER_CLOSE', () => {
    expect(statusAt(19, 1)).toBe('AFTER_CLOSE');
  });

  it('00:00 — midnight is BEFORE_OPEN, never a 24:00-shaped surprise', () => {
    expect(statusAt(0, 0)).toBe('BEFORE_OPEN');
  });
});

describe('[NOWBLOCK] a holiday beats the clock', () => {
  /* 12 August at 14:00 sits inside 10:00-19:00. Answering OPEN would be the
     feature working perfectly and still being wrong. */
  it('14:00 on a holiday is HOLIDAY, not OPEN', () => {
    expect(statusAt(14, 0, true, 12)).toBe('HOLIDAY');
  });

  it('a holiday outside business hours is still HOLIDAY', () => {
    expect(statusAt(3, 0, true, 12)).toBe('HOLIDAY');
    expect(statusAt(22, 0, true, 12)).toBe('HOLIDAY');
  });

  it('the same clock time on an ordinary day is OPEN', () => {
    expect(statusAt(14, 0, false, 12)).toBe('OPEN');
  });
});

describe('[NOWBLOCK] windows that cross midnight', () => {
  /* Not hypothetical: the live rule this feature grew out of is a 23:00-02:00
     maintenance band. Expressed as a SERVICE window it becomes 02:00-23:00 and
     does not wrap — but a window that genuinely wraps must not silently answer
     "closed forever", which is what a naive open <= m <= close does. */
  const wrapping = (hh: number, mm = 0): string =>
    resolveNowStatus({
      instant: bangkok(hh, mm),
      minuteOfDay: minuteOfDay(hh, mm),
      isHoliday: false,
      openMin: 22 * 60,
      closeMin: 6 * 60,
    });

  it('inside a wrapping window, before midnight, is OPEN', () => {
    expect(wrapping(23, 30)).toBe('OPEN');
  });

  it('inside a wrapping window, after midnight, is OPEN', () => {
    expect(wrapping(2, 0)).toBe('OPEN');
  });

  it('the inclusive close still holds on a wrapping window', () => {
    expect(wrapping(6, 0)).toBe('OPEN');
    expect(wrapping(6, 1)).toBe('AFTER_CLOSE');
  });

  it('outside a wrapping window reports AFTER_CLOSE, as documented', () => {
    expect(wrapping(12, 0)).toBe('AFTER_CLOSE');
  });

  /* The maintenance band the owner's real bug came from, written the way the
     policy file says to write it. 23:30 must read as closed. */
  it('a 23:00-02:00 maintenance band expressed as a 02:00-23:00 service window', () => {
    const at = (hh: number, mm = 0): string =>
      resolveNowStatus({
        instant: bangkok(hh, mm),
        minuteOfDay: minuteOfDay(hh, mm),
        isHoliday: false,
        openMin: 2 * 60,
        closeMin: 23 * 60,
      });
    expect(at(23, 30)).toBe('AFTER_CLOSE');
    expect(at(1, 0)).toBe('BEFORE_OPEN');
    expect(at(12, 0)).toBe('OPEN');
  });
});

describe('[NOWBLOCK] the time suffix follows the status', () => {
  it('OPEN needs no suffix; every other status does', () => {
    expect(shouldAppendTimeSuffix('OPEN')).toBe(false);
    expect(shouldAppendTimeSuffix('BEFORE_OPEN')).toBe(true);
    expect(shouldAppendTimeSuffix('AFTER_CLOSE')).toBe(true);
    expect(shouldAppendTimeSuffix('HOLIDAY')).toBe(true);
  });
});

describe('[NOWBLOCK] the timezone promise, as a source census', () => {
  /* A behavioural test cannot prove this: a `getHours()` added tomorrow would
     answer correctly on a Bangkok-set laptop and wrongly in the container, and
     every case above would stay green. The same technique the menu module uses
     to keep its revert claim honest — assert on the source, not the behaviour. */
  const FOLDER = join(
    __dirname,
    '..',
    '..',
    'src',
    'modules',
    'webhook',
    'now-block',
  );
  const FILES = [
    'bangkok-now.ts',
    'now-block.builder.ts',
    'now-block.mode.ts',
    'policy/now-status.ts',
    'policy/office-hours.ts',
    'calendar/th-holidays.ts',
    'calendar/holiday-source.port.ts',
    'index.ts',
  ];

  it.each(FILES)('%s reads no process-timezone Date getter', (rel) => {
    const src = readFileSync(join(FOLDER, rel), 'utf8');
    /* Strip block and line comments first: the headers DISCUSS getHours() at
       length, and a census that fails on its own explanation teaches the next
       reader to delete the explanation. */
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(code).not.toMatch(
      /\.(getHours|getMinutes|getDate|getDay|getMonth|getFullYear)\s*\(/,
    );
  });

  it('the policy constants are integers, not strings or Dates', () => {
    expect(Number.isInteger(OFFICE_OPEN_MIN)).toBe(true);
    expect(Number.isInteger(OFFICE_CLOSE_MIN)).toBe(true);
  });
});
