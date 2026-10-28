/**
 * [FEAT-20260919-SHOWORIGSRC] Every cell of the room × account grid, plus the
 * cell that must not move.
 * ============================================================================
 * The rule under test decides whether a customer's original text is shown next
 * to its translation. It has two inputs that live in different places (a column
 * on the room, a preference on the logged-in account) and one of them is
 * tri-state, so the combinations are easy to reason about wrongly and cheap to
 * enumerate — which is what this does.
 *
 * 🔴 THE CASE THIS SUITE EXISTS FOR is "nothing configured anywhere". That is
 * what every room looks like the moment this ships (20 of 21 rooms in the
 * reference database do not carry the column at all), and it must answer OFF —
 * identical to the behaviour before this feature. Owner, 19/09: *"ถ้าทั้งสอง
 * ไม่มีค่าเลย ก็คือปิดการแสดง original ห้ามพังเด็ดขาด"*.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getInitialPreferences, saveLocalPreference, savePreferences } =
  vi.hoisted(() => ({
    getInitialPreferences: vi.fn<() => any>(() => null),
    saveLocalPreference: vi.fn<(patch: any) => any>(),
    savePreferences: vi.fn<(patch: any) => Promise<any>>(() =>
      Promise.resolve({}),
    ),
  }));

vi.mock('../services/admin/preferencesService', () => ({
  getInitialPreferences,
  saveLocalPreference,
  savePreferences,
}));

import {
  normalizeShowOriginalSource,
  readShowOriginalAllRooms,
  rememberShowOriginalAllRooms,
  resolveShowOriginalText,
  SHOW_ORIGINAL_ALL_ROOMS_PREF_PATH,
} from '../services/chat/showOriginalText';

beforeEach(() => {
  vi.clearAllMocks();
  getInitialPreferences.mockReturnValue(null);
});

describe('[SHOWORIGSRC] 🔴 nothing configured anywhere = OFF', () => {
  it('a room that predates the column, on an account that never chose', () => {
    // This is the whole installed base on day one. It must behave exactly as it
    // did yesterday: translation only, no original.
    expect(resolveShowOriginalText({})).toBe(false);
  });

  it('…and it stays off even if the room carries a stale `true` boolean', () => {
    /* A room configured before 19/09 holds `show_original_text: true` but no
       source column. The column is what grants that boolean authority, so
       without it the room follows the shared value — which is unset ⇒ off.
       This is a deliberate, documented behaviour change for such rooms. */
    expect(resolveShowOriginalText({ roomValue: true })).toBe(false);
  });

  it('an account with preferences but no `chat` section', () => {
    getInitialPreferences.mockReturnValue({ ui: { theme: 'light' } });

    expect(resolveShowOriginalText({})).toBe(false);
  });

  it('an account with a `chat` section that has other keys only', () => {
    getInitialPreferences.mockReturnValue({
      chat: { skip_auto_send_confirm: true },
    });

    expect(resolveShowOriginalText({})).toBe(false);
  });
});

describe('[SHOWORIGSRC] the full grid — room choice × account value', () => {
  const GRID: Array<{
    source: unknown;
    roomValue: unknown;
    allRooms: boolean | null;
    expected: boolean;
    why: string;
  }> = [
    // ── source = 'room' : the room decides, the account is ignored ──────────
    { source: 'room', roomValue: true, allRooms: true, expected: true, why: 'ห้องเปิด · ค่ากลางเปิด' },
    { source: 'room', roomValue: true, allRooms: false, expected: true, why: '🔴 ห้องเปิด ชนะค่ากลางที่ปิด' },
    { source: 'room', roomValue: true, allRooms: null, expected: true, why: 'ห้องเปิด · ค่ากลางยังไม่ตั้ง' },
    { source: 'room', roomValue: false, allRooms: true, expected: false, why: '🔴 ห้องปิด ชนะค่ากลางที่เปิด' },
    { source: 'room', roomValue: false, allRooms: false, expected: false, why: 'ปิดทั้งคู่' },
    { source: 'room', roomValue: false, allRooms: null, expected: false, why: 'ห้องปิด · ค่ากลางยังไม่ตั้ง' },
    // a room switched to 'room' before its own boolean was ever written
    { source: 'room', roomValue: undefined, allRooms: true, expected: false, why: 'ห้องเลือกเองแต่ยังไม่มีค่า = ปิด' },
    /* ⚠️ `roomValue` arrives from the API as `unknown` — nothing between Mongo and
       here guarantees it is a boolean. A `Boolean()` coercion would turn every one
       of these ON; `=== true` keeps them off. A mutation swapping the two stayed
       GREEN until these three rows existed, which means the check was measuring
       nothing for exactly the input it was written to guard. ค่าที่ไม่ใช่ boolean ต้องไม่เปิด */
    { source: 'room', roomValue: 'true', allRooms: null, expected: false, why: '🔴 string "true" ไม่ใช่ true' },
    { source: 'room', roomValue: 1, allRooms: null, expected: false, why: '🔴 เลข 1 ไม่ใช่ true' },
    { source: 'room', roomValue: 'yes', allRooms: null, expected: false, why: '🔴 string อะไรก็ไม่ใช่ true' },

    // ── source = 'all_rooms' : the account decides ──────────────────────────
    { source: 'all_rooms', roomValue: false, allRooms: true, expected: true, why: 'ตามค่ากลาง เปิด' },
    { source: 'all_rooms', roomValue: true, allRooms: false, expected: false, why: '🔴 ค่าห้องถูกเมิน เพราะห้องยกให้ค่ากลาง' },
    { source: 'all_rooms', roomValue: true, allRooms: null, expected: false, why: '🔴 ยกให้ค่ากลางที่ยังไม่ตั้ง = ปิด' },
    { source: 'all_rooms', roomValue: false, allRooms: null, expected: false, why: 'ปิดทุกทาง' },

    // ── anything that is not exactly 'room' behaves as 'all_rooms' ──────────
    { source: undefined, roomValue: true, allRooms: true, expected: true, why: 'แถวเก่าไม่มีคอลัมน์ → ตามค่ากลาง' },
    { source: null, roomValue: true, allRooms: false, expected: false, why: 'null → ตามค่ากลาง' },
    { source: '', roomValue: true, allRooms: null, expected: false, why: 'empty string → ตามค่ากลาง' },
    { source: 'ROOM', roomValue: true, allRooms: false, expected: false, why: '🔴 ตัวพิมพ์ใหญ่ไม่นับ — ต้องตรงเป๊ะ' },
    { source: 'rooms', roomValue: true, allRooms: false, expected: false, why: 'สะกดใกล้เคียงไม่นับ' },
    { source: true, roomValue: true, allRooms: false, expected: false, why: 'ค่าผิดชนิด → ตามค่ากลาง' },
  ];

  it.each(GRID)(
    'source=$source room=$roomValue all=$allRooms → $expected ($why)',
    ({ source, roomValue, allRooms, expected }) => {
      expect(resolveShowOriginalText({ source, roomValue, allRooms })).toBe(
        expected,
      );
    },
  );

  it('covers every combination it claims to', () => {
    expect(GRID).toHaveLength(20);
  });

  it('🔴 a non-boolean account value does not turn it on either', () => {
    /* The signature says `boolean | null`, so this can only arrive from a caller
       that lost its types — a raw preferences blob passed straight through, say.
       Same reasoning as the room rows above: the coercion must not be the
       forgiving kind. Without this row, swapping `shared === true` for
       `Boolean(shared)` survives. */
    expect(
      resolveShowOriginalText({
        source: 'all_rooms',
        allRooms: 'true' as unknown as boolean,
      }),
    ).toBe(false);
  });
});

describe('[SHOWORIGSRC] the account value is only ever a literal boolean', () => {
  it.each([
    ['ยังไม่มี preferences เลย', null, null],
    ['ไม่มี chat section', { ui: {} }, null],
    ['ตั้ง true', { chat: { show_original_text_all_rooms: true } }, true],
    ['ตั้ง false', { chat: { show_original_text_all_rooms: false } }, false],
    ['เคยตั้งแล้วล้างเป็น null', { chat: { show_original_text_all_rooms: null } }, null],
    ['🔴 string "true" ไม่นับ', { chat: { show_original_text_all_rooms: 'true' } }, null],
    ['🔴 เลข 1 ไม่นับ', { chat: { show_original_text_all_rooms: 1 } }, null],
  ])('%s', (_label, prefs, expected) => {
    getInitialPreferences.mockReturnValue(prefs);

    expect(readShowOriginalAllRooms()).toBe(expected);
  });

  it('🔴 storage that throws reads as "not set", never as on', () => {
    getInitialPreferences.mockImplementation(() => {
      throw new Error('localStorage disabled');
    });

    expect(readShowOriginalAllRooms()).toBeNull();
    expect(resolveShowOriginalText({})).toBe(false);
  });
});

describe('[SHOWORIGSRC] saving the account value', () => {
  it.each([[true], [false], [null]] as const)('writes %s to both caches', (value) => {
    rememberShowOriginalAllRooms(value);

    const patch = { chat: { show_original_text_all_rooms: value } };
    expect(saveLocalPreference).toHaveBeenCalledWith(patch);
    expect(savePreferences).toHaveBeenCalledWith(patch);
  });

  it('🔴 null is sent, not skipped — it is how "เลิกตั้งค่า" travels', () => {
    rememberShowOriginalAllRooms(null);

    const sent = savePreferences.mock.calls[0]![0] as any;
    expect('show_original_text_all_rooms' in sent.chat).toBe(true);
    expect(sent.chat.show_original_text_all_rooms).toBeNull();
    // and it must survive JSON — `undefined` would not have
    expect(JSON.parse(JSON.stringify(sent)).chat).toHaveProperty(
      'show_original_text_all_rooms',
      null,
    );
  });

  it('a dead network does not throw at the caller', () => {
    savePreferences.mockReturnValue(Promise.reject(new Error('offline')) as any);

    expect(() => rememberShowOriginalAllRooms(true)).not.toThrow();
  });

  it('local storage failing still attempts the server write', () => {
    saveLocalPreference.mockImplementation(() => {
      throw new Error('quota');
    });

    expect(() => rememberShowOriginalAllRooms(true)).not.toThrow();
    expect(savePreferences).toHaveBeenCalledTimes(1);
  });

  it('the preference path is the documented one', () => {
    expect(SHOW_ORIGINAL_ALL_ROOMS_PREF_PATH).toBe(
      'chat.show_original_text_all_rooms',
    );
  });
});

describe('[SHOWORIGSRC] normalizeShowOriginalSource', () => {
  it.each([
    ['room', 'room'],
    ['all_rooms', 'all_rooms'],
    [undefined, 'all_rooms'],
    [null, 'all_rooms'],
    ['', 'all_rooms'],
    ['Room', 'all_rooms'],
    [0, 'all_rooms'],
    [{}, 'all_rooms'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeShowOriginalSource(raw)).toBe(expected);
  });
});

describe('[SHOWORIGSRC] it reads the account value itself when not handed one', () => {
  it('omitting `allRooms` falls through to the preference', () => {
    getInitialPreferences.mockReturnValue({
      chat: { show_original_text_all_rooms: true },
    });

    expect(resolveShowOriginalText({ source: 'all_rooms' })).toBe(true);
  });

  it('passing `null` explicitly means "not set" and does NOT re-read', () => {
    getInitialPreferences.mockReturnValue({
      chat: { show_original_text_all_rooms: true },
    });

    expect(
      resolveShowOriginalText({ source: 'all_rooms', allRooms: null }),
    ).toBe(false);
    expect(getInitialPreferences).not.toHaveBeenCalled();
  });
});
