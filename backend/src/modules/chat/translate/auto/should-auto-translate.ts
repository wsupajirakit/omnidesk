/**
 * [FEAT-20260918-AUTOTRANS] Should this message be translated on its way IN?
 * =============================================================================
 * A pure decision. No models, no vendor, no I/O — it takes what the caller has
 * already read and answers yes/no with a REASON. That is what lets every case
 * below be tested without a database, and what lets the seam stay one line.
 *
 * ## The default is NO, and that is the whole safety story
 *
 * An OA that never opened the translate tab has `auto_translate` unset on the
 * hook and `null` on the room. Every such message must leave here as
 * `{ translate: false }` so the storage path does exactly what it did before
 * this feature existed — not "calls the translator and gets nothing back", but
 * never calls it at all. ไม่ตั้งค่า = ไม่มีอะไรเกิดขึ้น เหมือนเดิมเป๊ะ
 *
 * ## Direction matters — this file is the INBOUND half only
 *
 * Inbound is "the customer wrote something, the operator needs to read it", so
 * the target is the operator's reading language. The outbound half is a
 * different question with a different target (the CUSTOMER's language) and a
 * different failure rule (it blocks the send), which is why it is its own
 * wrapper rather than a flag on this one. ขาเข้ากับขาออกคนละโจทย์
 *
 * revert: delete `translate/auto/` and the optional constructor argument in
 * `chat-history.service.ts`. Nothing else references it.
 */
import { resolveRoomTranslateSettings } from '../room-translate-settings';
import type {
  HookTranslateFields,
  RoomTranslateFields,
} from '../room-translate-settings';

/**
 * 🔴 THE INBOUND TARGET IS FIXED, AND `translate_lang` IS NOT IT.
 * =============================================================================
 * Read the dashboard's own wording before changing this. The room modal's step 3
 * is *"ภาษาของห้องแชท — ระบุภาษาของ**ลูกค้า**ในห้องนี้ เพื่อใช้แปลและตอบกลับ"*: the room's
 * language is the CUSTOMER's, stored for translating replies back OUT to them.
 * Its step 1 is *"แปลข้อความภาษาต่างประเทศของลูกค้าให้อัตโนมัติ (ข้อความไทยจะแสดงปกติ
 * โดยไม่ส่งแปล)"* — inbound means "make the foreign line readable", and readable
 * here means Thai.
 *
 * So translating an inbound message INTO `translate_lang` would translate a
 * customer's Burmese into Burmese. The room's language decides the OUTBOUND
 * target, never this one. ขาเข้า = ไทยเสมอ · ภาษาห้อง = ภาษาลูกค้า ใช้ตอนตอบกลับ
 *
 * There is no per-operator reading language in the schema, and inventing one
 * would be a guess. If the console ever gains one, this constant is the single
 * place that changes.
 */
export const INBOUND_TARGET = 'th';

export type SkipReason =
  | 'not-a-customer-message'
  | 'not-text'
  | 'empty'
  | 'nothing-to-translate'
  | 'auto-translate-off'
  | 'already-in-target';

export type AutoTranslateDecision =
  { translate: true; to: string } | { translate: false; reason: SkipReason };

export interface AutoTranslateInput {
  senderType?: string | null;
  messageType?: string | null;
  content?: unknown;
  room?: RoomTranslateFields | null;
  hook?: HookTranslateFields | null;
}

/* Text worth paying a vendor for. A bubble that is only an emoji, a price, a
   link or punctuation has no sentence in it — translating it bills a call and
   returns the same characters back. URLs go first so their letters do not count
   as words. */
const URL = /https?:\/\/\S+/gi;
const NOT_A_WORD = /[\p{Extended_Pictographic}\p{P}\p{S}\s\d]/gu;

export function hasTranslatableText(text: string): boolean {
  return text.replace(URL, '').replace(NOT_A_WORD, '').trim().length > 0;
}

/* Thai letters, vowels and tone marks (U+0E01–U+0E4E). Used for ONE narrow
   question — "is this already Thai, when Thai is what we would translate it
   into" — and never to guess what language something IS. The vendor answers
   that, and its answer is what gets stored (`translations[].from`).
   เช็คแค่ว่า "เหมือนภาษาปลายทางอยู่แล้วไหม" ไม่ได้เดาว่าเป็นภาษาอะไร */
const THAI = /[ก-ฺเ-๎]/g;
const LATIN_OR_OTHER_SCRIPT = /[a-zA-Z一-鿿က-႟຀-໿ក-៿Ѐ-ӿ؀-ۿ]/g;

/**
 * True only when the text is CONFIDENTLY already in the target, so skipping it
 * cannot hide a real translation. Today that means: target is Thai, the text
 * carries Thai letters, and it carries no competing script. A mixed line
 * ("โอน 500 บาท ok?") still translates — the Latin word may be the part the
 * operator cannot read.
 */
export function looksAlreadyInTarget(text: string, target: string): boolean {
  if (target !== 'th') return false;
  const thai = text.match(THAI)?.length ?? 0;
  if (thai === 0) return false;
  const foreign =
    text.replace(URL, '').match(LATIN_OR_OTHER_SCRIPT)?.length ?? 0;
  return foreign === 0;
}

/**
 * The half that needs NOTHING but the message — deliberately separate, because
 * the caller runs it BEFORE reading the room and the hook. A bot card, a slip,
 * an admin's own reply or an emoji then costs zero database lookups, which is
 * what keeps this feature free for every OA that will never use it.
 * กรองด้วยตัวข้อความก่อน ค่อยไปอ่าน DB
 *
 * @returns `null` when the message qualifies, or the reason it does not.
 */
export function inboundTextRefusal(
  input: Pick<AutoTranslateInput, 'senderType' | 'messageType' | 'content'>,
): SkipReason | null {
  // Only what a customer typed. Bot cards, slips, tickets and the admin's own
  // outbound all pass through the same storage funnel and all stop here.
  if (input.senderType !== 'customer') return 'not-a-customer-message';
  if ((input.messageType ?? 'text') !== 'text') return 'not-text';

  const text = typeof input.content === 'string' ? input.content.trim() : '';
  if (!text) return 'empty';
  if (!hasTranslatableText(text)) return 'nothing-to-translate';

  return null;
}

export function shouldAutoTranslateInbound(
  input: AutoTranslateInput,
): AutoTranslateDecision {
  const refusal = inboundTextRefusal(input);
  if (refusal) return { translate: false, reason: refusal };

  const text = (input.content as string).trim();

  /* Room first, hook second — the owner's rule, and the same resolver the
     settings API answers with, so the screen and this decision can never
     disagree about whether translation is on. */
  const settings = resolveRoomTranslateSettings(input.room, input.hook);
  if (!settings.effective_auto_translate) {
    return { translate: false, reason: 'auto-translate-off' };
  }

  /* The target does NOT come from the settings — see `INBOUND_TARGET`. The
     settings decided only WHETHER to translate; the room's own language belongs
     to the reply direction. */
  if (looksAlreadyInTarget(text, INBOUND_TARGET)) {
    return { translate: false, reason: 'already-in-target' };
  }

  return { translate: true, to: INBOUND_TARGET };
}
