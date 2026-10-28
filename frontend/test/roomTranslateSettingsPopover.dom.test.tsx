/**
 * [FEAT-20260918-ROOMTRANS] RoomTranslateSettingsPopover & TranslatedBubble DOM Spec
 * =================================================================================
 * Verifies:
 *  1. Header button "แปลภาษาออโต้" invokes onTranslateLatest.
 *  2. Loading indicator displays when isTranslating is true.
 *  3. Popover opens on chevron click and displays the 3 controls:
 *     - translate_lang selector (7 languages)
 *     - show_original_text toggle
 *     - auto_translate toggle
 *  4. Selecting options fires onUpdateRoomSettings with appropriate payloads.
 *  5. TranslatedBubble conditionally renders original text based on showOriginalText.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nProvider } from '../i18n';
import { RoomTranslateSettingsPopover } from '../components/chat/room-header/parts/room-translate/RoomTranslateSettingsPopover';
import { TranslatedBubble } from '../components/chat/TranslatedBubble';
import type { ChatRoom } from '../services/chat';

describe('[FEAT-20260918-ROOMTRANS] RoomTranslateSettingsPopover', () => {
  const mockRoom: ChatRoom = {
    _id: 'room-1',
    line_user_id: 'U123456',
    hook_id: 'hook-1',
    translate_lang: 'th',
    show_original_text: false,
    auto_translate: false,
  } as unknown as ChatRoom;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders "แปลภาษาออโต้" button and triggers onTranslateLatest on click', () => {
    const onTranslateLatest = vi.fn();
    render(
      <I18nProvider>
        <RoomTranslateSettingsPopover
          room={mockRoom}
          onTranslateLatest={onTranslateLatest}
          isTranslating={false}
          onUpdateRoomSettings={vi.fn()}
        />
      </I18nProvider>,
    );

    const btn = screen.getByRole('button', { name: /^แปลภาษา$/i });
    expect(btn).toBeTruthy();

    fireEvent.click(btn);
    expect(onTranslateLatest).toHaveBeenCalledTimes(1);
  });

  it('disables button and shows spinning icon when isTranslating is true', () => {
    const onTranslateLatest = vi.fn();
    const { container } = render(
      <I18nProvider>
        <RoomTranslateSettingsPopover
          room={mockRoom}
          onTranslateLatest={onTranslateLatest}
          isTranslating={true}
          onUpdateRoomSettings={vi.fn()}
        />
      </I18nProvider>,
    );

    const btn = screen.getByRole('button', { name: /^แปลภาษา$/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);

    const spinner = container.querySelector('.animate-spin');
    expect(spinner).toBeTruthy();

    fireEvent.click(btn);
    expect(onTranslateLatest).not.toHaveBeenCalled();
  });

  it('opens popover on chevron click and allows changing translate_lang', () => {
    const onUpdateRoomSettings = vi.fn();
    render(
      <I18nProvider>
        <RoomTranslateSettingsPopover
          room={mockRoom}
          onTranslateLatest={vi.fn()}
          onUpdateRoomSettings={onUpdateRoomSettings}
        />
      </I18nProvider>,
    );

    const chevronBtn = screen.getByRole('button', { name: /ตั้งค่าการแปลภาษา/i });
    fireEvent.click(chevronBtn);

    const select = screen.getByRole('combobox');
    expect(select).toBeTruthy();

    fireEvent.change(select, { target: { value: 'zh-Hans' } });
    expect(onUpdateRoomSettings).toHaveBeenCalledWith({ translate_lang: 'zh-Hans' });
  });

  it('toggles show_original_text and auto_translate in popover', () => {
    const onUpdateRoomSettings = vi.fn();
    render(
      <I18nProvider>
        <RoomTranslateSettingsPopover
          room={mockRoom}
          onTranslateLatest={vi.fn()}
          onUpdateRoomSettings={onUpdateRoomSettings}
        />
      </I18nProvider>,
    );

    const chevronBtn = screen.getByRole('button', { name: /ตั้งค่าการแปลภาษา/i });
    fireEvent.click(chevronBtn);

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBe(2);

    /* First checkbox: show_original_text.
       [FEAT-20260919-SHOWORIGSRC] It now writes BOTH fields in one call. Ticking
       a per-room box has to claim the per-room decision as well, or the value
       would be stored on a room that is still following the account-wide setting
       and the tick would appear to do nothing. ติ๊ก = ห้องนี้ขอตัดสินเอง */
    fireEvent.click(checkboxes[0]);
    expect(onUpdateRoomSettings).toHaveBeenCalledWith({
      show_original_text: true,
      show_original_text_source: 'room',
    });

    // Second checkbox: auto_translate
    fireEvent.click(checkboxes[1]);
    expect(onUpdateRoomSettings).toHaveBeenCalledWith({ auto_translate: true });
  });
});

describe('[FEAT-20260918-ROOMTRANS] TranslatedBubble showOriginalText', () => {
  const translation = {
    lang: 'th',
    text: 'สวัสดีครับ',
    from: 'en',
    to: 'th',
  };

  it('renders both original and translated text when showOriginalText is true or default', () => {
    const { container } = render(
      <I18nProvider>
        <TranslatedBubble
          original="Hello there"
          translation={translation}
          showOriginalText={true}
        />
      </I18nProvider>,
    );

    expect(container.textContent).toContain('Hello there');
    expect(container.textContent).toContain('สวัสดีครับ');
    expect(container.querySelector('.border-t')).toBeTruthy();
  });

  it('hides original text and divider when showOriginalText is false', () => {
    const { container } = render(
      <I18nProvider>
        <TranslatedBubble
          original="Hello there"
          translation={translation}
          showOriginalText={false}
        />
      </I18nProvider>,
    );

    expect(container.textContent).not.toContain('Hello there');
    expect(container.textContent).toContain('สวัสดีครับ');
    expect(container.querySelector('.border-t')).toBeNull();
  });
});
