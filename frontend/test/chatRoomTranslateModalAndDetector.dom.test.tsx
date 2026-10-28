/**
 * [FEAT-20260918-ROOMTRANS] chatRoomTranslateModalAndDetector.dom.test.tsx
 * =========================================================================
 * Tests for:
 * 1. Single Source of Truth languages (canonical 7: th, en, my, zh-Hans, zh-Hant, lo, km)
 * 2. Thai Language Detector & Non-translatable content filter
 * 3. RoomTranslateModal (3 sections: auto_translate, show_original_text, translate_lang)
 * 4. ComposerAutoSendToggle (auto_send_translated toggle for composer)
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  TRANSLATE_LANGUAGES,
  TRANSLATE_LANGUAGE_CODES,
  isTranslateLanguage,
} from '../config/translateLanguages';
import {
  isThaiText,
  isNonTranslatableText,
  shouldSkipAutoTranslateForThai,
} from '../services/chat/thaiLanguageDetector';
import { RoomTranslateModal } from '../components/chat/room-header/parts/room-translate/RoomTranslateModal';
import { ComposerAutoSendToggle } from '../components/chat/chat-input/ComposerAutoSendToggle';
import type { ChatRoom } from '../services/chat';

describe('[FEAT-20260918-ROOMTRANS] Single Source of Truth Languages', () => {
  const EXPECTED_CODES = ['th', 'en', 'my', 'zh-Hans', 'zh-Hant', 'lo', 'km'] as const;

  it('matches exactly the canonical 7 languages', () => {
    expect(TRANSLATE_LANGUAGE_CODES).toEqual(EXPECTED_CODES);
    expect(TRANSLATE_LANGUAGES.map((l) => l.code)).toEqual(EXPECTED_CODES);
  });

  it('validates language codes with isTranslateLanguage', () => {
    for (const code of EXPECTED_CODES) {
      expect(isTranslateLanguage(code)).toBe(true);
    }
    expect(isTranslateLanguage('ja')).toBe(false);
    expect(isTranslateLanguage('ko')).toBe(false);
    expect(isTranslateLanguage(null)).toBe(false);
    expect(isTranslateLanguage(undefined)).toBe(false);
    expect(isTranslateLanguage('')).toBe(false);
  });
});

describe('[FEAT-20260918-ROOMTRANS] Thai Language Detector', () => {
  it('detects Thai script accurately', () => {
    expect(isThaiText('สวัสดีครับ มีปัญหาเรื่องฝากเงิน')).toBe(true);
    expect(isThaiText('Hello there')).toBe(false);
    expect(isThaiText('mingalaba')).toBe(false);
    expect(isThaiText('你好')).toBe(false);
    expect(isThaiText('ສະບາຍດີ')).toBe(false);
  });

  it('identifies non-translatable text (emojis, punctuation, digits)', () => {
    expect(isNonTranslatableText('12345')).toBe(true);
    expect(isNonTranslatableText('🔥🔥🔥')).toBe(true);
    expect(isNonTranslatableText('...')).toBe(true);
    expect(isNonTranslatableText('   ')).toBe(true);
    expect(isNonTranslatableText('Hello')).toBe(false);
    expect(isNonTranslatableText('สวัสดี')).toBe(false);
  });

  it('skips auto-translation for Thai and non-translatable messages', () => {
    // Thai messages should be skipped
    expect(shouldSkipAutoTranslateForThai('สวัสดีครับ ขอสอบถามโปรโมชั่น')).toBe(true);
    expect(shouldSkipAutoTranslateForThai('ฝากเงิน 500 บาท เรียบร้อยแล้ว')).toBe(true);

    // Pure numbers/emojis should be skipped
    expect(shouldSkipAutoTranslateForThai('1234567890')).toBe(true);
    expect(shouldSkipAutoTranslateForThai('👍🙏')).toBe(true);

    // Foreign languages must NOT be skipped (proceed to translation)
    expect(shouldSkipAutoTranslateForThai('How can I deposit funds?')).toBe(false);
    expect(shouldSkipAutoTranslateForThai('ငွေသွင်းချင်လို့ပါ')).toBe(false); // Myanmar
    expect(shouldSkipAutoTranslateForThai('我想存款')).toBe(false); // Chinese
  });
});

describe('[FEAT-20260918-ROOMTRANS] RoomTranslateModal Component', () => {
  const mockRoom: ChatRoom = {
    _id: 'room-123',
    line_user_id: 'u-123',
    user_data: { id: 'u-123', display_name: 'Test Customer', nickname: '', picture_url: '' },
    auto_translate: false,
    show_original_text: false,
    /* [FEAT-20260919-SHOWORIGSRC] the room claims its own decision, so step 2's
       switch is enabled and this suite keeps testing the wizard's navigation
       rather than the new room-vs-account rule (which has its own suite). */
    show_original_text_source: 'room',
    translate_lang: 'en',
  } as unknown as ChatRoom;

  it('does not render when isOpen is false', () => {
    const { container } = render(
      <RoomTranslateModal
        isOpen={false}
        onClose={vi.fn()}
        room={mockRoom}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders 4 wizard steps and hook section below when isOpen is true', () => {
    render(
      <RoomTranslateModal
        isOpen={true}
        onClose={vi.fn()}
        room={mockRoom}
      />,
    );

    // Title
    expect(screen.getByText('ตั้งค่าแปลภาษาห้องแชท')).toBeInTheDocument();

    // 4 Wizard Step buttons
    expect(screen.getByTestId('room-wizard-step-1-btn')).toBeInTheDocument();
    expect(screen.getByTestId('room-wizard-step-2-btn')).toBeInTheDocument();
    expect(screen.getByTestId('room-wizard-step-3-btn')).toBeInTheDocument();
    expect(screen.getByTestId('room-wizard-step-4-btn')).toBeInTheDocument();

    // Hook section below
    expect(screen.getByTestId('room-modal-hook-section')).toBeInTheDocument();
    expect(screen.getByText(/ค่าเริ่มต้น OA \(แสดงอย่างเดียว/)).toBeInTheDocument();

    // Step 1 is active by default
    expect(screen.getByTestId('room-modal-auto-translate-toggle')).toBeInTheDocument();
  });

  it('navigates between steps via buttons and triggers onUpdateSettings', () => {
    const onUpdateSettings = vi.fn();
    render(
      <RoomTranslateModal
        isOpen={true}
        onClose={vi.fn()}
        room={mockRoom}
        onUpdateSettings={onUpdateSettings}
      />,
    );

    // Toggle auto translate in Step 1
    fireEvent.click(screen.getByTestId('room-modal-auto-translate-toggle'));
    expect(onUpdateSettings).toHaveBeenCalledWith({ auto_translate: true });

    // Navigate to Step 2 via Next button
    fireEvent.click(screen.getByTestId('room-wizard-next-1-btn'));
    expect(screen.getByTestId('room-modal-show-original-toggle')).toBeInTheDocument();

    // Toggle show original in Step 2
    fireEvent.click(screen.getByTestId('room-modal-show-original-toggle'));
    expect(onUpdateSettings).toHaveBeenCalledWith({ show_original_text: true });

    // Navigate to Step 3 via Next button
    fireEvent.click(screen.getByTestId('room-wizard-next-2-btn'));
    expect(screen.getByTestId('room-modal-lang-select')).toBeInTheDocument();

    // Change room language in Step 3
    fireEvent.change(screen.getByTestId('room-modal-lang-select'), {
      target: { value: 'zh-Hans' },
    });
    expect(onUpdateSettings).not.toHaveBeenCalledWith({ translate_lang: 'zh-Hans' });

    // Click Save button then Confirm in ConfirmModal
    fireEvent.click(screen.getByTestId('room-modal-save-lang-btn'));
    fireEvent.click(screen.getByText('ยืนยันบันทึก'));
    expect(onUpdateSettings).toHaveBeenCalledWith({ translate_lang: 'zh-Hans' });

    // Navigate to Step 4 via step button
    fireEvent.click(screen.getByTestId('room-wizard-step-4-btn'));
    expect(screen.getByTestId('room-modal-auto-send-toggle')).toBeInTheDocument();
    /* [FEAT-20260918-LANGSUMMARY] the blue box used to be one sentence about the
       RULE; it now names both levels with their flags and the resolved answer,
       so the assertion follows the summary instead of a copy line. */
    expect(screen.getByTestId('step4-lang-summary')).toBeInTheDocument();
    expect(screen.getByTestId('step4-lang-room')).toBeInTheDocument();
    expect(screen.getByTestId('step4-lang-hook')).toBeInTheDocument();
    expect(screen.getByTestId('step4-lang-target')).toBeInTheDocument();

    // Toggle auto send in Step 4
    fireEvent.click(screen.getByTestId('room-modal-auto-send-toggle'));
    expect(onUpdateSettings).toHaveBeenCalledWith({ auto_send_translated: true });
  });

  it('closes modal when clicking close button in footer', () => {
    const onClose = vi.fn();
    render(
      <RoomTranslateModal
        isOpen={true}
        onClose={onClose}
        room={mockRoom}
      />,
    );

    const btn = screen.getByTestId('room-modal-close-btn');
    fireEvent.click(btn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('[FEAT-20260918-ROOMTRANS] ComposerAutoSendToggle Component', () => {
  const mockRoom: ChatRoom = {
    _id: 'room-123',
    line_user_id: 'u-123',
    user_data: { id: 'u-123', display_name: 'Test Customer', nickname: '', picture_url: '' },
    auto_send_translated: false,
    translate_lang: 'en',
  } as unknown as ChatRoom;

  it('does not render when isOpen is false', () => {
    const { container } = render(
      <ComposerAutoSendToggle
        isOpen={false}
        onClose={vi.fn()}
        room={mockRoom}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders title and toggle when open', () => {
    render(
      <ComposerAutoSendToggle
        isOpen={true}
        onClose={vi.fn()}
        room={mockRoom}
      />,
    );

    expect(screen.getByText('แปลและส่งออโต้')).toBeInTheDocument();
    expect(screen.getByTestId('composer-auto-send-switch')).toBeInTheDocument();
    expect(screen.getByText(/🇬🇧 อังกฤษ/)).toBeInTheDocument();
  });

  it('toggles auto_send_translated on click', () => {
    const onUpdateSettings = vi.fn();
    render(
      <ComposerAutoSendToggle
        isOpen={true}
        onClose={vi.fn()}
        room={mockRoom}
        onUpdateSettings={onUpdateSettings}
      />,
    );

    fireEvent.click(screen.getByTestId('composer-auto-send-switch'));
    expect(onUpdateSettings).toHaveBeenCalledWith({ auto_send_translated: true });
  });

  it('renders room settings button and triggers onOpenRoomSettings when clicked', () => {
    const onOpenRoomSettings = vi.fn();
    const onClose = vi.fn();
    render(
      <ComposerAutoSendToggle
        isOpen={true}
        onClose={onClose}
        room={mockRoom}
        onOpenRoomSettings={onOpenRoomSettings}
      />,
    );

    const roomSettingsBtn = screen.getByTestId('composer-open-room-settings-btn');
    expect(roomSettingsBtn).toBeInTheDocument();
    expect(roomSettingsBtn.textContent).toContain('ตั้งค่าภาษาของห้องแชท');

    fireEvent.click(roomSettingsBtn);
    expect(onClose).toHaveBeenCalled();
    expect(onOpenRoomSettings).toHaveBeenCalled();

    // Verify 'เสร็จสิ้น' close button
    const closeBtn = screen.getByTestId('composer-auto-send-close-btn');
    expect(closeBtn.textContent).toContain('เสร็จสิ้น');
  });
});

