import type { Model } from 'mongoose';

/**
 * ==== [FIX-20260810-TICKETDIVIDER] Transcript dividers for ticket events ====
 *
 * WHAT: writes the "รับเคส / ปิดเคส / โอนเคส / บอทกลับมาดูแลแล้ว" separator rows
 * that mark ticket events inside the chat transcript.
 *
 * WHY IT EXISTS: the dividers stopped appearing when this service was ported to
 * NestJS. `chat_messages` holds 203 of them, but the newest is dated 6 Aug and
 * then nothing — because `tickets.service.ts` never wrote one. Its own comment
 * admitted it: *"the ปิดเคส/บอทกลับมาดูแลแล้ว transcript dividers are a separate,
 * still-unported concern (needs chatHistory)"*. Nothing broke; the work was
 * simply never carried over. ไม่ใช่ของพัง — เป็นงานที่ยังไม่ได้ย้ายมา.
 *
 * WHY A SEPARATE FILE: `tickets.service.ts` is already ~1.3k lines and the owner
 * asked that it not grow. Callers spend one line per event; everything else is
 * here.
 *
 * WHY IT WRITES `chat_messages` DIRECTLY: `TicketsModule` already registers the
 * `ChatMessage` schema, so importing `ChatModule` for a single method would add
 * a cross-module dependency (and a cycle risk) for no gain. The document shape
 * below was copied field-by-field from a real row, not guessed.
 *
 * DOCUMENT SHAPE — verified against a live row (do not change without checking):
 * ```
 * { room_id, hook_id, channel_type: 'line', sender_type: 'admin',
 *   message_type: 'divider', content: 'รับเคส โดย dev (Developer)',
 *   metadata: { variant: 'accept', actor_name: 'dev (Developer)', assign_to } }
 * ```
 * `room_id` — NOT `member_id`. The rows are keyed to the chat room.
 * `metadata.variant` drives colour and icon on the frontend
 * (`ChatRoomView.tsx` → `DIVIDER_STYLES`); an unknown variant renders grey.
 *
 * SAFETY: never throws. A divider is decoration — failing to write one must not
 * fail accepting or closing a case, which is exactly how legacy behaved (log and
 * continue). Missing data is skipped silently rather than written as a junk row.
 * It also never touches `room.last_message`, so a divider cannot surface as the
 * newest message in the ticket list. เส้นคั่นพัง ห้ามทำให้ปิดเคสพัง.
 *
 * HOW TO ADD AN EVENT LATER: add the variant to `DividerVariant` here, add a
 * matching entry to `DIVIDER_STYLES` + `DIVIDER_ICONS` on the frontend, then call
 * `writeTicketDivider` from the place the event happens.
 *
 * revert: delete this file and the `[FIX-20260810-TICKETDIVIDER]` call sites in
 * `tickets.service.ts` — the transcript goes back to having no dividers.
 */

/** Variants the frontend knows. Must match `DIVIDER_STYLES` in ChatRoomView.tsx.
 *
 * `direct_ticket` — [FIX-20260811-PAYDIVIDER] a slip check that needed a human
 * while the room was ALREADY being handled. The frontend synthesises this divider
 * from `ticket.direct_ticket`, so it can only ever show ONE per case; a second
 * slip on the same open case left no trace at all. Writing a real row covers
 * every check. Its style already exists (`ChatRoomView.tsx` DIVIDER_STYLES),
 * so nothing on the frontend needs to change. */
export type DividerVariant =
  | 'accept'
  | 'close'
  | 'assign'
  | 'bot'
  | 'direct_ticket'
  // [FEAT-20260817-REOPENBYADMIN] an admin reopened a closed case as a new
  // ticket. Styled the same blue as 'accept' on the FE, but a variant of its
  // own so reports can count reopens apart from normal accepts.
  | 'reopen_by_admin'
  // [FEAT-20260819-OPENFROMROOM] an admin opened a case for a conversation that
  // never had one — NOT a reopen: there is no earlier ticket to reopen. Its own
  // variant so reports can tell "first case for this customer" from "reopened",
  // styled the same blue as 'accept' on the FE.
  | 'open_by_admin';

export interface TicketDividerDeps {
  chatMessageModel: Model<Record<string, unknown>>;
  chatRoomModel: Model<Record<string, unknown>>;
  warn: (msg: string) => void;
}

export interface WriteDividerInput {
  /** Member `_id` — used to find the room the divider belongs to. */
  memberId: unknown;
  hookId: unknown;
  variant: DividerVariant;
  content: string;
  /** Who performed it, already formatted (`dev (Developer)`). Stored for audit. */
  actorName?: string;
  /** Target admin on an `assign`, mirroring the legacy rows. */
  assignTo?: unknown;
  /**
   * [FIX-20260820-DIVIDEROWNER] The case this row was written FOR.
   *
   * WHY IT EXISTS. `ticket.direct_ticket` was carrying two meanings at once —
   * "the system opened this case" (the orange badge) and "nobody wrote the line,
   * please draw one" (the dashboard's synthetic divider). The second stopped
   * being true the day `claimRoomAndOpenCase` began writing a real row, but the
   * flag still said it, so a system-opened case drew its line twice. Stamping the
   * row lets the question "has this case's line already been written" be answered
   * BY THE ROW, exactly — not inferred from an actor name, a timestamp, or
   * anything else that happens to be nearby.
   * flag ตัวเดียวถือสองความหมาย ⇒ ให้คนเขียนแถวบอกความจริงข้อที่สองเอง.
   *
   * OPTIONAL AND ABSENT WHEN NOT GIVEN, which is what keeps every existing caller
   * — the slip path, accept, close, bot, assign — writing byte-identical rows. An
   * unstamped row is the honest representation of "written outside any one case",
   * and the dashboard reads its absence as "still draw the line", which is exactly
   * today's behaviour for every row already in the database.
   * ไม่ส่งมา = ไม่มีคีย์นี้ ⇒ ของเดิมทุกแถวเหมือนเดิมเป๊ะ ไม่ต้อง migrate.
   */
  ticketId?: unknown;
}

/**
 * Format an actor the way the existing rows do: `dev (Developer)`.
 *
 * ⚠️ The second argument is the human DISPLAY NAME — never the role.
 * [FIX-20260814-DIVIDERNAME] It used to be named `roleName`, and the only caller
 * duly passed `auth.roleName`, so live transcripts read `dev (superadmin)`
 * (confirmed in the DB: user `dev` has `display_name: 'Developer'`, and
 * `superadmin` is the row in `roles`). Every example in this file's own header
 * said `dev (Developer)`, so the label was always meant to be the display name —
 * the parameter name is what misled the call site. A role is permission data and
 * has no business appearing inside a customer conversation.
 * ชื่อพารามิเตอร์เดิมทำให้ป้อนผิดตัว — ตัวนี้คือชื่อที่ใช้แสดง ไม่ใช่ role.
 *
 * Returns `''` when the username is missing, leaving the decision to the caller.
 * Substituting "ระบบ" here would state something untrue when a person did act
 * and we merely failed to read their name.
 */
/* [DEC-2708-DIVIDERDISPLAY] Owner, 27/08 (หลังเห็นจอจริง): แถว divider **เก็บ
   เหมือนเดิม** — คู่ `dev (Developer)` อยู่ใน content/actor_name ตามที่เคยเป็น
   (ครั้งหนึ่งเคยแก้ให้เก็บ displayName เดี่ยว แล้ว revert ที่ commit นี้) ·
   ส่วน "แสดงแค่ displayName" เป็นหน้าที่ **ตอน render** ฝั่ง FE:
   `omnidesk-console/components/chat/dividerActorDisplay.ts` strip ตอนวาด
   ครอบทั้งแถวเก่า/ใหม่เท่ากัน — ข้อมูลไม่หาย จอสะอาด. */
export const actorLabel = (
  username?: string | null,
  displayName?: string | null,
): string => {
  const u = String(username ?? '').trim();
  if (!u) return '';
  const d = String(displayName ?? '').trim();
  // Identical values collapse: an operator whose display name IS their username
  // would otherwise read `dev (dev)`, which looks like a rendering fault.
  return d && d !== u ? `${u} (${d})` : u;
};

/**
 * Write one divider row into the transcript.
 *
 * Resolves the room from (member, hook) because the rows are keyed on `room_id`.
 * No room means no transcript to write into, so it skips.
 *
 * Safe to `await` or to fire and forget — it never rejects.
 */
export async function writeTicketDivider(
  input: WriteDividerInput,
  deps: TicketDividerDeps,
  // [FIX-20260817-REOPENDIVIDER] RETURN VALUE IS ADDITIVE: the written row's
  // ids, or null when nothing was written (no room / bad input / caught error).
  // Existing callers ignore it and behave exactly as before; a caller that
  // wants the transcript to update live needs them to publish `message:new`.
): Promise<{ messageId: string | null; roomId: unknown } | null> {
  const { memberId, hookId, variant, content, actorName, assignTo, ticketId } =
    input;

  if (!memberId || !hookId || !String(content ?? '').trim()) return null;

  try {
    /* `user_id` holds the member `_id`; `line_user_id`/`channel_user_id` hold the
       LINE id. Verified on a live row — matching on the wrong one silently finds
       no room and the divider is dropped without a trace.
       ห้ามสลับกับ line_user_id — คนละค่ากัน. */
    const room = await deps.chatRoomModel
      .findOne({ user_id: memberId, hook_id: hookId })
      .select('_id channel_type')
      .lean<{ _id?: unknown; channel_type?: string } | null>()
      .exec();

    if (!room?._id) return null;

    const created = await deps.chatMessageModel.create({
      room_id: room._id,
      hook_id: hookId,
      channel_type: room.channel_type || 'line',
      sender_type: 'admin',
      message_type: 'divider',
      content: String(content).trim(),
      metadata: {
        variant,
        ...(actorName ? { actor_name: actorName } : {}),
        /* [FIX-20260820-DIVIDEROWNER] stringified because the caller hands over
           `ticket._id`, an ObjectId — stored raw it would never compare equal to
           the string the dashboard holds. Same conditional shape as `actor_name`
           above, so a row written without a case keeps exactly the keys it had.
           แปลงเป็น string ไม่งั้นฝั่งหน้าจอเทียบไม่ติด. */
        ...(ticketId ? { ticket_id: String(ticketId) } : {}),
        ...(assignTo ? { assign_to: assignTo } : {}),
      },
      created_at: new Date(),
    });
    const createdId = (created as { _id?: { toString?: () => string } } | null)
      ?._id;
    return {
      messageId: createdId ? String(createdId) : null,
      roomId: room._id,
    };
  } catch (err) {
    deps.warn(
      `[TICKETDIVIDER] write "${variant}" failed: ${(err as Error).message}`,
    );
    return null;
  }
}

/**
 * [FIX-20260815-DIVIDERRETITLE] Retitle the divider when there is NO ticket.
 *
 * WHY A SECOND ENTRY POINT: `retitleDirectTicket` below needs a ticket id, and
 * the most common case does not have one. When the room is already claimed the
 * runner cannot open a ticket (`openPaymentTicketIfIdle` returns null), so
 * `ctx.directTicketId` stays null — yet the runner DID write a divider, and that
 * line is what the admin reads. This updates that line directly.
 *
 * ⚠️ EDITS ONLY, NEVER CREATES. `[FIX-20260811-PAYDIVIDER]` guarantees one
 * divider per check; creating one here would be the second. The caller only
 * invokes this when `ctx.dividerDone` is true, i.e. a row is known to exist.
 *
 * ⚠️ THE ID TRAP, read off live rows 15/08/2026 — these look alike and are not:
 *   the LINE id            e.g. `Ubd88e2612…`  ← what the caller has
 *   the member `_id`       e.g. `6a6de682…33d` ← what `chat_rooms.user_id` holds
 *   the room `_id`         e.g. `6a6de682…33e` ← what `chat_messages.room_id` holds
 * Skipping the member lookup and matching the room on the LINE id finds nothing
 * and fails silently. ห้ามข้ามขั้น — สาม id คนละตัว.
 *
 * Never throws: the customer's reply already went out.
 *
 * revert: delete this function and its single call in `sendPaymentReply`.
 */
/**
 * [REFACTOR-20260819-DIVIDERDOOR] ONE door for the `direct_ticket` divider.
 * ===========================================================================
 * The sentence an admin reads when the system opened a case for them was BUILT
 * IN THREE PLACES — once where the divider is created (payment-ticket.helper)
 * and twice where it is retitled (here, and the same block copied into
 * payment-ticket.helper). Filter, `sort: {created_at:-1}` and wording were
 * duplicated verbatim, comments included, so changing the wording in one place
 * would leave two transcripts disagreeing with no error anywhere.
 *
 * These two exports are that door. Room RESOLUTION deliberately stays with each
 * caller — one starts from a LINE id, the other already holds the member id, and
 * forcing one path on both would cost an extra query — but everything that
 * decides WHAT the row says lives here now.
 *
 * ⚠️ Behaviour is unchanged, deliberately: same filter, same sort, same `$set`,
 * same wording, same "never throws, returns false". This is a move, not a fix.
 * ย้ายอย่างเดียว ผลลัพธ์และตรรกะเท่าเดิมทุกประการ.
 *
 * revert: inline these two back into the three call sites.
 */
export const directTicketDividerText = (reason: string): string =>
  `เคสนี้สร้างโดยระบบ เนื่องจาก ${reason}`;

/**
 * Retitle the NEWEST `direct_ticket` divider of one room.
 *
 * Newest only, on purpose: older dividers belong to earlier checks and carry
 * their own amounts, so rewriting them would rewrite history.
 * Never throws — the customer's reply has already gone out by this point.
 */
export async function updateLatestDirectTicketDivider(
  input: { roomId: unknown; reason: string },
  deps: {
    chatMessageModel: Model<Record<string, unknown>>;
    warn: (msg: string) => void;
  },
): Promise<boolean> {
  const reason = String(input.reason ?? '').trim();
  if (!reason || !input.roomId) return false;
  try {
    const res = await deps.chatMessageModel
      .findOneAndUpdate(
        {
          room_id: input.roomId as never,
          message_type: 'divider',
          'metadata.variant': 'direct_ticket',
        },
        { $set: { content: directTicketDividerText(reason) } },
        { sort: { created_at: -1 } },
      )
      .exec();
    return !!res;
  } catch (err) {
    deps.warn(
      `[DIVIDERDOOR] could not retitle divider: ${(err as Error)?.message}`,
    );
    return false;
  }
}

export async function retitleLatestDivider(
  input: { channelUserId: string; hookId: unknown; reason: string },
  deps: {
    memberModel: Model<Record<string, unknown>>;
    chatRoomModel: Model<Record<string, unknown>>;
    chatMessageModel: Model<Record<string, unknown>>;
    warn: (msg: string) => void;
  },
): Promise<boolean> {
  const reason = String(input.reason ?? '').trim();
  // Blank reason ⇒ leave the existing wording alone (owner's fallback rule).
  if (!reason || !input.channelUserId || !input.hookId) return false;

  try {
    const member = await deps.memberModel
      .findOne({
        $or: [
          { member_user_id: input.channelUserId },
          { line_user_id: input.channelUserId },
        ],
      })
      .select('_id')
      .lean<{ _id?: unknown } | null>()
      .exec();
    if (!member?._id) return false;

    const room = await deps.chatRoomModel
      .findOne({ user_id: member._id, hook_id: input.hookId as never })
      .select('_id')
      .lean<{ _id?: unknown } | null>()
      .exec();
    if (!room?._id) return false;

    // [REFACTOR-20260819-DIVIDERDOOR] the update itself now lives in one place —
    // this function's own job is resolving WHICH room from a LINE id.
    return updateLatestDirectTicketDivider(
      { roomId: room._id, reason },
      { chatMessageModel: deps.chatMessageModel, warn: deps.warn },
    );
  } catch (err) {
    deps.warn(
      `[CARDTICKET] could not retitle divider: ${(err as Error)?.message}`,
    );
    return false;
  }
}
