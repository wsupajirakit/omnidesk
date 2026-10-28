/**
 * [FEAT-20260824-BCASTMULTIOA] Which OAs one job addresses.
 * ===========================================================================
 * Owner, 24/08: *"เป้าหมมาย job เลือกได้หลาย group หลาย hook oa ใน job เดียว ทำดีๆ
 * ห้ามสร้างหนี้ อืสระ module ถอดได้ไม่พัง ห้ามคอขวด"*.
 *
 * A job names its OAs two ways and they are meant to add up:
 *
 *   `hook_ids`         — OAs picked one at a time. Already an array; multi-OA in
 *                        one job has worked since the first commit.
 *   `target.group_ids` — OAs picked a whole group at a time. Already an array,
 *                        already stored, and until today **completely unused**:
 *                        the new sender REFUSED any job whose `target.mode` was
 *                        `'group'` (`broadcast-run/new-send.helpers.ts`,
 *                        `audienceFor` returning `null`), so a group selection
 *                        produced exactly one outcome — a job that cannot send.
 *
 * 🔴 A GROUP SELECTS OAs, NOT PEOPLE — verified against the live data, not
 *    assumed. `members` carries **no group/sector/team field at all**, so a
 *    group cannot narrow an audience; `hooks.group` is the only link, one group
 *    to many OAs (8 OAs in `omnidesk-dev-group` on this database). Reading
 *    `group_ids` as a member filter would silently send to nobody.
 *    members ไม่มี field group ⇒ group คัดคนไม่ได้ มันคัด OA.
 *
 * 🔴 NOT A BOTTLENECK, MEASURED. The expansion is ONE query behind the existing
 *    `group_1` index on `hooks` — explain on this database: IXSCAN, 8 keys, 8
 *    docs, 8 returned, no collection scan. It is bounded by the number of OAs in
 *    the chosen groups, and then bounded AGAIN by the send matrix's `maxHooks`.
 *    วัดแล้ว: 1 query ใช้ index เต็ม ไม่ scan.
 *
 * ⚠️ PURE, LIKE ITS NEIGHBOUR. It builds query SHAPES and merges lists; it never
 *    talks to Mongo, the same rule `oa-scope.ts` states for itself. That is what
 *    makes it testable without a database and removable without unwiring a
 *    provider.
 *
 * revert: delete this file and its two call sites. A job then addresses exactly
 * its `hook_ids`, which is today's behaviour — nothing that sends now changes.
 */

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

/** The column on `hooks` that names the group an OA belongs to. */
export const HOOK_GROUP_COLUMN = 'group';

/**
 * The shape that turns "these groups" into "these OAs".
 *
 * `null` = there is nothing to expand, and the caller must NOT run a query. An
 * empty `$in` would match no rows, which reads the same as "the group has no
 * OAs" — a different fact, and the one that would hide a mistake.
 * ไม่มีอะไรต้องขยาย = ห้ามยิง query · $in ว่างจะกลืนความต่างระหว่าง "ไม่ได้เลือก" กับ "กลุ่มว่าง".
 */
export interface OaGroupExpansionQuery {
  readonly filter: Record<string, unknown>;
  readonly projection: Record<string, 1>;
}

export function oaGroupExpansionQuery(
  groupIds: unknown,
): OaGroupExpansionQuery | null {
  if (!Array.isArray(groupIds)) return null;
  const ids = groupIds.filter((id) => id !== null && id !== undefined);
  if (ids.length === 0) return null;
  return {
    filter: { [HOOK_GROUP_COLUMN]: { $in: ids } },
    projection: { _id: 1 },
  };
}

/** What a job ended up addressing, and what it lost on the way. */
export interface OaSelection {
  /** The OAs to send to, in a stable order: explicit picks first. */
  readonly hookIds: readonly string[];
  /** How many came from group expansion and were not already picked. */
  readonly addedFromGroups: number;
  /**
   * Present ONLY when the cap actually cut something.
   *
   * 🔴 A silent cap reads as "these are all your OAs" and the send then refuses
   * the job for a reason the admin was never shown. ตัดแล้วต้องบอก.
   */
  readonly truncatedToHooks?: number;
}

/**
 * Merge the two ways of naming OAs into the list a run will use.
 *
 * 🔴 EXPLICIT PICKS COME FIRST AND SURVIVE THE CAP. If the cap has to cut, it
 *    cuts the group expansion — an admin who typed an OA by hand meant that one
 *    specifically, while a group is a bulk gesture. Sorting the union would make
 *    which OAs get dropped depend on id bytes.
 *    ที่เลือกเองต้องรอดก่อน · กลุ่มเป็นการเลือกแบบเหมา ตัดได้ก่อน.
 *
 * 🔴 DEDUPED BY STRING. The same OA reached both ways (picked by hand AND in a
 *    chosen group) must be sent to ONCE. Without this, a job would run the same
 *    OA twice — two LINE requests, two history rows, and a follower who gets the
 *    card twice. `hook_ids` arrive as ObjectIds and expansions as ObjectIds, so
 *    the comparison has to be on the hex, never on identity.
 *    OA เดียวกันมาสองทาง ต้องยิงครั้งเดียว ไม่งั้นลูกค้าได้การ์ดซ้ำ.
 *
 * @param cap The send matrix's `maxHooks` for this job's cell. `undefined` or a
 *   non-positive number = no cap, which is how a caller says "the matrix does
 *   not bound this".
 */
export function mergeOaSelection(
  explicitHookIds: unknown,
  hooksFromGroups: readonly unknown[],
  cap?: number,
): OaSelection {
  const seen = new Set<string>();
  const ordered: string[] = [];

  const push = (raw: unknown): boolean => {
    if (raw === null || raw === undefined) return false;
    const id = idText(raw);
    if (id === undefined || seen.has(id)) return false;
    seen.add(id);
    ordered.push(id);
    return true;
  };

  if (Array.isArray(explicitHookIds)) explicitHookIds.forEach((id) => push(id));
  const explicitCount = ordered.length;

  let addedFromGroups = 0;
  hooksFromGroups.forEach((row) => {
    /* A projection of `{_id:1}` hands back DOCUMENTS, not ids — accept either so
       a caller does not have to reshape the rows first.
       ⚠️ `isRecord(row) ? row['_id'] : row` was wrong and a test caught it: an
       ObjectId IS a record, so a bare id was read as `row['_id']` — `undefined`
       — and silently dropped. The document case is the one with an `_id`, not
       the one that happens to be an object.
       ObjectId ก็เป็น object ⇒ ต้องเช็คว่ามีคีย์ _id จริง ไม่ใช่เช็คว่าเป็น object. */
    const raw = isRecord(row) && '_id' in row ? row['_id'] : row;
    if (push(raw)) addedFromGroups += 1;
  });

  const limit = typeof cap === 'number' && cap > 0 ? cap : undefined;
  if (limit === undefined || ordered.length <= limit) {
    return { hookIds: ordered, addedFromGroups };
  }

  const kept = ordered.slice(0, limit);
  return {
    hookIds: kept,
    /* Recounted against what SURVIVED. Reporting the pre-cap number would say a
       group contributed OAs that this run will never touch. */
    addedFromGroups: Math.max(0, kept.length - explicitCount),
    truncatedToHooks: limit,
  };
}

/**
 * The hex of an id, whatever wrapper it arrived in.
 *
 * ⚠️ `String(objectId)` is avoided deliberately: on any object WITHOUT
 * `toHexString` it yields `'[object Object]'`, and a list of those would dedupe
 * to one entry — a job addressing eight OAs would send to one and report eight.
 * ห้ามใช้ String() ตรง ๆ — object ที่ไม่ใช่ id จะกลายเป็นค่าเดียวกันหมด แล้ว dedupe เหลือตัวเดียว.
 */
function idText(raw: unknown): string | undefined {
  if (typeof raw === 'string') return raw.trim() || undefined;
  if (isRecord(raw) && typeof raw['toHexString'] === 'function') {
    const hex = (raw as { toHexString: () => unknown }).toHexString();
    return typeof hex === 'string' && hex.trim() !== '' ? hex : undefined;
  }
  return undefined;
}
