/**
 * [FEAT-20260829-MANUALFOLLOWSTAMP] record a follow-up time by hand.
 * ===========================================================================
 * Owner 29/08: on the customer panel the two follow-up rows are pressable while
 * they read `n/a`. Pressing one records the follow-up time for that member —
 * deposit and withdraw are pressed separately, each behind its own confirm.
 *
 * · the only route that writes this way: `PATCH /api/line-users/:id/follow-up-stamp`
 * · `memberId` is the member's `_id`, NOT the LINE user id — same as its
 *   neighbour `ignoreAbandonService.ts`, and the reason that file says so twice
 * · the body carries a KIND, never a config key. The back end holds the
 *   allow-list (`omnidesk-api/src/modules/chat/member-follow-stamp.helper.ts`);
 *   this file must not grow a third kind on its own.
 *
 * ⚠️ Throws when the back end answers non-2xx (`handleApiResponse`). A stamp that
 *    already has a value is REFUSED there, so the caller must catch and leave the
 *    row as it was — never move the UI before the answer arrives.
 *
 * revert: delete this file and its use in
 *         `components/member/follow-up/FollowUpCard.tsx`.
 */
import { API_BASE_URL, authFetch, handleApiResponse } from '../apiClient';

/** The two things an admin may stamp. Mirrors FOLLOW_STAMP_KINDS on the server. */
export const FOLLOW_STAMP_KINDS = ['deposit', 'withdraw'] as const;

export type FollowStampKind = (typeof FOLLOW_STAMP_KINDS)[number];

/** Which panel row maps to which kind — the row keys the card already renders. */
export const FOLLOW_STAMP_KIND_BY_ROW: Readonly<Record<string, FollowStampKind>> =
  {
    notice_deposit_at: 'deposit',
    notice_withdraw_at: 'withdraw',
  };

/**
 * The kind for a follow-up row, or `null` when that row is not stampable.
 *
 * 🔴 This is what keeps the button off every other row. `FOLLOW_ROWS` and
 *    `ALERT_ROWS` can grow (`notice_payment_at`, `request_reg_at` are one
 *    uncommented line away), and those have their own writers and meanings —
 *    only the two rows named above may be stamped by hand.
 */
export const stampKindForRow = (rowKey: string): FollowStampKind | null =>
  FOLLOW_STAMP_KIND_BY_ROW[rowKey] ?? null;

export interface FollowStampResponse {
  success: boolean;
  data?: { kind: FollowStampKind; key: string; at: string };
}

export const followStampService = {
  setFollowStamp: async (
    memberId: string,
    kind: FollowStampKind,
  ): Promise<FollowStampResponse> => {
    const res = await authFetch(
      `${API_BASE_URL}/api/line-users/${memberId}/follow-up-stamp`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind }),
      },
    );
    return handleApiResponse<FollowStampResponse>(res, 'record follow-up time');
  },
};

/**
 * [FEAT-20260830-FOLLOWUPFRESH] the member's follow-up stamps, read NOW.
 *
 * WHY THIS EXISTS. The close-case dialog decided which sections to show from
 * `selectedRoom`, which the screen loaded when the admin opened the room and
 * never refreshed. Between opening a room and pressing "ปิดเคส" the stamps can
 * move underneath: the notice runtime writes them after a card goes out, a
 * multicast clears them, another admin presses the clock button on this panel.
 * The dialog then offered a choice about a stamp that was already gone — the
 * back end correctly did nothing, and the admin was left believing they acted.
 *
 * ⚠️ A GET, so opening the dialog can never change anything.
 * ⚠️ It answers about ONE member with a two-field projection — deliberately not
 *    another `GET /api/chat`, which repopulates the whole room.
 * ⚠️ Throws on non-2xx (`handleApiResponse`). The caller must decide what a
 *    failed read means; it must NOT silently fall back to stale data and call it
 *    fresh, because that is the bug this endpoint exists to close.
 */
export interface FollowStampSnapshot {
  member_id: string;
  line_user_id: string | null;
  /** ISO string, or null when the member carries no stamp. */
  deposit: string | null;
  withdraw: string | null;
  /** true only when the member carries BOTH registration stamps. */
  registration_pair: boolean;
}

export const readFollowStamps = async (
  memberId: string,
): Promise<FollowStampSnapshot> => {
  const res = await authFetch(
    `${API_BASE_URL}/api/line-users/${memberId}/follow-up-stamp`,
    { method: 'GET' },
  );
  const body = await handleApiResponse<{ success: boolean; data: FollowStampSnapshot }>(
    res,
    'read follow-up stamps',
  );
  return body.data;
};

/**
 * Turn a fresh snapshot into the shape the dialog already understands.
 *
 * 🔴 The point of this function is that `closeCaseTopicsFor` keeps ONE
 *    definition of "which sections show". Rather than teaching the dialog a
 *    second source of truth, the snapshot is rendered back into the same
 *    `user_data.config.follow_up.line` shape a room carries, so the existing
 *    rule decides — fresh data in, same decision out.
 * ⚠️ `registration_pair` is a boolean, so both registration stamps are written
 *    as the same placeholder date: the rule only asks whether they are PRESENT
 *    (see `CloseCaseSections.closeCaseTopicsFor`), never what they hold.
 */
export const snapshotToRoomShape = (
  snap: FollowStampSnapshot,
): { user_data: { _id: string; config: { follow_up: { line: Record<string, string> } } } } => {
  const line: Record<string, string> = {};
  if (snap.deposit) line.notice_deposit_at = snap.deposit;
  if (snap.withdraw) line.notice_withdraw_at = snap.withdraw;
  if (snap.registration_pair) {
    const present = new Date(0).toISOString();
    line.abandon_trigger_at = present;
    line.request_reg_at = present;
  }
  return {
    user_data: {
      _id: snap.member_id,
      config: { follow_up: { line } },
    },
  };
};
