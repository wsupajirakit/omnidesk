/**
 * [FEAT-20260919-SHOWORIGSRC] Step 2 on screen: the choice, the switch it governs,
 * and the line that says what will actually happen.
 * ============================================================================
 * The rule itself is proved in `showOriginalText.value.test.ts`. This suite is
 * about the part a rule cannot check — that the controls say the same thing the
 * rule decides, in every one of the states an operator can land in.
 *
 * Four failures this is written to catch, all of which produce a screen that
 * lies rather than a crash, so nothing else would notice:
 *   1. the switch bound to the RESOLVED value instead of the room's own — a room
 *      following an account-wide "เปิด" would render ON and turning it "off"
 *      would change nothing;
 *   2. BOTH controls on screen at once — the state the owner rejected on sight,
 *      because it reads as two switches for one setting;
 *   3. neither control on screen, which a careless `&&` pair would produce and
 *      which no other suite would notice;
 *   4. the badge and the body disagreeing about the same room.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { getInitialPreferences, saveLocalPreference, savePreferences } =
  vi.hoisted(() => ({
    getInitialPreferences: vi.fn<() => any>(() => null),
    saveLocalPreference: vi.fn<(p: any) => any>(),
    savePreferences: vi.fn<(p: any) => Promise<any>>(() => Promise.resolve({})),
  }));

vi.mock('../services/admin/preferencesService', () => ({
  getInitialPreferences,
  saveLocalPreference,
  savePreferences,
}));

import { RoomTranslateModal } from '../components/chat/room-header/parts/room-translate/RoomTranslateModal';
import { I18nProvider } from '../i18n';

const mount = (room: any, onUpdateSettings = vi.fn()) => {
  const utils = render(
    <I18nProvider>
      <RoomTranslateModal
        isOpen
        onClose={vi.fn()}
        room={room}
        onUpdateSettings={onUpdateSettings}
      />
    </I18nProvider>,
  );
  fireEvent.click(screen.getByTestId('room-wizard-step-2-btn'));
  return { ...utils, onUpdateSettings };
};

const setAllRooms = (value: boolean | null) =>
  getInitialPreferences.mockReturnValue(
    value === null ? {} : { chat: { show_original_text_all_rooms: value } },
  );

const room = (over: Record<string, unknown> = {}) => ({
  _id: 'room-1',
  translate_lang: 'en',
  auto_translate: false,
  auto_send_translated: false,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  getInitialPreferences.mockReturnValue(null);
});

describe('[SHOWORIGSRC] the choice sits at the top and shows which side is active', () => {
  it('a room with no column defaults to "ใช้การตั้งค่าของทุกห้อง"', () => {
    mount(room());

    expect(
      screen.getByTestId('room-modal-show-original-source-all'),
    ).toHaveAttribute('aria-checked', 'true');
    expect(
      screen.getByTestId('room-modal-show-original-source-room'),
    ).toHaveAttribute('aria-checked', 'false');
  });

  it('a room that claims the decision shows "ใช้ค่าเฉพาะห้องนี้"', () => {
    mount(room({ show_original_text_source: 'room' }));

    expect(
      screen.getByTestId('room-modal-show-original-source-room'),
    ).toHaveAttribute('aria-checked', 'true');
  });

  it('🔴 the choice is rendered ABOVE the control it reveals — room side', () => {
    // Owner, 19/09: "ขึ้นบนสุดค่าใหม่". A control that decides whether another
    // control matters has to be met first.
    mount(room({ show_original_text_source: 'room' }));
    const choice = screen.getByTestId('room-modal-show-original-source-all');
    const toggle = screen.getByTestId('room-modal-show-original-toggle');

    expect(
      choice.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('🔴 …and above the one it reveals on the all-rooms side too', () => {
    mount(room());
    const choice = screen.getByTestId('room-modal-show-original-source-all');
    const panel = screen.getByTestId('room-modal-all-rooms-section');

    expect(
      choice.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('picking a side saves it, and saves nothing else', () => {
    const { onUpdateSettings } = mount(room());

    fireEvent.click(screen.getByTestId('room-modal-show-original-source-room'));

    expect(onUpdateSettings).toHaveBeenCalledTimes(1);
    expect(onUpdateSettings).toHaveBeenCalledWith({
      show_original_text_source: 'room',
    });
  });

  it('…and switching back saves the other side', () => {
    const { onUpdateSettings } = mount(
      room({ show_original_text_source: 'room' }),
    );

    fireEvent.click(screen.getByTestId('room-modal-show-original-source-all'));

    expect(onUpdateSettings).toHaveBeenCalledWith({
      show_original_text_source: 'all_rooms',
    });
  });
});

describe('[SHOWORIGSRC] one control at a time — the chosen option reveals its own', () => {
  /* Owner, 19/09, after seeing the first build: the account-wide control belongs
     INSIDE step 2, shown only when "ใช้การตั้งค่าของทุกห้อง" is picked, and the
     room's switch only when "ใช้ค่าเฉพาะห้องนี้" is. The build before this showed
     both — one of them greyed out — which read as two switches for one setting.
     ติ๊กอันไหน เห็นอันนั้น */

  it('🔴 following the shared value: the account control is there, the room switch is NOT', () => {
    mount(room({ show_original_text: true }));

    expect(screen.getByTestId('room-modal-all-rooms-section')).toBeInTheDocument();
    expect(screen.queryByTestId('room-modal-show-original-toggle')).toBeNull();
  });

  it('🔴 deciding for itself: the room switch is there, the account control is NOT', () => {
    mount(room({ show_original_text: true, show_original_text_source: 'room' }));

    expect(screen.getByTestId('room-modal-show-original-toggle')).toBeInTheDocument();
    expect(screen.queryByTestId('room-modal-all-rooms-section')).toBeNull();
  });

  it('🔴 never both at once, in either state', () => {
    // The exact thing the owner rejected.
    for (const source of [undefined, 'all_rooms', 'room'] as const) {
      const { unmount } = render(
        <I18nProvider>
          <RoomTranslateModal
            isOpen
            onClose={vi.fn()}
            room={room({ show_original_text_source: source }) as any}
            onUpdateSettings={vi.fn()}
          />
        </I18nProvider>,
      );
      fireEvent.click(screen.getByTestId('room-wizard-step-2-btn'));

      const both =
        Number(Boolean(screen.queryByTestId('room-modal-show-original-toggle'))) +
        Number(Boolean(screen.queryByTestId('room-modal-all-rooms-section')));
      expect(both).toBe(1);
      unmount();
    }
  });

  it('🔴 the room switch shows the ROOM value, not the resolved one', () => {
    // Binding it to the resolved value would render ON here, and "turning it
    // off" would then change nothing the operator can see.
    setAllRooms(true);
    mount(room({ show_original_text: false, show_original_text_source: 'room' }));

    expect(screen.getByTestId('room-modal-show-original-toggle')).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('the room switch writes the room value', () => {
    const { onUpdateSettings } = mount(
      room({ show_original_text: false, show_original_text_source: 'room' }),
    );

    fireEvent.click(screen.getByTestId('room-modal-show-original-toggle'));

    expect(onUpdateSettings).toHaveBeenCalledWith({ show_original_text: true });
  });

  it('🔴 hiding the room switch does NOT clear the room value', () => {
    /* The value is still on the room while it is not rendered — switching back
       must bring it back exactly as it was, and the only write in that direction
       is the source change itself. ซ่อนแล้วต้องไม่ล้างค่า */
    const { onUpdateSettings } = mount(room({ show_original_text: true }));

    fireEvent.click(screen.getByTestId('room-modal-show-original-source-room'));

    expect(onUpdateSettings).toHaveBeenCalledTimes(1);
    expect(onUpdateSettings).toHaveBeenCalledWith({
      show_original_text_source: 'room',
    });
  });
});

describe('[SHOWORIGSRC] the "ตอนนี้" line states the resolved answer', () => {
  const effective = () =>
    screen.getByTestId('room-modal-show-original-effective').textContent ?? '';

  it.each([
    ['ห้องยกให้ค่ากลาง · ค่ากลางเปิด', { show_original_text: false }, true, true],
    ['ห้องยกให้ค่ากลาง · ค่ากลางปิด', { show_original_text: true }, false, false],
    ['🔴 ห้องยกให้ค่ากลาง · ค่ากลางยังไม่ตั้ง', { show_original_text: true }, null, false],
    ['ห้องตัดสินเอง · เปิด', { show_original_text: true, show_original_text_source: 'room' }, false, true],
    ['ห้องตัดสินเอง · ปิด', { show_original_text: false, show_original_text_source: 'room' }, true, false],
  ] as const)('%s', (_label, over, allRooms, expectOn) => {
    setAllRooms(allRooms);
    mount(room(over));

    expect(effective()).toContain(
      expectOn ? 'แสดงข้อความต้นฉบับควบคู่' : 'แสดงเฉพาะคำแปล',
    );
  });

  it('🔴 the collapsed badge agrees with it — one value, two places', () => {
    setAllRooms(true);
    mount(room({ show_original_text: false }));
    // step 2 collapsed header badge
    const badge = screen.getByTestId('room-wizard-step-2-btn').textContent ?? '';

    expect(badge).toContain('เปิด');
    expect(effective()).toContain('แสดงข้อความต้นฉบับควบคู่');
  });
});

describe('[SHOWORIGSRC] the hint under "ใช้การตั้งค่าของทุกห้อง" names the shared value', () => {
  it.each([
    [true, 'เปิด'],
    [false, 'ปิด'],
    [null, 'ยังไม่ได้ตั้ง'],
  ] as const)('shared = %s', (value, expected) => {
    setAllRooms(value);
    mount(room());

    expect(
      screen.getByTestId('room-modal-show-original-source-all').textContent,
    ).toContain(expected);
  });
});
