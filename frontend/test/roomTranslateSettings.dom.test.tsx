import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  TRANSLATE_LANGUAGES,
  TRANSLATE_LANGUAGE_CODES,
  isTranslateLanguage,
  asTranslateLanguage,
} from '../config/translateLanguages';
import { RoomTranslateModal } from '../components/chat/room-header/parts/room-translate/RoomTranslateModal';
import { I18nProvider } from '../i18n';

describe('[FEAT-20260918-ROOMTRANS] Single Source of Truth & Room Translate Settings', () => {
  describe('Single Source of Truth languages', () => {
    it('contains exactly the 7 supported languages', () => {
      expect(TRANSLATE_LANGUAGE_CODES).toEqual([
        'th',
        'en',
        'my',
        'zh-Hans',
        'zh-Hant',
        'lo',
        'km',
      ]);
      expect(TRANSLATE_LANGUAGES.length).toBe(7);
    });

    it('validates language codes via isTranslateLanguage', () => {
      expect(isTranslateLanguage('th')).toBe(true);
      expect(isTranslateLanguage('zh-Hans')).toBe(true);
      expect(isTranslateLanguage('fr')).toBe(false);
      expect(isTranslateLanguage('')).toBe(false);
      expect(isTranslateLanguage(undefined)).toBe(false);
    });

    it('normalizes language codes via asTranslateLanguage', () => {
      expect(asTranslateLanguage('en')).toBe('en');
      expect(asTranslateLanguage('unknown')).toBeNull();
      expect(asTranslateLanguage(null)).toBeNull();
    });
  });

  describe('RoomTranslateModal component', () => {
    it('renders 3 main sections when open, toggles settings, and requires confirm on language change', () => {
      const onUpdateSettings = vi.fn();
      const onClose = vi.fn();

      render(
        <I18nProvider>
          <RoomTranslateModal
            isOpen={true}
            onClose={onClose}
            room={{
              _id: 'room-1',
              translate_lang: 'en',
              show_original_text: true,
              /* [FEAT-20260919-SHOWORIGSRC] step 2's switch is disabled while the
                 room follows the account-wide value, because a click would then
                 write a boolean nobody reads. This room claims the decision so
                 the switch is live and the assertion below still exercises it. */
              show_original_text_source: 'room',
              auto_translate: true,
              auto_send_translated: false,
            } as any}
            onUpdateSettings={onUpdateSettings}
          />
        </I18nProvider>
      );

      // Section 1: Auto translate toggle
      const autoTranslateToggle = screen.getByTestId('room-modal-auto-translate-toggle');
      expect(autoTranslateToggle).toBeInTheDocument();
      fireEvent.click(autoTranslateToggle);
      expect(onUpdateSettings).toHaveBeenCalledWith(
        expect.objectContaining({ auto_translate: false })
      );

      // Section 2: Show original text toggle
      fireEvent.click(screen.getByTestId('room-wizard-step-2-btn'));
      const showOriginalToggle = screen.getByTestId('room-modal-show-original-toggle');
      expect(showOriginalToggle).toBeInTheDocument();
      fireEvent.click(showOriginalToggle);
      expect(onUpdateSettings).toHaveBeenCalledWith(
        expect.objectContaining({ show_original_text: false })
      );

      // Section 3: Room language select
      fireEvent.click(screen.getByTestId('room-wizard-step-3-btn'));
      const langSelect = screen.getByTestId('room-modal-lang-select') as HTMLSelectElement;
      expect(langSelect).toBeInTheDocument();
      expect(langSelect.value).toBe('en');

      // Change language: Action bar appears, but onUpdateSettings is NOT called yet!
      fireEvent.change(langSelect, { target: { value: 'my' } });
      expect(onUpdateSettings).not.toHaveBeenCalledWith(
        expect.objectContaining({ translate_lang: 'my' })
      );

      // Click save button -> opens ConfirmModal
      const saveBtn = screen.getByTestId('room-modal-save-lang-btn');
      fireEvent.click(saveBtn);

      // Confirm modal confirm button
      const confirmBtn = screen.getByText('ยืนยันบันทึก');
      expect(confirmBtn).toBeInTheDocument();
      fireEvent.click(confirmBtn);

      // Now onUpdateSettings is called!
      expect(onUpdateSettings).toHaveBeenCalledWith(
        expect.objectContaining({ translate_lang: 'my' })
      );
    });

    it('cancels language change when clicking cancel button', () => {
      render(
        <I18nProvider>
          <RoomTranslateModal
            isOpen={true}
            onClose={vi.fn()}
            room={{
              _id: 'room-1',
              translate_lang: 'en',
            } as any}
            onUpdateSettings={vi.fn()}
          />
        </I18nProvider>
      );

      fireEvent.click(screen.getByTestId('room-wizard-step-3-btn'));
      const langSelect = screen.getByTestId('room-modal-lang-select') as HTMLSelectElement;
      expect(langSelect.value).toBe('en');

      fireEvent.change(langSelect, { target: { value: 'zh-Hans' } });
      expect(langSelect.value).toBe('zh-Hans');

      const cancelBtn = screen.getByTestId('room-modal-cancel-lang-btn');
      fireEvent.click(cancelBtn);

      expect(langSelect.value).toBe('en');
      expect(screen.queryByTestId('room-modal-lang-action-bar')).not.toBeInTheDocument();
    });

    it('calls onClose when clicking close button in footer', () => {
      const onClose = vi.fn();
      render(
        <I18nProvider>
          <RoomTranslateModal
            isOpen={true}
            onClose={onClose}
            room={null}
          />
        </I18nProvider>
      );

      const closeBtn = screen.getByTestId('room-modal-close-btn');
      fireEvent.click(closeBtn);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
