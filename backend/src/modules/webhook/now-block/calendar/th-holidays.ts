/**
 * [FEAT-20260902-NOWBLOCK] The Thai public-holiday calendar — plain data, nothing else.
 * ===========================================================================
 * Keys are the BANGKOK calendar day in `YYYY-MM-DD`, Gregorian, so a lookup is a
 * single hash hit and stays O(1) however long the table grows. Values are the
 * name a customer would recognise, because the name travels into the prompt and
 * can end up in an answer.
 *
 * ── ADDING A YEAR ─────────────────────────────────────────────────────────
 * Append rows. That is the whole procedure — no logic below reads anything but
 * the map, and nothing anywhere else in the repo knows these dates.
 * เพิ่มปี = เติมแถว ไม่ต้องแตะตรรกะสักบรรทัด
 *
 * ── 🔴 THIS TABLE IS INCOMPLETE ON PURPOSE, AND IT MUST NOT BE SWITCHED ON AS IS ──
 * Every date below is a FIXED-DATE holiday and can be stated without a source.
 * The lunar-calendar holidays move every year and CANNOT be derived — they are
 * announced. They are listed in `HOLIDAYS_PENDING` rather than guessed, because a
 * guessed date is worse than a missing one: it produces a confident wrong answer
 * on an ordinary working day.
 *
 * The feature is off by default, so an incomplete calendar harms nothing today.
 * Before the block is turned on for real (`AI_NOW_BLOCK=on` since 18/10, or the const in
 * `../now-block.mode.ts`), `HOLIDAYS_PENDING` should be empty — the owner turned the env
 * switch on 18/10 knowing the lunar days are still missing (runbook). ก่อนเปิดสวิตช์จริง ต้องเติมวันหยุดจันทรคติให้ครบก่อน
 *
 * ── WHY A HARDCODED TABLE AT ALL ──────────────────────────────────────────
 * Owner's decision, 02/09/2026. A calendar in code is edited in one place,
 * reviewed like code, and cannot be half-written by a failed migration. When it
 * should come from somewhere else, implement `HolidaySource` — the seam is
 * already there and no logic changes.
 *
 * revert: delete the `now-block/` folder.
 */
import type { HolidaySource } from './holiday-source.port';

/**
 * Fixed-date Thai public holidays. Bangkok days, Gregorian keys.
 * ⚠️ Nothing validates these against an official announcement — a typo here is a
 *    wrong answer with no error. The spec walks every row for shape; a human still
 *    has to check the values.
 */
export const TH_HOLIDAYS: Readonly<Record<string, string>> = Object.freeze({
  '2026-01-01': 'วันขึ้นปีใหม่',
  '2026-04-06': 'วันจักรี',
  '2026-04-13': 'วันสงกรานต์',
  '2026-04-14': 'วันสงกรานต์',
  '2026-04-15': 'วันสงกรานต์',
  '2026-05-01': 'วันแรงงานแห่งชาติ',
  '2026-05-04': 'วันฉัตรมงคล',
  '2026-06-03': 'วันเฉลิมพระชนมพรรษาสมเด็จพระนางเจ้าฯ พระบรมราชินี',
  '2026-07-28': 'วันเฉลิมพระชนมพรรษาพระบาทสมเด็จพระเจ้าอยู่หัว',
  '2026-08-12': 'วันแม่แห่งชาติ',
  '2026-10-13': 'วันนวมินทรมหาราช',
  '2026-10-23': 'วันปิยมหาราช',
  '2026-12-05': 'วันพ่อแห่งชาติ',
  '2026-12-10': 'วันรัฐธรรมนูญ',
  '2026-12-31': 'วันสิ้นปี',
});

/**
 * Holidays that belong in the table and whose 2026 dates are NOT derivable — they
 * follow the lunar calendar and are announced. Fill each one in `TH_HOLIDAYS`, then
 * delete its entry here.
 *
 * ⚠️ A non-empty list means the calendar answers "ordinary working day" on days
 *    that are public holidays. That is a wrong answer, not a missing feature.
 *
 * ── COMPLETING THIS IS DATA ENTRY, NOT DEVELOPMENT ─────────────────────────
 * Owner's assessment, 03/09/2026, and it is correct: on the day this feature is
 * actually used, the whole job here is putting the right dates in. No logic, no
 * wiring, no test structure changes — and three specs in
 * `z-test/unit/now-block-calendar.spec.ts` decide whether the data is right, so
 * nobody has to remember the rules:
 *
 *   1. "while holidays are still pending, the default mode stays off" — flipping
 *      the switch before this list is empty is a RED SUITE, not a note someone
 *      might read. The gate is mechanical.
 *   2. "a pending holiday is not also already in the table" — filling a date in
 *      and forgetting to delete the name here is red.
 *   3. the expiry guard — the table's last covered date must stay a comfortable
 *      margin ahead of the real current date, so the suite goes red on its own
 *      well BEFORE the calendar runs out. It arrives on the calendar's schedule,
 *      not on a person's memory.
 *
 * So: fill the four dates into `TH_HOLIDAYS`, delete the four names below, run
 * the suite. Green means the data is complete and consistent; red names exactly
 * what is still wrong.
 */
export const HOLIDAYS_PENDING: readonly string[] = Object.freeze([
  'วันมาฆบูชา',
  'วันวิสาขบูชา',
  'วันอาสาฬหบูชา',
  'วันเข้าพรรษา',
]);

/**
 * The last day this table can speak for. Read by the rot guard — see
 * `holiday-source.port.ts`. Update it in the same edit that appends a year, or the
 * guard will keep warning about a table that is in fact current.
 */
export const TH_HOLIDAYS_LAST_COVERED = '2026-12-31';

/** The hardcoded calendar, as a `HolidaySource`. The default source today. */
export const staticHolidaySource: HolidaySource = {
  lookup(dateIso: string): string | null {
    /* `Object.prototype.hasOwnProperty` via the frozen literal is not needed —
       the object has a null-safe shape and no inherited string keys can collide
       with a `YYYY-MM-DD`. Returning `?? null` keeps the contract explicit. */
    return TH_HOLIDAYS[dateIso] ?? null;
  },
  lastCoveredDate(): string | null {
    return TH_HOLIDAYS_LAST_COVERED;
  },
};
