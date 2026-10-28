/**
 * [FEAT-20260830-TRAYWHOBLOCKED] the tray says WHO blocked the customer.
 *
 * Owner 30/08: a customer an ADMIN blocked shows "โดนลิมิตแล้ว 0 ครั้ง", which is
 * noise — that row must read "Admin Blocked" instead.
 *
 * 🔴 The switch is `suspended_by`, never `strike_total === 0`. A CEILING lock
 *    also reads 0 once its events age out of the counting window (the same
 *    mismatch behind the strike modal's "3 / 3 · อีก 0 ครั้ง" bug the same day),
 *    and that customer must keep the count.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { SuspendedRow } from '../components/common/suspended/SuspendedRow';
import type { SuspendedEntry } from '../services/strike/strikeService';
import th from '../i18n/translations/th.json';

/* the row takes `t` as a PROP (not context) — feed it the real Thai bundle so a
   missing key shows up as a failure instead of echoing the key back */
const t = (k: string) => (th as Record<string, string>)[k] ?? k;

const base: SuspendedEntry = {
  _id: 's1',
  line_user_id: 'U1',
  seq: 1,
  strike_total: 0,
  suspended_at: '2026-08-30T10:00:00.000Z',
  opened_at: '2026-08-30T09:00:00.000Z',
  display_name: 'tttdev',
  hook_alias: 'omnideskdevoathree',
};

const show = (over: Partial<SuspendedEntry> = {}) =>
  render(<SuspendedRow row={{ ...base, ...over }} t={t} onCopied={vi.fn()} />);

describe('an ADMIN block', () => {
  it('⭐ reads "Admin Blocked", with no rate-limit tally', () => {
    show({ suspended_by: 'admin1' });
    expect(screen.getByTestId('suspended-admin-blocked').textContent).toBe(
      'Admin Blocked',
    );
    expect(document.body.textContent).not.toContain('โดนลิมิตแล้ว');
  });

  it('says it even when strikes exist — the CAUSE decides, not the count', () => {
    show({ suspended_by: 'admin1', strike_total: 7 });
    expect(screen.getByTestId('suspended-admin-blocked')).toBeTruthy();
    expect(document.body.textContent).not.toContain('7');
  });
});

describe('a CEILING block keeps its count', () => {
  it('shows the tally when nobody is named', () => {
    show({ strike_total: 5 });
    expect(screen.queryByTestId('suspended-admin-blocked')).toBeNull();
    const txt = document.body.textContent ?? '';
    expect(txt).toContain('โดนลิมิตแล้ว');
    expect(txt).toContain('5');
    expect(txt).toContain('Blocked');
  });

  it('🔴 strike_total 0 with no admin is STILL a ceiling row — events can age out', () => {
    /* the trap this test exists for: inferring "admin" from 0 would relabel a
       legitimate ceiling lock whose events fell out of the window. */
    show({ strike_total: 0 });
    expect(screen.queryByTestId('suspended-admin-blocked')).toBeNull();
    expect(document.body.textContent).toContain('โดนลิมิตแล้ว');
  });

  it('an empty-string suspended_by is not an admin either', () => {
    show({ suspended_by: '', strike_total: 3 });
    expect(screen.queryByTestId('suspended-admin-blocked')).toBeNull();
  });
});

describe('the rest of the row is untouched', () => {
  it('the customer fields still render in both cases', () => {
    const a = show({ suspended_by: 'admin1' });
    expect(screen.getByText('tttdev')).toBeTruthy();
    a.unmount();
    show({ strike_total: 2 });
    expect(screen.getByText('tttdev')).toBeTruthy();
  });
});
