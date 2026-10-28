/**
 * [FEAT-20260822-BCASTOASCOPE] Turning "these members match" into "these LINE
 * ids belong to THIS OA".
 * ===========================================================================
 * A pure decision. It builds query SHAPES; it never talks to Mongo itself, so
 * it is testable without a database and reusable from anywhere.
 *
 * 🔴 WHY THIS FILE HAS TO EXIST — the plan was wrong without it.
 * A LINE user id belongs to ONE channel: the same human talking to two OAs has
 * two different ids (4 such people exist on this dev database today). So a
 * multicast to OA-A may only carry ids that belong to OA-A.
 *
 * `members` cannot answer that question. Verified against the schema, and again
 * after merging dev on 2026-08-22: `src/modules/chat/schemas/member.schema.ts`
 * contains **no `hook_id` at all**. Selecting "everyone who abandoned
 * registration" therefore returns rows from every OA mixed together.
 *
 * Sending that mixed list with one OA's token does NOT fail loudly — the ids
 * that belong to other channels are simply not delivered, while the run counts
 * them as sent. A campaign would report 5,000 recipients and reach 1,000.
 *
 * `chat_rooms` is the collection that knows the pairing, and it already carries
 * the exact indexes needed (`chat-room.schema.ts:106-107`):
 *     { line_user_id: 1, hook_id: 1 }   unique
 *     { user_id: 1,      hook_id: 1 }   unique     ← the one this file uses
 *
 * ⇒ selection is TWO steps, always:
 *     1. `members`     — answers "who matches the rules"      → member _id[]
 *     2. `chat_rooms`  — answers "who of those is on this OA" → line_user_id[]
 *
 * A pleasant side effect: step 2 also proves the customer has actually talked
 * to this OA, so anyone without a room here drops out on their own.
 *
 * ⚠️ Sources that already carry `hook_id` themselves — `customer_tags` is the
 *    one that exists today — may scope in step 1 and skip step 2. They must say
 *    so explicitly; see `AudienceSource.scope_by_hook` in the plan's §A.
 *
 * revert: delete this folder and the line naming it in `content/index.ts`.
 */

/**
 * How many member ids to put in one `$in`.
 *
 * A ceiling exists because a 10,000-element `$in` is a large query document and
 * a slow index scan, not because the driver refuses it. Paging keeps each query
 * predictable and lets the caller stream, which is what the recipient path does
 * everywhere else.
 */
export const OA_SCOPE_BATCH = 1_000;

/** The shape of one `chat_rooms` lookup. The caller runs it; this builds it. */
export interface OaScopeQuery {
  readonly collection: 'chat_rooms';
  readonly filter: {
    readonly user_id: { readonly $in: readonly unknown[] };
    readonly hook_id: unknown;
  };
  /**
   * Only the id is read.
   *
   * ⚠️ `_id: 0` matters: without it every row drags its ObjectId back for no
   * reason, and this query runs once per batch per OA.
   */
  readonly projection: { readonly line_user_id: 1; readonly _id: 0 };
}

/**
 * Build the lookups that turn matched members into this OA's LINE ids.
 *
 * Returns one query per batch, in order. An empty result means there is nothing
 * to ask — not that something failed.
 *
 * ⚠️ Refuses rather than guesses: a missing `hookId` would produce a query that
 * matches every OA, which is the exact mixing this file exists to prevent.
 * A caller that gets `null` must treat it as "cannot scope — do not send".
 */
export function buildOaScopeQueries(
  memberIds: readonly unknown[],
  hookId: unknown,
  batchSize: number = OA_SCOPE_BATCH,
): OaScopeQuery[] | null {
  if (hookId === null || hookId === undefined || hookId === '') return null;
  if (!Array.isArray(memberIds)) return null;

  const size =
    Number.isFinite(batchSize) && batchSize >= 1
      ? Math.floor(batchSize)
      : OA_SCOPE_BATCH;

  const clean = memberIds.filter(
    (id) => id !== null && id !== undefined && id !== '',
  );
  if (clean.length === 0) return [];

  const out: OaScopeQuery[] = [];
  for (let i = 0; i < clean.length; i += size) {
    out.push({
      collection: 'chat_rooms',
      filter: { user_id: { $in: clean.slice(i, i + size) }, hook_id: hookId },
      projection: { line_user_id: 1, _id: 0 },
    });
  }
  return out;
}

/**
 * Does this audience source still need step 2?
 *
 * `true`  — the source read `members` (or anything without an OA column), so
 *           its ids are not yet channel-scoped.
 * `false` — the source already filtered by `hook_id` itself (`customer_tags`).
 *
 * ⚠️ Defaults to `true`. An unknown source is assumed NOT scoped, because
 * assuming the safe thing costs one query and assuming the unsafe thing sends
 * a campaign into the wrong channel.
 */
export function needsOaScope(
  source: { scope_by_hook?: boolean } | null,
): boolean {
  return source?.scope_by_hook !== true;
}
