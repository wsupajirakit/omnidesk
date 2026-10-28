/**
 * [FEAT-20260918-AUTOSENDREMEMBER] "จำค่านี้ไว้" — one operator's answer, kept.
 * ============================================================================
 * Owner, 18/09: *"ติ๊กว่าจำค่านี้ไว้ เป็น checkbox ข้างๆ ยกเลิก … default ไม่จำ …
 * ถ้าจำแล้วไม่ต้องกดยืนยันแปลและส่งอีก … จำทุกห้อง เพราะเป็นค่าระดับของคน login คนนี้"*.
 *
 * ## It reuses the preferences system, it does not build one
 *
 * `services/admin/preferencesService` already owns per-user UI preferences: a
 * Mixed object on the user row, deep-merged, cached in localStorage so a reload
 * paints instantly, and written back with one PUT. Adding a key there costs no
 * schema change, no new endpoint, no new storage, and it follows the ACCOUNT
 * rather than the browser — which is what "ค่าระดับของคน login คนนี้" means.
 * ใช้ของที่มีอยู่ ไม่สร้างที่เก็บใหม่
 *
 * ## The default is "ask", and it has to survive everything
 *
 * A legacy account has no `preferences` at all; an account that never ticked the
 * box has no `chat` section; a browser with storage disabled reads nothing. All
 * three must mean the same thing: ASK. That is why every read funnels through
 * one function that only ever returns `true` for a literal stored `true` —
 * anything else, including a corrupt cache, falls back to asking. Asking one
 * extra time is harmless; skipping a confirm nobody asked to skip is not,
 * because the next press sends a translation to a customer with no review.
 * ค่าเริ่มต้น = ถาม · อ่านอะไรไม่ได้ก็ถาม
 *
 * ## Why it is not per room
 *
 * The confirm protects against one thing — a reply leaving in a language the
 * operator cannot read — and that risk does not change between rooms. An
 * operator who has accepted it once has accepted it. Per-room would also mean a
 * new room silently re-asks, which reads as a bug rather than a safeguard.
 *
 * revert: delete this file, the checkbox in `AutoSendConfirm.tsx` and the
 * `skipAutoSendConfirm()` check in `ChatInputBox.tsx`. The confirm then asks
 * every time, which is where this feature started.
 */
import {
  getInitialPreferences,
  saveLocalPreference,
  savePreferences,
} from '../admin/preferencesService';

/** Namespaced under `chat` so the section can grow without touching this file. */
export const AUTO_SEND_CONFIRM_PREF_PATH = 'chat.skip_auto_send_confirm';

/**
 * Has this operator asked not to be asked again?
 *
 * @returns `true` ONLY for a stored literal `true`. Absent, null, a legacy
 * account, a truthy-but-not-true value or unreadable storage all answer `false`
 * — meaning the confirm still shows.
 */
export const skipAutoSendConfirm = (): boolean => {
  try {
    const prefs = getInitialPreferences();
    return prefs?.chat?.skip_auto_send_confirm === true;
  } catch {
    return false; // unreadable ⇒ ask. Never the other way round.
  }
};

/**
 * Remember the answer for this account, on every room and every device.
 *
 * Writes the local caches SYNCHRONOUSLY first so the very next send already
 * knows — the send happens in the same tick as the confirm, long before a PUT
 * could return — and then persists to the server. A failed PUT is swallowed:
 * the operator's message must go out regardless, and the worst case is being
 * asked again on another device. เซฟไม่ผ่าน = ถามใหม่ ไม่ใช่ส่งพลาด
 */
export const rememberAutoSendConfirm = (skip: boolean): void => {
  const patch = { chat: { skip_auto_send_confirm: skip } };
  try {
    saveLocalPreference(patch);
  } catch {
    /* storage disabled — the server copy below still stands */
  }
  void savePreferences(patch).catch(() => undefined);
};
