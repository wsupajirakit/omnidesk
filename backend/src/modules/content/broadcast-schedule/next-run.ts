/**
 * [FEAT-20260822-BCASTSCHED] When is the next round?
 * ===========================================================================
 * A pure decision. No database, no I/O, no clock — `after` comes in as an
 * argument, so a spec drives it without a fake timer. Same contract the header
 * of `webhook/follow-up/abandon-trigger.rule.ts` states for itself.
 *
 * Signature and algorithm are แผน §11b.4, step for step.
 *
 * 🔑 SLOTS ARE COUNTED FROM THE WINDOW'S OPENING TIME, NEVER FROM THE LAST RUN.
 * This is the whole point of the arithmetic below, not an implementation
 * detail. `last_run + every_minutes` accumulates every round's latency:
 *   fired 09:00:03 ⇒ next 11:00:03 ⇒ 13:00:07 ⇒ 15:00:16 ⇒ …
 * a month later the campaign goes out at a visibly wrong time and nobody can
 * say when it started drifting. Counting `window_start + k * every` from the
 * day's own opening gives a fixed grid that cannot drift, whatever the run took.
 * ⇒ `last_run_at` is FOR READING. It is never an input to this function.
 * เวลาต้องนับจากขอบหน้าต่างของวันนั้น ห้ามนับจากรอบที่แล้ว.
 *
 * 🔴 FAILS CLOSED EVERYWHERE. Every read below returns `null` — "no next round"
 * — on anything it cannot vouch for: a missing rule, a NaN, a string where a
 * Date belongs, a weekday of `9`, a window that ends before it starts. A
 * scheduler that fails OPEN sends campaigns nobody asked for, so there is
 * deliberately no input that produces a Date by accident.
 * อ่านไม่ออก = ไม่มีรอบถัดไป ห้ามเดา.
 *
 * ⚠️ ALL ARITHMETIC IS DONE IN UTC MILLISECONDS with the offset added by hand.
 * `getHours()`/`getDay()` would answer in the SERVER's timezone, which differs
 * between a laptop and production — the reason `date-range.ts:78-85` gives for
 * doing exactly this, and the reason `notice-time-window.ts:42` does it too.
 *
 * revert: delete this file with the rest of `broadcast-schedule/`.
 */
import { BUSINESS_TZ_OFFSET_MINUTES } from '@/common/utils/date-range';

import { CATCH_UP_MISSED_ROUNDS } from '../broadcast-send/run-trigger';
import {
  DAY_MINUTES,
  DAY_MS,
  DEFAULT_WINDOW_END_MIN,
  DEFAULT_WINDOW_START_MIN,
  MAX_DAY_WALK,
  MAX_TZ_OFFSET_MIN,
  MIN_EVERY_MINUTES,
  MIN_TZ_OFFSET_MIN,
  MINUTE_MS,
} from './schedule-limits';
import {
  isJobScheduleEnabled,
  isRepeatRule,
  readDate,
  readInt,
  type BroadcastSchedule,
} from './schedule-shape';

/**
 * Weekday of epoch day 0. 1970-01-01 was a Thursday, and `Date#getUTCDay()`
 * numbers Thursday 4 — which is why `days_of_week` uses 0=Sunday…6=Saturday
 * (§11b.3.3): it matches `getUTCDay()` exactly, so nothing anywhere converts,
 * and conversion is where off-by-one lives.
 */
const EPOCH_DAY_0_DOW = 4;

/**
 * The next instant this rule should fire, strictly AFTER `after`.
 *
 * `null` means there is no next round — and the caller must act on that, not
 * ignore it: §11b.4 says a `null` should `$unset` the due date and settle the
 * status, so the row drops out of the partial index instead of being scanned
 * for free every minute forever.
 *
 * `runsSoFar` is the job's completed round count (`run_count` in the plan's
 * design). It is a parameter rather than a field read because the column does
 * not exist yet — see the header of `schedule-shape.ts`.
 */
export function computeNextRun(
  s: BroadcastSchedule | null | undefined,
  after: Date,
  runsSoFar = 0,
): Date | null {
  const from = readDate(after);
  if (from === null) return null;

  // Gate 1 — is this even a repeating rule? `=== 'repeat'`, never `!==`: a
  // legacy row reads `undefined` here and must mean "once", i.e. no next round.
  if (!isRepeatRule(s)) return null;

  // Gate 2 — the per-job kill switch (§11b.6.5 level 2).
  if (!isJobScheduleEnabled(s)) return null;

  if (!Number.isInteger(runsSoFar) || runsSoFar < 0) return null;

  // Cadence. A rule tighter than MIN_EVERY_MINUTES would be refused by the
  // flood guard anyway (see the derivation there); one longer than a day is
  // expressed with `days_of_week`, not by counting thousands of minutes.
  /**
   * [FEAT-20260825-ATTIME] "ทำซ้ำ ตอนกี่โมง" — เลือกเวลาในวัน พอถึงเวลานั้นก็ยิง
   *
   * 🔴 ONE SLOT PER SELECTED DAY, AT `at_time_min`. Expressed on the existing
   *    grid rather than as a second engine: a one-minute window opening at that
   *    time can hold exactly one slot, so the day-walk below already does the
   *    right thing and every guard, every bound and every test that guards it
   *    still applies. A parallel code path would be a second thing to keep
   *    correct forever. ใช้กริดเดิม ไม่เขียนเครื่องคำนวณตัวที่สอง.
   *
   * ⚠️ `at_time_min` WINS over the legacy trio when present, and the legacy trio
   *    is still read when it is absent — see `schedule-shape.ts` for why the old
   *    fields stay. A row cannot mean both at once, so this is a branch, never
   *    a merge of the two.
   *
   * ⚠️ 23:59 (`1439`) IS ALLOWED: the window closes at `1440`, which is the
   *    maximum `window_end_min` accepts. A minute later would be tomorrow, and
   *    a window that crosses midnight is refused on purpose (D24 below).
   *
   * 🧪 MUTATION NOTE — TWO MUTATIONS SURVIVED (25/08), reported rather than
   *    hidden, and neither is a hole:
   *      · widening the window to `atTime + 120`
   *      · lowering the cadence to `every = 60`
   *    Each is inert ON ITS OWN because the OTHER one already pins the answer:
   *    a 1-minute window admits one slot whatever the cadence, and a 1440-minute
   *    cadence admits one slot whatever the window. Both would have to change
   *    together to move a firing, which is a robustness property, not an
   *    untested branch. Do not "fix" this with a test that would pass without
   *    the line — that is decoration, and the M4 case below is what a real one
   *    looks like. สองอันนี้กันกันเอง แก้อันเดียวไม่เปลี่ยนคำตอบ — อย่าแต่งเทสหลอกตัวเอง.
   */
  const atTimeSet = !notSet(s?.at_time_min);
  const atTime = atTimeSet ? readInt(s?.at_time_min, 0, DAY_MINUTES - 1) : null;
  /* Present but unreadable is a REFUSAL, not a fallback to the legacy cadence —
     a rule nobody can parse must not quietly become a different rule.
     อ่านไม่ออก = ปฏิเสธ ห้ามเงียบ ๆ ไปใช้กติกาเก่าแทน. */
  if (atTimeSet && atTime === null) return null;

  const every =
    atTime !== null
      ? DAY_MINUTES
      : readInt(s?.every_minutes, MIN_EVERY_MINUTES, DAY_MINUTES);
  if (every === null) return null;

  const tz = readOptionalInt(
    s?.tz_offset_min,
    MIN_TZ_OFFSET_MIN,
    MAX_TZ_OFFSET_MIN,
    BUSINESS_TZ_OFFSET_MINUTES,
  );
  if (tz === null) return null;

  /* [FEAT-20260825-ATTIME] `at_time_min` supplies its own one-minute window;
     only a legacy row reads `window_start_min` / `window_end_min`. */
  const winStart =
    atTime !== null
      ? atTime
      : readOptionalInt(
          s?.window_start_min,
          0,
          DAY_MINUTES - 1,
          DEFAULT_WINDOW_START_MIN,
        );
  if (winStart === null) return null;

  const winEnd =
    atTime !== null
      ? atTime + 1
      : readOptionalInt(
          s?.window_end_min,
          1,
          DAY_MINUTES,
          DEFAULT_WINDOW_END_MIN,
        );
  if (winEnd === null) return null;

  // D24 ⭐(ก): a window that crosses midnight is REFUSED, not interpreted.
  // Allowing it means deciding whether 01:00 on Tuesday belongs to Monday's
  // `days_of_week` entry or to Tuesday's — a question nobody has asked for an
  // answer to yet, and one that would silently pick a day either way.
  // ⚠️ Equal start and end is a zero-length window and is refused for the same
  // reason `notice-time-window.ts:46` refuses it: it can never contain a slot.
  //
  // 🧪 MUTATION NOTE — this line SURVIVED mutation (M11, 2026-08-22), and that
  // is reported rather than hidden. Deleting it changes no answer: an inverted
  // or zero-length window makes `closeMs <= openMs`, so the day-walk below
  // finds no slot on any day and runs out, returning null anyway. The guard is
  // therefore an EARLY, NAMED refusal — one comparison instead of eight wasted
  // iterations, and a place to hang the D24 reasoning — not the mechanism that
  // enforces it. Do not "prove" it with a test that would pass without it.
  if (winEnd <= winStart) return null;

  const days = readDays(s?.days_of_week);
  if (days === false) return null;

  const startsAt = readOptionalDate(s?.starts_at);
  if (startsAt === false) return null;
  const endsAt = readOptionalDate(s?.ends_at);
  if (endsAt === false) return null;

  if (!notSet(s?.max_runs)) {
    const maxRuns = readInt(s?.max_runs, 1, Number.MAX_SAFE_INTEGER);
    if (maxRuns === null) return null;
    if (runsSoFar >= maxRuns) return null;
  }

  // `starts_at` in the future is not a rejection — it moves the search forward.
  // The -1 ms keeps the "strictly after" rule while still allowing a slot that
  // lands exactly ON `starts_at`.
  const baseMs =
    startsAt !== null && startsAt.getTime() > from.getTime()
      ? startsAt.getTime() - 1
      : from.getTime();

  const everyMs = every * MINUTE_MS;
  const localMs = baseMs + tz * MINUTE_MS;
  const day0 = Math.floor(localMs / DAY_MS);

  // Walk forward a bounded number of days. Bounded, not `while (true)`: broken
  // data must make this TERMINATE and answer null, never round (§11b.4 step 4).
  for (let d = 0; d < MAX_DAY_WALK; d++) {
    const dayIndex = day0 + d;

    if (days !== null) {
      const dow = (((dayIndex + EPOCH_DAY_0_DOW) % 7) + 7) % 7;
      if (!days.includes(dow)) continue;
    }

    const dayStartMs = dayIndex * DAY_MS;
    const openMs = dayStartMs + winStart * MINUTE_MS;
    const closeMs = dayStartMs + winEnd * MINUTE_MS;

    // Slot index on THIS day's grid. Only the first day can start mid-window;
    // every later day is entered at its own opening time.
    let k = 0;
    if (d === 0 && localMs >= openMs) {
      k = Math.floor((localMs - openMs) / everyMs) + 1;
    }

    const slotMs = openMs + k * everyMs;
    if (slotMs >= closeMs) continue; // window closed for today — try tomorrow

    const utcMs = slotMs - tz * MINUTE_MS;
    // `ends_at` is a hard stop. Later days can only be later still, so the
    // first slot past it ends the search — there is nothing further to find.
    if (endsAt !== null && utcMs > endsAt.getTime()) return null;
    return new Date(utcMs);
  }

  return null;
}

/**
 * The next round after one that has just finished.
 *
 * 🔴 THE OWNER'S DECISION, ENCODED: catch-up of MISSED rounds is OUT OF SCOPE.
 * (เจ้าของ 22/08: "พวกตกหล่น ยังไม่ต้อง" · plan §PH.15.1 · the constant
 * `CATCH_UP_MISSED_ROUNDS` in `broadcast-send/run-trigger.ts`.)
 *
 * So the search starts from NOW, not from the round that finished. A process
 * that was down for five hours misses two rounds; those two are gone, and the
 * job fires once at its next real slot. The alternative — three messages in ten
 * seconds because a server restarted — is the failure this rule exists to make
 * impossible. There is deliberately no `grace_minutes` (D26 was dropped).
 *
 * ⚠️ `catchUpMissedRounds` is a PARAMETER, not an `if` on the imported constant.
 * `CATCH_UP_MISSED_ROUNDS` is typed as the literal `false`, so branching on it
 * directly would make the other path unreachable code that no test can enter —
 * and unreachable code is code that rots. As a parameter both paths stay real
 * and the spec proves the difference between them is what the comment claims.
 * ⚠️ Flipping the DEFAULT is a new decision with its own rules, not a tweak
 * here. วันที่อยากได้ค่อยตัดสินใหม่ ไม่ใช่มาแก้ค่าตรงนี้.
 *
 * `roundFinishedAt` is still read, and still has to be readable: a finish time
 * in the FUTURE means the clock is wrong, and the later of the two is used so a
 * skewed clock cannot produce a slot in the past. (`abuse-guard.ts:135` treats
 * the same situation the same way, and calls it what it is.)
 */
export function nextRunAfterRound(
  s: BroadcastSchedule | null | undefined,
  roundFinishedAt: Date,
  now: Date,
  runsSoFar = 0,
  catchUpMissedRounds: boolean = CATCH_UP_MISSED_ROUNDS,
): Date | null {
  const finished = readDate(roundFinishedAt);
  const at = readDate(now);
  if (finished === null || at === null) return null;

  if (catchUpMissedRounds) {
    // Not reachable with the default, kept live and tested so that the day the
    // owner asks for catch-up the shape is already here and already proven.
    return computeNextRun(s, finished, runsSoFar);
  }

  const base = finished.getTime() > at.getTime() ? finished : at;
  return computeNextRun(s, base, runsSoFar);
}

/* ── readers used only here ─────────────────────────────────────────────── */

/** Absent ⇒ the default. Present but unusable ⇒ null, i.e. no next round. */
/**
 * [FIX-20260824-BCASTNULLABSENT] `null` and `undefined` both mean "not set".
 *
 * 🔴 THIS ONE PREDICATE IS WHY NO REPEAT EVER CAME BACK. Every reader below
 *    used to test `value === undefined` alone and fail closed on anything else.
 *    Mongoose materialises a DECLARED-but-unset path as `null`, never
 *    `undefined` — so a rule saved through the API reads back as
 *    `{enabled:null, starts_at:null, ends_at:null, …}`, every optional reader
 *    answered "present but unreadable", and `computeNextRun` refused. Measured
 *    24/08 on a real job: the identical rule returned a Date when built in
 *    memory and `null` when read from Mongo.
 *    ค่าที่ไม่ได้ตั้ง ใน Mongo คือ null ไม่ใช่ undefined ⇒ ต้องนับเป็น "ไม่ได้ตั้ง" ทั้งคู่.
 *
 * ⚠️ Fail-closed is KEPT for everything else. A string where a number belongs
 *    is still refused — this widens "absent", not "acceptable".
 */
const notSet = (value: unknown): boolean =>
  value === undefined || value === null;

function readOptionalInt(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number | null {
  if (notSet(value)) return fallback;
  return readInt(value, min, max);
}

/** `false` = present but unreadable (fail closed). `null` = absent. */
function readOptionalDate(value: unknown): Date | null | false {
  if (notSet(value)) return null;
  return readDate(value) ?? false;
}

/**
 * `null` = every day · `false` = unreadable, fail closed.
 *
 * An EMPTY array means every day, per the field's own definition in §11b.3.2
 * ("`[]` หรือไม่มี = ทุกวัน"). Treating it as "no day at all" would make the
 * walk below run out of days and answer null — a job that silently never fires.
 */
function readDays(value: unknown): number[] | null | false {
  if (notSet(value)) return null;
  if (!Array.isArray(value)) return false;
  if (value.length === 0) return null;
  const out: number[] = [];
  for (const raw of value) {
    const day = readInt(raw, 0, 6);
    if (day === null) return false;
    out.push(day);
  }
  return out;
}
