/**
 * [FEAT-20260809-DATERANGE] Log date-range policy — ONE place for all log listings.
 *
 * WHAT
 *   Turns the `from`/`to` a dashboard sends into a Mongo range on `created_at`, applying
 *   two rules that every log endpoint must share:
 *     1. business timezone — a "day" means a Bangkok day, not a UTC day;
 *     2. a maximum window (MAX_RANGE_DAYS) so one request cannot sweep the collection.
 *
 * WHY
 *   `hook_audit_logs` holds 8,120 rows and `webhook_logs` 4,192 (measured 2026-08-09, local
 *   dev), and both pages listed them unbounded. Owner asked for a date filter defaulting to
 *   today, capped at 3 days, "so it isn't heavy". All three collections already carry a
 *   `created_at` index, so a bounded range is a genuine index-backed win, not merely moving
 *   the cost to the database.
 *
 *   Timezone matters concretely: admins read and type Bangkok time. Parsing a bare
 *   "2026-08-09" as UTC midnight would start the day at 07:00 Bangkok, so every event
 *   between 00:00 and 06:59 would silently vanish from "today" — a wrong answer that looks
 *   like a working filter. Owner's decision: the UI speaks Bangkok time, the backend owns
 *   the conversion. เวลาที่แอดมินเห็นคือเวลาไทย ส่วนการแปลงเป็น UTC เป็นหน้าที่หลังบ้าน.
 *
 * HOW TO CHANGE LATER
 *   - Different cap: edit MAX_RANGE_DAYS. It is enforced here, so every endpoint that calls
 *     resolveLogDateRange() picks the change up at once — no per-controller edit.
 *     The frontend has a matching constant it uses to disable out-of-range dates; keep the
 *     two in sync, and treat THIS one as the authority (a client can always be bypassed).
 *   - Different timezone: edit BUSINESS_TZ_OFFSET_MINUTES. A fixed offset is correct for
 *     Thailand, which has no DST; a region with DST would need a real tz library instead.
 *   - Remove the cap entirely: return the range unclamped and delete `clamped` from the
 *     result. Callers ignore the flag when it is false, so nothing else breaks.
 *   - revert: no caller is obliged to use this helper. Dropping the
 *     `resolveLogDateRange()` call in a service restores that endpoint's old behaviour
 *     (unbounded, UTC-parsed) exactly.
 */

/** Thailand is UTC+7 year-round (no DST), so a fixed offset is exact, not an approximation. */
export const BUSINESS_TZ_OFFSET_MINUTES = 7 * 60;

/**
 * Widest window a single log query may span, in days (inclusive of both ends: a from/to on
 * the same day is 1 day). Owner decision 2026-08-09 — 3 days keeps the heaviest page
 * responsive. Raising it is a one-line change here; see HOW TO CHANGE LATER above.
 */
export const MAX_RANGE_DAYS = 3;

export interface ResolvedLogDateRange {
  /** Mongo range for `created_at`. Null when the caller supplied no usable bound. */
  filter: { $gte?: Date; $lte?: Date } | null;
  /** True when `from` was moved forward because the window exceeded MAX_RANGE_DAYS. */
  clamped: boolean;
  /** Effective bounds after clamping — echo these back so the UI can show what was used. */
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
}

/** Bare `YYYY-MM-DD`, i.e. a calendar day with no time or zone attached. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Parse one bound.
 *
 * A bare `YYYY-MM-DD` is interpreted as a BANGKOK day boundary: `edge: 'start'` gives
 * 00:00:00.000 and `edge: 'end'` gives 23:59:59.999, both local to Bangkok, converted to the
 * UTC instant Mongo stores. Anything else (a full ISO string, with or without an explicit
 * zone) is handed to `Date` unchanged — a caller that already sent an absolute instant means
 * it, and must not be shifted a second time.
 *
 * Unparsable input returns null and is IGNORED rather than rejected, matching the existing
 * `buildDateFilter` behaviour in webhook-log.query.ts so the two cannot disagree.
 */
const parseBound = (
  value: string | undefined,
  edge: 'start' | 'end',
): Date | null => {
  if (!value) return null;

  if (DATE_ONLY.test(value)) {
    // Build the instant from the calendar day directly: take UTC midnight for that date,
    // then subtract the offset to land on Bangkok midnight. Doing the arithmetic in UTC
    // avoids depending on the SERVER's local timezone, which differs between a developer
    // laptop and production.
    const utcMidnight = Date.parse(`${value}T00:00:00.000Z`);
    if (Number.isNaN(utcMidnight)) return null;
    const dayStart = utcMidnight - BUSINESS_TZ_OFFSET_MINUTES * 60_000;
    return new Date(edge === 'start' ? dayStart : dayStart + MS_PER_DAY - 1);
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/**
 * Resolve `from`/`to` into a capped, timezone-correct `created_at` filter.
 *
 * Clamping deliberately moves `from` FORWARD (keeping the most recent MAX_RANGE_DAYS) rather
 * than pulling `to` backward: someone asking for a wide window almost always wants the
 * latest activity, so truncating the old end surprises them least.
 *
 * A one-sided range is left one-sided — `to` alone stays open at the start. The cap only has
 * meaning once both ends are known, and inventing the missing bound would silently answer a
 * question the caller did not ask.
 */
export const resolveLogDateRange = (
  from?: string,
  to?: string,
): ResolvedLogDateRange => {
  const fromDate = parseBound(from, 'start');
  const toDate = parseBound(to, 'end');

  if (!fromDate && !toDate) {
    return {
      filter: null,
      clamped: false,
      effectiveFrom: null,
      effectiveTo: null,
    };
  }

  let effectiveFrom = fromDate;
  let clamped = false;

  if (fromDate && toDate) {
    const maxSpanMs = MAX_RANGE_DAYS * MS_PER_DAY;
    if (toDate.getTime() - fromDate.getTime() > maxSpanMs) {
      effectiveFrom = new Date(toDate.getTime() - maxSpanMs);
      clamped = true;
    }
  }

  const filter: { $gte?: Date; $lte?: Date } = {};
  if (effectiveFrom) filter.$gte = effectiveFrom;
  if (toDate) filter.$lte = toDate;

  return {
    filter,
    clamped,
    effectiveFrom: effectiveFrom ?? null,
    effectiveTo: toDate ?? null,
  };
};

/**
 * Bangkok "today" as a bare `YYYY-MM-DD`, for defaults and for tests that must not depend on
 * the server's local timezone. Uses the same fixed-offset arithmetic as parseBound.
 */
export const businessToday = (now: Date = new Date()): string => {
  const shifted = new Date(now.getTime() + BUSINESS_TZ_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(0, 10);
};
