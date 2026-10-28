/* [FEAT-20260820-FREEDATERANGE] date-range picker WITHOUT a day cap
 * ===========================================================================
 * Owner, 20/08: "เราไม่ล็อคสามวัน สร้างใหม่ (ห้ามกระทบของเดิม ปล่อยเขาไป) …
 * เผื่อคนอื่นเปลี่ยนมาใช้ แต่ห้ามชน 3 วัน".
 *
 * This is the NEUTRAL, shared, UNCAPPED sibling of LogDateRangeFilter:
 *  · same value/onChange API shape ({from, to} of YYYY-MM-DD strings), so a
 *    page can migrate from the capped one by swapping the import — nothing
 *    else changes;
 *  · NO MAX_RANGE_DAYS anywhere. The only rule is validity: moving `from`
 *    past `to` drags `to` along, and vice versa — never rejects, never trims;
 *  · visual: the exact input classes the insight Filters panel already uses,
 *    so it blends into existing pages without new styling vocabulary.
 *
 * ⚠️ DO NOT merge this back into LogDateRangeFilter or import its cap logic.
 * The 3-day cap over there GUARDS five log pages against unbounded queries —
 * that rule is theirs and stays theirs. The two components share only the
 * bangkokToday()/addDays() helpers (imported, never modified). The pair is
 * pinned by test/freeDateRange.dom.test.tsx: old stays capped at 3, this one
 * passes a 365-day range untouched. คนละหน้าที่ ห้ามยุบรวมกัน.
 *
 * Consumers today: pages/insight/RegisterDataCard.tsx. Import by full path
 * (same convention as LogDateRangeFilter — deliberately not in the barrel).
 *
 * revert: delete this file + its usages; nothing shared changes.
 */
import React from 'react';

import { bangkokToday } from './LogDateRangeFilter';

export interface FreeDateRange {
  from: string;
  to: string;
}

/** Today→today in Bangkok wall-clock — a sensible uncapped default. */
export const defaultFreeRange = (): FreeDateRange => {
  const today = bangkokToday();
  return { from: today, to: today };
};

const INPUT_CLASS =
  'flex-1 bg-dark-900 border border-dark-600 rounded-lg px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all cursor-pointer';

export const FreeDateRangeFilter: React.FC<{
  value: FreeDateRange;
  onChange: (next: FreeDateRange) => void;
  disabled?: boolean;
  className?: string;
  /** Caller-owned data-testid prefix, e.g. "reg" → reg-from / reg-to. */
  testIdPrefix?: string;
}> = ({ value, onChange, disabled, className, testIdPrefix = 'range' }) => {
  const openPicker = (e: React.MouseEvent<HTMLInputElement>) => {
    // same affordance as the insight Filters panel: click anywhere opens the
    // native picker; jsdom/older browsers lack showPicker, hence the guard.
    try {
      e.currentTarget.showPicker();
    } catch (err) {}
  };

  return (
    <div className={`flex items-center gap-2 ${className ?? ''}`}>
      <input
        type="date"
        data-testid={`${testIdPrefix}-from`}
        value={value.from}
        max={value.to || undefined}
        disabled={disabled}
        onChange={(e) => {
          const from = e.target.value;
          // validity without a cap: from past to drags to along
          const to = value.to && from && from > value.to ? from : value.to;
          onChange({ from, to });
        }}
        onClick={openPicker}
        className={INPUT_CLASS}
      />
      <span className="text-xs text-slate-400">–</span>
      <input
        type="date"
        data-testid={`${testIdPrefix}-to`}
        value={value.to}
        min={value.from || undefined}
        disabled={disabled}
        onChange={(e) => {
          const to = e.target.value;
          const from = value.from && to && to < value.from ? to : value.from;
          onChange({ from, to });
        }}
        onClick={openPicker}
        className={INPUT_CLASS}
      />
    </div>
  );
};
