/**
 * [FIX-20260918-LANGSPLIT] Remember the language a message CAME IN as.
 * ===========================================================================
 * One job, one write, no opinions: given the `from` a translation carries, store
 * it on the room as `detected_source_lang` — and only when it actually changes.
 *
 * ## Why it is its own file
 *
 * The same three lines used to sit twice inside `chat-translate.service.ts`
 * (once on the cache-hit branch, once after the vendor call) and they wrote to
 * `translate_lang` — the field holding the customer's language AS THE OPERATOR
 * DECLARED IT in the room modal. Same question, but a model's guess from one
 * line was replacing a person's decision, silently, on most translations. The
 * observation gets its own field; the declaration stands. Pulling the write out
 * here also makes the rule exist once, and testable without standing up the
 * whole translate service.
 * กติกาเดียวอยู่ที่เดียว ไม่ก๊อป · โมเดลเดาได้ แต่ห้ามทับของที่คนตั้ง
 *
 * ## The guards, and why each one is here
 *
 * - **unknown language ⇒ no write.** `from` is whatever the vendor said. Only
 *   the seven codes this console supports may land in a column the dashboard
 *   renders; anything else (`auto`, `und`, a model's freeform answer) is dropped.
 * - **no room ⇒ no write.** A message can exist without `room_id`.
 * - **unchanged ⇒ no write.** The cache-hit branch is documented as costing
 *   "no vendor call, no cap spend, no audit row" — it should not cost a Mongo
 *   write either. Re-reading a translated bubble ten times must touch the DB
 *   zero times. The "is it different" test rides IN THE FILTER
 *   (`detected_source_lang: { $ne: from }`) rather than in a read-then-write:
 *   one round trip, and two presses racing cannot both decide to write.
 *   อ่านซ้ำ = ไม่เขียนซ้ำ · เช็คในฟิลเตอร์ ไม่ต้องอ่านก่อน
 *
 * Failure is swallowed on purpose: this is a display nicety riding along with a
 * translation the admin already has. It must never turn a successful
 * translation into an error. แปลสำเร็จแล้ว ห้ามพังเพราะบันทึกภาษาต้นทางไม่ได้
 *
 * revert: delete this file, drop the two call sites in `chat-translate.service.ts`
 * and the `detected_source_lang` prop in `chat-room.schema.ts`.
 */
import { Logger } from '@nestjs/common';

import { isTranslateLanguage } from '@/modules/ai-translate';

const logger = new Logger('RememberSourceLang');

/**
 * The narrowest thing that can do the job — deliberately NOT `Model<ChatRoom>`.
 * A structural port keeps this callable from anywhere (another channel, a
 * script, a spec with a plain object) without dragging a mongoose document type
 * along, and it is what lets a test assert the exact filter with no database.
 * ผูกกับ mongoose ให้น้อยที่สุด เพื่อให้ที่อื่นหยิบไปใช้ได้
 */
export interface RoomSourceLangWriter {
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
  ): unknown;
}

export interface RememberSourceLangInput {
  /** The room the message belongs to. Anything falsy is a no-op. */
  roomId?: unknown;
  /** What the translation says the text was written in. `null` is normal. */
  from?: string | null;
}

/**
 * @returns `true` when the update was issued, `false` when a guard stopped it —
 * the return value is what the specs assert on, so every skip stays provable.
 */
export async function rememberDetectedSourceLang(
  roomModel: RoomSourceLangWriter,
  input: RememberSourceLangInput,
): Promise<boolean> {
  const { roomId, from } = input;

  if (!roomId) return false;
  if (!from || !isTranslateLanguage(from)) return false;

  try {
    await (roomModel.updateOne(
      { _id: roomId, detected_source_lang: { $ne: from } },
      { $set: { detected_source_lang: from } },
    ) as Promise<unknown>);
    return true;
  } catch (err) {
    // A display field. Never fail the translation the admin is waiting for.
    logger.warn(
      `[LANGSPLIT] could not store detected source '${from}' on room ${String(roomId)}: ${String(err)}`,
    );
    return false;
  }
}
