/* ==== [PERF-20260826-NOCASEDEPS] 📖 omnidesk-api docs/bottleneck_26_aug.md (S4)
 * The บอทดูแล badge's server half refires on MEMBERSHIP, not on array identity.
 * ============================================================================
 * THE STORM THIS KILLS. TicketChat's no-case effect fires ONE request PER OA
 * (`getNoCaseRoomCount`) and used to depend on `activeTickets` /
 * `completedTickets` directly. Every fetch, WS patch and partial merge builds
 * a NEW array even when the rows are the same, so every event × every admin
 * × every OA re-asked the server a number that could not have changed.
 *
 * WHY THE DISPLAYED NUMBER CANNOT DIFFER UNDER THIS KEY. The BE formula is
 * count(rooms of hook whose user has NO ticket ever). It can only move when
 * (a) ticket-list MEMBERSHIP changes — a user's first ticket appears, or a
 * ticket is deleted — or (b) a room is created. Claim / close / transfer /
 * field patches change NEITHER (a closed ticket still exists), so a refire on
 * those returned the same number by construction. (b) never reached the old
 * deps either — no room event feeds them — so keying on membership loses
 * nothing that identity ever caught. Membership events all change the id
 * sequence, so every refetch that could matter still happens.
 *
 * Order-sensitive join ON PURPOSE: cheaper than sorting, and a same-set
 * reorder can only come from a full refetch (BE order is deterministic) or a
 * membership event — an occasional extra refetch is harmless; a missed one is
 * not, and sets that differ always differ as sequences too.
 *
 * Pure + tiny so it is testable directly — same pattern as
 * `partialTicketMerge.ts` / `ticketAlerts.ts`.
 * revert: delete this file; put `activeTickets, completedTickets` back into
 * the effect's deps in TicketChat.tsx.
 */

/** Stable membership key for a ticket list — `_id`s in order. */
export const ticketIdsKey = (
  list: ReadonlyArray<{ _id?: unknown } | null | undefined>,
): string => list.map((t) => String(t?._id ?? '')).join(',');
