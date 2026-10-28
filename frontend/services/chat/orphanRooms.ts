import type { ChatRoom } from './chatService';

/**
 * A conversation that never became a case, dressed as a ticket.
 * ===========================================================================
 * THE PROBLEM
 *   Every tab on the ticket page is built from TICKETS. A customer who wrote in
 *   and was never escalated has a chat_room and messages but no ticket row, so
 *   they appear in no tab, under no filter, and nobody ever sees them. On the
 *   dev data that was 6 rooms out of 34 — four of them a real customer who typed
 *   once and got no answer.
 *
 * WHY ONLY A MAPPER LIVES HERE
 *   The identity rule already exists: `getTicketUserKey` (pages/chat/ticketIdentity)
 *   is what the tabs, the counters and the pinning all key customers by. Writing a
 *   second "which customer is this" rule here is how the two drift apart, so the
 *   page subtracts with the EXISTING helper and this file only converts a room
 *   into the shape that helper — and the existing card — already understand.
 *   ใช้กติกาเดิม ไม่เขียนกฎซ้ำ · ไฟล์นี้แค่แปลงรูปห้องให้เป็นรูปตั๋ว.
 *
 * NOTHING IS STORED
 *   "Orphan" is a subtraction, not a field: no schema change, no flag, no
 *   backfill. The moment a case exists for that customer the row stops being an
 *   orphan on its own — which is exactly why opening a case turns the card from
 *   orange back to green with no extra code.
 *
 * revert: delete this file and the orphan branch in TicketChat.
 */

/** The marker a synthesized row carries. No document in the DB has this field. */
export const ORPHAN_FLAG = 'is_orphan_room' as const;

/**
 * `line_user_id` is set to the MEMBER id on purpose: that is what a real ticket
 * carries, and `getTicketUserKey` reads it, so a room and a ticket for the same
 * customer produce the SAME key and the subtraction works with no special case.
 *
 * `_id` is prefixed `orphan:` so a synthesized row can never be mistaken for a
 * real ticket id by anything that later stores or fetches one — a silent id
 * collision would be the worst failure this feature could have.
 *
 * `job_status: 2` because the bot-care tab reads the completed set; nothing about
 * a room without a case is "in progress".
 */
export function roomAsPseudoTicket(room: ChatRoom): Record<string, unknown> {
  const last = room?.last_message;
  return {
    _id: `orphan:${room._id}`,
    [ORPHAN_FLAG]: true,
    chat_room_id: room._id,
    line_user_id: room?.user_data?._id ?? (room as any)?.user_id ?? room?.line_user_id,
    line_user_data: room?.user_data,
    line_oa_hook_id: room?.hook_id,
    chat_status: 'bot',
    job_status: 2,
    category: null,
    need_detail: last?.text ?? '',
    created_at: last?.timestamp ?? null,
    updated_at: last?.timestamp ?? null,
  };
}

/**
 * [FIX-20260819-ORPHANQUIET] Should this row raise a badge or a chime?
 *
 * No — not for a conversation that never became a case. Owner, 2026-08-19:
 * "พวกที่เข้ามาตอนนี้ไม่ต้อง badge ไม่ต้องเด้ง noti". These rows exist so nobody is
 * forgotten, not so everybody is interrupted: the bot is handling them, no admin
 * owns them, and a new one appears every time a stranger says hello. Alerting on
 * them would train operators to ignore the alert that DOES matter.
 *
 * The orange ring already says "new, unhandled" at a glance — that is the whole
 * signal these rows get. แถวส้มบอกด้วยสีอยู่แล้ว ไม่ต้องดังไม่ต้องนับ.
 */
export function isQuietRow(ticket: unknown): boolean {
  return !!(ticket as Record<string, unknown> | null)?.[ORPHAN_FLAG];
}

/**
 * [FEAT-20260819-ORPHANROOM] The avatar ring, in ONE place.
 *
 * The same customer is drawn in three spots — the list card, the open
 * conversation's header, and the right-hand panel — and the owner wants the ring
 * identical in all three. Three copies of a two-branch class string is precisely
 * how they end up disagreeing after the next tweak, so the rule lives here and
 * the three call sites just ask.
 *
 * Green = a normal case. Orange = a conversation that never became one.
 * กติกาเดียว ใช้ทั้งสามจุด · เขียว = ปกติ · ส้ม = ยังไม่เคยมีเคส.
 */
export function avatarRingClass(ticket: unknown): string {
  return isQuietRow(ticket) ? 'ring-2 ring-orange-400' : 'ring-2 ring-emerald-400';
}

/**
 * [FIX-20260820-BOTCOUNT] The บอทดูแล tab's rows — ONE rule, every reader.
 * ===========================================================================
 * THE BUG THIS EXISTS TO END
 *   The tab listed its rows in one place and counted them in another. The list
 *   was closed cases PLUS rooms that never became a case; the count was computed
 *   from the cases alone. A customer with a room and no ticket therefore showed
 *   as a card that the tab's number did not include — seen in production
 *   2026-08-20: one card on screen, the badge reading 0.
 *   การ์ดขึ้นแต่เลขเป็น 0 เพราะนับคนละที่กับที่แสดง.
 *
 *   The header of this file already warned about it: "writing a second 'which
 *   customer is this' rule is how the two drift apart". They drifted in the
 *   counter. So the rows are built HERE, once, and every consumer reads the
 *   array — a number taken from `rows.length` cannot disagree with the rows.
 *
 * WHO SHOULD CALL IT
 *   · the visible list for the tab
 *   · the tab's counter
 *   · anything asking "is this customer one of the bot-care rows" — which is
 *     what a chime needs to stay silent for them
 *
 * ⚠️ GENERIC AND INJECTED ON PURPOSE. This file may not import the page: its
 * identity rule (`getTicketUserKey`) and its bot-mode test live there, and
 * importing them would make this untestable and circular. They arrive as
 * arguments, so the rule stays one rule and this file keeps importing nothing
 * but a type. ฉีดเข้ามา ไม่ import หน้าเพจ.
 *
 * revert: delete this function and inline it back into the two call sites in
 * `pages/chat/TicketChat.tsx` — the shape they had before this fix.
 */
export interface BotTabRowsInput<T> {
  /** Cases in progress. A customer with one is not in this tab at all. */
  activeTickets: T[];
  /** Closed cases — the rows this tab is built from. */
  completedTickets: T[];
  /** Every chat room in view, including those that never became a case. */
  rooms: ChatRoom[];
  /**
   * Members known to have had a case at some point, from the server. Answers
   * "EVER had a case", which the loaded lists cannot: they only hold the window
   * on screen. เคยมีเคสไหม ≠ มีเคสอยู่ในลิสต์ที่โหลดมา.
   */
  everTicketed: Iterable<string>;
  /** The ⚙️ date window in days. `undefined` = ทั้งหมด, no filtering. */
  withinDays?: number;
  /** Injectable clock so the window can be tested without waiting. */
  now?: number;
  /** The page's ONE identity rule. Never re-implement it here. */
  keyOf: (row: T) => string;
  /** The page's bot-mode test, for the closed cases half. */
  isBotMode: (row: T) => boolean;
  /** Turns a room into the row shape the card understands. */
  roomToRow: (room: ChatRoom) => T;
}

export function botTabRows<T>(input: BotTabRowsInput<T>): T[] {
  const {
    activeTickets,
    completedTickets,
    rooms,
    everTicketed,
    withinDays,
    now = Date.now(),
    keyOf,
    isBotMode,
    roomToRow,
  } = input;

  /* A customer with a case in progress belongs to กำลังคุย, not here. */
  const activeKeys = new Set(activeTickets.map(keyOf));
  const fromTickets = completedTickets.filter(
    (tk) => isBotMode(tk) && !activeKeys.has(keyOf(tk)),
  );

  /* A room drops out the moment ANY case exists for that customer — which is
     what makes "open a case and the card turns green" work with no extra code.
     `everTicketed` covers cases outside the loaded window. */
  const ticketedKeys = new Set(
    [...activeTickets, ...completedTickets].map(keyOf),
  );
  for (const memberId of everTicketed) ticketedKeys.add(`uid_${memberId}`);

  const fromRooms = rooms
    .map(roomToRow)
    .filter((row) => !ticketedKeys.has(keyOf(row)))
    .filter((row) => {
      if (withinDays === undefined) return true;
      const at = (row as { updated_at?: string; created_at?: string })
        .updated_at ??
        (row as { created_at?: string }).created_at;
      if (!at) return false; // no activity date → outside any window
      const ms = new Date(at).getTime();
      return Number.isFinite(ms) && ms >= now - withinDays * 86400000;
    });

  return [...fromTickets, ...fromRooms];
}
