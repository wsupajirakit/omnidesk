/**
 * [FEAT-20260918-CONFIRMPREFUI] The tick that hides the confirm needs a way back.
 * =============================================================================
 * Owner, 18/09: *"step 4 เพิ่มการติ๊ก save preference ค่าจำค่าตอนส่ง (และต้องบันทึกด้วย
 * ถ้าติ๊กเข้าออกตรงนี้)"*.
 *
 * The send confirm's own "จำค่านี้ไว้" works and then removes the dialog that
 * contained it — so before this control there was no way to undo it short of
 * clearing site data. Both directions must therefore save, not just the one that
 * turns it on.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { skipAutoSendConfirm, rememberAutoSendConfirm } = vi.hoisted(() => ({
  skipAutoSendConfirm: vi.fn(() => false),
  rememberAutoSendConfirm: vi.fn(),
}));

vi.mock('../services/chat/autoSendConfirmPref', () => ({
  skipAutoSendConfirm,
  rememberAutoSendConfirm,
  AUTO_SEND_CONFIRM_PREF_PATH: 'chat.skip_auto_send_confirm',
}));

import { AutoSendConfirmPrefToggle } from '../components/chat/room-header/parts/room-translate/AutoSendConfirmPrefToggle';
import { I18nProvider } from '../i18n';

const mount = () =>
  render(
    <I18nProvider>
      <AutoSendConfirmPrefToggle />
    </I18nProvider>,
  );

const box = () => screen.getByTestId('step4-skip-confirm-pref') as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
  skipAutoSendConfirm.mockReturnValue(false);
});

describe('[CONFIRMPREFUI] it shows what is actually saved', () => {
  it('unticked when the operator has never asked to skip', () => {
    mount();

    expect(box().checked).toBe(false);
  });

  it('🔴 ticked when they already did — this is the state with no other way out', () => {
    skipAutoSendConfirm.mockReturnValue(true);
    mount();

    expect(box().checked).toBe(true);
  });
});

describe('[CONFIRMPREFUI] both directions save immediately', () => {
  it('ticking saves true', () => {
    mount();

    fireEvent.click(box());

    expect(rememberAutoSendConfirm).toHaveBeenCalledTimes(1);
    expect(rememberAutoSendConfirm).toHaveBeenCalledWith(true);
    expect(box().checked).toBe(true);
  });

  it('🔴 UNticking saves false — the way back the confirm dialog cannot offer', () => {
    skipAutoSendConfirm.mockReturnValue(true);
    mount();

    fireEvent.click(box());

    expect(rememberAutoSendConfirm).toHaveBeenCalledWith(false);
    expect(box().checked).toBe(false);
  });

  it('there is no save button to press — each tick is the save', () => {
    mount();
    fireEvent.click(box());
    fireEvent.click(box());

    expect(rememberAutoSendConfirm.mock.calls.map((c) => c[0])).toEqual([true, false]);
  });
});

describe('[CONFIRMPREFUI] it says whose setting it is', () => {
  it('🔴 the hint says account-wide, not this room', () => {
    // Every other control in this modal writes to the room. An operator who
    // reads this one as room-scoped would be surprised by the first silent send
    // in a different room.
    mount();
    const text = screen.getByTestId('step4-skip-confirm-pref').closest('label')?.textContent ?? '';

    expect(text).toContain('ทุกห้อง');
    expect(text).toContain('บัญชี');
  });
});
