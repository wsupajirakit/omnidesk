/**
 * [FEAT-20260823-BCASTPREVIEW] The four fields a saved card is made of.
 * ===========================================================================
 * Moved out of `new-send.service.ts` on 23/08 so the PREVIEW reads a card
 * through the very same function the SENDER does. A second copy would agree
 * on the day it was written and drift the first time either side changed —
 * and a preview that disagrees with the sender is worse than no preview,
 * because an admin acts on it. พรีวิวต้องอ่านการ์ดด้วยฟังก์ชันเดียวกับตัวส่ง.
 *
 * revert: inline it back into `new-send.service.ts`.
 */
import type { SavedCard } from '../broadcast-send';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

const textOf = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : undefined;

export function savedCardOf(message: unknown): SavedCard | null {
  if (!isRecord(message)) return null;
  const type = textOf(message['type']);
  if (type === undefined) return null;
  return {
    type,
    text: textOf(message['text']),
    image_url: textOf(message['image_url']),
    flex_json: message['flex_json'],
  };
}

/**
 * [FEAT-20260824-BCASTFLEXID] Reads the id off a job's message, if it has one.
 *
 * Its own function so the two callers cannot disagree about which field holds
 * the reference — the same reason `savedCardOf` exists at all.
 */
export function flexIdOf(message: unknown): string | undefined {
  if (!isRecord(message)) return undefined;
  const raw = message['flex_id'];
  if (typeof raw === 'string') return raw.trim() || undefined;
  /* A `.lean()` read hands back an ObjectId, not a string. `toHexString()` is
     asked for BY NAME rather than going through `String(raw)`: eslint is right
     that stringifying an arbitrary object gives `[object Object]`, and an id
     that silently became that literal would be a lookup that always misses.
     Anything without the method is not an id and must not be guessed at.
     เรียก toHexString ตรง ๆ ไม่ใช้ String() — object ทั่วไปจะได้ '[object Object]'. */
  if (raw !== null && typeof raw === 'object' && 'toHexString' in raw) {
    const hex = (raw as { toHexString: () => unknown }).toHexString();
    return typeof hex === 'string' && hex.trim() !== '' ? hex : undefined;
  }
  return undefined;
}

/** What a resolver needs from the outside world. Injected, never imported. */
export type FlexJsonLoader = (id: string) => Promise<unknown>;

/**
 * [FEAT-20260824-BCASTFLEXID] The card this job will actually send.
 *
 * 🔴 THE ORDER IS THE WHOLE POINT — id first, the job's own copy second.
 * Owner, 24/08: *"flex id > เซฟ job > ตอน job ทำก็ไปดึงมา ทั้งแบบ dynamic +
 * plain card"*. A campaign stores WHICH card, not a photograph of it, so fixing
 * the card at the library fixes every campaign that points at it.
 *
 * ⚠️ WHY THE FALLBACK IS NOT DEAD WEIGHT. Every campaign saved before today has
 * `flex_json` and no `flex_id`. Reading the id first and falling back keeps all
 * of them sending exactly what they send now — absent is not empty, and a
 * missing reference is "this job predates the feature", not an error.
 * แถวเก่าไม่มี flex_id ⇒ ใช้สำเนาเดิม พฤติกรรมไม่ขยับ.
 *
 * ⚠️ A REFERENCE THAT RESOLVES TO NOTHING IS REFUSED, NOT SILENTLY DOWNGRADED.
 * If the id is there but the card is gone (deleted, or out of this admin's
 * scope), falling back to a stale private copy would send the very content the
 * admin thought they had replaced. `null` here makes the caller refuse the job,
 * which is the safe answer: no send beats a wrong send.
 * ชี้การ์ดที่ไม่มีอยู่ = ไม่ส่ง ไม่ใช่ส่งของเก่า.
 *
 * `text` and `image` never consult the loader — by owner's call they stay typed
 * into the job itself.
 *
 * revert: delete this function; callers go back to `savedCardOf` alone.
 */
export async function resolveSavedCard(
  message: unknown,
  loadFlexJson: FlexJsonLoader,
): Promise<SavedCard | null> {
  const card = savedCardOf(message);
  if (card === null) return null;
  if (card.type !== 'flex') return card;

  const id = flexIdOf(message);
  if (id === undefined) return card; // pre-feature row — its own copy stands

  const json = await loadFlexJson(id);
  if (json === undefined || json === null) return null; // refuse, never fall back
  return { ...card, flex_json: json };
}
