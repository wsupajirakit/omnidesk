/**
 * [FEAT-20260919-NOOUTSIDECLOSE] Clicking outside must not close this modal.
 * ============================================================================
 * Owner, 19/09: *"ต่องาน modal นี้ not allow outside click"*.
 *
 * It is a five-section form with a scrolling body, so a press that lands just
 * past the panel — or a drag that starts on a control and releases on the
 * backdrop — used to throw the whole thing away mid-edit.
 *
 * ⚠️ WHAT THIS SUITE IS REALLY GUARDING is the pair of behaviours, not the
 * removal. A modal that cannot be closed at all is a worse bug than one that
 * closes too eagerly, and it would look identical in a test that only asserted
 * "the backdrop does nothing". Every remaining way out is therefore asserted
 * here alongside it. ปิดไม่ได้เลย แย่กว่าปิดง่ายเกินไป ต้องเทสทั้งสองด้าน
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../services/admin/preferencesService', () => ({
  getInitialPreferences: vi.fn(() => null),
  saveLocalPreference: vi.fn(),
  savePreferences: vi.fn(() => Promise.resolve({})),
}));

import { RoomTranslateModal } from '../components/chat/room-header/parts/room-translate/RoomTranslateModal';
import { I18nProvider } from '../i18n';

const mockRoom = {
  _id: 'room-1',
  translate_lang: 'en',
  show_original_text: false,
  auto_translate: false,
  auto_send_translated: false,
} as any;

const mount = () => {
  const onClose = vi.fn();
  render(
    <I18nProvider>
      <RoomTranslateModal
        isOpen
        onClose={onClose}
        room={mockRoom}
        onUpdateSettings={vi.fn()}
      />
    </I18nProvider>,
  );
  return { onClose };
};

beforeEach(() => vi.clearAllMocks());

describe('[NOOUTSIDECLOSE] the backdrop is inert', () => {
  it('🔴 clicking the backdrop does not close', () => {
    const { onClose } = mount();

    fireEvent.click(screen.getByTestId('room-translate-modal-backdrop'));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('🔴 mousedown-on-a-control, mouseup-on-the-backdrop does not close either', () => {
    // The drag case: selecting text in an input and releasing past the panel.
    // A naive `e.target === e.currentTarget` check already handled this one, but
    // only because the click event never fires on the backdrop — asserting it
    // keeps the guarantee if the handler is ever reintroduced differently.
    const { onClose } = mount();
    const backdrop = screen.getByTestId('room-translate-modal-backdrop');

    fireEvent.mouseDown(screen.getByTestId('room-wizard-step-2-btn'));
    fireEvent.mouseUp(backdrop);
    fireEvent.click(backdrop);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('clicking inside the panel does not close', () => {
    const { onClose } = mount();

    fireEvent.click(screen.getByTestId('room-modal-hook-section'));

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('[NOOUTSIDECLOSE] …but it is still closeable, three ways', () => {
  it('the ✕ in the header', () => {
    const { onClose } = mount();

    fireEvent.click(screen.getByLabelText('Close'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the "เสร็จสิ้น" button in the footer', () => {
    const { onClose } = mount();

    fireEvent.click(screen.getByTestId('room-modal-close-btn'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('🔴 Escape — a key press is a decision, a click near the edge is not', () => {
    const { onClose } = mount();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
