/**
 * [FEAT-20260823-BCASTTITLE] The one rule for a broadcast's `title_detail`.
 * ===========================================================================
 * Split out of `card-message.builder.ts` on 23/08 because TWO layers need it
 * and they need it for different reasons:
 *
 *   · `broadcasts.service.ts` — at SAVE time, to REFUSE a bad title with a
 *     reason the admin can act on while the form is still open
 *   · `card-message.builder.ts` — at SEND time, to FALL BACK rather than lose
 *     a whole campaign over a notification line
 *
 * 🔴 THIS FILE IS THE ONLY AUTHORITY. The dashboard keeps a second copy in
 *    `utils/broadcastTitle.ts` so the admin hears about a bad title before
 *    saving — that copy is a courtesy, this one decides. เปลี่ยนที่นี่ = ต้องเปลี่ยนที่นั่น.
 *
 * Pure: no Mongo, no clock, no Nest. revert: fold back into the builder.
 */

/**
 * The default line a recipient sees before opening.
 *
 * Applied at RENDER time, never as a schema default — a `default:` in the
 * schema writes itself into every existing document on the first save, which
 * is a data change wearing a schema change's clothes.
 * ค่าเริ่มต้นใส่ตอนเรนเดอร์ ไม่ใช่ในสคีมา.
 */
export const BROADCAST_TITLE_DEFAULT = 'line messages';

/**
 * OUR cap on the title — no longer LINE's own number. Longer is still
 * rejected outright, never truncated.
 *
 * When this file was written (23/08) LINE's docs really did cap `altText`
 * at 400. Re-checked against the live reference on 26/08/2026 (the full
 * reference page, grepped, not paraphrased): LINE has since raised the
 * `altText` limit to **1500** for every type that has one (flex, template,
 * imagemap). So today 400 is OUR rule, stricter than LINE's — a title that
 * passes here can never be refused by LINE for length (400 < 1500).
 * เดิม 400 คือเพดานของ LINE จริง · ตอนนี้ LINE ขยายเป็น 1500 แล้ว
 * ⇒ 400 เป็นกติกาของเราเอง เข้มกว่า = ปลอดภัยกว่า ไม่มีวันโดนตีกลับ.
 *
 * 🔴 DO NOT raise this number as a "doc sync". It is a validation bound the
 *    form (`utils/broadcastTitle.ts`) and `ensureValidTitleDetail` both judge
 *    by — widening it is a behaviour change and needs the owner's say-so.
 *    Owner, 26/08: note the fact, change no code. ห้ามขยับเลขโดยไม่มีคำสั่ง.
 */
export const BROADCAST_TITLE_MAX = 400;

/**
 * 🔴 A TITLE IS PLAIN TEXT. NO TAGS, NO SYMBOLS.
 *
 * Owner's rule (23/08): Thai, English and digits only; no leading or trailing
 * space; no special characters; and **no `{{tags}}` at all**.
 *
 * Why it is a FILTER and not a substitution — the reason matters:
 *   · this line lands in a push notification and a chat-list row, where a card
 *     is not open and nothing can be re-read for context
 *   · a tag that resolves to `N/A` there reads as a broken app, not a missing
 *     value, and a tag that does not resolve ships literal braces
 *   · every symbol we reject is one LINE or a notification centre may render
 *     differently across platforms
 *
 * ⚠️ An invalid title FALLS BACK, it does not fail the send. Refusing a whole
 *    campaign over a notification line would be the wrong trade — but the
 *    admin must be told, so the reason rides back on `titleRejected`.
 *    ผิดกติกา = ใช้ค่าเริ่มต้น แต่ต้องบอกแอดมินว่าทำไม.
 */
const TITLE_ALLOWED = /^[A-Za-z0-9\u0E00-\u0E7F ]+$/;

export type TitleRejection =
  'empty' | 'has-tag' | 'bad-character' | 'edge-space' | 'too-long';

export interface TitleCheck {
  readonly title: string;
  readonly rejected?: TitleRejection;
}

/** The title to use, and why the admin's one was not used. */
export function resolveTitle(raw: unknown): TitleCheck {
  const fallback = { title: BROADCAST_TITLE_DEFAULT } as const;
  if (raw === null || raw === undefined) return fallback;
  if (typeof raw !== 'string') {
    return { title: BROADCAST_TITLE_DEFAULT, rejected: 'bad-character' };
  }
  if (raw.trim() === '') {
    return { title: BROADCAST_TITLE_DEFAULT, rejected: 'empty' };
  }
  /* Checked BEFORE the character rule so the admin is told the real reason:
     "you cannot use a tag here", not "you used a bad character". */
  if (raw.includes('{{') || raw.includes('}}')) {
    return { title: BROADCAST_TITLE_DEFAULT, rejected: 'has-tag' };
  }
  if (raw !== raw.trim()) {
    return { title: BROADCAST_TITLE_DEFAULT, rejected: 'edge-space' };
  }
  if (!TITLE_ALLOWED.test(raw)) {
    return { title: BROADCAST_TITLE_DEFAULT, rejected: 'bad-character' };
  }
  if (raw.length > BROADCAST_TITLE_MAX) {
    /* ⚠️ REJECTED, not truncated. A cut title reads as a different sentence,
       and the admin never learns theirs was too long. ตัดกลางประโยค = คนละความหมาย. */
    return { title: BROADCAST_TITLE_DEFAULT, rejected: 'too-long' };
  }
  return { title: raw };
}
