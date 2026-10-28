/**
 * [FEAT-20260824-TABLEPAGER] the shared pager — per-page on every table.
 * ===========================================================================
 * Owner, 24/08: "page gnation / per page ทั้งสอง table". Both tables on the
 * Broadcasts page had prev/next arrows and a hard-coded size of 10.
 *
 * The component is stateless, so a DOM test covers it completely: what it
 * renders, and which numbers it raises.
 *
 * 🔴 THE CLAMP IS THE LOAD-BEARING PART. A filter can shrink the result set
 *    while the parent still holds the old page number. Unclamped, the bar
 *    prints "9 / 2" and asks the server for a page that cannot exist — which
 *    comes back empty and reads as "no data". หน้าที่ไม่มีจริง = ตารางว่างแบบไม่มีเหตุผล.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { TablePager, TABLE_PER_PAGE_OPTIONS } from '../components/common';

const setup = (over: Partial<React.ComponentProps<typeof TablePager>> = {}) => {
  const onPageChange = vi.fn();
  const onPerPageChange = vi.fn();
  const utils = render(
    <TablePager
      page={2}
      totalPages={5}
      perPage={10}
      onPageChange={onPageChange}
      onPerPageChange={onPerPageChange}
      {...over}
    />,
  );
  return { ...utils, onPageChange, onPerPageChange };
};

describe('[TABLEPAGER] per-page selector', () => {
  it('🔴 offers exactly 10 / 25 / 50 / 100 — the sizes the owner named', () => {
    const t = setup();
    const select = t.getByTestId('table-pager-per-page') as HTMLSelectElement;
    expect([...select.options].map((o) => Number(o.value))).toEqual([10, 25, 50, 100]);
    expect([...TABLE_PER_PAGE_OPTIONS]).toEqual([10, 25, 50, 100]);
  });

  it('raises the picked size as a NUMBER, not the string the DOM gives', () => {
    /* `limit: '50'` on the request is a different value from `limit: 50` to a
       backend that validates types. ต้องเป็นตัวเลข ไม่ใช่สตริง. */
    const t = setup();
    fireEvent.change(t.getByTestId('table-pager-per-page'), { target: { value: '50' } });
    expect(t.onPerPageChange).toHaveBeenCalledWith(50);
    expect(t.onPerPageChange.mock.calls[0]![0]).toBeTypeOf('number');
  });

  it('shows the size currently in force', () => {
    const t = setup({ perPage: 100 });
    expect((t.getByTestId('table-pager-per-page') as HTMLSelectElement).value).toBe('100');
  });
});

describe('[TABLEPAGER] navigation and bounds', () => {
  it('prev/next raise the neighbouring page numbers', () => {
    const t = setup();
    fireEvent.click(t.getByTestId('table-pager-next'));
    fireEvent.click(t.getByTestId('table-pager-prev'));
    expect(t.onPageChange).toHaveBeenNthCalledWith(1, 3);
    expect(t.onPageChange).toHaveBeenNthCalledWith(2, 1);
  });

  it('prev is disabled on page 1, next on the last page', () => {
    const first = setup({ page: 1 });
    expect((first.getByTestId('table-pager-prev') as HTMLButtonElement).disabled).toBe(true);
    expect((first.getByTestId('table-pager-next') as HTMLButtonElement).disabled).toBe(false);
    first.unmount();
    const last = setup({ page: 5 });
    expect((last.getByTestId('table-pager-next') as HTMLButtonElement).disabled).toBe(true);
  });

  it('loading disables both arrows and the size select — no double-fetch', () => {
    const t = setup({ loading: true });
    expect((t.getByTestId('table-pager-next') as HTMLButtonElement).disabled).toBe(true);
    expect((t.getByTestId('table-pager-prev') as HTMLButtonElement).disabled).toBe(true);
    expect((t.getByTestId('table-pager-per-page') as HTMLSelectElement).disabled).toBe(true);
  });

  it('the page number is on screen — the whole point of the Groups fix, kept', () => {
    const t = setup({ page: 3, totalPages: 7 });
    expect(t.getByTestId('table-pager-position').textContent).toBe('3/7');
  });

  it('🔴 clamps a stale out-of-range page instead of printing 9 / 2', () => {
    const t = setup({ page: 9, totalPages: 2 });
    expect(t.getByTestId('table-pager-position').textContent).toBe('2/2');
    expect((t.getByTestId('table-pager-next') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(t.getByTestId('table-pager-prev'));
    expect(t.onPageChange).toHaveBeenCalledWith(1); // from the clamped 2, not from 9
  });

  it('🔴 a zero/empty result set still renders page 1 / 1, never 1 / 0', () => {
    const t = setup({ page: 1, totalPages: 0 });
    expect(t.getByTestId('table-pager-position').textContent).toBe('1/1');
    expect((t.getByTestId('table-pager-next') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('[TABLEPAGER] it is shared, so it must not carry one caller wording', () => {
  it('the summary is whatever the caller passes', () => {
    /* Contact counts "คน", broadcasts count "รายการ", and each page owns its
       own `t()`. A sentence baked in here would force one on all of them. */
    const t = setup({ summary: <span data-testid="s">ทั้งหมด 42 รายการ</span> });
    expect(t.getByTestId('s').textContent).toBe('ทั้งหมด 42 รายการ');
  });

  it('🔴 two pagers on one page get distinct test ids', () => {
    /* Both broadcast tables render one. Sharing an id would make the second
       pager unaddressable — by a test and by an accessibility tool alike. */
    const a = setup({ testId: 'broadcast-pager' });
    expect(a.queryByTestId('broadcast-pager-next')).not.toBeNull();
    a.unmount();
    const b = setup({ testId: 'broadcast-log-pager' });
    expect(b.queryByTestId('broadcast-log-pager-next')).not.toBeNull();
    expect(b.queryByTestId('broadcast-pager-next')).toBeNull();
  });
});
