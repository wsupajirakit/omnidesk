/**
 * [FIX-20260918-AUTOTRANSOR] "Is automatic translation on for this room?" — once.
 * ============================================================================
 * Owner's rule, 18/09: *"ถ้า room false = ไปอ่าน hook ไม่ใช่หยุดแปล หยุดเว้นว่า room
 * false แล้ว hook ก็ปิดเหมือนกันอีก อันนี้คือไม่แปล"* — either level may switch it ON,
 * and translation stops only when BOTH are off.
 *
 * | room \ hook | ON | OFF / ไม่ได้ตั้ง |
 * |---|---|---|
 * | `true`                    | ✅ | ✅ |
 * | `false` / `null` / ไม่มีค่า | ✅ | 🚫 |
 *
 * ## Why this file exists at all
 *
 * The backend already answers this and ships it as `effective_translate_*` on
 * every room payload. The dashboard was recomputing it anyway, in TWO places
 * with the same hand-written expression — `HeaderActions.tsx` and
 * `RoomTranslateModal.tsx` — and both encoded the OLD rule (room wins when set).
 * When the rule changed they would have needed finding and fixing individually,
 * and a miss would show a chat header saying one thing while the server did
 * another. One helper, both call sites, and the server still decides.
 * กติกาเดียว อยู่ที่เดียว · ฝั่ง BE เป็นคนตัดสินจริง
 *
 * ## The server's answer wins when it is there
 *
 * `effective_auto_translate` is the value the BACKEND computed from the same two
 * inputs, so it is preferred whenever present. The OR below is the fallback for
 * the moment before the settings fetch returns, and it is written to agree with
 * the backend rather than to have an opinion of its own.
 *
 * revert: delete this file and inline `Boolean(room?.auto_translate) ||
 * Boolean(room?.hook_auto_translate)` back at the two call sites.
 */

/** Only what the decision reads. Everything here may legitimately be absent. */
export interface RoomAutoTranslateFields {
  auto_translate?: boolean | null;
  hook_auto_translate?: boolean | null;
  effective_auto_translate?: boolean | null;
}

export const isAutoTranslateOn = (
  room: RoomAutoTranslateFields | null | undefined,
): boolean => {
  if (typeof room?.effective_auto_translate === 'boolean') {
    return room.effective_auto_translate;
  }
  return Boolean(room?.auto_translate) || Boolean(room?.hook_auto_translate);
};
