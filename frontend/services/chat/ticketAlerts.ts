/**
 * Ticket alert rules — what beeps, and what the card counter counts.
 * ===========================================================================
 * WHY THIS FILE EXISTS
 *   The two consumers sit far apart: the chime and the toast live in `App.tsx`
 *   (app-wide, one WS subscription), the badge lives in
 *   `pages/chat/TicketSupport.tsx` — a 4,000-line file on the max-lines waiver.
 *   Putting the rules in either one would bury them and make them untestable,
 *   and the waiver list may only shrink. So the rules live here, as pure
 *   functions with no React and no I/O, and both sides call them.
 *   กติกาอยู่ที่เดียว · ทั้ง 2 ฝั่งเรียกใช้ · เทสได้ตรง ๆ
 *
 * revert: delete this file, `test/ticketAlerts.value.test.ts`, and the call
 * sites in `App.tsx` and `pages/chat/TicketSupport.tsx`.
 */

/**
 * ⏱️ BURST GUARD — at most ONE chime inside this window, however many events
 * land. Owner-set: "ถ้าภายใน 4 วิ มีรัวๆ เสียงจะดังแค่ครั้งเดียว (ป้องกันรัวเสียง)".
 *
 * It also does a second job for free. A brand-new case publishes TWO alerting
 * events in the same request — `ticket:new` plus the `message:new` of its first
 * message — and the shared window swallows the second, so a new case still
 * beeps exactly once. That is why `App.tsx` must keep ONE cooldown clock for
 * every alerting event rather than one per event type.
 *
 * Tune here: raising it makes bursts quieter, lowering it lets a fast
 * back-and-forth beep more often. 4000 ms replaced a 5000 ms window that was
 * ticket-only. แก้ค่าที่นี่ที่เดียว.
 */
export const ALERT_SOUND_WINDOW_MS = 4000;

export interface TicketAlertEvent {
  type: string;
  data?: Record<string, unknown> | null;
}

const str = (v: unknown): string => (v == null ? '' : String(v));

/**
 * 🔔 THE CASE LIST — edit HERE to change what alerts. This is the one place
 * that decides; the callers only obey it.
 *
 * Alerting today:
 *   • `ticket:new`   — a new case arrives (existing behaviour, unchanged)
 *   • `message:new` where `sender_type === 'customer'` — a customer wrote in,
 *     including on a case that is already open or already being handled. This
 *     is the case the owner asked for: "กำลังคุย + รอรับเคส + ส่วนตัว ต้องมี noti
 *     ด้วย + เสียงด้วยเวลามันมีข้อความใหม่เข้ามา".
 *
 * Deliberately silent:
 *   • `sender_type` of `admin` / `bot` / `system` — our own outbound traffic and
 *     dividers; beeping at ourselves is noise, and the bot answers constantly.
 *   • `ticket:updated` / close / claim — a status change is not someone talking.
 *   • anything malformed — no `data`, no `sender_type`: stay silent rather than
 *     beep on an event we cannot explain.
 *
 * To add a case, add its condition here and a test in
 * `test/ticketAlerts.value.test.ts`. To silence customer messages again, delete
 * the `message:new` branch — `ticket:new` alone is exactly the old behaviour.
 */
export function shouldAlert(event: TicketAlertEvent): boolean {
  if (event?.type === 'ticket:new') return true;
  /* [FEAT-20260819-ABANDON] a customer who was asked to register, never did, and
     wrote again. The server publishes this ONCE per room — an atomic claim makes
     sure of it — so this cannot become a stream of chimes however fast that
     customer types. It is also the reason the bot-care tab, which is silent by
     design, is allowed to make a sound at all: this is the one thing in it that
     needs a person. ยิงครั้งเดียวจาก BE · แท็บบอทดูแลถึงจะมีเสียงได้. */
  /* [REMOVED-20260820-ABANDON] `room:abandon` used to chime here. The owner
     retired the alert on 2026-08-20 — the bot-care tab makes no sound at all
     now, which is what it did before the flag existed. */
  if (event?.type === 'message:new') {
    /* [FIX-20260820-BOTQUIET] the บอทดูแล tab makes no sound. Owner, 2026-08-20:
       "ทุกแบบที่เข้ามาใน บอทดูแล = ไม่ต้องมีเสียง".

       WHAT MAKES A ROW BELONG TO THAT TAB is BOTH halves of `botTabRows()` +
       `isBotModeTicket()`: no case still OPEN **and** the room is not held by an
       admin. The BE answers exactly that on the event (`bot_care`), because the
       chime lives app-wide in `App.tsx` and has no ticket list to consult.

       ⚠️ THE KEY WAS `has_open_case` AND THAT WAS WRONG — it carried only the
       first half, so a customer whose cases are all closed while an admin still
       holds the room would have been silenced too, and that customer sits in
       ปิดเคส. Owner: "เฉพาะบอทดูแล ห้ามกระทบตัวอื่นเด็ดขาด".
       ปิดเคสแล้วแต่แอดมินยังถือห้อง = คนละแท็บ ⇒ ต้องยังดัง.

       ⚠️ WHY NOT `assist_status`, which is right here on the event:
       `[FIX-20260819-ORPHANQUIET]` tried exactly that and was reverted. A case
       WAITING to be claimed (รอรับเคส) also carries `assist_status: false` —
       nobody has picked it up yet — so that rule silenced the customers most in
       need of a person. `job_status` 0 counts as OPEN, which is why this one does
       not have that failure. เคสรอรับก็ assist=false · ต้องใช้ has_open_case.

       ⚠️ ONLY AN EXPLICIT `false` SILENCES. A missing key — an older server, a
       replayed payload, a field that failed to compute — chimes. Too loud is
       recoverable; a customer silently dropped is not.
       ไม่รู้ = ดังไว้ก่อน. */
    if (event.data?.['bot_care'] === true) return false;

    /* [FIX-20260819-ORPHANQUIET] REVERTED, on purpose — read before trying again.
       An attempt to silence rooms with no case used the event's `assist_status`,
       but a WAITING case (รอรับเคส) has assist_status false too: nobody has
       claimed it yet. That rule silenced the very customers who are waiting for a
       human, across every tab. The owner's rule is narrower — quiet applies to
       the bot-care tab's ticket-less rows only — and `assist_status` cannot
       express it, so the chime stays exactly as it was.
       What WOULD express it is "does this customer have any case at all", which
       no message event carries today. รอรับเคสก็ assist=false — ใช้ค่านี้ตัดสินไม่ได้. */
    return str(event.data?.['sender_type']) === 'customer';
  }
  return false;
}

/**
 * Which ticket card an inbound message belongs to, or `null` when it cannot be
 * told for certain.
 *
 * The key is the LINE user id, and that is not a free choice: the ticket list
 * exposes no `chat_room_id` and no top-level `hook_id` — only
 * `line_user_data.line_user_id` — while `ticket.line_user_id` holds the MEMBER
 * ObjectId, not the LINE id. So the card and the event can only meet on the
 * LINE id, which the BE now sends (`chat-history.service.ts`,
 * `[FEAT-20260819-MSGEVENTUSER]`).
 *
 * ⚠️ Returns `null` — no badge — rather than guessing when the field is absent,
 * because an old BE that does not send it must show NO number instead of a
 * wrong one. ไม่มี key = ไม่ขึ้นเลข ดีกว่าขึ้นผิดใบ.
 */
export function inboundMessageKey(event: TicketAlertEvent): string | null {
  if (event?.type !== 'message:new') return null;
  if (str(event.data?.['sender_type']) !== 'customer') return null;
  const key = str(event.data?.['line_user_id']);
  return key || null;
}

/** +1 on one card. Returns a NEW map — React state is never mutated in place. */
export function bumpUnread(
  counts: Record<string, number>,
  key: string,
): Record<string, number> {
  return { ...counts, [key]: (counts[key] ?? 0) + 1 };
}

/**
 * Zero one card — called when the admin OPENS that chat, since the number means
 * "arrived while you were not looking". Owner: "เมื่อกดเปิดดูแชท badge เลขบนการ์ด
 * จะหายไป". Returns the SAME object when there is nothing to clear, so an open
 * on a card with no badge triggers no re-render.
 */
export function clearUnread(
  counts: Record<string, number>,
  key: string,
): Record<string, number> {
  if (!(key in counts)) return counts;
  const next = { ...counts };
  delete next[key];
  return next;
}

/**
 * ⏫ LIVE RE-SORT — when a customer writes, that card should rise in the lists
 * that are ordered by "latest activity". It cannot be read off the ticket row:
 * an inbound message touches NOTHING on the ticket (nothing bumps its
 * `updated_at`), which is why the list used to sit still. Rather than change
 * what `updated_at` means for every other reader — or add a column — the page
 * keeps the arrival time in memory and lets it RAISE the row's own time.
 *
 * Consequences, on purpose:
 *   • empty map ⇒ every list is byte-identical to before. Only a card that
 *     actually received a message during this session ever moves.
 *   • a reload forgets it and the order returns to the server's. Correct: this
 *     is a live hint, not stored state.
 *   • it only ever raises, never lowers — see `activityAt`.
 * ยกอันดับเฉพาะใบที่มีข้อความเข้าจริง · ไม่แตะ DB ไม่แตะความหมาย updated_at.
 */
export function markMessageAt(
  times: Record<string, number>,
  key: string,
  at: number,
): Record<string, number> {
  if (!Number.isFinite(at)) return times;
  // Keep the later of the two: WS events can arrive out of order, and a stale
  // one must never drag a card back down the list.
  if ((times[key] ?? 0) >= at) return times;
  return { ...times, [key]: at };
}

/**
 * The time a row should sort by: its own, raised by its newest message.
 * `Math.max` and not a replacement — a row the BE updated more recently than
 * the last message (a claim, a status change) must keep its own, higher time.
 */
export function activityAt(rowTime: number, messageAt?: number): number {
  return Math.max(rowTime || 0, messageAt ?? 0);
}

/**
 * How many unread messages a ticket card should show.
 *
 * A ticket row and a `message:new` event have almost no id in common, and the
 * two that look like they should match do not:
 *   • the list returns **no `chat_room_id`** (verified against the live endpoint);
 *   • `ticket.line_user_id` is the **member ObjectId**, never the room id.
 * The only shared id is the LINE U-string, which the row exposes as
 * `line_user_data.line_user_id` and the event now carries. All three keys are
 * tried so an older BE, or a row that does carry a room id, still matches.
 *
 * Kept here rather than inline because several places need the same answer — the
 * card badge, the parent tab's colour and the newest-first sort — and a second
 * copy of a key list is exactly how they drift apart.
 *
 * ⚠️ [FIX-20260819-OAKEY] THE KEY IS SCOPED BY OA, and it has to be.
 *   One customer can have a conversation on SEVERAL OAs — 8 of them do in the
 *   live data, one with three — because a room is keyed by (member, hook). The
 *   LINE id identifies a PERSON, not a conversation. Keyed on it alone, that
 *   customer writing to OA A lit the badge, coloured the tab and raised the card
 *   of their OA B conversation, where nobody had said a word.
 *   `hook_id:line_user_id` is the narrowest key BOTH the event and the ticket row
 *   can produce, so it is the key. The member-ObjectId form was dropped outright:
 *   it is what `ticket.line_user_id` holds, no event has ever carried it, and it
 *   could never have matched anything.
 *   คนหนึ่งมีหลายห้องได้จริงแล้ว · คีย์ต้องผูก OA ไม่งั้นเด้งข้าม OA.
 */
/**
 * [FEAT-20260820-MSGGLOW] Does this event light the GROUP tab (and, through it,
 * the `อื่นๆ` select's ring)?
 *
 * Owner, 2026-08-20: "เวลามีข้อความใหม่ในเคส ก็ให้สีส้มขึ้นด้วย ทั้งแท็บ hook list
 * เลย + select option ด้วยต้องส้มกรอบ" · "ห้ามกระทบ realtime ส่วนอื่น".
 *
 * WHY IT EXISTS AT ALL. Three of the four places the owner named already lit up
 * on a new message — the card's badge and orange text, and the status tabs, all
 * read the same unread map. The group tab was the one that did not: it is driven
 * by `groupHasNew`, which only a `ticket:new` ever set. This predicate is the
 * missing half, and the select needs nothing of its own because its ring is
 * derived from `groupHasNew` too.
 * ขาดชั้นเดียวคือแท็บกลุ่ม · select ติดตามมาเอง.
 *
 * ⚠️ A BOT-CARE ROW DOES NOT LIGHT IT. The owner's words are "ข้อความใหม่ **ในเคส**",
 * and a bot-care row has no case open — it is also the tab ordered silent earlier
 * the same day. The server ships that fact on the event, and `shouldAlert` above
 * reads the SAME key, so the badge and the chime can never disagree about which
 * rows are being left alone. ป้ายกับเสียงอ่านคีย์เดียวกัน จึงเพี้ยนจากกันไม่ได้.
 *
 * ⚠️ Only a CUSTOMER counts. An admin's own reply is not news to the admin, and
 * the bot answering is not news at all — the same rule the unread map applies.
 *
 * ⚠️ Missing key = LIGHT IT. An older server, a replayed payload or a field that
 * failed to compute must never make a waiting customer invisible; too visible is
 * recoverable. ไม่รู้ = แสดงไว้ก่อน.
 *
 * revert: delete this function and the `setGroupHasNew` call it guards in
 * `TicketChat.tsx`'s `message:new` branch. The group tab goes back to lighting
 * only for a new case.
 */
export function messageLightsGroupTab(event: unknown): boolean {
  const e = event as
    | { type?: unknown; data?: Record<string, unknown> | null }
    | null
    | undefined;
  if (!e || e.type !== 'message:new') return false;
  const data = e.data;
  if (!data || typeof data !== 'object') return false;
  if (data['sender_type'] !== 'customer') return false;
  /* the same key, compared the same way, as the chime above */
  if (data['bot_care'] === true) return false;
  return String(data['hook_id'] ?? '').trim() !== '';
}

export function customerEventKey(hookId: unknown, lineUserId: unknown): string {
  return `${String(hookId ?? '')}:${String(lineUserId ?? '')}`;
}

/**
 * [FIX-20260824-GROUPGLOW] Does this GROUP still hold any unread, judged from
 * the unread map alone?
 *
 * The group tab's orange is a FLAG (`groupHasNew`) — set by realtime, and until
 * today cleared only by `selectGroup`. Reading every card down to zero while
 * INSIDE the group re-evaluated nothing, so the orange outlived its reason —
 * the owner's report, verbatim: "0 แล้ว สีส้มต้องหาย … ตอน 0 มันไม่ออก".
 *
 * This is the missing evaluation, kept PURE so it is testable and so the
 * realtime handlers stay untouched (the owner's line: lighting is correct,
 * only the going-out is missing). A key counts toward the group when it is
 *   · `hookId:lineUserId` with hookId among the group's hooks, or
 *   · a room id among the group's ticket rooms;
 * anything else belongs to another group and must NOT keep this one lit.
 * Zero/absent counts never count. ธงดับเมื่อเหตุหมดจริงเท่านั้น.
 *
 * revert: delete this + its call in `openTicket`; the flag then clears only on
 * group switch again, exactly the pre-24/08 behaviour.
 */
export function groupStillHasUnread(
  counts: Record<string, number>,
  groupHookIds: ReadonlySet<string>,
  groupRoomIds: ReadonlySet<string>,
): boolean {
  for (const [key, n] of Object.entries(counts)) {
    if (!n) continue; // 0 = อ่านแล้ว ไม่ใช่เหตุให้ส้มค้าง
    const colon = key.indexOf(':');
    if (colon > 0) {
      if (groupHookIds.has(key.slice(0, colon))) return true;
    } else if (groupRoomIds.has(key)) {
      return true;
    }
  }
  return false;
}

export function unreadFor(
  counts: Record<string, number>,
  ticket: {
    chat_room_id?: string | null;
    line_oa_hook_id?: string | null;
    line_user_data?: { line_user_id?: string | null } | null;
  },
): number {
  return (
    // a room id is already conversation-scoped, so it needs no OA prefix
    counts[ticket?.chat_room_id ?? ''] ||
    counts[customerEventKey(ticket?.line_oa_hook_id, ticket?.line_user_data?.line_user_id)] ||
    0
  );
}
