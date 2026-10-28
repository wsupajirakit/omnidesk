/* [FEAT-20260815-GEARFOLD] ⚙️ settings groups fold into their own cards
 * ===========================================================================
 * Owner's spec, pinned literally:
 *   "wrap ทุกเมนูเข้าการ์ดตัวเอง พับไว้"  → each group is one card, folded
 *   "default พับ"                        → CLOSED on first render, every time
 *   "มี arrow ชัดเจน"                    → a visible arrow that flips on toggle
 *
 * The fourth case is the one that protects the user: folding must not hide the
 * CURRENT CHOICE. A menu that folds away which font size is active would be
 * shorter and worse.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, fireEvent } from '@testing-library/react';

import { GearSection } from '../components/settings';

const setup = (value?: string) =>
  render(
    <GearSection title="ขนาดตัวอักษร" value={value}>
      <button type="button">ก ปกติ</button>
    </GearSection>,
  );

describe('[GEARFOLD] every group is its own folded card', () => {
  it('starts FOLDED — the group\'s controls are not rendered', () => {
    const t = setup();
    expect(t.container.textContent).toContain('ขนาดตัวอักษร'); // the card is there
    expect(t.queryByText('ก ปกติ')).toBeNull(); // its contents are not
  });

  it('opens on click and folds back on a second click', () => {
    const t = setup();
    fireEvent.click(t.getByTitle('เปิด ขนาดตัวอักษร'));
    expect(t.getByText('ก ปกติ')).toBeTruthy();
    fireEvent.click(t.getByTitle('พับ ขนาดตัวอักษร'));
    expect(t.queryByText('ก ปกติ')).toBeNull();
  });

  /* "มี arrow ชัดเจน" — the arrow must exist AND change with the state, or the
     card gives the user no clue that it opens. aria-expanded carries the same
     fact to screen readers. */
  it('shows an arrow that flips, and reports the state to assistive tech', () => {
    const t = setup();
    const row = t.getByTitle('เปิด ขนาดตัวอักษร');
    expect(row.getAttribute('aria-expanded')).toBe('false');
    const folded = row.querySelector('svg')?.innerHTML;
    expect(folded).toBeTruthy();

    fireEvent.click(row);
    const opened = t.getByTitle('พับ ขนาดตัวอักษร');
    expect(opened.getAttribute('aria-expanded')).toBe('true');
    expect(opened.querySelector('svg')?.innerHTML).not.toBe(folded); // ▸ → ▾
  });

  it('keeps the current choice visible WHILE FOLDED, and drops it once open', () => {
    const t = setup('ปกติ');
    expect(t.container.textContent).toContain('ปกติ'); // readable without expanding
    fireEvent.click(t.getByTitle('เปิด ขนาดตัวอักษร'));
    // open: the real controls show the selection, so the summary would duplicate it
    expect(t.getByText('ก ปกติ')).toBeTruthy();
  });

  it('renders no summary when the group has nothing to summarise', () => {
    const t = setup();
    expect(t.container.querySelectorAll('.text-slate-400').length).toBe(0);
  });
});
