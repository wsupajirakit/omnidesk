/**
 * Reading and writing `members.config` — the only file that touches the bag.
 * ===========================================================================
 * Which keys exist is `member-config.registry.ts`'s job; this file is how they
 * are read and written, and nothing else in the codebase should reach into
 * `member.config` directly. Keeping it to one file means the storage decision
 * can change later — a different field, a cache, a separate collection —
 * without a single caller knowing. Same reasoning as `registration-stamp.helper.ts`. ที่เดียวที่แตะถุงนี้.
 *
 * ⚠️ ABSENT IS A VALUE, AND IT IS THE COMMON ONE
 *   Every member alive today has no `config` at all, and that must keep meaning
 *   "behave exactly as before". So the reader NEVER decides a default by itself
 *   — the caller passes the fallback it wants, and for a switch that is on
 *   today the caller passes `true`. A reader that quietly defaulted to `false`
 *   would silently turn a live feature off for every member on deploy.
 *   ไม่มีค่า = ต้องเหมือนพฤติกรรมวันนี้ · ผู้เรียกเป็นคนบอกว่าเหมือนคืออะไร.
 *
 * ⚠️ READ FROM A DOCUMENT YOU ALREADY HAVE
 *   `readMemberConfig` takes a member document, not an id: every caller already
 *   loads the member by `_id` / `line_user_id`, so reading a setting costs
 *   nothing. Do NOT add `find({ 'config.x': ... })` without a partial index for
 *   that exact key — an unindexed path is a collection scan.
 *
 * revert: delete this folder and the `config` Prop in `member.schema.ts`.
 */
import type { Model } from 'mongoose';

import {
  MEMBER_CONFIG_ROOT,
  assertMemberConfigKey,
  assertMemberConfigValue,
  type MemberConfigKey,
  type MemberConfigValue,
} from './member-config.registry';

/** `config.follow_up.line.abandon` — the path Mongo is given, built in one place. */
export function memberConfigPath(key: MemberConfigKey): string {
  return `${MEMBER_CONFIG_ROOT}.${key}`;
}

/**
 * Read one setting out of a member document already in hand.
 *
 * `fallback` is what "this member has never been configured" means, and the
 * caller owns that answer — see the header. A stored value of the wrong type is
 * treated as absent rather than trusted: the bag is `Mixed`, so Mongoose
 * validates nothing, and a hand-edited row must not be able to make a boolean
 * switch hold a string.
 */
export function readMemberConfig<T extends MemberConfigValue>(
  member: unknown,
  key: MemberConfigKey,
  fallback: T,
): T {
  assertMemberConfigKey(key);
  const bag = (member as Record<string, unknown> | null | undefined)?.[
    MEMBER_CONFIG_ROOT
  ];
  if (!bag || typeof bag !== 'object') return fallback;
  let cursor: unknown = bag;
  for (const part of key.split('.')) {
    if (!cursor || typeof cursor !== 'object') return fallback;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return typeof cursor === typeof fallback ? (cursor as T) : fallback;
}

export interface MemberConfigDeps {
  memberModel: Model<Record<string, unknown>>;
}

/**
 * Write one setting.
 *
 * DOT-PATH `$set`, always. `{ $set: { config: { … } } }` would replace the whole
 * bag and drop every sibling key that another feature had written — the exact
 * class of bug this design exists to avoid. A dotted path touches one leaf,
 * atomically, with no read first and therefore no lost-update race.
 * ต้อง dot-path เท่านั้น · ยัดทั้งก้อน = ค่าของฟีเจอร์อื่นหาย.
 *
 * The key and the value are both checked before the query is built, so a typo
 * or a wrong type fails here rather than being stored and never read again.
 *
 * @returns true when a document was actually changed.
 */
export async function writeMemberConfig(
  filter: Record<string, unknown>,
  key: string,
  value: MemberConfigValue,
  deps: MemberConfigDeps,
): Promise<boolean> {
  assertMemberConfigKey(key);
  assertMemberConfigValue(key, value);
  const res = await deps.memberModel
    .updateOne(filter, { $set: { [memberConfigPath(key)]: value } })
    .exec();
  return (res as { modifiedCount?: number })?.modifiedCount === 1;
}

/**
 * Write it ONCE — the first call wins and later ones change nothing.
 *
 * The guard is in the FILTER, not in a read before the write, so any number of
 * concurrent messages produce exactly one stamp. A customer who is stuck writes
 * again and again; without this, every one of those messages would be a write,
 * and the timestamp would keep moving forward until it meant "last message"
 * instead of "since when". เขียนครั้งแรกครั้งเดียว · เวลาต้องไม่ขยับ.
 *
 * @returns true when this call was the one that wrote it.
 */
export async function writeMemberConfigOnce(
  filter: Record<string, unknown>,
  key: string,
  value: MemberConfigValue,
  deps: MemberConfigDeps,
): Promise<boolean> {
  assertMemberConfigKey(key);
  assertMemberConfigValue(key, value);
  const path = memberConfigPath(key);
  const res = await deps.memberModel
    .updateOne(
      {
        ...filter,
        // absent OR an explicit null — both mean "never stamped"
        $or: [{ [path]: { $exists: false } }, { [path]: null }],
      },
      { $set: { [path]: value } },
    )
    .exec();
  return (res as { modifiedCount?: number })?.modifiedCount === 1;
}

/**
 * Forget one setting, so the member goes back to whatever the default is.
 *
 * `$unset` and not "write the default": absent is the only state that keeps
 * meaning "never configured", and storing today's default would freeze it if
 * the default ever changes. ลบให้กลับไปเป็น "ไม่เคยตั้ง" ไม่ใช่เขียนค่า default ทับ.
 */
export async function clearMemberConfig(
  filter: Record<string, unknown>,
  key: string,
  deps: MemberConfigDeps,
): Promise<boolean> {
  assertMemberConfigKey(key);
  const res = await deps.memberModel
    .updateOne(filter, { $unset: { [memberConfigPath(key)]: '' } })
    .exec();
  return (res as { modifiedCount?: number })?.modifiedCount === 1;
}

/**
 * [FEAT-20260824-BCASTCLEARNOTICE] Forget one setting for MANY members at once.
 *
 * 🔴 WHY A SECOND DOOR RATHER THAN A LOOP OVER THE FIRST. A multicast reaches up
 *    to 500 people per request; calling `clearMemberConfig` per member would be
 *    500 round trips after every campaign, on the collection every screen reads.
 *    One `updateMany` is one trip whatever the size. วนเรียกทีละคน = 500 รอบต่อแคมเปญ.
 *
 * ⚠️ IT IS STILL ONE LEAF. `$unset` addresses the single dotted path, exactly
 *    like the singular version, so another feature's sibling key is not merely
 *    left alone — it is not addressable from this call at all. The bulk part is
 *    the FILTER, never the shape of the write. ยิงหลายคน แต่ยังล้างทีละ leaf เหมือนเดิม.
 *
 * ⚠️ The key is asserted the same way, so an undeclared key throws here too and
 *    a typo cannot silently clear nothing.
 *
 * @returns how many members actually carried the key. `0` means "nobody had it",
 *   which is a normal outcome and NOT a failure — most campaigns reach people
 *   who were never stamped. 0 = ปกติ ไม่ใช่พัง.
 */
export async function clearMemberConfigMany(
  filter: Record<string, unknown>,
  key: string,
  deps: MemberConfigDeps,
): Promise<number> {
  assertMemberConfigKey(key);
  const res = await deps.memberModel
    .updateMany(filter, { $unset: { [memberConfigPath(key)]: '' } })
    .exec();
  return (res as { modifiedCount?: number })?.modifiedCount ?? 0;
}
