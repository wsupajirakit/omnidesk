/**
 * [FIX-20260918-LANGSPLIT] The room/hook precedence, written once.
 * ===========================================================================
 * Owner's rule, 18/09: *"อ่านของ room ก่อนค่อยไปเช็คของ hook"* — the room answers
 * first, the hook only fills what the room left unset. That rule was copied into
 * three separate blocks of `chat.service.ts` (the chat-open payload, the GET and
 * the PATCH response) plus a fourth on the dashboard, so changing it meant
 * finding four places and getting all four right. It lives here now.
 *
 * ## `auto_translate` — either level may switch it ON
 *
 * 🔴 CHANGED 18/09, owner's rule: *"ถ้า room false = ไปอ่าน hook ไม่ใช่หยุดแปล
 * หยุดเว้นว่า room false แล้ว hook ก็ปิดเหมือนกันอีก อันนี้คือไม่แปล"*.
 *
 * So the answer is `room OR hook`, and a room's `false` is NOT an override — it
 * reads as "this room asks for nothing", exactly like `null`. Translation stops
 * only when BOTH levels are off:
 *
 * | room \ hook | ON | OFF / absent |
 * |---|---|---|
 * | `true`            | ✅ แปล | ✅ แปล |
 * | `false`           | ✅ แปล | 🚫 ไม่แปล |
 * | `null` / ไม่มีคอลัมน์ | ✅ แปล | 🚫 ไม่แปล |
 *
 * ⚠️ THE CONSEQUENCE, STATED PLAINLY: there is no way to silence ONE room while
 * its OA has translation on. That is the trade the rule makes — turning the OA
 * on means every room under it translates. If per-room muting is ever wanted,
 * it needs a THIRD state that means "off on purpose" (and a control that can
 * send it), not a change to this function. ปิดรายห้องทั้งที่ OA เปิด = ทำไม่ได้ โดยตั้งใจ
 *
 * The earlier version treated `false` as an override that beat the hook. It was
 * the direct cause of "ตั้งค่าระดับ OA ให้แปล แต่มันไม่แปล" on 18/09: the room had
 * been saved as `false`, so the OA switch could never reach it.
 *
 * `translate_lang` is unchanged — a STRING where empty/`null` means unset, so
 * `||` was always right there.
 *
 * ## The raw value is still reported
 *
 * `auto_translate` in the payload is the room's OWN answer as a plain boolean —
 * a room that never set it, or an old row still holding `null`, both report
 * `false`. A screen can therefore render one checkbox instead of three states,
 * and `false` there means "this room asks for nothing", never "this room is
 * muted". ไม่เคยตั้ง กับ ตั้งเป็น false = เรื่องเดียวกัน
 *
 * Pure function, no models, no I/O: the caller passes the two documents it has
 * already read. That is what lets a spec drive every precedence case without a
 * database.
 *
 * revert: delete this file and inline the block back at its three call sites.
 */

/** The two values `show_original_text` can be read from. */
export type ShowOriginalTextSource = 'all_rooms' | 'room';

/** Only the fields this decision reads — anything else is the caller's business. */
export interface RoomTranslateFields {
  translate_lang?: string | null;
  detected_source_lang?: string | null;
  show_original_text?: boolean;
  show_original_text_source?: ShowOriginalTextSource | string | null;
  auto_translate?: boolean | null;
  auto_send_translated?: boolean;
}

export interface HookTranslateFields {
  translate_lang?: string | null;
  auto_translate?: boolean;
}

export interface RoomTranslateSettings {
  translate_lang: string | null;
  detected_source_lang: string | null;
  show_original_text: boolean;
  show_original_text_source: ShowOriginalTextSource;
  auto_translate: boolean;
  auto_send_translated: boolean;
  hook_translate_lang: string | null;
  hook_auto_translate: boolean;
  /** What the app must actually use. Room first, hook second. */
  effective_translate_lang: string | null;
  effective_auto_translate: boolean;
}

export function resolveRoomTranslateSettings(
  room: RoomTranslateFields | null | undefined,
  hook: HookTranslateFields | null | undefined,
): RoomTranslateSettings {
  /* A room that never set it reads as `false`, which under the OR rule is the
     same as asking for nothing — so a brand-new room inherits its OA and an old
     row holding `null` behaves identically. ห้องที่ไม่เคยตั้ง = false = ตามค่า OA */
  const roomAuto = Boolean(room?.auto_translate);

  return {
    translate_lang: room?.translate_lang ?? null,
    detected_source_lang: room?.detected_source_lang ?? null,
    show_original_text: Boolean(room?.show_original_text),
    /* [FEAT-20260919-SHOWORIGSRC] ONLY a literal `'room'` means "this room
       decides". Absent (every row written before 19/09), `null`, and any value
       the enum does not know all answer `'all_rooms'` — so a row that predates
       the column, or one corrupted by a hand edit, falls back to the
       account-wide setting rather than to a boolean nobody chose. Failing
       toward the shared default is the direction that cannot surprise anyone:
       the shared default itself starts unset, which renders as off — exactly
       what these rooms already do today. ไม่ใช่ 'room' เป๊ะ ๆ = ตามค่ากลาง

       ⚠️ NO `effective_show_original_text` HERE, ON PURPOSE. The other half of
       the answer is a PER-OPERATOR preference on the user row, and this
       function is given a room and a hook — it does not know whose screen the
       payload is headed for. Two operators opening the same room may correctly
       see different things. The dashboard joins the two in
       `services/chat/showOriginalText.ts`; computing a fake "effective" value
       here would be a number that is wrong for somebody.
       ค่ากลางเป็นของคนดู ไม่ใช่ของห้อง BE จึงรวมให้ไม่ได้ */
    show_original_text_source:
      room?.show_original_text_source === 'room' ? 'room' : 'all_rooms',
    auto_translate: roomAuto,
    auto_send_translated: Boolean(room?.auto_send_translated),
    hook_translate_lang: hook?.translate_lang ?? null,
    hook_auto_translate: Boolean(hook?.auto_translate),
    effective_translate_lang:
      room?.translate_lang || hook?.translate_lang || null,
    /* 🔴 EITHER LEVEL MAY SWITCH IT ON — see the header's table. */
    effective_auto_translate: roomAuto || Boolean(hook?.auto_translate),
  };
}
