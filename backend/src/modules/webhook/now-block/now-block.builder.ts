/**
 * [FEAT-20260902-NOWBLOCK] Assemble the block the model reads.
 * ===========================================================================
 * `key = value` lines only. No sentences — a sentence is the thing that can be
 * read two ways, and reading things two ways is the failure this feature exists
 * to remove. The block carries BOTH the finished decision (`status`,
 * `append_time_suffix`) and the raw values behind it (`datetime_th`, `time_24h`),
 * so the model never has to derive anything and can still quote a time.
 *
 * ── THE FENCE NAMES ARE NOT COSMETIC ──────────────────────────────────────
 * `[START_OF_NOW]` / `[END_OF_NOW]`, not `[NOW]` / `[/NOW]`.
 * Measured 02/09/2026: the outbound sweep that runs before a reply reaches the
 * customer strips single-bracket markers shaped `[START_OF_*]` / `[END_OF_*]` and
 * nothing else. A model that echoes a fence back — and models echo the fences they
 * are shown more readily than tags they were never given — would put a literal
 * `[NOW]` in a customer's LINE bubble with no error and no failing test. Choosing
 * the shape the guard already knows removes that class of bug for free.
 * ตั้งชื่อรั้วให้ตรงกับตัวกวาดเดิม = ได้ตัวกันฟรี ไม่ต้องเขียนใหม่
 *
 * ── WHY `datetime_th` IS AN INPUT AND NOT COMPUTED HERE ───────────────────
 * Three implementations of that Thai string already exist in this repo
 * (`webhook.service.ts:527`, which also draws the slip and payment cards;
 * `rag-engine.service.ts:82`, which has no production caller; and
 * `epoch-thai-time.util.ts:131`). A fourth would drift from the others, and the
 * whole reason the raw-JSON block stamps `date_th` in that exact shape is so the
 * model can compare two lines directly. So the caller passes the string it already
 * has, from the instant it already captured.
 *
 * ── VALUES ARE SANITISED, AND THE KEYS ARE CHOSEN, NOT INVENTED ───────────
 * On the `ai_stable_prompt === false` branch this text is concatenated into the
 * training-document string, which then passes through ctx-var substitution, dynamic
 * tag substitution, and the unknown-tag-marker scan. So:
 *   · no value may contain `{{` — `substituteCtxVars` would rewrite it silently;
 *   · no value may contain a newline — it would break the `key = value` shape;
 *   · no KEY may match `/(?:odk_[a-z]+_\d+|[a-z]+_[a-z]_\d+)/i`, or every reply
 *     would file a bogus `dynamic_tag_marker_mismatch` row. The current keys are
 *     clear; the spec pins that, because the next key added is where it breaks.
 *
 * revert: delete the `now-block/` folder.
 */
import { bangkokNow } from './bangkok-now';
import type { HolidaySource } from './calendar/holiday-source.port';
import { staticHolidaySource } from './calendar/th-holidays';
import {
  OFFICE_CLOSE_MIN,
  OFFICE_HOURS_TEXT,
  OFFICE_OPEN_MIN,
} from './policy/office-hours';
import {
  resolveNowStatus,
  shouldAppendTimeSuffix,
  type NowStatus,
} from './policy/now-status';

export const NOW_BLOCK_START = '[START_OF_NOW]';
export const NOW_BLOCK_END = '[END_OF_NOW]';

/** Shown when a field has no value. A bare key with nothing after `=` reads as broken. */
const EMPTY = '-';

export interface NowBlockInput {
  /** The instant already captured on the reply path — never a fresh clock read. */
  instant: Date;
  /**
   * The Thai date/time string the prompt already carries, passed in verbatim.
   * Empty or missing ⇒ the field renders as `-` rather than inventing a format.
   */
  datetimeTh?: string | null;
  /** Defaults to the hardcoded calendar; swap for a loaded one via the port. */
  holidays?: HolidaySource;
  /** Policy overrides — for specs and for a future per-OA window. */
  openMin?: number;
  closeMin?: number;
  officeHoursText?: string;
}

/** Everything the block says, before it becomes text. Useful to assert on directly. */
export interface NowBlockFacts {
  datetimeTh: string;
  dateIso: string;
  time24h: string;
  officeHours: string;
  isHoliday: boolean;
  holidayName: string;
  status: NowStatus;
  appendTimeSuffix: boolean;
}

/** One line of defence for values that reach the prompt as free text. */
function safeValue(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : '';
  const cleaned = s
    .replace(/[\r\n]+/g, ' ') // keep the key = value shape intact
    .replace(/[{}]/g, '') // never hand a `{{` to the ctx-var rewriter
    .trim();
  return cleaned.length > 0 ? cleaned : EMPTY;
}

/** Compute what the block will say. Pure; no clock, no I/O. */
export function resolveNowFacts(input: NowBlockInput): NowBlockFacts {
  const {
    instant,
    datetimeTh,
    holidays = staticHolidaySource,
    openMin = OFFICE_OPEN_MIN,
    closeMin = OFFICE_CLOSE_MIN,
    officeHoursText = OFFICE_HOURS_TEXT,
  } = input;

  const now = bangkokNow(instant);
  const holidayName = holidays.lookup(now.dateIso);
  const status = resolveNowStatus({
    instant,
    minuteOfDay: now.minuteOfDay,
    isHoliday: holidayName !== null,
    openMin,
    closeMin,
  });

  return {
    datetimeTh: safeValue(datetimeTh),
    dateIso: now.dateIso,
    time24h: now.time24h,
    officeHours: safeValue(officeHoursText),
    isHoliday: holidayName !== null,
    holidayName: safeValue(holidayName),
    status,
    appendTimeSuffix: shouldAppendTimeSuffix(status),
  };
}

/**
 * The block as the model receives it.
 *
 * ⚠️ KEY ORDER IS PART OF THE CONTRACT. Training documents are written against
 * this layout; reordering is a change every OA can see, so it belongs in a
 * deliberate edit with the documents, not in a tidy-up.
 */
export function renderNowBlock(facts: NowBlockFacts): string {
  return [
    NOW_BLOCK_START,
    `datetime_th = ${facts.datetimeTh}`,
    `date_iso = ${facts.dateIso}`,
    `time_24h = ${facts.time24h}`,
    `office_hours = ${facts.officeHours}`,
    `is_holiday = ${facts.isHoliday ? 'true' : 'false'}`,
    `holiday_name = ${facts.holidayName}`,
    `status = ${facts.status}`,
    `append_time_suffix = ${facts.appendTimeSuffix ? 'YES' : 'NO'}`,
    NOW_BLOCK_END,
  ].join('\n');
}

/** Facts → text in one call. The only function the seat needs. */
export function buildNowBlock(input: NowBlockInput): string {
  return renderNowBlock(resolveNowFacts(input));
}
