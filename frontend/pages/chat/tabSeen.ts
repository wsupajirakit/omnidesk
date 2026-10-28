/**
 * [FEAT-20260907-TABSEEN] Taking the orange OFF a status tab, without touching
 * anything that decides when it goes on.
 * ref: todo/task/07092026/fe_todo114_07092026_tabglowclear.md
 * ===========================================================================
 * WHAT WAS WRONG. The five tabs down the left of the ticket page — ส่วนตัว ·
 * รอรับเคส · กำลังคุย · ปิดเคส · บอทดูแล — turn their count badge orange from
 * TWO independent sources, and only one of them was ever cleared:
 *
 *   · `statusHasNew[tab]`  a new CASE landed here. Stored, and the tab's own
 *                          onClick already deletes it.
 *   · `tabHasUnread[tab]`  a CARD in here still holds an unread message.
 *                          DERIVED from `unreadByRoom`, never stored, so it can
 *                          only go out when the underlying unread does — which
 *                          means opening every unread card in the tab.
 *
 * So a tab stayed orange after the operator had looked at it, and there was no
 * way to say "seen". This module is that word, and nothing else.
 *
 * 🔴 IT DOES NOT TOUCH WHAT LIGHTS THE BADGE, and that is the whole constraint
 *    this was written under. `statusHasNew` keeps its meaning and its existing
 *    clear; `tabHasUnread` is not read differently, not stored, not changed;
 *    `unreadByRoom` is not written; no room is marked read; no request is sent;
 *    the tab's NUMBER is never touched, because a tab counts CASES and a card
 *    counts MESSAGES and mixing them makes both meaningless.
 *    The test of whether this went too far: delete this file and every reference
 *    to it, and the screen must behave exactly as it did before.
 *
 * ⚠️ WHY A SEPARATE FILE. `TicketChat.tsx` is ~4.5k lines and cannot be rendered
 *    in vitest, so a predicate living inline is untestable — the same reason
 *    `directTicketBadge.ts` and `ticketTagFilterOptions.ts` sit next door.
 *
 * revert: delete this file and its spec, drop `tabSeen` state and the four call
 * sites carrying this tag in `TicketChat.tsx`. Every badge returns to today's
 * behaviour with nothing else to undo.
 */

/** Which tabs the operator has acknowledged. Absent key = not acknowledged. */
export type TabSeen = Readonly<Record<string, boolean>>;

/** The two inputs a tab's colour is composed from, as the page already has them. */
export interface TabLitSources {
  readonly statusHasNew: Record<string, boolean>;
  readonly tabHasUnread: Record<string, boolean>;
}

/**
 * Is this tab orange right now?
 *
 * The first half is the existing composition, unchanged in meaning: a new case
 * OR an unread card. The second half is the only thing this feature adds.
 */
export function tabIsLit(key: string, src: TabLitSources, seen: TabSeen): boolean {
  const raw = !!src.statusHasNew[key] || !!src.tabHasUnread[key];
  return raw && !seen[key];
}

/**
 * Acknowledge one tab.
 *
 * Returns the SAME object when nothing changes, so a click on an already-seen
 * tab does not re-render the list behind it.
 */
export function markTabSeen(seen: TabSeen, key: string): TabSeen {
  if (seen[key]) return seen;
  return { ...seen, [key]: true };
}

/**
 * After acknowledging, is every tab quiet?
 *
 * 🔴 THIS IS "NOTHING IS ORANGE", NOT "ALL FIVE WERE CLICKED". A tab that was
 *    never orange satisfies it without being touched — three lit tabs means
 *    acknowledging those three is enough and the other two are irrelevant.
 *    Counting clicks instead would make the group's orange (below) almost
 *    unclearable, which is the opposite of the point.
 *
 * @param keys every tab key on screen, in any order.
 */
export function noTabLit(
  keys: readonly string[],
  src: TabLitSources,
  seen: TabSeen,
): boolean {
  return !keys.some((k) => tabIsLit(k, src, seen));
}

/**
 * A message arrived, so nothing is "already seen" any more.
 *
 * ⚠️ THIS IS THE LOAD-BEARING HALF. An acknowledgement that only ever went ON
 *    would kill the badge permanently: `tabHasUnread` stays true while the card
 *    is unread, so the flag would keep covering it and the next message would
 *    announce nothing at all. A badge that cannot come back is worse than one
 *    that will not go away.
 *
 * It is deliberately blanket rather than per-tab. Working out which tabs an
 * incoming room belongs to would need the ticket's `job_status` at the event
 * site plus a second copy of the grouping rule `tabHasUnread` already owns —
 * a competing opinion about tab membership, living next to the code that
 * decides what lights. The cost of the blanket form is small and visible: a tab
 * that was acknowledged lights again when a message arrives for a DIFFERENT
 * tab. That is a fair trade for keeping this feature entirely outside the
 * lighting path.
 */
export const NOTHING_SEEN: TabSeen = {};
