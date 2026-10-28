import { Types, isValidObjectId } from 'mongoose';

/**
 * [FEAT-20260901-OBJSCOPE] Who may use an Object category / album — as a Mongo
 * filter fragment, written ONCE.
 *
 * Three call sites share this file: the category list, the album list, and the
 * LINE reply path in `webhook.service.ts`. They ask the same question from
 * different directions — an admin holds a LIST of groups and OAs, a live
 * conversation holds exactly ONE of each — so there are two entry points over
 * one set of legs. `hooks/oa-access/allowed-hook-ids.ts:1-39` is the file-length
 * record of what happens when a scope rule is re-implemented per caller instead.
 *
 * THE RULE, in one sentence: a row is in scope when its scope column is absent,
 * or empty, or contains the caller — and it is not switched off.
 *
 * `absent` and `[]` both mean **unrestricted**. That is not laziness: every row
 * that exists predates these columns, and a fail-closed reading would make all
 * of them vanish from every screen and stop every image the bot serves. The
 * divergence from `flex-messages.service.ts:562-568` (which IS fail-closed) is
 * deliberate and is only safe there because every flex row already carries a
 * group.
 *
 * revert: delete this folder and the `$and` legs at the three call sites. The
 * stored columns go back to being inert.
 */

/** The two scope columns, named once so a typo cannot diverge between legs. */
const GROUP_FIELD = 'group_providers';
const HOOK_FIELD = 'hook_ids';

/**
 * 🔴 `{status: true}` WOULD BE A TOTAL BLACKOUT.
 *
 * Mongoose applies a schema `default` on WRITE, not on read. Every row saved
 * before `status` existed carries no `status` key at all, so an equality match
 * skips all of them — on the reply path that means the bot silently stops
 * sending every image it has.
 *
 * `$ne: false` is the shape that reads absent as ON, which is also what makes
 * this feature additive: no backfill, no migration, and no `?? true` anywhere
 * in the code.
 */
const ENABLED_LEG = { status: { $ne: false } } as const;

/** A scope column matches when it is absent, empty, or contains `match`. */
function scopeLeg(field: string, match: unknown): Record<string, unknown> {
  return {
    $or: [
      { [field]: { $exists: false } },
      /* Exact-array equality, NOT `$size: 0`. `$size` can never use an index;
         this can. */
      { [field]: [] },
      { [field]: match },
    ],
  };
}

/**
 * Cast to `ObjectId`, or refuse.
 *
 * Both columns are ObjectId ref paths. Mongo does not match an ObjectId column
 * against a hex STRING — it returns nothing, silently, which on the reply path
 * reads as "this album does not exist". The runtime's `hook` is an untyped
 * `Record<string, unknown>` off a cache, so the type is never guaranteed.
 * `content-oa-access.util.ts:363-365` records the same trap on the write side.
 */
function toObjectId(value: unknown): Types.ObjectId | null {
  if (value instanceof Types.ObjectId) return value;
  /* Only a string is worth trying. Anything else — an object, a number, null —
     would stringify to something no `isValidObjectId` accepts anyway, and
     coercing it first only risks `[object Object]` reaching a query. */
  if (typeof value !== 'string') return null;
  return isValidObjectId(value) ? new Types.ObjectId(value) : null;
}

function toObjectIds(values: readonly unknown[]): Types.ObjectId[] {
  return values
    .map(toObjectId)
    .filter((id): id is Types.ObjectId => id !== null);
}

/**
 * The ADMIN shape: the caller holds a list of groups and a list of OAs.
 *
 * @param groupIds the caller's groups.
 * @param allowedHookIds the caller's OAs, or `null` for a superuser. `null`
 *   means "no OA filter"; `[]` means "no OA at all". Conflating them locks
 *   superadmins out of everything — `allowed-hook-ids.ts:147-155` says the same.
 * @param includeDisabled `true` for admin screens, which MUST keep showing a
 *   switched-off row: filtering it off the list would make it impossible to
 *   switch back on.
 *
 * Returns `{}` for a superuser listing everything, so a caller can spread it
 * into a filter unconditionally.
 */
export function objectScopeFilter(options: {
  groupIds?: readonly unknown[] | null;
  allowedHookIds: readonly unknown[] | null;
  includeDisabled?: boolean;
}): Record<string, unknown> {
  const legs: Array<Record<string, unknown>> = [];

  if (options.allowedHookIds !== null) {
    const groups = toObjectIds(options.groupIds ?? []);
    legs.push(scopeLeg(GROUP_FIELD, { $in: groups }));
    legs.push(
      scopeLeg(HOOK_FIELD, { $in: toObjectIds(options.allowedHookIds) }),
    );
  }

  if (!options.includeDisabled) legs.push(ENABLED_LEG);

  return legs.length > 0 ? { $and: legs } : {};
}

/**
 * The RUNTIME shape: one conversation, so one group and one OA.
 *
 * Returns `null` when the OA cannot be identified. That is not "no filter" — it
 * is a refusal, and the caller must skip the lookup entirely rather than run it
 * unscoped. Fail closed: an unidentified OA serving library images is the leak
 * this whole change exists to close.
 *
 * ⚠️ `$and` — never assign a second `$or` onto the filter. `matching_tag` and
 * `deleted_at` stay top-level; these legs nest. Assigning `filter.$or` twice
 * drops the first, which is exactly the failure `broadcasts-read.service.ts:
 * 172-176` records.
 */
export function objectRuntimeScopeFilter(
  hookId: unknown,
  groupId: unknown,
): Record<string, unknown> | null {
  const hook = toObjectId(hookId);
  if (hook === null) return null;

  const legs: Array<Record<string, unknown>> = [];

  /* A hook with no group is legal, so an unusable group id narrows to the
     unrestricted legs rather than refusing outright — the OA leg still scopes
     the lookup. Refusing here would take images away from OAs that work today
     for a reason unrelated to what the owner asked for. */
  const group = toObjectId(groupId);
  legs.push(
    group === null
      ? {
          $or: [{ [GROUP_FIELD]: { $exists: false } }, { [GROUP_FIELD]: [] }],
        }
      : scopeLeg(GROUP_FIELD, group),
  );
  legs.push(scopeLeg(HOOK_FIELD, hook));
  legs.push(ENABLED_LEG);

  return { $and: legs };
}
