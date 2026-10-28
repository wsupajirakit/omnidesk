/**
 * [FEAT-20260902-NOWBLOCK] The decision the model used to make in its head.
 * ===========================================================================
 * One function, four possible answers, no I/O and no clock of its own. This is
 * the whole point of the feature: the open/closed/holiday conclusion becomes a
 * deterministic value computed here, and the model's only remaining job is to
 * read it.
 *
 * ── THE ENUM IS CLOSED ON PURPOSE ─────────────────────────────────────────
 * Four values, forever, unless a deliberate decision widens it. Every OA's
 * training document is written against this set; the day a fifth value appears,
 * every document is out of date at once and nothing in this repo would say so.
 * ⚠️ Adding a value is a product decision, not a refactor.
 *
 * ── ORDER IS LOAD-BEARING: A HOLIDAY BEATS THE CLOCK ──────────────────────
 * 14:00 on a public holiday sits inside 10:00-19:00 and must still read HOLIDAY.
 * Checking the window first and the calendar second would answer OPEN — the
 * single most likely way this feature could be built wrong while looking right.
 * วันหยุดชนะเงื่อนไขเวลาเสมอ
 *
 * ── THE WINDOW MATHS IS BORROWED, NOT COPIED ──────────────────────────────
 * `notice-runtime/notice-time-window.ts` already computes "is this instant inside
 * a Thai wall-clock window", already handles windows that cross midnight, and its
 * own header invites direct reuse ("ยืมไปเรียกตรงได้"). A second copy of that
 * arithmetic is exactly the debt this repo keeps paying for elsewhere — three
 * separate Thai date formatters already exist. So this file borrows it.
 * The coupling is one-way and inside the same module: deleting `now-block/` is
 * still a complete revert.
 *
 * ── INCLUSIVE CLOSE vs EXCLUSIVE END — read this before changing anything ──
 * The policy is that the closing minute is still OPEN (19:00 → OPEN,
 * 19:00:01 → AFTER_CLOSE). `noticeTimeWindow()`'s end is EXCLUSIVE. The two are
 * reconciled in exactly one place, by passing `closeMin + 1`. Do not "simplify"
 * that away without moving the boundary case with it.
 *
 * revert: delete the `now-block/` folder.
 */
import { noticeTimeWindow } from '../../notice-runtime/notice-time-window';
import { OFFICE_CLOSE_MIN, OFFICE_OPEN_MIN } from './office-hours';

/**
 * What the model reads. Closed set — see the header.
 *   OPEN         inside the service window on an ordinary day
 *   BEFORE_OPEN  ordinary day, the window has not started yet
 *   AFTER_CLOSE  ordinary day, the window has ended
 *   HOLIDAY      a public holiday, whatever the clock says
 */
export type NowStatus = 'OPEN' | 'BEFORE_OPEN' | 'AFTER_CLOSE' | 'HOLIDAY';

export interface NowStatusInput {
  /** The instant already captured upstream — never a fresh clock read. */
  instant: Date;
  /** Minutes since Bangkok midnight for that same instant (`bangkokNow`). */
  minuteOfDay: number;
  /** Did the calendar name this Bangkok day? */
  isHoliday: boolean;
  /** Window start, inclusive. Defaults to the policy constant. */
  openMin?: number;
  /** Window end, INCLUSIVE — the closing minute itself is still open. */
  closeMin?: number;
}

/**
 * The four-way decision.
 *
 * ⚠️ WRAPPING WINDOWS. A window may cross midnight (a service running 22:00-06:00).
 * Outside such a window a moment is simultaneously after the close and before the
 * next open; this function reports **AFTER_CLOSE**, because the close is the event
 * that has already happened. Stated here rather than left to whoever reads the
 * comparison. A maintenance band such as 23:00-02:00 is expressed as its
 * complement — a service window of 02:00-23:00 — which does not wrap at all.
 */
export function resolveNowStatus(input: NowStatusInput): NowStatus {
  const {
    instant,
    minuteOfDay,
    isHoliday,
    openMin = OFFICE_OPEN_MIN,
    closeMin = OFFICE_CLOSE_MIN,
  } = input;

  // 1 — the calendar wins outright. Never move this below the window check.
  if (isHoliday) return 'HOLIDAY';

  /* 2 — inside the window? Borrowed maths, one owner. `closeMin + 1` converts
     this file's inclusive close into that function's exclusive end. */
  if (noticeTimeWindow(instant, openMin, closeMin + 1)) return 'OPEN';

  /* 3 — outside. On a plain window the side is unambiguous. On a wrapping
     window both labels are true at once; see the header for why AFTER_CLOSE. */
  const wraps = openMin > closeMin;
  if (!wraps && minuteOfDay < openMin) return 'BEFORE_OPEN';
  return 'AFTER_CLOSE';
}

/**
 * Should the answer carry a time-of-day suffix?
 * Everything except a plain OPEN moment — the customer is being told something
 * about time, so the time is worth naming. Kept beside the status so the two can
 * never drift into contradicting each other.
 */
export function shouldAppendTimeSuffix(status: NowStatus): boolean {
  return status !== 'OPEN';
}
