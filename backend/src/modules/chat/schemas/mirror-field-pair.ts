/**
 * Dual-write mirroring for a field that exists under two names at once.
 *
 * Ported from the `mirrorPair` / `mirror*Fields` pair that legacy declares
 * directly on its schemas — `chatRoomModel.js:98-142` and
 * `lineUserModel.js:88-131`. Two renames are mid-flight:
 *
 *   chat_rooms   line_user_id ↔ channel_user_id
 *   members      line_user_id ↔ member_user_id
 *
 * Legacy keeps both names populated on every write so that readers of either
 * name see the same row, whichever era they were written in. This service had
 * the *columns* and even the unique index on `{channel_user_id, hook_id}`, but
 * not the hooks that fill them.
 *
 * That gap is not cosmetic. `getOrCreateRoom` never sets `channel_user_id`
 * itself — legacy's hook does it. The first room inserted through the ported
 * path therefore succeeds with the field absent; the **second customer on the
 * same hook collides on that unique index**, and the E11000 recovery then looks
 * for a row by `{user_id, hook_id}`, finds none, and rethrows — dropping the
 * message. It would have surfaced as "the bot ignores everyone but the first
 * person who ever wrote to this OA".
 *
 * Ported in full, including the upsert branch legacy documents as having no
 * current call site. The rule here is that this service carries the same code
 * as legacy whether or not today's traffic reaches it: the day a call site
 * appears, both backends have to behave the same without anyone remembering
 * this file exists.
 */

/** Whichever of the two names is set, copy it to the other. */
export function mirrorPair(
  obj: Record<string, unknown> | null | undefined,
  oldKey: string,
  newKey: string,
): void {
  if (!obj) return;
  const hasOld = obj[oldKey] !== undefined;
  const hasNew = obj[newKey] !== undefined;
  if (hasOld && !hasNew) obj[newKey] = obj[oldKey];
  else if (hasNew && !hasOld) obj[oldKey] = obj[newKey];
}

interface UpdateDoc {
  $set?: Record<string, unknown>;
  $setOnInsert?: Record<string, unknown>;
}

/**
 * Mirrors both names across an update document, and — on an upsert only —
 * across the filter as well.
 *
 * The filter branch covers a case Mongo half-handles by itself: an upsert that
 * matches on one name without restating it in `$set`/`$setOnInsert` gets that
 * field on insert through Mongo's own filter-merge, but never its counterpart.
 * The row is then created with one name populated and the other missing, which
 * is exactly the state the unique index punishes.
 *
 * `$setOnInsert` is a no-op on a matched document, so this can never rewrite an
 * existing row — it only completes a row at the moment it is created.
 */
export function mirrorUpdatePair(
  query: Record<string, unknown> | null | undefined,
  update: UpdateDoc | null | undefined,
  isUpsert: boolean,
  oldKey: string,
  newKey: string,
): void {
  if (!update) return;
  mirrorPair(update.$set, oldKey, newKey);
  mirrorPair(update.$setOnInsert, oldKey, newKey);

  if (!isUpsert || !query) return;

  const setHasNew = update.$set?.[newKey] !== undefined;
  const soiHasNew = update.$setOnInsert?.[newKey] !== undefined;
  const setHasOld = update.$set?.[oldKey] !== undefined;
  const soiHasOld = update.$setOnInsert?.[oldKey] !== undefined;

  if (query[oldKey] !== undefined && !setHasNew && !soiHasNew) {
    update.$setOnInsert = update.$setOnInsert ?? {};
    if (update.$setOnInsert[newKey] === undefined) {
      update.$setOnInsert[newKey] = query[oldKey];
    }
  }
  if (query[newKey] !== undefined && !setHasOld && !soiHasOld) {
    update.$setOnInsert = update.$setOnInsert ?? {};
    if (update.$setOnInsert[oldKey] === undefined) {
      update.$setOnInsert[oldKey] = query[newKey];
    }
  }
}

/**
 * The subset of a Mongoose query this file needs.
 *
 * Declared here rather than imported from mongoose because the hook callbacks
 * are typed by their `this`, and mongoose's own `Query` generic does not narrow
 * usefully in that position.
 */
export interface MirroringQuery {
  getQuery(): Record<string, unknown>;
  getUpdate(): {
    $set?: Record<string, unknown>;
    $setOnInsert?: Record<string, unknown>;
  } | null;
  getOptions(): { upsert?: boolean };
}
