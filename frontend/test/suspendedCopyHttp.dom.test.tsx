/**
 * [FIX-20260830-TRAYCOPYHTTP] the tray's copy button on plain http.
 *
 * Owner 30/08: "ปุ่มคัดลอกใช้จริงไม่ได้ toast คัดลอกขึ้น แต่ค่าไม่คัดลอกจริง".
 *
 * The row called `navigator.clipboard?.writeText(value)` and then lit the tick
 * and fired the toast unconditionally. `navigator.clipboard` is `undefined`
 * outside a secure context — this stack runs on http://console.omnidesk.test —
 * so the optional chain swallowed the call and the UI confirmed a copy that
 * never happened.
 *
 * These tests are written against the OBSERVABLE promise of the button: the
 * value reaches the clipboard, and nothing claims success when it does not.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { SuspendedRow } from '../components/common/suspended/SuspendedRow';
import type { SuspendedEntry } from '../services/strike/strikeService';
import th from '../i18n/translations/th.json';

const t = (k: string) => (th as Record<string, string>)[k] ?? k;

const row: SuspendedEntry = {
  _id: 's1',
  line_user_id: 'U1',
  seq: 1,
  strike_total: 5,
  suspended_at: '2026-08-30T10:00:00.000Z',
  opened_at: '2026-08-30T09:00:00.000Z',
  phone_number: '0812345678',
} as SuspendedEntry;

const realExec = (document as unknown as { execCommand?: unknown }).execCommand;
const realClip = navigator.clipboard;

/** put the browser back the way it was — these tests rewrite globals */
afterEach(() => {
  (document as unknown as { execCommand?: unknown }).execCommand = realExec;
  Object.defineProperty(navigator, 'clipboard', {
    value: realClip,
    configurable: true,
  });
});

/** strip the Clipboard API the way a plain-http page does */
const asHttpPage = () =>
  Object.defineProperty(navigator, 'clipboard', {
    value: undefined,
    configurable: true,
  });

describe('copying a field from the tray', () => {
  let onCopied: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onCopied = vi.fn();
  });

  const clickCopy = () => {
    render(<SuspendedRow row={row} t={t} onCopied={onCopied} />);
    fireEvent.click(screen.getByTestId('copy-phone_number'));
  };

  it('⭐ THE BUG: on http the phone still reaches the clipboard', async () => {
    asHttpPage();
    /* the legacy path parks the value in an off-screen textarea and copies the
       selection. Read that node AT THE MOMENT of the call — it is removed
       immediately after, so there is nothing left to inspect afterwards.
       (`activeElement` is not usable here: jsdom's `select()` does not move
       focus, so it would read null and the test would pass for a wrong reason.) */
    let copiedValue: string | null = null;
    (document as unknown as { execCommand: () => boolean }).execCommand = () => {
      copiedValue = document.querySelector('textarea')?.value ?? null;
      return true;
    };

    clickCopy();

    await waitFor(() => expect(copiedValue).toBe('0812345678'));
  });

  it('⭐ THE LIE: a copy the browser refused shows no tick and no toast', async () => {
    asHttpPage();
    (document as unknown as { execCommand: () => boolean }).execCommand = () => false;

    clickCopy();

    /* give the promise every chance to resolve before declaring the tick absent,
       otherwise this passes for the wrong reason (too early, not correct) */
    await new Promise((r) => setTimeout(r, 0));
    expect(onCopied).not.toHaveBeenCalled();
    expect(screen.queryByTestId('copy-phone_number')?.querySelector('.text-emerald-600')).toBeNull();
  });

  it('a copy that worked does light the tick and fire the toast', async () => {
    asHttpPage();
    (document as unknown as { execCommand: () => boolean }).execCommand = () => true;

    clickCopy();

    await waitFor(() => expect(onCopied).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        screen.getByTestId('copy-phone_number').querySelector('.text-emerald-600'),
      ).not.toBeNull(),
    );
  });

  it('still prefers the real Clipboard API when the page is secure', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    (document as unknown as { execCommand: () => boolean }).execCommand = () => {
      throw new Error('the legacy path must not run in a secure context');
    };

    clickCopy();

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('0812345678'));
    await waitFor(() => expect(onCopied).toHaveBeenCalledTimes(1));
  });
});
