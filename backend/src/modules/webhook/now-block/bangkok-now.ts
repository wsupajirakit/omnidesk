/**
 * [FEAT-20260902-NOWBLOCK] The one time gate — an instant in, three plain values out.
 * ===========================================================================
 * Every value the block needs about "now" is derived HERE and nowhere else, so
 * there is exactly one place where a timezone mistake could live. Downstream
 * files receive integers and strings and never touch a clock.
 *
 * ── NO `Date` GETTERS. NOT ONE. ────────────────────────────────────────────
 * `getHours()` / `getDate()` answer in the PROCESS timezone. Measured 02/09/2026
 * inside the deploy image (node:22-alpine): `process.env.TZ` is undefined and the
 * default zone is UTC, and no `TZ=` is set anywhere in the tracked tree —
 * Dockerfile, ci.yml, .env.example, env.schema.ts, docs, scripts. So the process
 * zone is not pinned by anything, which is exactly why this file does not depend
 * on it. (Note the phrasing: NOT PINNED, therefore not depended on. Asserting
 * "prod runs UTC" would be a claim about a hosting panel this repo cannot see.)
 *
 * ── WHY FIXED +7 AND NOT `Intl` ────────────────────────────────────────────
 * Thailand is UTC+7 year-round with no DST, so a fixed offset is exact, not an
 * approximation — the same reasoning `common/utils/date-range.ts` records for
 * `BUSINESS_TZ_OFFSET_MINUTES` and `notice-runtime/notice-time-window.ts` records
 * for the maintenance window. This repo reserves `Intl`/`toLocale*` for FORMATTING
 * and uses fixed-offset arithmetic for time MATHS; this file does maths.
 *
 * It also sidesteps a real trap. Measured across six runtimes: `hour12: false`
 * returns "24:00" for a Bangkok midnight under `en-US`/`en-CA` on node 14-20 (a
 * V8 difference, not an ICU one — node:20-alpine and node:22-alpine ship the same
 * ICU 78.2 and disagree). "24:00" would parse as 1440 minutes, i.e. past every
 * closing time, and would silently classify the whole hour after midnight as
 * closed. Deriving minutes arithmetically cannot produce that value at all.
 * เลี่ยง Intl ตรงนี้ = เลี่ยงเคส "24:00" ที่ทำให้ทั้งชั่วโมงหลังเที่ยงคืนกลายเป็นปิด
 *
 * ── WHAT THIS FILE DELIBERATELY DOES NOT DO ───────────────────────────────
 * It does not format the Thai date. Three implementations of that string already
 * exist (`webhook.service.ts:527` — also the formatter behind the slip and payment
 * cards, `rag-engine.service.ts:82` — no production caller, and
 * `epoch-thai-time.util.ts:131`). A fourth would be the same bug this feature
 * exists to remove. The caller passes the Thai string it already has.
 *
 * revert: delete the `now-block/` folder.
 */
import {
  BUSINESS_TZ_OFFSET_MINUTES,
  businessToday,
} from '@/common/utils/date-range';

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_DAY = 24 * 60;

/** Everything downstream is allowed to know about "now". */
export interface BangkokNow {
  /** Minutes since Bangkok midnight, 0..1439. The only value the window maths reads. */
  minuteOfDay: number;
  /** Bangkok calendar day as `YYYY-MM-DD` — the key the holiday table is written in. */
  dateIso: string;
  /** Bangkok wall clock as `HH:mm`, zero-padded, 24-hour. Display only. */
  time24h: string;
}

/**
 * Derive the Bangkok wall clock from a UTC instant.
 *
 * ⚠️ THROWS on an unusable instant. That is deliberate and it is the ONLY throw in
 * this feature: the caller sits on the customer reply path and wraps the whole
 * block in a try/catch that falls back to the prompt exactly as it is today. A
 * silent default here would put a confident, wrong `status` in front of a customer.
 */
export function bangkokNow(instant: Date): BangkokNow {
  const t = instant?.getTime?.();
  if (typeof t !== 'number' || !Number.isFinite(t)) {
    throw new TypeError('[NOWBLOCK] bangkokNow() needs a valid Date');
  }

  /* Shift the instant into Bangkok, then read the wall clock off the shifted
     value. `% MINUTES_PER_DAY` can go negative for pre-1970 instants, which no
     real message carries — the double modulo costs nothing and removes the
     class of bug entirely rather than arguing that it cannot happen. */
  const shiftedMinutes =
    Math.floor(t / MS_PER_MINUTE) + BUSINESS_TZ_OFFSET_MINUTES;
  const minuteOfDay =
    ((shiftedMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;

  const hh = String(Math.floor(minuteOfDay / 60)).padStart(2, '0');
  const mm = String(minuteOfDay % 60).padStart(2, '0');

  return {
    minuteOfDay,
    // Borrowed, not re-derived: same fixed-offset arithmetic, one owner.
    dateIso: businessToday(instant),
    time24h: `${hh}:${mm}`,
  };
}
