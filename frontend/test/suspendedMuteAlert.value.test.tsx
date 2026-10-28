/**
 * [FEAT-20260830-MUTEALERT] the per-admin switch for the bot-stopped alerts.
 *
 * Owner's design, all decisions closed 30/08:
 *   two-way switch (alert ↔ muted) · every press confirmed with a message that
 *   states current → target · icon shows the CURRENT state (Bell / BellOff) ·
 *   muted = no glow, no badge — the tray and its data untouched · header only ·
 *   per THIS admin as a preference · default `alert` for everyone, garbage
 *   never breaks anyone.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

import {
  SUSPENDED_ALERT_MODE_PATH,
  SUSPENDED_ALERT_DEFAULT,
  normalizeSuspendedAlertMode,
  isSuspendedAlertMuted,
} from '../hooks/suspendedAlertMode';

/* ── the preference, stateful in-memory (usePreference stores verbatim) ── */
const prefStore: Record<string, unknown> = {};
vi.mock('../hooks/usePreferences', () => ({
  usePreference: (path: string, fallback: unknown) => {
    const [v, setV] = React.useState<unknown>(
      path in prefStore ? prefStore[path] : fallback,
    );
    return [
      v,
      (next: unknown) => {
        prefStore[path] = next;
        setV(next);
      },
    ] as const;
  },
}));

/* ── the strike read: two locked customers ── */
const listSuspended = vi.fn();
vi.mock('../services/strike/strikeService', () => ({
  default: { listSuspended: (...a: unknown[]) => listSuspended(...a) },
}));

import { SuspendedTrayButton } from '../components/common/suspended/SuspendedTrayButton';
import { I18nProvider } from '../i18n';

const mount = () =>
  render(
    <I18nProvider>
      <SuspendedTrayButton />
    </I18nProvider>,
  );

beforeEach(() => {
  for (const k of Object.keys(prefStore)) delete prefStore[k];
  listSuspended.mockReset();
  listSuspended.mockResolvedValue({
    suspended: [
      { _id: 's1', line_user_id: 'U1', strike_total: 5 },
      { _id: 's2', line_user_id: 'U2', strike_total: 9 },
    ],
  });
});
afterEach(() => vi.clearAllMocks());

describe('the normalizer — garbage never breaks anyone', () => {
  it.each([
    ['undefined', undefined], ['null', null], ['a number', 1],
    ['an object', {}], ['a word', 'banana'], ['ALERT uppercase', 'ALERT'],
  ])('%s → alert (the default)', (_l, v) => {
    expect(normalizeSuspendedAlertMode(v)).toBe('alert');
    expect(isSuspendedAlertMuted(v)).toBe(false);
  });

  it('only the literal "muted" mutes', () => {
    expect(normalizeSuspendedAlertMode('muted')).toBe('muted');
    expect(isSuspendedAlertMuted('muted')).toBe(true);
  });

  it('the default the whole design hangs on is alert', () => {
    expect(SUSPENDED_ALERT_DEFAULT).toBe('alert');
    expect(SUSPENDED_ALERT_MODE_PATH).toBe('ui.suspendedAlertMode');
  });
});

describe('alert mode (default) — today, byte for byte', () => {
  it('glow + badge while anyone is locked', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('suspended-count')).toBeTruthy());
    expect(screen.getByTestId('suspended-count').textContent).toBe('2');
    expect(screen.getByTestId('suspended-trigger').className).toContain('border-red-400');
  });

  it('the tray switch shows Bell (current state = alerts on), not pressed', async () => {
    mount();
    await waitFor(() => screen.getByTestId('suspended-count'));
    fireEvent.click(screen.getByTestId('suspended-trigger'));
    const sw = await screen.findByTestId('suspended-alert-switch');
    expect(sw.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByTestId('suspended-muted-hint')).toBeNull();
  });
});

describe('the confirm — nothing moves until ยืนยัน', () => {
  const openSwitch = async () => {
    mount();
    await waitFor(() => screen.getByTestId('suspended-count'));
    fireEvent.click(screen.getByTestId('suspended-trigger'));
    fireEvent.click(await screen.findByTestId('suspended-alert-switch'));
  };

  it('pressing the switch only ASKS — the message states current → target', async () => {
    await openSwitch();
    /* [FEAT-20260830-MUTEALERT] the confirm is INLINE in the tray, where the
       admin clicked — not a page-level modal in the middle of the screen. */
    expect(screen.getByTestId('suspended-alert-confirm')).toBeTruthy();
    expect(screen.getByText('ปิดแจ้งเตือนลูกค้าที่บอทหยุดตอบ')).toBeTruthy();
    const msg = document.body.textContent ?? '';
    expect(msg).toContain('สถานะปัจจุบัน: เปิดรับแจ้งเตือน');
    expect(msg).toContain('จะเปลี่ยนเป็น: ปิดรับแจ้งเตือน');
    expect(msg).toContain('มีผลเฉพาะบัญชีของคุณ');
    /* [FEAT-20260830-MUTEALERT] owner cut the two describing clauses on 30/08 —
       the message states the two STATES and the scope, nothing more. */
    expect(msg).not.toContain('ปุ่มจะแดงและมีตัวเลข');
    expect(msg).not.toContain('ไม่แดง ไม่เด้ง');
    expect(prefStore[SUSPENDED_ALERT_MODE_PATH]).toBeUndefined();
  });

  it('cancel writes nothing; glow and badge stay', async () => {
    await openSwitch();
    fireEvent.click(screen.getByTestId('suspended-alert-cancel'));
    expect(prefStore[SUSPENDED_ALERT_MODE_PATH]).toBeUndefined();
    expect(screen.getByTestId('suspended-count')).toBeTruthy();
  });

  it('confirm writes "muted" exactly, then the glow and badge are gone', async () => {
    await openSwitch();
    fireEvent.click(screen.getByTestId('suspended-alert-confirm-ok'));
    await waitFor(() =>
      expect(prefStore[SUSPENDED_ALERT_MODE_PATH]).toBe('muted'),
    );
    expect(screen.queryByTestId('suspended-count')).toBeNull();
    expect(screen.getByTestId('suspended-trigger').className).not.toContain('border-red-400');
  });
});

describe('muted mode — quiet, but the data untouched', () => {
  beforeEach(() => {
    prefStore[SUSPENDED_ALERT_MODE_PATH] = 'muted';
  });

  it('no glow, no badge, even with customers locked', async () => {
    mount();
    await waitFor(() => expect(listSuspended).toHaveBeenCalled());
    expect(screen.queryByTestId('suspended-count')).toBeNull();
    expect(screen.getByTestId('suspended-trigger').className).not.toContain('border-red-400');
  });

  it('the tray still opens with the full rows — mute hides nothing inside', async () => {
    mount();
    await waitFor(() => expect(listSuspended).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('suspended-trigger'));
    expect(await screen.findByTestId('suspended-alert-switch')).toBeTruthy();
    // the hint the owner asked for, in the agreed wording
    expect(screen.getByTestId('suspended-muted-hint').textContent).toBe('ปิดรับแจ้งเตือน');
  });

  it('the switch shows BellOff (current state = muted) and is pressed', async () => {
    mount();
    await waitFor(() => expect(listSuspended).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('suspended-trigger'));
    const sw = await screen.findByTestId('suspended-alert-switch');
    expect(sw.getAttribute('aria-pressed')).toBe('true');
  });

  it('confirming the other way writes "alert" and the glow returns', async () => {
    mount();
    await waitFor(() => expect(listSuspended).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('suspended-trigger'));
    fireEvent.click(await screen.findByTestId('suspended-alert-switch'));
    const msg = document.body.textContent ?? '';
    expect(msg).toContain('สถานะปัจจุบัน: ปิดรับแจ้งเตือน');
    expect(msg).toContain('จะเปลี่ยนเป็น: เปิดรับแจ้งเตือน');
    fireEvent.click(screen.getByTestId('suspended-alert-confirm-ok'));
    await waitFor(() =>
      expect(prefStore[SUSPENDED_ALERT_MODE_PATH]).toBe('alert'),
    );
    expect(screen.getByTestId('suspended-count')).toBeTruthy();
  });
});

describe('the two icons really invert', () => {
  it('source-level: BellOff on muted, Bell otherwise, on the same expression', () => {
    const src = require('fs').readFileSync(
      require('path').resolve(__dirname, '../components/common/suspended/SuspendedTray.tsx'),
      'utf8',
    ) as string;
    expect(src).toMatch(/alertMuted \? <BellOff size=\{15\} \/> : <Bell size=\{15\} \/>/);
  });
});

describe('placement — the owner rejected the page-level modal', () => {
  const TRAY = require('fs').readFileSync(
    require('path').resolve(__dirname, '../components/common/suspended/SuspendedTray.tsx'),
    'utf8',
  ) as string;
  const BUTTON = require('fs').readFileSync(
    require('path').resolve(__dirname, '../components/common/suspended/SuspendedTrayButton.tsx'),
    'utf8',
  ) as string;

  it('⭐ the confirm lives INSIDE the tray, not as a full-screen ConfirmModal', () => {
    expect(TRAY).toContain('suspended-alert-confirm');
    expect(BUTTON).not.toContain('ConfirmModal');
  });

  it('⭐ the switch sits right after the label — no justify-between pushing it away', () => {
    const at = TRAY.indexOf("t('suspended.title')");
    const header = TRAY.slice(Math.max(0, at - 300), at);
    expect(header).toContain('flex items-center gap-2');
    expect(header).not.toContain('justify-between');
  });

  it('the tray asks; the BUTTON still owns the write', () => {
    expect(TRAY).toMatch(/onToggleAlert\?\.\(\)/);
    expect(BUTTON).toMatch(/onToggleAlert=\{\(\) => setAlertModeRaw\(/);
  });
});
