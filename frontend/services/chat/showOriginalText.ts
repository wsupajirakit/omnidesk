/**
 * [FEAT-20260919-SHOWORIGSRC] "แสดงข้อความต้นฉบับ" — one rule, and the only place
 * the account-wide value is read or written.
 * ============================================================================
 * Owner, 19/09: *"เพิ่ม flag ใหม่ติดห้อง เก็บ flag ว่าใช้สำหรับห้องนี้ ค่าแบบทุกห้อง
 * หรือใช้ค่าเฉพาะห้อง"* … *"default ค่าใหม่คือ ใช้แบบทุกห้อง (preference)"* …
 * *"ถ้าทั้งสองไม่มีค่าเลย ก็คือปิดการแสดง original ห้ามพังเด็ดขาด เพราะอัปเดตแล้ว
 * บางคนก็ไม่ตั้ง"*.
 *
 * ## Two settings, and which one wins
 *
 * | ห้องเลือก | ค่าทุกห้อง = เปิด | = ปิด | = ยังไม่ตั้ง |
 * |---|---|---|---|
 * | เฉพาะห้องนี้ + เปิด | เปิด | เปิด | เปิด |
 * | เฉพาะห้องนี้ + ปิด   | ปิด  | ปิด  | ปิด |
 * | ใช้ค่าทุกห้อง (ค่าเริ่มต้น) | เปิด | ปิด | **ปิด** |
 *
 * The room wins when it has been configured — owner's choice on 19/09, taken
 * after the first draft had the account value win. That draft could not ship: a
 * room whose badge reads "ปิด" would still have shown the original text, which
 * is a screen that lies about its own setting. It is the same class of bug as
 * yesterday's "OA เปิดแปลแต่ไม่แปล", and the lesson from it was that a label
 * must describe what actually happens. ป้ายบนจอต้องตรงกับของจริง
 *
 * 🔴 THE BOTTOM-RIGHT CELL IS THE ONE THAT MATTERS. Nobody has configured
 * anything the moment this ships — 20 of 21 rooms in the reference database do
 * not even carry the column — so almost every room on the first load lands
 * there and must answer OFF, exactly as it does today. Every fallback in this
 * file therefore points at `false`, and nothing in it can return `true` by
 * accident. ไม่ตั้งอะไรเลย = ปิด เท่าเดิม
 *
 * ## Why the two halves live in different places
 *
 * The room's choice is stored on the room (`show_original_text_source`, backend).
 * The account-wide value is a preference on the LOGGED-IN USER, so it is not the
 * backend's to resolve: two operators in the same room can legitimately see
 * different things. That is why `resolveShowOriginalText` is on this side and
 * `room-translate-settings.ts` deliberately ships no `effective_` field for it.
 *
 * revert: delete this file, drop the source column's readers, and point callers
 * back at `Boolean(room.show_original_text)`. That is the 18/09 behaviour.
 */
import {
  getInitialPreferences,
  saveLocalPreference,
  savePreferences,
} from '../admin/preferencesService';

/** The two values the room's `show_original_text_source` column can hold. */
export type ShowOriginalTextSource = 'all_rooms' | 'room';

/** Namespaced under `chat`, beside `chat.skip_auto_send_confirm`. */
export const SHOW_ORIGINAL_ALL_ROOMS_PREF_PATH =
  'chat.show_original_text_all_rooms';

/**
 * Fired after the account-wide value is written, so every open screen re-reads
 * it at once.
 *
 * The setting is changed inside the room modal but decides what the CHAT BUBBLES
 * render, and those live in a different component with no shared state — the
 * same shape as the existing `tc:room-translate-settings-updated`. Dispatching
 * from the single write function rather than from the modal means a future
 * second control cannot forget to announce itself. ประกาศจากจุดเขียนจุดเดียว
 */
export const SHOW_ORIGINAL_ALL_ROOMS_EVENT = 'tc:show-original-all-rooms-changed';

/**
 * Normalise whatever arrived from the API into one of the two known values.
 *
 * Only a literal `'room'` means "this room decides". Absent, `null`, a legacy
 * row that predates the column, or a value the enum does not know all answer
 * `'all_rooms'` — falling back to the shared setting, which itself starts unset
 * and therefore renders as off.
 */
export const normalizeShowOriginalSource = (
  raw: unknown,
): ShowOriginalTextSource => (raw === 'room' ? 'room' : 'all_rooms');

/**
 * The operator's account-wide answer.
 *
 * @returns `true` / `false` when they have actually chosen one, and `null` for
 * "never set" — which includes a legacy account with no `preferences` at all, an
 * account with no `chat` section, a browser with storage disabled, and any
 * stored value that is not a boolean. Three different kinds of nothing have to
 * mean the same thing here, so the check is for the boolean type rather than for
 * truthiness. อ่านไม่ได้ = ยังไม่ตั้ง ไม่ใช่ "เปิด"
 */
export const readShowOriginalAllRooms = (): boolean | null => {
  try {
    const value = getInitialPreferences()?.chat?.show_original_text_all_rooms;
    return typeof value === 'boolean' ? value : null;
  } catch {
    return null; // unreadable ⇒ not set. Never the other way round.
  }
};

/**
 * Save the account-wide answer, on every room and every device.
 *
 * Writes the local caches synchronously first so the room that is already open
 * repaints from the same tick, then persists. A failed PUT is swallowed: the
 * worst case is the operator seeing their old preference on another device,
 * which is a display difference, not a message going out wrong.
 *
 * `null` is a real value to send, not a no-op — it is how "เลิกตั้งค่า" is
 * expressed, and it survives the backend deep-merge (`users-prefs.service.ts`
 * returns the patch as-is when the patch is `null`). `undefined` could not be
 * used for this: `JSON.stringify` drops it and the PUT would carry nothing.
 */
export const rememberShowOriginalAllRooms = (value: boolean | null): void => {
  const patch = { chat: { show_original_text_all_rooms: value } };
  try {
    saveLocalPreference(patch);
  } catch {
    /* storage disabled — the server copy below still stands */
  }
  /* Announced BEFORE the network call, from the same tick as the local write:
     listeners re-read the cache that was just updated, so the bubbles repaint
     with the switch rather than a round-trip later. */
  try {
    window.dispatchEvent(
      new CustomEvent(SHOW_ORIGINAL_ALL_ROOMS_EVENT, { detail: { value } }),
    );
  } catch {
    /* no window (SSR / a bare test runner) — nothing to notify */
  }
  void savePreferences(patch).catch(() => undefined);
};

export interface ShowOriginalTextInput {
  /** The room's `show_original_text_source`, raw from the API. */
  source?: unknown;
  /** The room's own `show_original_text`, raw from the API. */
  roomValue?: unknown;
  /**
   * The account-wide answer. Optional so callers that have already read it can
   * pass it in (and tests can drive it); omitted means "read it now".
   */
  allRooms?: boolean | null;
}

/**
 * THE decision. Every screen that renders original text must come through here —
 * the room modal, the header popover and the bubble itself — so the three cannot
 * drift into telling the operator different stories about the same room.
 */
export const resolveShowOriginalText = ({
  source,
  roomValue,
  allRooms,
}: ShowOriginalTextInput): boolean => {
  if (normalizeShowOriginalSource(source) === 'room') {
    return roomValue === true;
  }
  const shared = allRooms === undefined ? readShowOriginalAllRooms() : allRooms;
  /* `=== true` and not `Boolean(shared)`: `null` must read as "not set", and the
     only value that turns this on is one the operator literally chose. */
  return shared === true;
};
