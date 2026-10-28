import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import {
  LogDateRangeFilter,
  MAX_RANGE_DAYS,
  addDays,
  bangkokToday,
  defaultLogRange,
  rangeDays,
  openNativePicker,
  type LogDateRange,
} from '../components/common/LogDateRangeFilter';

/**
 * [FEAT-20260809-DATERANGE] Contract tests for the shared log date-range control.
 *
 * Three properties are locked down:
 *   (A) DEFAULT — every log page must start on today only, since that default is the whole
 *       point of the change (bounded first paint on collections with thousands of rows).
 *   (B) CAP — the UI must make a >MAX_RANGE_DAYS window unreachable, and must repair the
 *       pair rather than reject the edit, so the user is never stuck.
 *   (C) BANGKOK DAYS — the value stays a bare YYYY-MM-DD. Converting to ISO here would
 *       shift by 7 hours and silently drop the 00:00–06:59 rows.
 * เทสนี้ต้องพังถ้ามีคนถอด cap ออก หรือเผลอแปลงวันเป็น ISO.
 */

describe('date helpers', () => {
  it('bangkokToday uses the Bangkok calendar day, not the browser or UTC one', () => {
    // 18:00Z is already the next day in Bangkok (+07:00).
    expect(bangkokToday(new Date('2026-08-08T18:00:00.000Z'))).toBe('2026-08-09');
    expect(bangkokToday(new Date('2026-08-08T16:00:00.000Z'))).toBe('2026-08-08');
  });

  it('defaults to today only — a one-day window', () => {
    const range = defaultLogRange();
    expect(range.from).toBe(range.to);
    expect(range.from).toBe(bangkokToday());
    expect(rangeDays(range)).toBe(1);
  });

  it('rangeDays counts inclusively, so the cap means MAX_RANGE_DAYS calendar days', () => {
    expect(rangeDays({ from: '2026-08-09', to: '2026-08-09' })).toBe(1);
    expect(rangeDays({ from: '2026-08-07', to: '2026-08-09' })).toBe(3);
  });

  it('addDays keeps the bare YYYY-MM-DD form', () => {
    expect(addDays('2026-08-09', -2)).toBe('2026-08-07');
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
  });
});

/** Render helper: a controlled wrapper so we can observe what the control emits. */
const renderFilter = (initial: LogDateRange) => {
  const seen: LogDateRange[] = [];
  const Wrapper = () => {
    const [value, setValue] = React.useState(initial);
    return (
      <LogDateRangeFilter
        value={value}
        onChange={(next) => {
          seen.push(next);
          setValue(next);
        }}
      />
    );
  };
  render(<Wrapper />);
  return {
    seen,
    from: () => screen.getByLabelText('วันที่เริ่ม') as HTMLInputElement,
    to: () => screen.getByLabelText('วันที่สิ้นสุด') as HTMLInputElement,
  };
};

describe('LogDateRangeFilter — enforces the cap', () => {
  it('pulls `to` back when `from` is moved so far that the window exceeds the cap', () => {
    const ui = renderFilter({ from: '2026-08-09', to: '2026-08-09' });
    fireEvent.change(ui.from(), { target: { value: '2026-01-01' } });

    const emitted = ui.seen.at(-1)!;
    expect(emitted.from).toBe('2026-01-01');
    expect(rangeDays(emitted)).toBe(MAX_RANGE_DAYS);
    expect(emitted.to).toBe(addDays('2026-01-01', MAX_RANGE_DAYS - 1));
  });

  it('pushes `from` forward when `to` is moved past the cap, keeping the newest days', () => {
    const ui = renderFilter({ from: '2026-08-01', to: '2026-08-01' });
    fireEvent.change(ui.to(), { target: { value: '2026-08-31' } });

    const emitted = ui.seen.at(-1)!;
    expect(emitted.to).toBe('2026-08-31');
    expect(rangeDays(emitted)).toBe(MAX_RANGE_DAYS);
    // Clamps in the same direction the backend does, so the two never disagree about
    // which slice of a too-wide window survives.
    expect(emitted.from).toBe(addDays('2026-08-31', -(MAX_RANGE_DAYS - 1)));
  });

  it('repairs an inverted range instead of rejecting the edit', () => {
    const ui = renderFilter({ from: '2026-08-09', to: '2026-08-09' });
    fireEvent.change(ui.to(), { target: { value: '2026-08-01' } });

    const emitted = ui.seen.at(-1)!;
    expect(emitted.from).toBe('2026-08-01');
    expect(emitted.to).toBe('2026-08-01');
  });

  it('leaves a window inside the cap untouched', () => {
    const ui = renderFilter({ from: '2026-08-09', to: '2026-08-09' });
    fireEvent.change(ui.from(), { target: { value: '2026-08-07' } });
    expect(ui.seen.at(-1)).toEqual({ from: '2026-08-07', to: '2026-08-09' });
  });

  it('caps the `to` input via its max attribute, so the cap is visible not just corrected', () => {
    const ui = renderFilter({ from: '2026-01-01', to: '2026-01-01' });
    expect(ui.to().max).toBe(addDays('2026-01-01', MAX_RANGE_DAYS - 1));
  });

  /* [FIX-20260814-FROMFREE] Owner, 14/08: the START calendar was greying out
   * every day after `to` ("บัค start date ที่ล็อคสามวัน") — the 3-day cap
   * belongs to the LATTER field only; the start date must accept ANY day up
   * to today. The repair handlers (tests above) keep the pair valid. */
  it('the `from` input is capped by TODAY only — never by `to` or the 3-day window', () => {
    const ui = renderFilter({ from: '2026-01-01', to: '2026-01-03' });
    expect(ui.from().max).toBe(bangkokToday());
  });
});

describe('LogDateRangeFilter — values stay bare dates', () => {
  it('emits YYYY-MM-DD, never an ISO timestamp', () => {
    const ui = renderFilter({ from: '2026-08-09', to: '2026-08-09' });
    fireEvent.change(ui.from(), { target: { value: '2026-08-08' } });
    const emitted = ui.seen.at(-1)!;
    // An ISO conversion here would shift the day by 7 hours on the backend and hide the
    // early-morning rows — the exact bug this assertion exists to prevent.
    expect(emitted.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(emitted.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(emitted.from).not.toContain('T');
  });

  it('the "วันนี้" button returns to the default single-day window', () => {
    const ui = renderFilter({ from: '2026-08-01', to: '2026-08-03' });
    fireEvent.click(screen.getByText('วันนี้'));
    expect(ui.seen.at(-1)).toEqual(defaultLogRange());
  });
});

/**
 * [FEAT-20260817-DATEINPUTOPEN] Owner, 17/08: clicking the field must open the
 * calendar, not only the little glyph.
 *
 * jsdom has no `showPicker`, which is exactly the fallback path this must survive:
 * the spy is attached per test, so one case proves it is called and another proves
 * an absent/throwing implementation cannot break the input.
 */
describe('[DATEINPUTOPEN] click-to-open', () => {
  /**
   * The guard cases call `openNativePicker` DIRECTLY, not through a click: React
   * swallows a handler throw inside `fireEvent`, so a DOM-only test stays green
   * even with both guards deleted — measured, not assumed.
   */
  const fakeEvent = (input: Partial<HTMLInputElement>) =>
    ({ currentTarget: input }) as unknown as React.MouseEvent<HTMLInputElement>;

  it('calls showPicker for an enabled field', () => {
    const showPicker = vi.fn();
    openNativePicker(fakeEvent({ showPicker, disabled: false } as Partial<HTMLInputElement>));
    expect(showPicker).toHaveBeenCalledTimes(1);
  });

  it('a browser without showPicker is a no-op, not a crash (Safari <16)', () => {
    expect(() => openNativePicker(fakeEvent({ disabled: false }))).not.toThrow();
  });

  it('a showPicker that THROWS (not user-activated) is swallowed', () => {
    const showPicker = vi.fn(() => {
      throw new Error('NotAllowedError');
    });
    expect(() =>
      openNativePicker(fakeEvent({ showPicker, disabled: false } as Partial<HTMLInputElement>)),
    ).not.toThrow();
    expect(showPicker).toHaveBeenCalledTimes(1);
  });

  it('a disabled field never opens the picker', () => {
    const showPicker = vi.fn();
    openNativePicker(fakeEvent({ showPicker, disabled: true } as Partial<HTMLInputElement>));
    expect(showPicker).not.toHaveBeenCalled();
  });

  it('BOTH rendered fields are wired to it — not just the first', () => {
    render(<LogDateRangeFilter value={defaultLogRange()} onChange={() => {}} />);
    for (const label of ['วันที่เริ่ม', 'วันที่สิ้นสุด']) {
      const input = screen.getByLabelText(label) as HTMLInputElement;
      const showPicker = vi.fn();
      (input as unknown as { showPicker: () => void }).showPicker = showPicker;
      fireEvent.click(input);
      expect(showPicker).toHaveBeenCalledTimes(1);
    }
  });

  it('clicking still leaves the field editable (the picker is additive)', () => {
    const onChange = vi.fn();
    render(<LogDateRangeFilter value={defaultLogRange()} onChange={onChange} />);
    const from = screen.getByLabelText('วันที่เริ่ม') as HTMLInputElement;
    fireEvent.click(from);
    fireEvent.change(from, { target: { value: addDays(bangkokToday(), -1) } });
    expect(onChange).toHaveBeenCalled();
  });
});
