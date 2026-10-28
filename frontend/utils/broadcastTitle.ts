/**
 * [FEAT-20260823-BCASTTITLE] The rule for a broadcast's notification line.
 * ===========================================================================
 * `title_detail` becomes the flex `altText` — what a person reads in their chat
 * list and on their lock screen, before opening anything.
 *
 * Owner's rule (23/08): Thai, English and digits only · no leading or trailing
 * space · no special characters · and NO `{{tags}}` at all.
 *
 * ⚠️ THIS IS A SECOND COPY OF A BACKEND RULE, ON PURPOSE — and the duplication
 *    is the risk, so read this before changing either side.
 *    The authority is `omnidesk-api/src/modules/content/broadcast-send/adapters/
 *    card-message.builder.ts` → `resolveTitle()`. The backend ALWAYS enforces
 *    it; this copy exists only so an admin is told at save time instead of
 *    discovering it on a card that already went out.
 *    ⇒ CHANGE ONE, CHANGE BOTH. If they drift, the backend wins and the form
 *      lies to the admin. แก้ฝั่งเดียว = ฟอร์มโกหก เพราะ backend เป็นคนตัดสินจริง.
 *
 * ⚠️ FLEX ONLY. A text or image message has no `altText`; LINE uses the content
 *    itself as the notification. The form must not offer this field for those
 *    types, or it promises something that cannot happen.
 *
 * revert: delete this file and the `title_detail` block in BroadcastFormModal.
 */

/** Same order as the backend, so the admin reads the same reason. */
export type TitleProblem =
  | 'empty'
  | 'has-tag'
  | 'bad-character'
  | 'edge-space'
  | 'too-long';

/**
 * OUR cap — not LINE's own number anymore: LINE's docs (checked 26/08/2026)
 * now allow `altText` up to 1500. We keep 400 on purpose — stricter than
 * LINE = can never be refused for length. The deciding copy of this bound
 * lives in BE `broadcast-send/adapters/title-rule.ts`; raising either side
 * alone makes the form lie, and raising at all is a behaviour change that
 * needs the owner's say-so (owner 26/08: note only, no code change).
 * 400 คือกติกาของเราเอง · LINE ขยายเป็น 1500 แล้ว · ห้ามขยับเลขฝั่งเดียว.
 */
export const TITLE_MAX = 400;

/** What the backend falls back to when the title cannot be used. */
export const TITLE_DEFAULT = 'line messages';

const ALLOWED = /^[A-Za-z0-9฀-๿ ]+$/;

/**
 * `null` when the title is usable, otherwise WHY it is not.
 *
 * An empty/absent title is NOT a problem — it simply means the default line is
 * used. Only a title the admin typed and cannot have is reported.
 * ไม่กรอก = ใช้ค่าเริ่มต้น ไม่ใช่ error.
 */
export function checkBroadcastTitle(raw: string | undefined | null): TitleProblem | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (raw.trim() === '') return 'empty';
  /* Checked BEFORE the character rule so the admin reads the reason they can
     act on: "you cannot use a tag here", not "bad character". */
  if (raw.includes('{{') || raw.includes('}}')) return 'has-tag';
  if (raw !== raw.trim()) return 'edge-space';
  if (!ALLOWED.test(raw)) return 'bad-character';
  if (raw.length > TITLE_MAX) return 'too-long';
  return null;
}
