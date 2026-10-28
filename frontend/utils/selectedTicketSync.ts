/**
 * [FIX-20260829-SELECTEDSTATUSSYNC] keep the open card's OWNERSHIP fields fresh
 * ===========================================================================
 * The list row is the truth about who holds a case and what state it is in. The
 * card on screen reads `selectedTicket`, a separate piece of state, so it has to
 * be reconciled against the refreshed row or the footer keeps offering to accept
 * a case somebody else already took.
 *
 * 🔴 `job_status` IS PART OF OWNERSHIP HERE. The footer decides with
 *    `selectedJobStatus === 1 && !isMyCase`, so copying the owner fields without
 *    the status leaves the held-by banner unreachable — the name was corrected
 *    for a banner that never rendered (`[FIX-20260823-CLAIMCAS]`).
 *
 * 🔴 A PATCH OF NAMED FIELDS, NEVER THE WHOLE ROW. `selectedTicket` also carries
 *    values the screen itself wrote — `customer_tags` is set straight onto it —
 *    and a full copy would quietly revert them.
 *
 * 🔴 `null` WHEN NOTHING MOVED. The caller runs on every `activeTickets` change;
 *    without this it would set state on every list tick and re-render the chat
 *    for nothing.
 *
 * ⚠️ Nothing realtime is involved: no socket handler, no fetch, no debounce.
 *    `usePartialTicketFetch` keeps its single job of writing `setActiveTickets`,
 *    and this only reads what landed there.
 *
 * revert: inline the old two-field compare back into the effect in
 *         `TicketChat.tsx` and delete this file.
 */

/** Only the fields that say who holds the case and what state it is in. */
export interface OwnershipPatch {
  job_status: unknown;
  admin_user_id: unknown;
  admin_user_data: unknown;
}

const idText = (v: unknown): string => String(v ?? '');
const statusText = (v: unknown): string => String(v ?? '');

/**
 * What the open card should take from the refreshed row — or `null` when it is
 * already in step, or the row is not the same ticket.
 */
export function ownershipPatch(
  prev: Record<string, unknown> | null | undefined,
  fresh: Record<string, unknown> | null | undefined,
): OwnershipPatch | null {
  if (!prev || !fresh) return null;
  if (idText(prev['_id']) !== idText(fresh['_id'])) return null;

  const sameOwner = idText(prev['admin_user_id']) === idText(fresh['admin_user_id']);
  const sameStatus = statusText(prev['job_status']) === statusText(fresh['job_status']);
  /* Both, not either — a row whose status moved while the owner string stayed
     equal is exactly the case the old owner-only guard skipped. */
  if (sameOwner && sameStatus) return null;

  return {
    job_status: fresh['job_status'],
    admin_user_id: fresh['admin_user_id'],
    admin_user_data: fresh['admin_user_data'],
  };
}
