/**
 * [FEAT-20260824-BCASTFLEXID] Reads one saved card's body out of the library.
 * ===========================================================================
 * Owner, 24/08: *"flex id ใช้ส่ง ไม่ใช่ กรอกดิบ"* — a campaign stores WHICH
 * card it sends, and the body is fetched at send time. This is the one place
 * that turns an id into a body, so the sender and the preview cannot disagree
 * about where the content came from.
 *
 * 🔴 IT LIVES HERE, NOT IN `new-send.service.ts`. That file is already 554
 * lines — past the 400-line cap — and the anti-bloat rule says the waiver list
 * may only shrink, so nothing new may be added to a file that is already over.
 * `adapters/` is also where its siblings sit (`hook-token.reader.ts`,
 * `oa-vars.reader.ts`): the role is "read one thing the send needs".
 * ไฟล์นั้นเกินเพดานอยู่แล้ว ห้ามเพิ่ม — ของใหม่แยกตาม role.
 *
 * revert: delete this file and the two call sites (sender + preview).
 */
/** The column the card library keeps a card's body in. */
export const FLEX_CARD_BODY_COLUMN = 'content_json';

/**
 * Anything that can answer "give me this card". Narrower than the Mongoose
 * model on purpose — a test can satisfy it without a database, and nothing
 * here needs the other ~40 methods a model carries.
 */
export interface FlexCardSource {
  /* Returns the query object Mongoose hands back. `| unknown` was here and
     eslint was right to refuse it: `unknown` swallows every other member of a
     union, so the annotation said nothing at all. union ที่มี unknown = ไม่ได้บอกอะไรเลย. */
  findById(id: string): { lean(): Promise<Record<string, unknown> | null> };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

/**
 * The card's body, or `undefined` when there is no such card.
 *
 * 🔴 `undefined` MEANS "REFUSE", NOT "SEND SOMETHING ELSE". The caller turns
 * this into a failed send with a reason. Falling back to whatever copy the job
 * happens to hold would send the very content an admin thought they had
 * replaced — the failure this whole feature exists to remove.
 * หาไม่เจอ = ไม่ส่ง ห้ามถอยไปใช้สำเนาเก่า.
 *
 * ⚠️ A MALFORMED ID IS NOT AN EXCEPTION. `findById` on a string that is not a
 * valid ObjectId throws inside Mongoose, and an id typed by hand or left over
 * from an import is exactly the case that would take a scheduled run down with
 * it. Caught here and reported as "no such card", which is what it is.
 *
 * ⚠️ An EMPTY body is still a real answer and is returned as-is: a card saved
 * with `{}` is a card an admin can see and fix. Only "no row" is `undefined`.
 */
export async function readFlexCardBody(
  source: FlexCardSource,
  id: string,
): Promise<unknown> {
  const trimmed = id.trim();
  if (trimmed === '') return undefined;
  try {
    const row = await source.findById(trimmed).lean();
    if (!isRecord(row)) return undefined;
    const body = row[FLEX_CARD_BODY_COLUMN];
    return body === undefined ? undefined : body;
  } catch {
    return undefined;
  }
}
