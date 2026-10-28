import { API_BASE_URL, authFetch, handleApiResponse } from '../apiClient';

/**
 * [FEAT-20260826-STRIKESUSPEND] Reads for the strike screens.
 * ===========================================================================
 * 📖 PLAN: `omnidesk-api/todo/task/26082026/todo10_26082026_strike-suspend.md`
 *
 * WHAT THESE ARE FOR: showing an admin how often a customer has been rate-limited
 * and whether the bot has stopped answering them. Nothing here changes how
 * strikes are counted — that happens on the webhook path and this side never
 * touches it. ดูอย่างเดียว ไม่ได้ไปยุ่งกับการนับ
 *
 * ⚠️ NO NEW FETCH LOOP AND NO POLLING, on purpose. The screens hang these calls
 * off events that already happen — opening a room, pressing the existing refresh
 * button, opening the tray — so the cost is bounded by what the admin does, not
 * by how many customers exist. Measured server-side at 200,000 customers: the
 * per-customer read touches ONE document and the tray touches fifty, whatever
 * the collection size.
 *
 * ⚠️ PERMISSIONS ARE SPLIT AND THE SCREENS MUST RESPECT IT. Reading is
 * `ticket.manage`; CLEARING is `strike.manage`, which the seeder does NOT grant
 * retroactively — on a database that already had its roles, only accounts on the
 * superadmin/superuser role can clear today. A clear button offered to everyone
 * is a 403 waiting to happen, so the caller checks before rendering it.
 *
 * revert: delete this folder and the components that import it.
 */

/**
 * One row of the header tray.
 *
 * ⚠️ THE FOUR DISPLAY FIELDS ARE ALL OPTIONAL, and that is the normal case, not
 * an error case. `full_name` / `display_name` / `phone_number` come from a join
 * that finds nothing when the member row was never filled in, and `hook_alias`
 * is simply absent on strikes recorded before 26/08 — the column did not exist
 * yet and no backfill was run, deliberately (a session is short; clearing it
 * starts a fresh one that records the name). The row renders `n/a` for each
 * missing one. ขาดได้เป็นเรื่องปกติ ไม่ใช่ error
 */
export interface SuspendedEntry {
  _id: string;
  line_user_id: string;
  seq: number;
  strike_total: number;
  suspended_at: string;
  /* [FEAT-20260830-TRAYWHOBLOCKED] present ONLY when an admin pressed Block
     (`strike-admin.service.ts`); the strike ceiling never writes it.
     🔴 Read it — never infer the cause from `strike_total === 0`: a CEILING
        lock also sits at 0 once its events age out of the counting window, and
        guessing there labels that customer wrongly. */
  suspended_by?: string;
  opened_at: string;
  full_name?: string;
  display_name?: string;
  phone_number?: string;
  hook_alias?: string;
}

/** The numbers the server decides by. Never hold a copy of these in a component. */
export interface SuspendPolicy {
  suspend_at: number;
  window_hours: number;
}

export interface StrikeSessionView {
  _id: string;
  line_user_id: string;
  seq: number;
  status: string;
  strike_total: number;
  by_level: Record<string, number>;
  suspended_at?: string;
  /* [FEAT-20260827-ADMINBLOCK] present only when an ADMIN minted the lock —
     the gate (strike ceiling) never writes these two. Absence = gate lock. */
  suspended_by?: string;
  suspended_reason?: string;
  first_strike_at?: string;
  last_strike_at?: string;
  opened_at: string;
  closed_at?: string;
  closed_reason?: string;
}

export const strikeService = {
  /** Everyone the bot is currently ignoring, newest lock first. */
  listSuspended: async (
    limit = 50,
  ): Promise<{ suspended: SuspendedEntry[]; policy: SuspendPolicy }> => {
    const res = await authFetch(
      `${API_BASE_URL}/api/strikes/suspended?limit=${limit}`,
    );
    return handleApiResponse(res, 'list suspended');
  },

  /** The session that is counting for this customer right now. `null` is normal. */
  current: async (
    lineUserId: string,
  ): Promise<{ current: StrikeSessionView | null }> => {
    const res = await authFetch(
      `${API_BASE_URL}/api/strikes/${encodeURIComponent(lineUserId)}`,
    );
    return handleApiResponse(res, 'current strike session');
  },

  /** Every session this customer has had, newest first. */
  sessions: async (
    lineUserId: string,
    limit = 20,
  ): Promise<{ sessions: StrikeSessionView[] }> => {
    const res = await authFetch(
      `${API_BASE_URL}/api/strikes/${encodeURIComponent(lineUserId)}/sessions?limit=${limit}`,
    );
    return handleApiResponse(res, 'strike sessions');
  },

  /**
   * [FEAT-20260827-ADMINBLOCK] Block — "Block จำกัดการคุย".
   *
   * Puts the customer in the SAME state as reaching the strike cap: the bot
   * stops answering them immediately. The server stamps `suspended_at` plus
   * `suspended_by`/`suspended_reason` on the open session (creating one if the
   * customer never had a strike).
   *
   * ⚠️ `strike.manage`, same as clearing — check before offering the button.
   * ⚠️ 409 = already suspended (gate or another admin got there first): reload
   * and show the locked state, do not treat it as a failure to report.
   * ⚠️ Releasing is `clearSession` below — deliberately no separate unblock.
   */
  suspendSession: async (
    lineUserId: string,
    reason?: string,
  ): Promise<{ suspended: StrikeSessionView }> => {
    const res = await authFetch(
      `${API_BASE_URL}/api/strikes/${encodeURIComponent(lineUserId)}/suspend`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reason ? { reason } : {}),
      },
    );
    return handleApiResponse(res, 'suspend strike session');
  },

  /**
   * Close the counting session — "เคลียร์ session".
   *
   * ⚠️ `strike.manage`, not `ticket.manage`. Check before offering the button.
   * ⚠️ This is also what RELEASES a suspended customer: closing opens a fresh
   * session, and a fresh session carries no `suspended_at`. There is no separate
   * unsuspend call and there should never be one — a second door is a second
   * thing to forget. ปลดล็อกคือการเคลียร์ ไม่มีปุ่มปลดแยก
   */
  clearSession: async (
    sessionId: string,
    reason?: string,
  ): Promise<{ closed: StrikeSessionView }> => {
    const res = await authFetch(`${API_BASE_URL}/api/strikes/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'closed', ...(reason ? { reason } : {}) }),
    });
    return handleApiResponse(res, 'clear strike session');
  },
};

export default strikeService;
