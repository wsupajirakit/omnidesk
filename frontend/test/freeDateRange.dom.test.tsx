/* [FEAT-20260820-FREEDATERANGE] the UNCAPPED date-range picker
 * ===========================================================================
 * Owner, 20/08: "เราไม่ล็อคสามวัน สร้างใหม่ (ห้ามกระทบของเดิม ปล่อยเขาไป)" —
 * a NEW component, free of LogDateRangeFilter's 3-day hard cap, and
 * LogDateRangeFilter itself stays byte-untouched (it guards 5 log pages).
 *
 * Pinned here:
 *  ⭐ NO day cap — a 365-day range goes through exactly as picked;
 *  ⭐ cross-clamping still works both ways (from > to drags to along, and
 *    to < from drags from back) — the one behaviour shared with the page's
 *    Filters panel that keeps ranges valid without capping them;
 *  · testid prefix is caller-owned so cards keep their own ids.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React, { useState } from 'react';

import {
  FreeDateRangeFilter,
  type FreeDateRange,
} from '../components/common/FreeDateRangeFilter';
import { MAX_RANGE_DAYS } from '../components/common/LogDateRangeFilter';

const Harness: React.FC<{ onRange?: (r: FreeDateRange) => void }> = ({
  onRange,
}) => {
  const [range, setRange] = useState<FreeDateRange>({
    from: '2026-08-01',
    to: '2026-08-05',
  });
  return (
    <FreeDateRangeFilter
      value={range}
      onChange={(next) => {
        setRange(next);
        onRange?.(next);
      }}
      testIdPrefix="free"
    />
  );
};

describe('[FEAT-20260820-FREEDATERANGE] FreeDateRangeFilter', () => {
  it('⭐ a 365-day range passes through untouched — no cap anywhere', () => {
    const seen = vi.fn();
    render(<Harness onRange={seen} />);
    fireEvent.change(screen.getByTestId('free-from'), {
      target: { value: '2026-01-01' },
    });
    fireEvent.change(screen.getByTestId('free-to'), {
      target: { value: '2026-12-31' },
    });
    expect(seen).toHaveBeenLastCalledWith({
      from: '2026-01-01',
      to: '2026-12-31',
    });
  });

  it('⭐ moving FROM past TO drags TO along (range stays valid, never rejected)', () => {
    const seen = vi.fn();
    render(<Harness onRange={seen} />);
    fireEvent.change(screen.getByTestId('free-from'), {
      target: { value: '2026-09-10' },
    });
    expect(seen).toHaveBeenLastCalledWith({
      from: '2026-09-10',
      to: '2026-09-10',
    });
  });

  it('⭐ NO COLLISION: the old log-page picker still caps at exactly 3 days — its rule is untouched', () => {
    // the pair, pinned together: this suite proves the NEW one is uncapped
    // (365-day case above) while the OLD one still guards its five log pages.
    expect(MAX_RANGE_DAYS).toBe(3);
  });

  it('moving TO before FROM drags FROM back', () => {
    const seen = vi.fn();
    render(<Harness onRange={seen} />);
    fireEvent.change(screen.getByTestId('free-to'), {
      target: { value: '2026-07-01' },
    });
    expect(seen).toHaveBeenLastCalledWith({
      from: '2026-07-01',
      to: '2026-07-01',
    });
  });
});
