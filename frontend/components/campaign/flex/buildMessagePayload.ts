/**
 * [FEAT-20260824-BCASTFLEXID] What the form actually sends as `message`.
 * ===========================================================================
 * Pulled out of `BroadcastFormModal.buildPayload` because it grew a real
 * decision — id vs raw copy — and because the parent is already 1,098 lines,
 * past the 400-line cap (dev-local §6.1). A pure function is also the only
 * shape this can be tested in without mounting the whole modal.
 *
 * 🔴 IT REPLACED `JSON.parse(flexText)` INLINE, WHICH COULD THROW. With the
 *    textarea gone, `flexText` is empty for every card picked from the library
 *    — and `JSON.parse('')` throws `SyntaxError`, from inside a submit handler,
 *    which the modal shows as nothing at all. The admin clicks save and the
 *    dialog just sits there. JSON.parse('') = throw ⇒ กดเซฟแล้วเงียบ ไม่มีอะไรเกิด.
 *
 * 🔴 A REFERENCE WINS, A COPY IS CARRIED. The backend reads `flex_id` first and
 *    falls back to `flex_json` (`broadcast-run/saved-card.ts`), so a job editing
 *    session must not DROP the copy an old campaign already holds — otherwise
 *    renaming a 2025 broadcast would delete its card.
 *    เลือกการ์ดใหม่ = ส่ง id · ของเก่ายังไม่เลือก = ส่งสำเนาเดิมไปด้วย ห้ามทิ้ง.
 */

import type { MessageType } from '../../../types';

/** The `message` sub-object as both the form and the backend DTO see it. */
export interface MessagePayload {
  /* The union the form already uses — not `string`. Widening it here would let
     a typo'd type through the one place that could still catch it. */
  type: MessageType;
  text?: string;
  image_url?: string;
  flex_json?: unknown;
  /** [FEAT-20260824-BCASTFLEXID] The library card this job points at. */
  flex_id?: string | null;
}

/**
 * `flexText` is the legacy raw-JSON box. It is still honoured when it holds
 * something, so a campaign mid-migration can be saved either way — but it is no
 * longer REQUIRED, and an empty box is no longer an error.
 *
 * ⚠️ Invalid JSON in that box is dropped rather than thrown: the backend
 * validates and answers with a message an admin can read. Throwing here would
 * kill the submit with no feedback, which is the failure this function exists
 * to remove. JSON เสีย = ปล่อยให้ BE ตอบ ไม่ใช่ระเบิดที่นี่.
 */
export function buildMessagePayload(
  message: MessagePayload,
  flexText: string
): MessagePayload {
  if (message.type !== 'flex') {
    /* text / image are unchanged by owner's call, 24/08:
       "ยกเว้น text กรอกดิบ เซฟติด job" · "image ก็ทำงานได้แบบเดิม". */
    return { ...message };
  }

  const raw = (flexText ?? '').trim();
  let parsed: unknown;
  if (raw !== '') {
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      parsed = undefined;
    }
  }

  const flexId =
    typeof message.flex_id === 'string' && message.flex_id.trim() !== ''
      ? message.flex_id.trim()
      : null;

  /* The copy that survives: whatever was typed this session, else whatever the
     job already held. `undefined` when there is neither — and `undefined` is
     what keeps the key OUT of the request, which matters because a `null`
     `flex_json` would be a deliberate clear. */
  const copy = parsed !== undefined ? parsed : message.flex_json;

  /**
   * 🔴 `...message` FIRST WOULD CARRY THE RAW VALUE THROUGH. A conditional
   *    spread can only ADD a key — it cannot remove one the spread already
   *    put there — so `flex_id: '   '` survived a `flexId === null` branch and
   *    went up as a whitespace reference. Caught by the test that asserts an
   *    all-blank id is NOT a link; the field is rebuilt explicitly instead.
   *    spread แบบมีเงื่อนไข "เพิ่ม" ได้ แต่ "ลบ" ของที่ ...message ใส่มาไม่ได้.
   */
  const { flex_id: _dropped, flex_json: _alsoDropped, ...rest } = message;
  return {
    ...rest,
    /* Present only when there is one, so an old job is never stamped with a
       reference it does not have. */
    ...(flexId === null ? {} : { flex_id: flexId }),
    ...(copy === undefined ? {} : { flex_json: copy })
  };
}
