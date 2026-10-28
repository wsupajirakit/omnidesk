/**
 * [FEAT-20260823-BCASTACTOR] Turning `created_by` into a name a person reads.
 * ===========================================================================
 * A broadcast stores `created_by` / `updated_by` as ObjectIds, and every read
 * handed those straight out. An id answers "is this mine?" and nothing else —
 * the question an admin actually asks about a campaign in a shared console is
 * *who set this up*. เก็บ id อย่างเดียว = ตอบคำถามที่คนถามจริงไม่ได้.
 *
 * 🔴 RESOLVED AT READ TIME, NOT DENORMALISED. A `created_by_name` column would
 *    freeze the name as it was on the day the job was made, so an admin who
 *    later changes their display name becomes two different people across the
 *    list. One `$in` per page is cheap and always current.
 *
 *    ⚠️ The opposite choice is right for `broadcast_histories.triggered_by_name`
 *    and stays there: a history row is a record of a moment, so the name AS IT
 *    WAS is the honest one. Two collections, two rules, on purpose.
 *    ประวัติเก็บชื่อ ณ ตอนนั้น · ตัวงานใช้ชื่อปัจจุบัน.
 *
 * 🔴 ONE QUERY FOR THE WHOLE PAGE. Resolving per row would be an N+1 against
 *    `users` on every list load — the shape this file exists to avoid, not to
 *    introduce. ต่อหน้า ไม่ใช่ต่อแถว.
 *
 * ⚠️ COLUMN NAMES `username` / `display_name` are the real ones, taken from
 *    `user.schema.ts:24,31` and corroborated by `chat.service.ts:1528`, which
 *    populates exactly this pair. A guessed name here would select nothing and
 *    every row would quietly show its id again. ชื่อคอลัมน์อ่านมาจากของจริง.
 *
 * revert: delete this file and the two `*_name` fields in `sanitizeBroadcast`.
 */
import type { Model } from 'mongoose';

/** id → the best name we have for that admin. Missing ids are simply absent. */
export type ActorNames = ReadonlyMap<string, string>;

export const NO_ACTOR_NAMES: ActorNames = new Map();

const idText = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v === '' ? null : v;
  if (typeof v === 'object') {
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    const s = String(v);
    return s === '' || s === '[object Object]' ? null : s;
  }
  return null;
};

/** `display_name` first, `username` as the fallback — never the raw id. */
export function bestActorName(row: Record<string, unknown>): string | null {
  const display = row['display_name'];
  if (typeof display === 'string' && display.trim() !== '') return display;
  const username = row['username'];
  if (typeof username === 'string' && username.trim() !== '') return username;
  return null;
}

/**
 * Look up every distinct actor on a page of rows, in one query.
 *
 * Never throws: a lookup that fails costs the NAMES, not the page. A list that
 * refuses to load because a name could not be found would be a worse answer
 * than a list showing ids. อ่านชื่อไม่ได้ = ไม่มีชื่อ ไม่ใช่โหลดหน้าไม่ขึ้น.
 */
export async function resolveActorNames(
  userModel: Model<Record<string, unknown>> | undefined,
  rows: ReadonlyArray<Record<string, unknown> | null | undefined>,
): Promise<ActorNames> {
  if (!userModel) return NO_ACTOR_NAMES;

  const ids = new Set<string>();
  for (const row of rows) {
    if (!row) continue;
    for (const field of ['created_by', 'updated_by'] as const) {
      const id = idText(row[field]);
      if (id !== null) ids.add(id);
    }
  }
  if (ids.size === 0) return NO_ACTOR_NAMES;

  try {
    const users = (await userModel
      .find({ _id: { $in: [...ids] } })
      .select({ username: 1, display_name: 1 })
      .lean()
      .exec()) as unknown as Array<Record<string, unknown>>;

    const out = new Map<string, string>();
    for (const u of users) {
      const id = idText(u['_id']);
      const name = bestActorName(u);
      if (id !== null && name !== null) out.set(id, name);
    }
    return out;
  } catch {
    return NO_ACTOR_NAMES;
  }
}

/** The name for one stored id, or `null` when we could not resolve it. */
export function actorNameOf(names: ActorNames, value: unknown): string | null {
  const id = idText(value);
  return id === null ? null : (names.get(id) ?? null);
}
