/**
 * [FEAT-20260919-SHOWORIGSRC] ข้อ 5 — the account-wide switch, and the third
 * state it has to keep visible.
 * ============================================================================
 * Owner, 19/09: *"ทำใหม่เป็น section ใหม่ต่อท้าย … ตั้งค่าสำหรับทุกห้อง · toggle ·
 * ปิด (ทุกห้อง) > save ค่า preference · เปิด (ทุกห้อง) > save ค่า preference"*
 * with *"default ค่า preference ใหม่นี้ คือ null ไม่ปิด ไม่เปิด"*.
 *
 * 🔴 THE HARD PART IS THAT `null` AND `false` LOOK IDENTICAL. Both render an off
 * switch and both produce no original text, so a bug that collapses them is
 * invisible on screen — and they are not the same thing: `null` is what every
 * account is in today, and it is the state a room's "ใช้การตั้งค่าของทุกห้อง"
 * falls through to. This suite pins the difference in the two places it can be
 * observed: the status line, and whether the clear control is offered.
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

import { AllRoomsShowOriginalSection } from '../components/chat/room-header/parts/room-translate/AllRoomsShowOriginalSection';
import { SHOW_ORIGINAL_ALL_ROOMS_EVENT } from '../services/chat/showOriginalText';
import { I18nProvider } from '../i18n';

const stored = (value: boolean | null) =>
  getInitialPreferences.mockReturnValue(
    value === null ? {} : { chat: { show_original_text_all_rooms: value } },
  );

const mount = (onChanged = vi.fn()) => {
  render(
    <I18nProvider>
      <AllRoomsShowOriginalSection onChanged={onChanged} />
    </I18nProvider>,
  );
  return { onChanged };
};

const toggle = () => screen.getByTestId('room-modal-all-rooms-toggle');
const status = () =>
  screen.getByTestId('room-modal-all-rooms-status').textContent ?? '';
const sentPatch = () =>
  (savePreferences.mock.calls.at(-1)?.[0] as any)?.chat
    ?.show_original_text_all_rooms;

beforeEach(() => {
  vi.clearAllMocks();
  getInitialPreferences.mockReturnValue(null);
});

describe('[ALLROOMS] it shows which of the three states it is in', () => {
  it('never set — the state every account starts in', () => {
    stored(null);
    mount();

    expect(toggle()).toHaveAttribute('aria-checked', 'false');
    expect(status()).toContain('ยังไม่ได้ตั้งค่า');
  });

  it('🔴 set to OFF looks the same on the switch but says something different', () => {
    stored(false);
    mount();

    expect(toggle()).toHaveAttribute('aria-checked', 'false');
    expect(status()).toContain('ปิด');
    expect(status()).not.toContain('ยังไม่ได้ตั้งค่า');
  });

  it('set to ON', () => {
    stored(true);
    mount();

    expect(toggle()).toHaveAttribute('aria-checked', 'true');
    expect(status()).toContain('เปิด');
  });
});

describe('[ALLROOMS] every press saves immediately, in both directions', () => {
  it('turning it on saves true', () => {
    stored(null);
    mount();

    fireEvent.click(toggle());

    expect(sentPatch()).toBe(true);
    expect(saveLocalPreference).toHaveBeenCalledTimes(1);
    expect(toggle()).toHaveAttribute('aria-checked', 'true');
  });

  it('🔴 turning it off saves an explicit false, not a removal', () => {
    // "off for every room" is a decision, and it has to outrank nothing — but it
    // must still be distinguishable from never having answered.
    stored(true);
    mount();

    fireEvent.click(toggle());

    expect(sentPatch()).toBe(false);
    expect(status()).toContain('ปิด');
    expect(status()).not.toContain('ยังไม่ได้ตั้งค่า');
  });

  it('there is no save button — each press is the save', () => {
    stored(null);
    mount();
    fireEvent.click(toggle());
    fireEvent.click(toggle());

    expect(
      savePreferences.mock.calls.map(
        (c) => (c[0] as any).chat.show_original_text_all_rooms,
      ),
    ).toEqual([true, false]);
  });
});

describe('[ALLROOMS] the way back to "never set"', () => {
  it('🔴 not offered when there is nothing to clear', () => {
    stored(null);
    mount();

    expect(screen.queryByTestId('room-modal-all-rooms-clear')).toBeNull();
  });

  it.each([[true], [false]])('offered once a value exists (%s)', (value) => {
    stored(value);
    mount();

    expect(screen.getByTestId('room-modal-all-rooms-clear')).toBeInTheDocument();
  });

  it('🔴 clearing sends a literal null — the only wire value that means unset', () => {
    stored(true);
    mount();

    fireEvent.click(screen.getByTestId('room-modal-all-rooms-clear'));

    const patch = savePreferences.mock.calls.at(-1)![0] as any;
    expect('show_original_text_all_rooms' in patch.chat).toBe(true);
    expect(patch.chat.show_original_text_all_rooms).toBeNull();
    // `undefined` would have been dropped by JSON.stringify and the PUT would
    // have carried nothing at all.
    expect(JSON.parse(JSON.stringify(patch)).chat).toHaveProperty(
      'show_original_text_all_rooms',
      null,
    );
  });

  it('after clearing, the control disappears and the status says so', () => {
    stored(false);
    mount();

    fireEvent.click(screen.getByTestId('room-modal-all-rooms-clear'));

    expect(screen.queryByTestId('room-modal-all-rooms-clear')).toBeNull();
    expect(status()).toContain('ยังไม่ได้ตั้งค่า');
  });
});

describe('[ALLROOMS] it tells everyone else', () => {
  it('🔴 calls back so step 2 above it repaints in the same tick', () => {
    stored(null);
    const { onChanged } = mount();

    fireEvent.click(toggle());

    expect(onChanged).toHaveBeenCalledWith(true);
  });

  it('🔴 and fires the window event the chat bubbles listen to', () => {
    // Without this the setting saves and nothing on screen changes until the
    // next unrelated re-render — which reads as "it did not save".
    stored(null);
    const seen: unknown[] = [];
    const onEvt = (e: Event) => seen.push((e as CustomEvent).detail?.value);
    window.addEventListener(SHOW_ORIGINAL_ALL_ROOMS_EVENT, onEvt);
    mount();

    fireEvent.click(toggle());
    window.removeEventListener(SHOW_ORIGINAL_ALL_ROOMS_EVENT, onEvt);

    expect(seen).toEqual([true]);
  });
});

describe('[ALLROOMS] the copy says whose setting it is', () => {
  it('🔴 it says every room and this account — not this room', () => {
    // Every other control in this modal writes to the open room. An operator who
    // read this one as room-scoped would change every conversation they have.
    stored(null);
    mount();
    const section =
      screen.getByTestId('room-modal-all-rooms-section').textContent ?? '';

    expect(section).toContain('ทุกห้อง');
    expect(section).toContain('บัญชี');
  });
});
