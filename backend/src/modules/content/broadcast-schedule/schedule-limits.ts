/**
 * [FEAT-20260822-BCASTSCHED] Every number and every switch the scheduler owns.
 * ===========================================================================
 * ตัวตั้งของตัวตั้งเวลาอยู่ไฟล์นี้ไฟล์เดียว — แก้ที่นี่ที่เดียว ห้ามมีสำเนาที่สอง.
 * Same rule `broadcast-send/limits.ts` states for the SEND side; this file is
 * the same idea for the SCAN side, and the two must not grow copies of each
 * other's numbers — where a value already exists over there, it is IMPORTED.
 *
 * Nothing here is a magic number: each one is either quoted from the plan
 * (`todo/task/21082026/todo1_21082026_broadcast-multicast.md`) or DERIVED from
 * a constant that already exists, with the derivation written beside it.
 *
 * revert: delete this file with the rest of `broadcast-schedule/`.
 */
import {
  MAX_CONCURRENT_RUNS_GLOBAL,
  MAX_RUNS_PER_JOB_PER_HOUR,
} from '../broadcast-send/abuse-guard';

/* ── the kill switch ───────────────────────────────────────────────────────
 * แผน §11b.6.5 asks for three levels. This file owns the first one.
 *
 *   1. WHOLE LAYER  ← here. Off ⇒ the scanner answers "nothing is due", ever.
 *   2. PER JOB      ← `schedule.enabled === false` (see `next-run.ts`).
 *   3. WHOLE FEATURE← delete this folder. Nothing outside it names these.
 *
 * 🔴 SHIPPED OFF, ON PURPOSE. Deploying this folder changes nothing that runs:
 * every entry point below refuses while the switch is false, and no module
 * imports this folder yet. ขึ้นไปแล้วต้องไม่มีอะไรขยับ.
 *
 * 🔑 WHY THE `: boolean` ANNOTATION IS LOAD-BEARING — do not delete it.
 * Without it TypeScript infers the LITERAL type `false`, and then `if (enabled)`
 * is statically dead: the on-branch becomes unreachable code that no test can
 * ever enter, and the compiler will happily let the on-path rot. Widening to
 * `boolean` keeps BOTH branches real, so the spec can prove the off branch
 * actually refuses AND that the on branch actually works.
 * (This is exactly the shape `CATCH_UP_MISSED_ROUNDS` in `run-trigger.ts` does
 * NOT have — that one is deliberately a frozen literal, because flipping it is
 * meant to be a new decision, not a config change. Two switches, two intents.)
 *
 * 🟢 ON since 23/08, with the owner's approval — and turning it on moved
 * nothing, because the scan can only ever return jobs carrying `next_run_at`
 * and no campaign had that column before 22/08. The `broadcast_due` index the
 * old text called missing landed with those columns.
 * เปิดแล้วแต่ไม่มีงานเก่าใบไหนถูกแตะ เพราะไม่มีใครมี next_run_at.
 *
 * ⇒ TO TURN IT BACK OFF: set this to `false`. `buildDueScanQuery` then returns
 *   `null` and the database is never asked — one edit, no stored row touched.
 * ────────────────────────────────────────────────────────────────────────── */
export const BROADCAST_SCHEDULER_ENABLED: boolean = true;

/**
 * How often a future worker would wake. Plan line 1380: "timer ธรรมดา ทุก 60 วิ".
 *
 * Nothing here starts a timer — the number lives here so the worker that is
 * written later reads it from one place instead of typing `60_000` inline.
 */
export const SCHEDULER_TICK_SEC = 60;

/**
 * How many due jobs ONE scan round may take.
 *
 * 🔑 DERIVED, NOT PICKED. §11b.5 measured the query at `.limit(50)` and it cost
 * 0-1 ms — so the DATABASE would happily hand over 50. That is the wrong number
 * to use anyway: `MAX_CONCURRENT_RUNS_GLOBAL` (abuse-guard.ts) says only three
 * runs may be in flight at once. Claiming 50 would flip 47 jobs to `sending`
 * that cannot start, each holding a lease for ~20 minutes (`computeLeaseMs`),
 * and the admin would watch jobs sit in `sending` doing nothing.
 * ⇒ never claim more than the system can actually run.
 * หยิบมาได้เท่าที่ยิงไหว ไม่ใช่เท่าที่ฐานข้อมูลยอมให้หยิบ.
 *
 * ⚠️ Consequence, from §11b.5.4: 500 jobs set to the same minute drain at this
 * rate, so the last one starts hours later. That is a PACING decision, not an
 * index problem — raising this number does not fix it, raising
 * `MAX_CONCURRENT_RUNS_GLOBAL` (and the OA pool behind it) does.
 */
export const DUE_SCAN_LIMIT = MAX_CONCURRENT_RUNS_GLOBAL;

/**
 * The tightest repeat cadence a rule may ask for, in minutes.
 *
 * 🔑 DERIVED from the flood guard so the two cannot disagree:
 * `MAX_RUNS_PER_JOB_PER_HOUR` = 6 ⇒ the abuse guard refuses a 7th run inside a
 * rolling hour ⇒ 60/6 = 10 minutes is the fastest cadence that can actually be
 * honoured. A rule of "every 5 minutes" would be accepted here, fire, and then
 * be REFUSED by `checkAbuse` every other round — which reads as a broken
 * scheduler, not as a limit. ⇒ refuse it at the rule instead.
 * ตั้งถี่กว่านี้ = ด่านกันฟลัดปัดทิ้งอยู่ดี ⇒ ปฏิเสธตั้งแต่ตอนตั้งกฎ.
 *
 * แผน §11b.3.4 trap 3 says the same thing in the owner's words:
 * "ยิงลูกค้าทุก 1 นาทีคือเหตุการณ์ระดับปิดบัญชี OA".
 */
export const MIN_EVERY_MINUTES = Math.ceil(60 / MAX_RUNS_PER_JOB_PER_HOUR);

/**
 * How many calendar days the next-round search may walk before giving up.
 *
 * แผน §11b.4 step 4: "วนไม่เกิน 8 ครั้ง แล้วยอมแพ้คืน null". Seven would be
 * enough for any legal `days_of_week` (every weekday occurs within 7 days);
 * the eighth is the guard against data that can never match — the loop must
 * TERMINATE on broken input rather than busy-loop.
 */
export const MAX_DAY_WALK = 8;

/** Minutes in a day. `window_end_min = 1440` means "to midnight". */
export const DAY_MINUTES = 1440;

export const MINUTE_MS = 60_000;

/**
 * ⚠️ RE-EXPORTED, NOT REDEFINED.
 *
 * `broadcast-history/usage-queries.ts:26` already owns `DAY_MS`, and defining a
 * second one here made the content barrel refuse to compile — two modules
 * exporting the same name. That error was the good outcome: the bad one is two
 * definitions that quietly drift, so the quota window and the schedule window
 * stop meaning the same day. The number has ONE owner; this file only points
 * at it. ตัวเลขต้องมีเจ้าของคนเดียว ที่นี่แค่ชี้ไป ไม่ได้นิยามใหม่.
 */
export { DAY_MS } from '../broadcast-history/usage-queries';

/**
 * Default daily window when a rule names none: the whole day.
 *
 * ⚠️ End is EXCLUSIVE — 1080 (18:00) means a slot AT 18:00 is already outside.
 * Same convention `notice-time-window.ts:27` records for its own window; two
 * different conventions in one repo is how off-by-one bugs are born.
 */
export const DEFAULT_WINDOW_START_MIN = 0;
export const DEFAULT_WINDOW_END_MIN = DAY_MINUTES;

/**
 * Legal range for `tz_offset_min`. UTC-12:00 … UTC+14:00 is the real span of
 * world offsets; anything outside it is corrupt data, not an exotic timezone.
 */
export const MIN_TZ_OFFSET_MIN = -12 * 60;
export const MAX_TZ_OFFSET_MIN = 14 * 60;
