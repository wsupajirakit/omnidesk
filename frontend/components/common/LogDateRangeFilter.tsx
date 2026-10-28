import React from 'react';
import { useI18n } from '../../i18n';

/**
 * [FEAT-20260809-DATERANGE] Shared date-range control for the log pages.
 *
 * WHAT
 *   One control used by Webhook Logs, Audit Logs and Handoff History. Defaults to today,
 *   allows a range, and refuses to let the user pick a window wider than MAX_RANGE_DAYS.
 *
 * WHY
 *   Those three pages listed unbounded collections — hook_audit_logs held 8,120 rows and
 *   webhook_logs 4,192 when this was written — so every visit paged through the whole
 *   history. Owner asked for "default today, range allowed, max 3 days so it isn't heavy".
 *   All three collections already carry a `created_at` index, so the bounded query is an
 *   index-backed win rather than the same cost moved server-side.
 *
 * DATES ARE BANGKOK DAYS
 *   The value is a bare `YYYY-MM-DD`, which the backend reads as a Bangkok calendar day
 *   (see `common/utils/date-range.ts`). We deliberately do NOT convert to ISO/UTC here:
 *   `new Date('2026-08-09').toISOString()` would yield UTC midnight, i.e. 07:00 Bangkok,
 *   and quietly drop every row logged between 00:00 and 06:59. Sending the plain date keeps
 *   the timezone decision in exactly one place — the backend.
 *   ส่งเป็น YYYY-MM-DD เฉย ๆ ห้ามแปลงเป็น ISO เอง เพราะจะเพี้ยนไป 7 ชั่วโมง.
 *
 * HOW TO CHANGE LATER
 *   - Different cap: change MAX_RANGE_DAYS below AND `MAX_RANGE_DAYS` in the backend's
 *     `src/common/utils/date-range.ts`. The backend is the authority — this constant only
 *     drives the UI affordance, and a client limit can always be bypassed.
 *   - Different default (e.g. last 7 days): change `defaultLogRange()`. Nothing else reads
 *     the default, so the blast radius is that one function.
 *   - Remove the cap: delete the `min`/`max` props and the clamping in `onFromChange`.
 *   - revert: a page rolls back by dropping <LogDateRangeFilter/> and no longer sending
 *     `from`/`to`. The backend treats both as optional, so the list returns to its previous
 *     unfiltered behaviour with no server change.
 */

/** Keep in sync with MAX_RANGE_DAYS in the backend's common/utils/date-range.ts. */
export const MAX_RANGE_DAYS = 3;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Thailand is UTC+7 all year (no DST), so a fixed offset is exact. */
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * Today as a Bangkok `YYYY-MM-DD`.
 *
 * Uses UTC arithmetic with an explicit offset rather than the browser's local time: an
 * admin travelling, or a machine set to another timezone, must still see the same "today"
 * the backend does. Otherwise the default silently shifts per viewer.
 */
export const bangkokToday = (now: Date = new Date()): string =>
  new Date(now.getTime() + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);

/** Shift a `YYYY-MM-DD` by whole days, staying in the same string form. */
export const addDays = (isoDate: string, days: number): string =>
  new Date(Date.parse(`${isoDate}T00:00:00.000Z`) + days * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);

export interface LogDateRange {
  from: string;
  to: string;
}

/** The default every log page starts on: today only. Cheapest useful window. */
export const defaultLogRange = (): LogDateRange => {
  const today = bangkokToday();
  return { from: today, to: today };
};

/** Inclusive day count, so from===to is 1 day. */
export const rangeDays = (range: LogDateRange): number =>
  Math.round(
    (Date.parse(`${range.to}T00:00:00.000Z`) -
      Date.parse(`${range.from}T00:00:00.000Z`)) /
      MS_PER_DAY,
  ) + 1;

interface Props {
  value: LogDateRange;
  onChange: (next: LogDateRange) => void;
  /** Disable both inputs while a fetch is in flight. */
  disabled?: boolean;
  className?: string;
}

/**
 * [FEAT-20260817-DATEINPUTOPEN] Clicking anywhere in the box opens the calendar.
 *
 * Owner, 17/08: "Date picker กดที่ input แล้วเปิดเลย ไม่ต้องคลิกแค่ icon" — a native
 * `<input type="date">` only opens on the little calendar glyph, so the rest of
 * the field looks clickable and does nothing.
 *
 * `showPicker()` is the standards way to open it, and it is guarded twice: the
 * method is absent on older Safari, and it THROWS (`NotAllowedError`) when the
 * call is not tied to a user gesture. Either way the field keeps working exactly
 * as before — the glyph still opens it. A no-op fallback, never a broken input.
 * ⚠️ Do not call it on `focus`: focus also fires when the picker closes, which
 * re-opens it in a loop on Chrome. Click only.
 *
 * Exported for the spec: React swallows a handler throw during `fireEvent`, so a
 * test driven through the DOM cannot tell a guarded call from an unguarded one —
 * it has to call this directly. (Proven: removing both guards left a DOM-only
 * suite green.) ต้องเทสฟังก์ชันตรง ๆ ไม่ใช่ผ่าน click.
 *
 * revert: delete this function and the two `onClick` props below.
 */
export const openNativePicker = (
  event: React.MouseEvent<HTMLInputElement>,
): void => {
  const input = event.currentTarget;
  if (typeof input.showPicker !== 'function' || input.disabled) return;
  try {
    input.showPicker();
  } catch {
    /* not user-activated, or unsupported — the glyph still works */
  }
};

export const LogDateRangeFilter: React.FC<Props> = ({
  value,
  onChange,
  disabled,
  className,
}) => {
  const { t } = useI18n();
  const today = bangkokToday();

  /*
   * Moving one end may invalidate the other, so each handler repairs the pair instead of
   * rejecting the edit. Rejecting would leave the user stuck with no feedback; repairing
   * keeps the range always-valid and always-explicable.
   */
  const handleFrom = (from: string) => {
    if (!from) return;
    let to = value.to;
    if (Date.parse(to) < Date.parse(from)) to = from;
    // Widening past the cap pulls `to` back to the last allowed day.
    if (rangeDays({ from, to }) > MAX_RANGE_DAYS) {
      to = addDays(from, MAX_RANGE_DAYS - 1);
    }
    onChange({ from, to });
  };

  const handleTo = (to: string) => {
    if (!to) return;
    let from = value.from;
    if (Date.parse(to) < Date.parse(from)) from = to;
    // Here the cap moves `from` forward, keeping the most recent days — the same direction
    // the backend clamps in, so UI and server never disagree about which slice survives.
    if (rangeDays({ from, to }) > MAX_RANGE_DAYS) {
      from = addDays(to, -(MAX_RANGE_DAYS - 1));
    }
    onChange({ from, to });
  };

  const input =
    'px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-200 disabled:opacity-50';

  return (
    <div className={`flex items-center gap-2 flex-wrap ${className ?? ''}`}>
      <input
        type="date"
        aria-label={t('pageui.common.range_start', 'วันที่เริ่ม')}
        className={input}
        value={value.from}
        /* [FIX-20260814-FROMFREE] TODAY is the only ceiling here. It used to be
           `value.to || today`, which greyed the start CALENDAR out past `to` —
           the picker looked "locked to 3 days" (owner bug report, 14/08). The
           3-day cap belongs to the LATTER field alone (`to`'s max below);
           picking a far-back start is legal and `handleFrom` drags `to` into
           the window. ล็อค 3 วันอยู่ที่ช่องหลังเท่านั้น ช่องหน้าห้ามเกินวันนี้พอ.
           revert: max={value.to || today} */
        max={today}
        disabled={disabled}
        onChange={(e) => handleFrom(e.target.value)}
        /* [FEAT-20260817-DATEINPUTOPEN] click the field, not just the glyph */
        onClick={openNativePicker}
      />
      <span className="text-slate-400 text-sm">{t('pageui.common.range_to', 'ถึง')}</span>
      <input
        type="date"
        aria-label={t('pageui.common.range_end', 'วันที่สิ้นสุด')}
        className={input}
        value={value.to}
        min={value.from}
        // Cannot exceed the cap measured from `from`, and never past today.
        max={
          value.from && addDays(value.from, MAX_RANGE_DAYS - 1) < today
            ? addDays(value.from, MAX_RANGE_DAYS - 1)
            : today
        }
        disabled={disabled}
        onChange={(e) => handleTo(e.target.value)}
        /* [FEAT-20260817-DATEINPUTOPEN] click the field, not just the glyph */
        onClick={openNativePicker}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(defaultLogRange())}
        className="px-3 py-2 rounded-xl text-sm font-bold text-primary-600 hover:bg-primary-50 dark:hover:bg-slate-800 disabled:opacity-50"
      >
        {t('pageui.common.range_today', 'วันนี้')}
      </button>
      <span className="text-[11px] text-slate-400">
        {t('pageui.common.range_max_days', 'สูงสุด {n} วัน', { n: MAX_RANGE_DAYS })}
      </span>
    </div>
  );
};
