/**
 * [FEAT-20260817-REOPENBYADMIN] Build the activeTickets card for a case the
 * signed-in admin just reopened.
 *
 * Why this exists: after POST /api/tickets/reopen-by-admin the card must move
 * completedTickets → activeTickets INSTANTLY, satisfying the "ส่วนตัว"/
 * "กำลังคุย" tab predicate (job_status===1 && admin_user_id===me). The generic
 * executeAction optimistic patch cannot do this — it maps over activeTickets,
 * where a closed case does not live, so the card would vanish from both lists.
 *
 * Pure on purpose (precedent: ticketTagFilterOptions.ts beside it) — the move
 * is deterministic and pinned by test/reopenTicketCard.test.ts without
 * mounting the 4,400-line page.
 *
 * revert: delete this file + its test + the executeReopen block in
 * TicketChat.tsx.
 */

export interface ReopenApiResponse {
  success?: boolean;
  data?: Record<string, unknown> | null;
  room_id?: string;
}

export const buildReopenedTicketCard = (
  source: Record<string, unknown>,
  resp: ReopenApiResponse,
  currentUser: Record<string, unknown> | null,
): Record<string, unknown> => {
  const fresh = (resp?.data ?? null) as Record<string, unknown> | null;
  return {
    // the source card carries everything the list card renders (customer/OA
    // data, room linkage); the fields below overwrite the closed-case state
    ...source,
    _id: (fresh?.['_id'] as string) ?? source['_id'],
    job_status: 1,
    chat_status: 'admin',
    admin_user_id: currentUser ? ((currentUser['id'] as string) ?? null) : null,
    // same UI-only shape executeAction fills on accept — the "ผู้ดูแลปัจจุบัน"
    // card reads admin_user_data, not admin_user_id
    admin_user_data: currentUser
      ? {
          _id: currentUser['id'],
          username: (currentUser['username'] as string) || '',
          display_name: (currentUser['display_name'] as string) || '',
          role: (currentUser['role'] as string) || '',
          email: (currentUser['email'] as string) || null,
        }
      : null,
    assigned_at:
      (fresh?.['assigned_at'] as string) ?? new Date().toISOString(),
    created_at: (fresh?.['created_at'] as string) ?? source['created_at'],
    // closed-case leftovers must not survive onto an open card
    resolved_at: null,
  };
};
