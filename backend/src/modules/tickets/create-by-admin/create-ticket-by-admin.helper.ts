/**
 * [FEAT-20260817-REOPENBYADMIN] "เปิดเคสอีกครั้ง" — reopen a CLOSED case as a
 * brand-new ticket owned by the admin who pressed the button.
 *
 * Why a NEW ticket and not a resurrection: `updateTicket` refuses job_status:1
 * and claims on a closed case by design (two layers — the 409 guard and the
 * `$ne:2` write filter), and the closed ticket is history that must not move.
 *
 * The heart is step 2, the ATOMIC CLAIM on `chat_rooms (user_id, hook_id)`:
 * one findOneAndUpdate with `assist_status: {$ne: true}` is simultaneously
 *   · the duplicate guard — two admins pressing at once, only one wins
 *     (there is NO unique index on tickets; the room row is the lock), and
 *   · the bot mute — assist_status:true is the switch webhook.service reads,
 *     so the bot cannot answer over the admin, and assist-notification cannot
 *     open a competing auto ticket.
 * Losing the claim creates NOTHING (no ticket, no divider, no history).
 *
 * ⚠️ THE ID TRAP (same as ticket-divider.helper.ts) — three ids look alike:
 * the LINE id (`Ubd88…`), the member `_id` (what `chat_rooms.user_id` and the
 * ticket's `chat_user_id`/`line_user_id` hold), and the room `_id`. The claim
 * matches on the MEMBER `_id`. ห้ามสลับ — สาม id คนละตัว.
 *
 * ⚠️ auto_unassist: while assist_status is true, a customer silent longer than
 * the hook's `auto_unassist_minutes` (default 30) flips it back and writes an
 * `auto_unassist` history row bound to the NEWEST ticket — i.e. the one this
 * helper just opened. That row is normal system behaviour, not admin error.
 *
 * Deps-object style on purpose (mirrors ticket-divider.helper.ts): no DI class,
 * directly testable, the service call site stays one line.
 *
 * revert: delete this folder, the `'reopen_by_admin'` variant in
 * ticket-divider.helper.ts, the DTO + route + service method, and the
 * insight-reports count branch.
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types, isValidObjectId, type Model } from 'mongoose';

import {
  type DividerVariant,
  actorLabel,
  writeTicketDivider,
} from '../ticket-divider.helper';
import {
  SYSTEM_CASE_CHAT_STATUS,
  SYSTEM_CASE_DIRECT_TICKET,
  SYSTEM_CASE_DIVIDER_VARIANT,
  SYSTEM_CASE_HISTORY_ACTION,
  SYSTEM_CASE_JOB_STATUS,
} from './open-by-system.constants';

type AnyModel = Model<Record<string, unknown>>;

export interface CreateTicketByAdminAuth {
  userId: string;
  username?: string | null;
  displayName?: string | null;
}

export interface CreateTicketByAdminDeps {
  ticketModel: AnyModel;
  chatRoomModel: AnyModel;
  chatMessageModel: AnyModel;
  assignHistoryModel: AnyModel;
  warn: (msg: string) => void;
}

export interface CreateTicketByAdminResult {
  ticket: Record<string, unknown>;
  /** the claimed room's _id — the FE dispatches tc:assist-changed with it */
  roomId: string;
  /**
   * [FIX-20260817-REOPENDIVIDER] the divider row's id, so the caller can
   * announce it (`message:new`). Null when no divider was written.
   */
  dividerMessageId: string | null;
}

/**
 * [FEAT-20260819-OPENFROMROOM] Steps 2–5 — claim the room, create the ticket,
 * write the divider, record the history — are IDENTICAL however the case starts.
 * They were lifted here verbatim so a second entry point could reuse them instead
 * of growing a second copy that drifts. `createTicketByAdmin` below is unchanged
 * in behaviour: same claim, same field values, same divider wording, same history
 * action; only the lines it now delegates moved.
 * ยกออกมาใช้ร่วม ไม่ได้แก้พฤติกรรมของเส้นเดิมเลย.
 */
async function claimRoomAndOpenCase(
  input: {
    memberId: unknown;
    hookId: unknown;
    /**
     * Who is opening it. `null` means the SYSTEM — see
     * `open-by-system.constants.ts` for what that changes and why.
     * The admin path passes an auth and is untouched by this.
     */
    auth: CreateTicketByAdminAuth | null;
    category: unknown;
    needDetail: unknown;
    /** divider variant + wording differ per entry point, nothing else does */
    dividerVariant: DividerVariant;
    /** Divider wording. The admin path builds "เปิดเคส โดย <ชื่อ>"; a system case
     *  states its reason instead, and the caller owns that sentence. */
    dividerContent?: string | null;
    historyAction: string;
    historyDetail: string;
  },
  deps: CreateTicketByAdminDeps,
): Promise<CreateTicketByAdminResult> {
  const { memberId, hookId, auth } = input;

  // ── 2) ATOMIC CLAIM — duplicate guard + bot mute in ONE command ───────────
  const room = (await deps.chatRoomModel
    .findOneAndUpdate(
      { user_id: memberId, hook_id: hookId, assist_status: { $ne: true } },
      { $set: { assist_status: true, last_assist_changed_at: new Date() } },
    )
    .lean()) as { _id?: Types.ObjectId } | null;
  if (!room?._id) {
    throw new ConflictException('ลูกค้ารายนี้มีเคสเปิดอยู่แล้ว');
  }

  // ── 3) the new ticket — verified template (new names; pre('save') mirrors
  //       the legacy line_* fields) ────────────────────────────────────────
  /* The only difference between "an admin opened and took it" and "a rule opened
     it and nobody has it yet". Everything below — the divider, the history row,
     the claim above — is identical, which is why there is one door and not two.
     ต่างกันแค่ก้อนนี้ ที่เหลือใช้เส้นเดียวกันหมด. */
  const ownership = auth
    ? {
        job_status: 1,
        chat_status: 'admin',
        admin_user_id: new Types.ObjectId(auth.userId),
        assigned_at: new Date(),
      }
    : {
        job_status: SYSTEM_CASE_JOB_STATUS,
        chat_status: SYSTEM_CASE_CHAT_STATUS,
        admin_user_id: null,
        direct_ticket: SYSTEM_CASE_DIRECT_TICKET,
        /* the reason, in the caller's own words. Only a string is taken —
           coercing whatever turns up would store "[object Object]". */
        direct_ticket_detail:
          typeof input.needDetail === 'string' ? input.needDetail : null,
      };
  const ticket = (await deps.ticketModel.create({
    hook_id: hookId,
    chat_user_id: memberId,
    ...ownership,
    category: input.category ?? 'Other',
    need_detail: input.needDetail ?? '',
  })) as Record<string, unknown>;

  // ── 4) divider — its own variant so reports can count each way of opening a
  //       case apart; the FE styles both the same blue as "รับเคส" ──────────
  const actor = auth
    ? actorLabel(auth.username, auth.displayName) || 'แอดมิน'
    : 'ระบบ';
  const divider = await writeTicketDivider(
    {
      memberId,
      hookId,
      variant: input.dividerVariant,
      content: input.dividerContent ?? `เปิดเคส โดย ${actor}`,
      actorName: actor,
      /* [FIX-20260820-DIVIDEROWNER] the row is stamped with the case it belongs
         to, so the dashboard never has to guess whether this case's line was
         already written — it stopped drawing a second one the moment this landed.
         ⚠️ MUST stay below `ticketModel.create` above: the stamp is that ticket's
         id, and reordering these two would silently stamp `undefined` and bring
         the duplicate line straight back.
         ต้องอยู่หลังสร้าง ticket เท่านั้น สลับที่เมื่อไหร่เส้นซ้ำกลับมาเงียบ ๆ. */
      ticketId: ticket['_id'],
    },
    {
      chatMessageModel: deps.chatMessageModel,
      chatRoomModel: deps.chatRoomModel,
      warn: deps.warn,
    },
  );

  // ── 5) assign history — the countable trace. A failure here must not undo
  //       the open (the admin already owns the case); warn and continue. ────
  try {
    await deps.assignHistoryModel.create({
      chat_room_id: room._id,
      ticket_id: ticket['_id'],
      // null on both = an unassigned case, which is what the schema says null means
      assign_to: auth ? new Types.ObjectId(auth.userId) : null,
      changed_by_id: auth ? new Types.ObjectId(auth.userId) : null,
      action: input.historyAction,
      detail: input.historyDetail,
    });
  } catch (err) {
    deps.warn(
      `[${input.historyAction.toUpperCase()}] assign_history write failed (ticket ${String(ticket['_id'])}): ${(err as Error).message}`,
    );
  }

  return {
    ticket,
    roomId: String(room._id),
    // [FIX-20260817-REOPENDIVIDER] the caller publishes message:new with this —
    // without it the divider sat in the DB unannounced and only surfaced when
    // the next real message forced a reload (owner saw exactly that).
    dividerMessageId: divider?.messageId ?? null,
  };
}

export async function createTicketByAdmin(
  input: { ticketId: string; auth: CreateTicketByAdminAuth },
  deps: CreateTicketByAdminDeps,
): Promise<CreateTicketByAdminResult> {
  const { ticketId, auth } = input;

  // ── 1) the closed source ticket decides member + hook ─────────────────────
  if (!isValidObjectId(ticketId)) {
    throw new NotFoundException('Ticket not found');
  }
  const old = (await deps.ticketModel.findById(ticketId).lean()) as Record<
    string,
    unknown
  > | null;
  if (!old) throw new NotFoundException('Ticket not found');
  if (old['job_status'] !== 2) {
    throw new ConflictException('เคสนี้ยังไม่ปิด เปิดใหม่ไม่ได้');
  }
  // Same legacy fallback the close path uses: new name first, old name second.
  const memberId = old['chat_user_id'] ?? old['line_user_id'];
  const hookId = old['hook_id'] ?? old['line_oa_hook_id'];
  if (!memberId || !hookId) {
    throw new ConflictException(
      'ตั๋วเดิมไม่มีข้อมูลลูกค้า/OA — เปิดใหม่ไม่ได้',
    );
  }

  return claimRoomAndOpenCase(
    {
      memberId,
      hookId,
      auth,
      category: old['category'],
      needDetail: old['need_detail'],
      dividerVariant: 'reopen_by_admin',
      historyAction: 'reopen_by_admin',
      historyDetail: `reopened_from_${ticketId}`,
    },
    deps,
  );
}

/**
 * [FEAT-20260819-OPENFROMROOM] Open the FIRST case for a conversation that never
 * had one.
 *
 * Deliberately NOT called a reopen: there is no earlier ticket, nothing is being
 * resurrected, and the owner asked for the distinction to be visible in the name
 * ("เรียกชื่อให้ชัดเจน มันไม่ใช่ re open"). The two paths differ only in where the
 * customer comes from and who chooses the category:
 *
 *   reopen  → a CLOSED ticket supplies member, hook, category and need_detail
 *   this    → a ROOM supplies member and hook; the admin types the rest
 *
 * Everything after that — the atomic claim that doubles as the duplicate guard
 * and the bot mute, the ticket template, the divider, the history row — is the
 * SAME shared code, so the two can never drift apart.
 * ต่างกันแค่ต้นทาง · ขั้นตอนหลังจากนั้นใช้โค้ดชุดเดียวกัน.
 */
export async function openTicketFromRoom(
  input: {
    roomId: string;
    auth: CreateTicketByAdminAuth;
    /** 'Other' | 'Payment' — the values the collection actually holds. */
    category?: string | null;
    /** Free text from the admin; empty falls back to a stated default. */
    needDetail?: string | null;
  },
  deps: CreateTicketByAdminDeps,
): Promise<CreateTicketByAdminResult> {
  const { roomId, auth } = input;

  // ── 1) the ROOM decides member + hook ─────────────────────────────────────
  if (!isValidObjectId(roomId)) {
    throw new NotFoundException('Chat room not found');
  }
  const room = (await deps.chatRoomModel.findById(roomId).lean()) as Record<
    string,
    unknown
  > | null;
  if (!room) throw new NotFoundException('Chat room not found');

  // `user_id` is the MEMBER `_id` — the same id the claim below matches on, and
  // NOT the LINE id. See the id trap at the top of this file.
  const memberId = room['user_id'];
  const hookId = room['hook_id'];
  if (!memberId || !hookId) {
    throw new ConflictException(
      'ห้องแชทนี้ไม่มีข้อมูลลูกค้า/OA — เปิดเคสไม่ได้',
    );
  }

  return claimRoomAndOpenCase(
    {
      memberId,
      hookId,
      auth,
      // 'Other' is what the collection stores for an uncategorised case.
      category: input.category || 'Other',
      needDetail: (input.needDetail ?? '').trim() || 'เปิดเคสโดยแอดมิน',
      dividerVariant: 'open_by_admin',
      historyAction: 'open_by_admin',
      historyDetail: `opened_from_room_${roomId}`,
    },
    deps,
  );
}

/**
 * Open a case that nobody has taken, because a rule said so.
 * ===========================================================================
 * The same door as `openTicketFromRoom` — same atomic claim, same duplicate
 * guard, same divider writer, same history row — with one difference: there is
 * no `auth`, so the case belongs to nobody and waits in the queue. What that
 * changes is four values, and they are named in `open-by-system.constants.ts`.
 * เปิดเคสเฉย ๆ ยังไม่มีคนรับ · ใช้ประตูเดียวกับเส้นแอดมิน.
 *
 * ⚠️ NOTHING IS HARDCODED HERE. The category, the need text and the divider
 * sentence all come from the caller, because only the caller knows why it is
 * opening a case. This function knows how, not why.
 * ค่าทั้งหมดมาจากผู้เรียก · ที่นี่รู้แค่ "ทำยังไง" ไม่ใช่ "ทำไม".
 *
 * Throws `ConflictException` when the room is already claimed — which is also
 * the duplicate guard: a customer already in a case cannot be opened again.
 *
 * revert: delete this function, `open-by-system.constants.ts`, and the `auth:
 * null` branch in `claimRoomAndOpenCase`.
 */
export async function openTicketBySystem(
  input: {
    roomId: string;
    /** 'Other' | 'Payment' — the values the collection actually holds. */
    category: string;
    /** Why the case exists, in the words the caller chose. */
    needDetail: string;
    /** The divider sentence. The caller owns the wording. */
    dividerContent: string;
  },
  deps: CreateTicketByAdminDeps,
): Promise<CreateTicketByAdminResult> {
  const { roomId } = input;
  if (!isValidObjectId(roomId)) {
    throw new NotFoundException('Chat room not found');
  }
  const room = (await deps.chatRoomModel.findById(roomId).lean()) as Record<
    string,
    unknown
  > | null;
  if (!room) throw new NotFoundException('Chat room not found');

  // the ROOM decides member + hook, exactly as the admin path does
  return claimRoomAndOpenCase(
    {
      memberId: room['user_id'],
      hookId: room['hook_id'],
      auth: null,
      category: input.category,
      needDetail: input.needDetail,
      dividerVariant: SYSTEM_CASE_DIVIDER_VARIANT,
      dividerContent: input.dividerContent,
      historyAction: SYSTEM_CASE_HISTORY_ACTION,
      historyDetail: `opened_by_system_from_room_${roomId}`,
    },
    deps,
  );
}
