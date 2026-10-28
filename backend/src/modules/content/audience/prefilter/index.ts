/**
 * [FEAT-20260824-BCASTTAGPRE] Barrel for the audience PRE-STEP.
 * ===========================================================================
 * RULES OF THIS FOLDER
 *  · a resolver builds a query SHAPE; the send path is the only thing that runs
 *    it — same house rule as `audience/oa-scope.ts`
 *  · a rule this folder owns is REWRITTEN in place, never merged onto the
 *    finished filter, so `match: 'or'` stays correct (see
 *    `resolve-audience.ts`)
 *  · an empty result is a clause that matches nobody, never a dropped rule
 *  · nothing here writes to any collection, and no schema or index was changed
 *
 * DELETABLE AS A FOLDER: remove this directory, its `export *` line in
 * `../index.ts`, the `customer_tag` entry in
 * `../sources/audience-source.registry.ts` and the four lines in
 * `../../broadcast-run/new-send.service.ts` that call it. Nothing else refers
 * to it, and the system behaves exactly as it does today.
 *
 * ===========================================================================
 * ENG NOTE — THE SEAM, AND WHAT A TICKET RESOLVER WOULD HAVE TO PROVIDE
 * ===========================================================================
 * The owner asked (24/08) for ticket type / ticket status to be *possible* but
 * not built yet: *"ticket type / ticket status >>> ติดไว้ก่อน ทำท่อเผื่อไว้ แต่ต้อง
 * ทำท่อเผื่อไว้ note eng"*. This note is that pipe, written down.
 *
 * WHAT THE SEAM IS
 *   An audience rule normally names a path on `members`, and
 *   `buildAudienceFilter` turns it into one clause of one `members` filter.
 *   Some questions cannot be asked that way because the answer lives in another
 *   collection. For those, a PRE-STEP runs first: it reads the other collection,
 *   gets `member _id[]`, and substitutes those ids into the SAME rule, whose
 *   registry entry declares `path: '_id'`. The filter builder, the recipient
 *   pager and the send path never learn that a join happened.
 *
 * WHAT A NEW RESOLVER MUST PROVIDE — three small things, no edits elsewhere:
 *   1. a file exporting an `AudiencePrefilterResolver` (see
 *      `customer-tag.resolver.ts` as the worked example). Its `planLookup`
 *      returns a `PrefilterLookup`: the mongoose MODEL name, a filter, a
 *      projection, and the field on the returned rows that holds the member id.
 *      It must return an `error` — never "skip" — for a rule it cannot plan.
 *   2. one line in `prefilter.registry.ts`.
 *   3. one entry in `../sources/audience-source.registry.ts` with
 *      `path: '_id'`, `scope_by_hook: false`, and an honest `indexed`.
 *
 * WHY TICKET KEYS ARE *NOT* REGISTERED TODAY
 *   An unusable key is worse than a missing one: it appears in the admin's
 *   dropdown, builds a filter, and reaches nobody with no error anywhere. The
 *   entry goes in on the day the resolver exists, not before.
 *
 * VERIFIED FACTS FOR THAT FUTURE RESOLVER — checked against real rows on the
 * lane database `boardcast_lane_24aug`, 2026-08-24 (92 ticket rows), NOT
 * against the schema file:
 *   · model name        `Ticket` — registered by `tickets.module.ts:60`,
 *                       `webhook.module.ts:236` and `payment.module.ts:62`
 *   · collection        `tickets`
 *   · link to a member  `chat_user_id` IS the member `_id`. Confirmed by taking
 *                       a real ticket's `chat_user_id`
 *                       (a0d000000000000000000006) and finding that exact
 *                       `members._id`. So a lookup projects
 *                       `{ chat_user_id: 1, _id: 0 }` with
 *                       `memberIdField: 'chat_user_id'`.
 *   · the "type"        `category`, a string. Distinct values on real rows:
 *                       'Other' | 'Payment'.
 *   · the "status"      TWO different columns, and they answer different
 *                       questions — do not merge them into one key:
 *                         `chat_status`  'admin' | 'bot'   (who is replying)
 *                         `job_status`   0 | 1 | 2         (where the case is)
 *   · indexes that already answer it, so no new index would be needed:
 *                       `category_1`, `chat_status_1`, `job_status_1`,
 *                       `chat_user_id_1`, and the compound
 *                       `hook_id_1_job_status_1_created_at_-1`.
 *
 * TWO THINGS TO DECIDE BEFORE WRITING IT — they are not free choices:
 *   · `job_status` is a NUMBER. `audience-filter.ts` has no numeric range
 *     (`lte`/`gte` both go through `parseAdminTime`), and a dropdown that sends
 *     "0" instead of 0 matches nothing in Mongo without a single error. Offer
 *     `eq`/`in` only, and make the FE send numbers.
 *   · one member can have MANY tickets, so the lookup returns duplicate
 *     `chat_user_id` values. `resolve-audience.ts` already dedupes per rule, but
 *     the ceiling it checks is a MEMBER count — keep it that way, or a member
 *     with 50 cases would count 50 times against it.
 *
 * WHAT WOULD *NOT* WORK, and why it is written here rather than rediscovered:
 *   · copying ticket facts onto `members` — that is what `first_ticket_at`
 *     does (`tickets/schemas/first-ticket-stamp.ts`), and it is the right shape
 *     for a value that never changes. `category` / `chat_status` / `job_status`
 *     all change over a case's life, so a stamp would go stale and a stale stamp
 *     sends a campaign to people who no longer qualify.
 *   · a `$lookup` in the recipient pager — the pager's port takes a plain
 *     `members` filter and a keyset cursor; widening it to an aggregation is
 *     permanent debt in another lane for a feature that must stay removable.
 */
export * from './prefilter.types';
export * from './prefilter.registry';
export * from './customer-tag.resolver';
export * from './resolve-audience';
export * from './keyset-safe-filter';
