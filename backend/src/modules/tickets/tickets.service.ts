/**
 * LIFTED — pending rewrite.
 *
 * Source: legacy-api/src/controllers/ticket/ticketController.js
 *
 * WHY IT IS NOT SPLIT YET
 * Per the accepted-debt policy in check-list.md, large legacy controllers move
 * in two steps. Step one ports the logic to TypeScript so it runs; step two
 * splits it once golden tests are in place. Doing both at once changes
 * framework and structure simultaneously, making any behavioural difference
 * unattributable. This file is step one for ticket management.
 *
 * WHAT UNBLOCKS SPLITTING
 * Every /api/tickets endpoint golden-green against the running legacy backend.
 *
 * "Lifted" means the same logic expressed in typed code — not JavaScript with a
 * new extension. There is no `any` and no `@ts-ignore` here.
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';

import { type AuthenticatedUser } from '@/common';
import { RealtimePublisherService } from '@/infra/realtime/realtime-publisher.service';
import { AuditLogService } from '@/modules/audit';
import { CustomerProviderService } from '@/modules/customer-provider';
import {
  AssignHistory,
  ChatMessage,
  ChatRoom,
  CustomerTag,
  Member,
  type AssignHistoryDocument,
  type ChatMessageDocument,
  type ChatRoomDocument,
  type CustomerTagDocument,
  type MemberDocument,
} from '@/modules/chat';
import {
  Hook,
  getAllowedHookIds,
  scopeFilter,
  type HookDocument,
} from '@/modules/hooks';

import type { ListTicketsQueryDto } from './dto';
import {
  LIST_MEMBER_POPULATE_EXCLUSION,
  trimListMember,
} from './list-member-trim';
import { trimListProfile } from './list-profile-trim';
import { Ticket, type TicketDocument } from './schemas/ticket.schema';
// [FEAT-20260817-REOPENBYADMIN] the reopen block — relative import inside the
// module (the barrel re-exports it for z-test and cross-module callers).
import { createTicketByAdmin, openTicketFromRoom } from './create-by-admin';
/* [DOC-20260821-BAGRULES] · [FEAT-20260826-CLOSECLEARFU] the per-member settings
   Relative, not `@/modules/chat/config`: the alias form is a layering error the
   linter rejects, and it is the path `webhook/follow-up/` and `customer-link/`
   already use to reach these shared helpers.
   bag. Which keys exist, who writes them and who may clear them all live in
   `src/modules/chat/config/member-config.registry.ts`; this file is named there
   as the close-case clearer. อ่านกติกาที่ registry ก่อนเสมอ

   ── BOTH ENDS ─────────────────────────────────────────────────────────────
   CLEARS `follow_up.line.abandon_trigger_at` AND `follow_up.line.request_reg_at`
   — WHOSE? the first is the flag written by `follow-up/abandon-trigger.helper.ts`
   and by `broadcast-follow-up/stamp-abandon-on-multicast.ts`, read for a decision
   by `follow-up/follow-up.gate.ts`. The second is the record written once by
   `webhook.service.ts`, read for COUNTING by
   `tickets/insight-registrations/insight-registrations.service.ts`.
   ON WHICH ROUTE: neither automatic one — an ADMIN ticking "ไม่ต้องติดตามการสมัคร
   ลูกค้านี้อีก" in the close-case confirm. It is the only human-driven clear.

   ⚠️ THE OTHER ROUTE HAS ITS OWN CLEARER — two of them, and they clear LESS
   than this one does: `follow-up/clear-follow-up.helper.ts` (webhook) and
   `customer-link/clear-follow-up-on-register.helper.ts` (link) both fire when
   the customer REGISTERS, and both deliberately leave `request_reg_at` alone so
   the registration can still be counted. This clear is the documented exception
   to that, confirmed by the owner on 26/08/2026 — see the registry entry for
   what an absent `request_reg_at` is allowed to mean afterwards.
   ห้ามไป "แก้ให้ครบ" ที่สองตัวนั้น — มันตั้งใจไม่ลบ

   ⚠️ It clears one leaf per call by dot-path, so a sibling key belonging to
   another feature is not merely spared — it is not addressable from here. */
import { clearMemberConfig } from '../chat/config';
/* [FEAT-20260827-PATCHAFTERCLOSE] the SAME audit writer the contact-screen
   switch uses, so both routes that flip `ignore_abandon_assist` leave one
   recognisable row. Relative for the same layering reason as the line above. */
import { auditAbandonShieldFlip } from '../chat/member-abandon-audit.helper';
import { buildFollowUpClear } from './close-case-follow-up.helper';
/* [FEAT-20260827-PATCHAFTERCLOSE] the close-case sections — see the block that
   uses it for which key belongs to whom. */
import {
  buildClearFollowUpNote,
  buildPatchAfterClose,
  type PatchAfterCloseAnswers,
} from './patch-after-close.helper';
import { actorLabel, writeTicketDivider } from './ticket-divider.helper';
import { casOwnerText, isCasRequested } from './cas-requested.util';
import { resolveWithinDaysCutoff } from './within-days.util';
import {
  TICKET_LIST_HARD_MAX,
  clampTicketPage,
  decodeTicketCursor,
  encodeTicketCursor,
  ticketCursorSeek,
} from './list-cursor.util';
import { parseTicketIds } from './list-ids.util';
/* [FEAT-20260905-CUSTPROV PART 3] the projection and the reader both take the
   ACTIVE provider's paths now — see the util's header for why the projection had
   to move too (a hardcoded projection strips a vendor's field before the reader
   ever sees it). */
import { memberTierKey, tierKeyProjection } from './member-tier-key.util';
import {
  MEMBER_SEARCH_MODE,
  type MemberLookupMode,
  buildMemberSearchQuery,
} from './member-search.util';

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  constructor(
    @InjectModel(Ticket.name)
    private readonly ticketModel: Model<TicketDocument>,
    @InjectModel(AssignHistory.name)
    private readonly assignHistoryModel: Model<AssignHistoryDocument>,
    @InjectModel(ChatRoom.name)
    private readonly chatRoomModel: Model<ChatRoomDocument>,
    @InjectModel(ChatMessage.name)
    private readonly chatMessageModel: Model<ChatMessageDocument>,
    @InjectModel(Member.name)
    private readonly memberModel: Model<MemberDocument>,
    @InjectModel(CustomerTag.name)
    private readonly customerTagModel: Model<CustomerTagDocument>,
    @InjectModel(Hook.name)
    private readonly hookModel: Model<HookDocument>,
    private readonly realtimePublisher: RealtimePublisherService,
    // [FEAT-20260808-AUDITSITE] audit_logs writer for clearTickets, matching
    // legacy ticketController.js auditLogService. Fire-and-forget below.
    private readonly auditLogService: AuditLogService,
    /* [FEAT-20260905-CUSTPROV PART 3] APPENDED LAST, and that is not a style
       choice: a constructor param inserted in the middle silently shifts every
       positional caller, and `{} as never` stubs in specs hide it from tsc.
       Same rule `members.service.ts` follows. ต่อท้ายเท่านั้น */
    private readonly customerProvider: CustomerProviderService,
  ) {}

  private formatTicket(ticket: unknown): Record<string, unknown> | null {
    if (!ticket) return null;
    const doc = (
      typeof (ticket as { toObject?: () => Record<string, unknown> })
        .toObject === 'function'
        ? (ticket as { toObject: () => Record<string, unknown> }).toObject()
        : ticket
    ) as Record<string, unknown>;

    const {
      line_user_id,
      admin_user_id,
      line_oa_hook_id,
      chat_user_id,
      hook_id,
      ...rest
    } = doc;
    const userRef = (chat_user_id || line_user_id) as
      Record<string, unknown> | string | null;
    const hookRef = (hook_id || line_oa_hook_id) as
      Record<string, unknown> | string | null;

    return {
      ...rest,
      line_user_id:
        userRef && typeof userRef === 'object' && '_id' in userRef
          ? userRef._id
          : userRef || null,
      line_user_data: userRef && typeof userRef === 'object' ? userRef : null,
      admin_user_id:
        admin_user_id &&
        typeof admin_user_id === 'object' &&
        '_id' in admin_user_id
          ? admin_user_id._id
          : admin_user_id || null,
      admin_user_data:
        admin_user_id && typeof admin_user_id === 'object'
          ? admin_user_id
          : null,
      line_oa_hook_id:
        hookRef && typeof hookRef === 'object' && '_id' in hookRef
          ? hookRef._id
          : hookRef || null,
      line_oa_hook_data:
        hookRef && typeof hookRef === 'object'
          ? {
              line_oa_name:
                (hookRef as { display_name?: string; line_oa_name?: string })
                  .display_name ||
                (hookRef as { line_oa_name?: string }).line_oa_name ||
                '',
            }
          : null,
    };
  }

  private async populateAttachedFiles(
    ticketDoc: unknown,
  ): Promise<Record<string, unknown> | null> {
    if (!ticketDoc) return null;
    const ticket = this.formatTicket(ticketDoc);
    if (!ticket) return null;

    let attached_files: unknown[] = [];
    if (ticket['line_user_id'] && ticket['line_oa_hook_id']) {
      const room = await this.chatRoomModel
        .findOne({
          user_id: ticket['line_user_id'],
          hook_id: ticket['line_oa_hook_id'],
        })
        .lean();

      if (room) {
        const ticketCreatedAt = new Date(
          (ticketDoc as { created_at?: string | Date }).created_at ||
            (ticket['created_at'] as string | Date),
        );
        const tenMinutesAgo = new Date(
          ticketCreatedAt.getTime() - 10 * 60 * 1000,
        );
        const threeMinutesLater = new Date(
          ticketCreatedAt.getTime() + 3 * 60 * 1000,
        );

        const messages = await this.chatMessageModel
          .find({
            room_id: room._id,
            message_type: 'image',
            created_at: {
              $gte: tenMinutesAgo,
              $lte: threeMinutesLater,
            },
          })
          .populate('internal_content_id')
          .sort({ created_at: -1 })
          .limit(10)
          .lean();

        attached_files = messages
          .map((msg) => {
            const internal = msg.internal_content_id as Record<
              string,
              unknown
            > | null;
            if (internal) {
              return {
                _id: internal._id,
                image_url: internal['image_url'],
                created_at: (msg as unknown as { created_at?: Date })
                  .created_at,
              };
            }
            return null;
          })
          .filter(Boolean);
      }
    }
    ticket['attached_files'] = attached_files;

    let assign_histories: unknown[] = [];
    if (ticket['_id']) {
      assign_histories = await this.assignHistoryModel
        .find({ ticket_id: ticket['_id'] })
        .populate('assign_to', 'username display_name email role')
        .populate('changed_by_id', 'username display_name email role')
        .sort({ created_at: -1 })
        .lean();
    }
    ticket['assign_histories'] = assign_histories;

    return ticket;
  }

  /**
   * Reads the id out of a ticket ref field, which is either a raw id or the
   * populated document — `chat_user_id` and `hook_id` arrive populated on the
   * list query and raw everywhere else.
   *
   * Returns `''` when the ref is absent, never `'undefined'` or
   * `'[object Object]'`: those would become real-looking keys in the room and
   * tag lookup maps and quietly match the wrong row.
   */
  private refIdToString(
    ref:
      | Types.ObjectId
      | string
      | { _id?: Types.ObjectId | string }
      | null
      | undefined,
  ): string {
    if (!ref) return '';
    if (typeof ref === 'string') return ref;
    if (ref instanceof Types.ObjectId) return ref.toHexString();
    const id = ref._id;
    if (!id) return '';
    return typeof id === 'string' ? id : id.toHexString();
  }

  /**
   * Adds `customer_tags`, `assign_histories` and `attached_files` to every row
   * of a ticket LIST — legacy `ticketController.js:370-481`.
   *
   * The detail endpoint builds the same three per ticket
   * (`populateAttachedFiles`); the list must not, because a page of 10 would
   * become 30+ round trips. Legacy answers it with a fixed number of batch
   * queries whatever the page size, and this is that same shape: four queries
   * (rooms, assign histories, image messages, customer tags) plus the populates
   * Mongoose folds into them.
   *
   * ⚠️ อย่าเปลี่ยนกลับไปเป็น query ต่อแถวเด็ดขาด — จำนวน query ต้องคงที่
   */
  private async enrichTicketRows(
    tickets: Array<Record<string, unknown>>,
    hookIds: Types.ObjectId[],
  ): Promise<Array<Record<string, unknown> | null>> {
    const ticketIds = tickets.map((t) => t['_id'] as Types.ObjectId);

    // `chat_user_id` arrives populated, so read through the object when present.
    const userIds = [
      ...new Set(
        tickets
          .map((t) =>
            this.refIdToString(
              t['chat_user_id'] as Parameters<
                TicketsService['refIdToString']
              >[0],
            ),
          )
          .filter(Boolean),
      ),
    ].map((id) => new Types.ObjectId(id));

    const [chatRooms, allAssignHistories] = await Promise.all([
      userIds.length > 0
        ? this.chatRoomModel
            .find({ hook_id: { $in: hookIds }, user_id: { $in: userIds } })
            .lean()
        : Promise.resolve([]),
      ticketIds.length > 0
        ? this.assignHistoryModel
            .find({ ticket_id: { $in: ticketIds } })
            .populate('assign_to', 'username display_name email role')
            .populate('changed_by_id', 'username display_name email role')
            .sort({ created_at: -1 })
            .lean()
        : Promise.resolve([]),
    ]);

    /**
     * Keyed by user AND hook, never by user alone: in group scope one member
     * holds a room under each OA they have written to, and a user-only key
     * attaches another OA's images to this ticket — a cross-OA data leak that
     * renders as a plausible-looking attachment.
     */
    const roomByUserAndHook: Record<string, (typeof chatRooms)[number]> = {};
    for (const room of chatRooms) {
      roomByUserAndHook[
        `${String(room.user_id)}|${String(room.hook_id ?? '')}`
      ] = room;
    }

    const assignByTicketId: Record<string, unknown[]> = {};
    for (const history of allAssignHistories) {
      const key = String(history.ticket_id);
      (assignByTicketId[key] ??= []).push(history);
    }

    // One query for every room's images; the per-ticket time window is applied
    // in memory below, exactly as legacy does.
    const allRoomIds = chatRooms.map((room) => room._id);
    const messagesByRoomId: Record<string, Array<Record<string, unknown>>> = {};
    /**
     * [PERF-20260826-TKTIMGENVELOPE] 📖 docs/bottleneck_26_aug.md (S1)
     * Bound the image read to the PAGE's own
     * time envelope — the other half of the defect `ticket-image-index.spec.ts`
     * measured (1,812 messages read to keep 81). That round fixed the INDEX
     * (message_type was a post-filter); the time bound was still missing, so a
     * room whose customer sends images daily paid for its whole history on
     * every list request, then threw almost all of it away against the
     * per-ticket window below.
     *
     * The envelope is [min(created_at) − 10 min, max(created_at) + 3 min] over
     * the page's tickets — the union of every per-ticket window, so a message
     * outside it can belong to NO ticket's window by construction. The
     * in-memory per-ticket filter below is UNTOUCHED and still the only thing
     * that decides; this only narrows what the database ships. Response
     * byte-identical — pinned by z-test/unit/ticket-image-envelope.spec.ts,
     * and the single-ticket path (`populateAttachedFiles` above) has carried
     * exactly this bound since legacy.
     *
     * ⚠️ The 10/3 numbers MUST stay equal to the per-ticket window below
     * (`tenMinutesAgo` / `threeMinutesLater`) — widen both or neither.
     *
     * A ticket whose created_at does not parse keeps nothing today (its NaN
     * window matches no message), so it is excluded from the envelope the same
     * way; a page with no parseable date skips the read outright.
     * ครอบช่วงเวลาเท่าที่หน้าต้องใช้ · ตัวตัดสินตัวเดิมยังอยู่ครบ ⇒ ไฟล์แนบเท่าเดิมทุกใบ
     * revert: drop the `created_at` key + the `ticketTimes` guard (find กลับไปไร้ขอบ).
     */
    const ticketTimes = tickets
      .map((t) => new Date(t['created_at'] as Date).getTime())
      .filter((ms) => Number.isFinite(ms));
    if (allRoomIds.length > 0 && ticketTimes.length > 0) {
      // reduce, not Math.min(...spread) — a `limit=all` page can be thousands
      // of rows and a spread that size risks the argument-count ceiling.
      const minAt = ticketTimes.reduce((a, b) => (b < a ? b : a));
      const maxAt = ticketTimes.reduce((a, b) => (b > a ? b : a));
      const allMessages = await this.chatMessageModel
        .find({
          room_id: { $in: allRoomIds },
          message_type: 'image',
          created_at: {
            $gte: new Date(minAt - 10 * 60 * 1000),
            $lte: new Date(maxAt + 3 * 60 * 1000),
          },
        })
        .populate('internal_content_id')
        .lean();
      for (const msg of allMessages) {
        const key = String((msg as { room_id: unknown }).room_id);
        (messagesByRoomId[key] ??= []).push(
          msg as unknown as Record<string, unknown>,
        );
      }
    }

    /**
     * Label text and colour live on the Tag, not on the join row, so they come
     * through a populate. Deliberately NOT filtered by group: a label already
     * applied to a customer shows in every group — hiding another group's
     * warning label would be more dangerous than showing it. Group filtering
     * belongs to the label picker only (legacy `ticketController.js:426`).
     */
    const tagsByMemberId: Record<string, unknown[]> = {};
    if (userIds.length > 0) {
      const allTags = await this.customerTagModel
        .find({ member_id: { $in: userIds } })
        .select('member_id tag_id created_at')
        .populate('tag_id', 'label color')
        .sort({ created_at: -1 })
        .lean();
      for (const row of allTags) {
        const key = String(row.member_id);
        const list = (tagsByMemberId[key] ??= []);
        const def =
          row.tag_id && typeof row.tag_id === 'object'
            ? (row.tag_id as unknown as {
                _id: unknown;
                label?: string;
                color?: string;
              })
            : null;
        // The tag was deleted but its join row survives → skip, so the screen
        // never renders an empty chip.
        if (!def) continue;
        list.push({
          _id: row._id,
          tag_id: def._id,
          label: def.label,
          color: def.color,
        });
      }
    }

    return tickets.map((ticket) => {
      const formattedTicket = this.formatTicket(ticket);
      if (!formattedTicket) return null;

      /* [PERF-20260820-LISTPROFILE] the LIST ships the member document whole, and
         five keys inside `raw_profile_data` are ~97% of its weight while nothing
         on the list reads them — a 2.7 MB response was about 1,168 rows carrying
         them. Trimmed HERE, in the list path only: the single-ticket endpoints,
         the raw-profile route and `PersonalPanel`'s own fetch all still get the
         full document. See `list-profile-trim.ts` for who reads what, and for why
         it removes named keys rather than keeping named ones.
         ตัดเฉพาะเส้นลิสต์ · เส้นรายตัวยังได้ครบเหมือนเดิม. */
      /* [PERF-20260822-LISTMEMBERTRIM] and then the member's own unread columns.
         Order matters only for readability: the profile trim reshapes a value
         INSIDE the member, the member trim removes columns AROUND it, and
         neither touches what the other looks at. `line_user_data` is 41.3% of
         a list response and these eight columns are 33.7% of that.
         See `list-member-trim.ts` for the reader traced behind every name kept.
         ตัดเฉพาะเส้นลิสต์เหมือนกัน · เส้นรายตัวยังได้ครบ. */
      const lud = formattedTicket['line_user_data'];
      if (lud && typeof lud === 'object') {
        const member = lud as Record<string, unknown>;
        const profileTrimmed = member['raw_profile_data']
          ? {
              ...member,
              raw_profile_data: trimListProfile(member['raw_profile_data']),
            }
          : member;
        formattedTicket['line_user_data'] = trimListMember(profileTrimmed);
      }

      type Ref = Parameters<TicketsService['refIdToString']>[0];
      const userId = this.refIdToString(ticket['chat_user_id'] as Ref);

      formattedTicket['customer_tags'] = userId
        ? (tagsByMemberId[userId] ?? [])
        : [];

      const ticketHookId = this.refIdToString(ticket['hook_id'] as Ref);

      let attachedFiles: unknown[] = [];
      if (userId) {
        const room = roomByUserAndHook[`${userId}|${ticketHookId}`];
        if (room) {
          // Images sent from 10 minutes before to 3 minutes after the ticket was
          // raised — the customer usually sends the slip just before, sometimes
          // just after.
          const ticketCreatedAt = new Date(ticket['created_at'] as Date);
          const tenMinutesAgo = new Date(
            ticketCreatedAt.getTime() - 10 * 60 * 1000,
          );
          const threeMinutesLater = new Date(
            ticketCreatedAt.getTime() + 3 * 60 * 1000,
          );
          const roomMessages = messagesByRoomId[String(room._id)] ?? [];

          attachedFiles = roomMessages
            .filter((msg) => {
              const at = new Date(msg['created_at'] as Date);
              return at >= tenMinutesAgo && at <= threeMinutesLater;
            })
            .sort(
              (a, b) =>
                new Date(b['created_at'] as Date).getTime() -
                new Date(a['created_at'] as Date).getTime(),
            )
            .slice(0, 10)
            .map((msg) => {
              const internal = msg['internal_content_id'] as Record<
                string,
                unknown
              > | null;
              return internal
                ? {
                    _id: internal['_id'],
                    image_url: internal['image_url'],
                    created_at: msg['created_at'],
                  }
                : null;
            })
            .filter(Boolean);
        }
      }
      formattedTicket['attached_files'] = attachedFiles;
      formattedTicket['assign_histories'] =
        assignByTicketId[String(ticket['_id'])] ?? [];

      return formattedTicket;
    });
  }

  private async resolveScopeHookIds(
    hookIdParam?: string,
    groupIdParam?: string,
    auth?: AuthenticatedUser,
  ): Promise<Types.ObjectId[]> {
    const allowed = await getAllowedHookIds(auth, this.hookModel);

    if (groupIdParam) {
      if (!isValidObjectId(groupIdParam)) {
        throw new BadRequestException(
          'Invalid or missing group_id in URL path',
        );
      }
      const hooks = await this.hookModel
        .find({ group: groupIdParam })
        .select('_id')
        .lean();
      const ids = hooks.map((h) => String(h._id));
      if (allowed === null) return ids.map((id) => new Types.ObjectId(id));
      return ids
        .filter((id) => allowed.includes(id))
        .map((id) => new Types.ObjectId(id));
    }

    if (!hookIdParam || !isValidObjectId(hookIdParam)) {
      throw new BadRequestException('Invalid or missing hook_id in URL path');
    }
    if (allowed !== null && !allowed.includes(String(hookIdParam))) {
      throw new ForbiddenException('insufficient OA access');
    }
    return [new Types.ObjectId(hookIdParam)];
  }

  private publishScopedTicketEvent(
    type: string,
    data: Record<string, unknown>,
  ): void {
    const hookIdObj = data['hook_id'] as
      { toString?: () => string } | undefined;
    const hookId =
      typeof data['hook_id'] === 'string'
        ? data['hook_id']
        : hookIdObj && typeof hookIdObj.toString === 'function'
          ? hookIdObj.toString()
          : '';
    if (!hookId) return;
    void this.realtimePublisher.publish(type, {
      ...data,
      hook_id: hookId,
    });
  }

  /**
   * [FEAT-20260817-REOPENBYADMIN] "เปิดเคสอีกครั้ง" — the whole reopen is one
   * BE block (claim → create → divider → history in the helper, then the
   * realtime publish here, because publishScopedTicketEvent is private).
   *
   * A NEW event type on purpose: `ticket:new` lights the "รอรับเคส" tab and
   * chimes every operator; `ticket:updated` only patches tickets already in
   * the list. `ticket:reopened` does neither — the FE moves the presser's card
   * locally and other admins refetch. The gateway forwards any type untouched.
   */
  public async reopenTicketByAdmin(
    ticketId: string,
    auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    if (!auth?.userId) {
      // The route sits behind the class guard, so this only fires on a broken
      // token payload — but admin_user_id must never be guessed.
      throw new ForbiddenException('ไม่ทราบตัวตนผู้กด');
    }
    const { ticket, roomId, dividerMessageId } = await createTicketByAdmin(
      {
        ticketId,
        auth: {
          userId: auth.userId,
          username: auth.username,
          displayName: auth.displayName,
        },
      },
      {
        ticketModel: this.ticketModel as never,
        chatRoomModel: this.chatRoomModel as never,
        chatMessageModel: this.chatMessageModel as never,
        assignHistoryModel: this.assignHistoryModel as never,
        warn: (msg) => this.logger.warn(msg),
      },
    );

    // [FIX-20260817-REOPENDIVIDER] announce the divider row itself, exactly as
    // every other bubble writer does (chat-media/chat.service). Without it the
    // open transcript showed the divider only after the NEXT message forced a
    // reload — the bug the owner hit on screen.
    if (dividerMessageId) {
      void this.realtimePublisher.publish('message:new', {
        hook_id: String(ticket['hook_id'] ?? ''),
        room_id: roomId,
        message_id: dividerMessageId,
      });
    }

    this.publishScopedTicketEvent('ticket:reopened', {
      _id: String(ticket['_id']),
      hook_id: ticket['hook_id'],
      job_status: 1,
      admin_user_id: String(auth.userId),
      category: ticket['category'] ?? null,
    });

    return {
      success: true,
      data: this.formatTicket(ticket) ?? ticket,
      room_id: roomId,
    };
  }

  /**
   * [FEAT-20260819-OPENFROMROOM] Open the FIRST case for a conversation that has
   * none — the rows the bot-care tab now surfaces from `chat_rooms`.
   *
   * NOT a reopen, and named so: there is no earlier ticket to resurrect. It runs
   * the SAME shared steps as `reopenTicketByAdmin` (atomic room claim → ticket →
   * divider → assign history), so a case opened this way is indistinguishable
   * downstream from any other admin-opened case, except for the divider variant
   * and history action, which stay distinct so reports can tell them apart.
   *
   * The event published is `ticket:new`, not `ticket:reopened`: to every other
   * screen this genuinely IS a new case appearing for the first time.
   * เส้นใหม่ ใช้ขั้นตอนเดิมทั้งหมด · ต่างแค่ชื่อ/variant ให้รายงานแยกออก.
   */
  public async openTicketFromRoom(
    roomId: string,
    choices: { category?: string | null; needDetail?: string | null },
    auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    if (!auth?.userId) {
      // Same reasoning as the reopen route: the guard already ran, so this only
      // fires on a broken token — and admin_user_id must never be guessed.
      throw new ForbiddenException('ไม่ทราบตัวตนผู้กด');
    }
    const {
      ticket,
      roomId: claimedRoomId,
      dividerMessageId,
    } = await openTicketFromRoom(
      {
        roomId,
        auth: {
          userId: auth.userId,
          username: auth.username,
          displayName: auth.displayName,
        },
        category: choices?.category ?? null,
        needDetail: choices?.needDetail ?? null,
      },
      {
        ticketModel: this.ticketModel as never,
        chatRoomModel: this.chatRoomModel as never,
        chatMessageModel: this.chatMessageModel as never,
        assignHistoryModel: this.assignHistoryModel as never,
        warn: (msg) => this.logger.warn(msg),
      },
    );

    // Same reason as [FIX-20260817-REOPENDIVIDER]: without announcing the divider
    // row it sits in the DB unseen until the next message forces a reload.
    if (dividerMessageId) {
      void this.realtimePublisher.publish('message:new', {
        hook_id: String(ticket['hook_id'] ?? ''),
        room_id: claimedRoomId,
        message_id: dividerMessageId,
      });
    }

    this.publishScopedTicketEvent('ticket:new', {
      _id: String(ticket['_id']),
      hook_id: ticket['hook_id'],
      job_status: 1,
      admin_user_id: String(auth.userId),
      category: ticket['category'] ?? null,
    });

    return {
      success: true,
      data: this.formatTicket(ticket) ?? ticket,
      room_id: claimedRoomId,
    };
  }

  public async createTicket(
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const ticket = await this.ticketModel.create(body);
    const populated = await this.populateAttachedFiles(ticket);

    if (populated) {
      const eventHookId =
        (populated['hook_id'] as string) ||
        (populated['line_oa_hook_id'] as string);
      if (eventHookId) {
        // [FEAT-20260808-GROUPB-HOOKNAME] Resolve the OA display name before the
        // realtime emit, restoring parity with legacy ticketController.js:125-134.
        // Legacy looks the hook up (`display_name || line_oa_name || alias || ''`)
        // and emits with that name; on any read error it falls back to '', which
        // is exactly what this port previously ALWAYS sent. FE EFFECT: the
        // admin-created ticket's realtime `ticket:new` payload / badge now carries
        // the OA name instead of a blank. DB-EFFECT: read-only — no write, no
        // schema change (the lookup is `.select(...).lean()`).
        void this.hookModel
          .findById(eventHookId)
          .select('line_oa_name display_name alias')
          .lean()
          .then((hook) => {
            const hookName =
              (hook?.['display_name'] as string) ||
              (hook?.['line_oa_name'] as string) ||
              (hook?.['alias'] as string) ||
              '';
            this.publishScopedTicketEvent('ticket:new', {
              _id: populated['_id'],
              hook_id: String(eventHookId),
              hook_name: hookName,
            });
          })
          .catch(() => {
            // Legacy's `.catch` re-emits with an empty name rather than dropping
            // the event — the badge still appears, just without the OA label.
            this.publishScopedTicketEvent('ticket:new', {
              _id: populated['_id'],
              hook_id: String(eventHookId),
              hook_name: '',
            });
          });
      }
    }

    return { success: true, data: populated };
  }

  public async listTierOptions(
    hookIdParam?: string,
    groupIdParam?: string,
    auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    const hookIds = await this.resolveScopeHookIds(
      hookIdParam,
      groupIdParam,
      auth,
    );
    if (hookIds.length === 0) return { success: true, data: [] };

    const rows = await this.ticketModel.aggregate([
      { $match: { hook_id: { $in: hookIds } } },
      { $group: { _id: '$chat_user_id' } },
      { $match: { _id: { $ne: null } } },
      {
        $lookup: {
          from: this.memberModel.collection.name,
          localField: '_id',
          foreignField: '_id',
          as: 'm',
          pipeline: [{ $project: { tier: 1 } }],
        },
      },
      { $unwind: '$m' },
      { $match: { 'm.tier': { $ne: null } } },
      {
        $group: {
          _id: {
            $toLower: {
              $toString: {
                $ifNull: [
                  {
                    $cond: [
                      { $eq: ['$m.tier.code', ''] },
                      null,
                      '$m.tier.code',
                    ],
                  },
                  {
                    $ifNull: [
                      {
                        $cond: [
                          { $eq: ['$m.tier.name', ''] },
                          null,
                          '$m.tier.name',
                        ],
                      },
                      '$m.tier.level',
                    ],
                  },
                ],
              },
            },
          },
          name: { $first: '$m.tier.name' },
          code: { $first: '$m.tier.code' },
          level: { $first: '$m.tier.level' },
          count: { $sum: 1 },
        },
      },
      { $match: { _id: { $nin: [null, '', 'null'] } } },
      { $sort: { level: 1, name: 1, _id: 1 } },
    ]);

    return {
      success: true,
      data: rows.map((r) => ({
        key: r._id,
        code: r.code || '',
        name: r.name || '',
        level: typeof r.level === 'number' ? r.level : null,
        count: r.count,
      })),
    };
  }

  public async listTickets(
    queryDto: ListTicketsQueryDto,
    hookIdParam?: string,
    groupIdParam?: string,
    auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    let hookIds = await this.resolveScopeHookIds(
      hookIdParam,
      groupIdParam,
      auth,
    );
    /* [FEAT-20260905-CUSTPROV PART 4] 📖 todo/task/05092026/todo3_05092026_
       profile_panel_module.md §20 — resolved ONCE per request (cheap, no I/O,
       `CustomerProviderService.resolve()` returns the same cached provider
       object every call) and read at EVERY exit of this method, including the
       two early-return branches below. Both switches default `true` on
       `shopapi_v1`, so an unset `CUSTOMER_PROVIDER` stamps a response that is
       byte-identical to today.
       🔴 Hiding a control must never hide a ROW: these two flags ride the SAME
       envelope `data`/`pagination` untouched — see z-test/unit/
       customer-provider-tierswitch.spec.ts for the row-count-unchanged proof.
       revert: drop `provider` and the two `show_tier_*` keys at the 3 returns. */
    const provider = this.customerProvider.resolve();
    /* [FEAT-20260826-TKTFILTERPARAMS] 📖 docs/bottleneck_26_aug.md (S5 · 3a)
       `oa` narrows the RESOLVED scope to that one hook — screen parity with
       the dashboard's OA dropdown (`tk.line_oa_hook_id !== filterOa` filters
       every other hook's rows to nothing), so an out-of-scope or garbage `oa`
       falls into the empty-response branch below without touching the
       collection. Absent/'' ⇒ this line is inert and the path is unchanged. */
    if (queryDto.oa !== undefined && queryDto.oa !== '') {
      hookIds = hookIds.filter((id) => String(id) === String(queryDto.oa));
    }
    if (hookIds.length === 0) {
      return {
        success: true,
        data: [],
        pagination: { total: 0, page: 1, limit: 0, pages: 0, total_pages: 0 },
        show_tier_badge: provider.showTierBadge,
        show_tier_filter: provider.showTierFilter,
        /* [FEAT-20260907-PROVCONDS] optional §6 switch — absent (shop-api) means
           the key drops from JSON and the dashboard keeps today's screen. */
        show_follow_ups: provider.showFollowUps,
        /* [FEAT-20260907-PROVCONDS] the register action + WalletPay card must be
           knowable even when the member's profile answer is null (the exact
           case the register box renders for) — so these two ALSO ride the
           list envelope. Same optional rule: absent (shop-api) = key dropped. */
        show_register_action: provider.showRegisterAction,
        show_walletpay_card: provider.showWalletpayCard,
      };
    }

    const {
      job_status,
      category,
      line_user_id,
      admin_user_id,
      page = '1',
      limit = '10',
      search,
      start_date,
      end_date,
      within_days,
      cursor,
      ids,
      tag,
      tier,
      counts,
    } = queryDto;

    /* [FEAT-20260826-TKTFILTERPARAMS] member-narrowing constraints (search /
       line_user_id / tag / tier) intersect as id-sets — AND, exactly the way
       the screen stacks its filters. The machinery exists ONLY when tag/tier
       is present: absent ⇒ null ⇒ every legacy line below runs byte-identical
       (the cursorMode pattern). */
    const memberSets: Types.ObjectId[][] | null =
      (tag !== undefined && tag !== '') || (tier !== undefined && tier !== '')
        ? []
        : null;

    /* [PERF-20260821-TICKETCURSOR] cursor mode is opt-in per request: the key
       must be PRESENT (empty string = first page). Absent → the legacy path
       below, untouched. A malformed cursor is a client error, not a scan. */
    const cursorMode = cursor !== undefined;
    const cursorKeys = cursorMode ? decodeTicketCursor(cursor) : null;
    if (cursorMode && cursorKeys === undefined) {
      throw new BadRequestException('invalid cursor');
    }
    /* [FEAT-20260826-TKTACTIVITYSORT] 📖 docs/bottleneck_26_aug.md (S7 · 3c)
       Opt-in activity order, recognised ONLY inside cursor mode: the open tab
       pages by (updated_at desc, _id desc) so page 1 is the working set.
       Everything that moves updated_at already emits ticket:updated (the
       ids-fetch pulls the row), and 3d adds the line_user_id float-up fetch —
       the screen's own lastMsgAt fold stays untouched. Absent / any other
       value / non-cursor requests: byte-identical created_at path (pinned by
       ticket-activity-sort.spec.ts). */
    const activityMode = cursorMode && queryDto.sort === 'activity';

    const filter: Record<string, unknown> =
      hookIds.length === 1
        ? { hook_id: hookIds[0] }
        : { hook_id: { $in: hookIds } };

    if (job_status !== undefined && job_status !== '') {
      if (typeof job_status === 'string' && job_status.includes(',')) {
        filter['job_status'] = { $in: job_status.split(',').map(Number) };
      } else {
        filter['job_status'] = Number(job_status);
      }
    }
    if (category) filter['category'] = category;
    /* [FIX-20260827-TKTMEMBERPARAM] one customer's tickets — the param is the
       member's ObjectId, and a wrong value now FAILS LOUDLY instead of silently
       widening the result to everyone.
       📖 todo/task/27082026/todo1_27082026_tickets-line-user-id-fix.md
       ==================================================================
       🔴 THE BUG THIS REPLACES: `if (line_user_id && isValidObjectId(…))` — a
       LINE id ("Uxxx…", 33 chars) fails the check, the whole filter block was
       SKIPPED, and the caller got every ticket in scope with no error anywhere.
       The FE calls this with `limit:'all'` relying on this very filter as the
       bound (TicketChat.tsx float-up), so a silently dropped filter is an
       unbounded fetch. Four separate call sites have been burned by this
       field name already (divider / catupgrade / payment / close-case).
       ตัวกรองที่หายเงียบ = คำตอบผิดที่ไม่มีใครรู้ · พังให้ดังดีกว่า

       `member_id` is the honest name for the same value; `line_user_id` stays
       accepted as the legacy alias (FE ships call sites with it — remove only
       when logs show no callers). Both set, disagreeing ⇒ 400: ambiguity must
       be loud, never a silent pick. Absent/'' ⇒ no filter, byte-identical to
       before. Validation lives HERE and not in the DTO because the hook route
       passes a raw `@Query() Record<string, unknown>` (tickets.controller.ts:136)
       that no DTO ever sees — this is the single choke point of both routes.
       revert: restore the 4-line `isValidObjectId` guard above this comment. */
    const memberIdParam = (queryDto as Record<string, unknown>)['member_id'] as
      string | undefined;
    /* [FIX-20260827-CHANNELUSERPARAM] `channel_user_id` — the customer's
       EXTERNAL id on their channel (the `Uxxx…` LINE string today), resolved to
       the member `_id` HERE so the filter below stays one shape.
       📖 todo/task/27082026/todo5_27082026_floatup-identity-contexts.md
       ==================================================================
       WHY A SECOND PARAM: proven by firing the real flow — the float-up's WS
       leg only has the external id (`message:new` carries `room.line_user_id`,
       chat-history.service.ts:450) while `member_id` takes the Mongo `_id`.
       The name is the channel-neutral one the migration already uses
       (`mirror-field-pair.ts`) and the FE already sends on other routes.

       The resolve covers BOTH names of the members mirror pair, exactly as
       ticket-category-upgrade.helper.ts:160 does — nothing here is pinned to
       the word "line", so a second channel's external id resolves the same way.

       🔴 UNKNOWN id ⇒ EMPTY LIST, immediately. Falling through unfiltered would
       be the silsilent-widening bug the 400 guard was built to kill; an id that
       matches nobody has an honest answer: no tickets.
       ⚠️ Sent together with a member id that resolves differently ⇒ 400, same
       ambiguity rule as the pair below.
       revert: delete this block; the float-up's WS leg then 400s again. */
    const channelUserParam = (queryDto as Record<string, unknown>)[
      'channel_user_id'
    ] as string | undefined;
    let channelResolvedId: string | undefined;
    if (channelUserParam && String(channelUserParam).trim()) {
      const ext = String(channelUserParam).trim();
      const member = await this.memberModel
        .findOne({ $or: [{ member_user_id: ext }, { line_user_id: ext }] })
        .select('_id')
        .lean<{ _id?: unknown } | null>()
        .exec();
      if (!member?._id) {
        return {
          success: true,
          data: [],
          pagination: { total: 0, page: 1, limit: 0, pages: 0, total_pages: 0 },
          // [FEAT-20260905-CUSTPROV PART 4] same `provider` resolved at the top
          // of listTickets — every exit stamps both switches, this one included.
          show_tier_badge: provider.showTierBadge,
          show_tier_filter: provider.showTierFilter,
          /* [FEAT-20260907-PROVCONDS] optional §6 switch — absent (shop-api) drops the
             key from JSON and the dashboard keeps today's screen. */
          show_follow_ups: provider.showFollowUps,
          /* [FEAT-20260907-PROVCONDS] the register action + WalletPay card must be
             knowable even when the member's profile answer is null (the exact
             case the register box renders for) — so these two ALSO ride the
             list envelope. Same optional rule: absent (shop-api) = key dropped. */
          show_register_action: provider.showRegisterAction,
          show_walletpay_card: provider.showWalletpayCard,
        };
      }
      channelResolvedId = String(member._id);
      const other = memberIdParam || line_user_id;
      if (other && String(other) !== channelResolvedId) {
        throw new BadRequestException(
          'channel_user_id resolves to a different member than member_id/line_user_id — send one identity',
        );
      }
    }
    if (
      memberIdParam &&
      line_user_id &&
      String(memberIdParam) !== String(line_user_id)
    ) {
      throw new BadRequestException(
        'member_id and line_user_id disagree — send one value (the member ObjectId)',
      );
    }
    const memberParam = channelResolvedId || memberIdParam || line_user_id;
    if (memberParam) {
      if (!isValidObjectId(memberParam)) {
        throw new BadRequestException(
          'line_user_id/member_id must be the member ObjectId (24 hex chars), ' +
            'not the LINE id — resolve the member first, as ' +
            'payment-ticket.helper.ts does',
        );
      }
      if (memberSets) memberSets.push([new Types.ObjectId(memberParam)]);
      else filter['chat_user_id'] = new Types.ObjectId(memberParam);
    }
    if (admin_user_id && isValidObjectId(admin_user_id)) {
      filter['admin_user_id'] = new Types.ObjectId(admin_user_id);
    }

    /* [PERF-20260821-MEMBERSEARCH] the ten-field $or that lived here moved,
       byte for byte, into member-search.util.ts as `legacy_regex` — the mode
       that ships. `tokens` (index-served, bounded, still global) is one switch
       away once the buckets have filled. The [FEAT-20260819-SERVERSEARCH]
       reasoning (raw-profile paths must stay searchable) lives in that file.
       `searchTruncated` surfaces the result cap to the caller; legacy mode never
       truncates. */
    let searchTruncated = false;
    /* [PERF-20260826-TKTSEARCHHYBRID] 📖 docs/bottleneck_26_aug.md (S3)
       `hybrid` mode: tokens leg first (index range scan), and the byte-identical
       legacy walk as the net when tokens found NOTHING or the term is too short
       for it — so a legacy member whose `search` buckets were never written
       (no backfill, owner's rule) can still be found. `search_mode` reports
       which leg answered, ONLY in hybrid, so the fallback share is measurable
       on stg before any flip. While MEMBER_SEARCH_MODE is `legacy_regex`
       (shipping default) every line below behaves exactly as before and the
       response carries no new key — pinned by ticket-search-through-builder +
       member-search-hybrid specs. revert: restore the single
       `buildMemberSearchQuery(search.trim())` call. */
    let hybridLegUsed: MemberLookupMode | undefined;
    if (search && search.trim()) {
      const term = search.trim();
      const configured = MEMBER_SEARCH_MODE;
      let leg: MemberLookupMode =
        configured === 'hybrid' ? 'tokens' : configured;
      let q = buildMemberSearchQuery(term, leg);
      if (configured === 'hybrid' && !q) {
        // too short for tokens — straight to the legacy walk, one query only
        leg = 'legacy_regex';
        q = buildMemberSearchQuery(term, leg);
      }
      if (!q) {
        // too short for the active mode (tokens: < 2 chars) — no member can match
        if (memberSets) memberSets.push([]);
        else filter['chat_user_id'] = { $in: [] };
      } else {
        let lookup = this.memberModel.find(q.filter, '_id');
        if (q.limit !== null) lookup = lookup.limit(q.limit);
        let matchingUsers = await lookup.lean();
        if (
          configured === 'hybrid' &&
          leg === 'tokens' &&
          matchingUsers.length === 0
        ) {
          // tokens knows only members written since the buckets shipped —
          // zero hits falls through to the full legacy walk so nobody with a
          // presence is missed. (Non-zero-but-incomplete is the known edge the
          // flip gate measures — see the spec header.)
          leg = 'legacy_regex';
          q = buildMemberSearchQuery(term, leg);
          if (q) {
            let fallback = this.memberModel.find(q.filter, '_id');
            if (q.limit !== null) fallback = fallback.limit(q.limit);
            matchingUsers = await fallback.lean();
          }
        }
        searchTruncated =
          q !== null && q.limit !== null && matchingUsers.length >= q.limit;
        if (memberSets) memberSets.push(matchingUsers.map((u) => u._id));
        else filter['chat_user_id'] = { $in: matchingUsers.map((u) => u._id) };
      }
      if (configured === 'hybrid') hybridLegUsed = leg;
    }

    if (start_date || end_date) {
      const dateFilter: Record<string, unknown> = {};
      if (start_date) dateFilter['$gte'] = new Date(start_date);
      if (end_date) {
        const endDateObj = new Date(end_date);
        endDateObj.setHours(23, 59, 59, 999);
        dateFilter['$lte'] = endDateObj;
      }
      filter['created_at'] = dateFilter;
    }

    /* [FEAT-20260808-TKTSCOPE] read-only filter, no writes. When within_days is
       in {2,3,4,5,7}, scope the list to `created_at >= now - N days`, the same
       field the tab-count aggregations below are scoped by, so list and badges
       stay coherent. Omitted/invalid → null → unbounded = today. Merges with any
       start/end_date $gte rather than clobbering it.

       ── [DOC-20260918-SCOPEFIELD] WHAT THIS COMMENT USED TO CLAIM, AND WHY IT
          WAS WRONG ────────────────────────────────────────────────────────────
       It said `created_at` is "the same field the list sorts by (so 'last N
       days' matches each card's date)". Neither half is true, and the gap is
       visible on screen:
         · the card renders `updated_at` — `TicketChat.tsx:4149`,
           `formatRelative(tk.updated_at)`
         · the dashboard re-sorts by `updated_at` too — `TicketChat.tsx:2544`
         · only `sort=activity` makes THIS service order by `updated_at`
           (`activityMode`, :985/:1313); the default order here is `created_at`

       So an operator reads a date off a card and expects the window to match it,
       and it does not. Measured on `local_db_10_aug_26`, 18/09: 119 of 176
       tickets have the two timestamps differing, one by 188 hours — opened
       10/09, last touched today. Filtering 7 days returned 0 rows while the top
       card read "18 ก.ย. @ 15:25", because that date is its `updated_at`.

       🔴 STAYING ON `created_at` IS THE OWNER'S DECISION, 18/09: the window means
       WHEN THE CASE WAS OPENED, not when it was last touched. Do not "fix" this
       to `updated_at` — a long-running case would then keep re-entering a window
       it was never opened in, and the badge counts would drift from what the
       word "7 วัน" says. 7 วัน = วันที่เปิดเคส ไม่ใช่วันที่แตะล่าสุด

       If the behaviour is ever revisited, the options considered were:
         (a) filter on `updated_at` — matches the card, but every long-running
             case re-enters the window forever;
         (b) filter on whichever of the two is newer — keeps both new and active
             cases, at the cost of a window with two meanings;
         (c) render `created_at` on the card — numbers agree, but an operator
             loses "when was this last touched", which is the more useful fact.
       Each changes the tab-count badges as well, because they share this filter.
       ref: todo/task/18092026/be_todo127_18092026_ticket-scope-field.md */
    const withinCutoff = resolveWithinDaysCutoff(within_days);
    if (withinCutoff) {
      const existing =
        (filter['created_at'] as Record<string, unknown> | undefined) ?? {};
      const priorGte = existing['$gte'] as Date | undefined;
      // If an explicit start_date is later than the window, keep the narrower
      // bound so neither filter is silently widened.
      existing['$gte'] =
        priorGte && priorGte > withinCutoff ? priorGte : withinCutoff;
      filter['created_at'] = existing;
    }

    /* [PERF-20260822-TKTIDSFETCH] a named subset, ANDed onto everything the
       request already asked for — hook scope, job_status, search, within_days
       all still apply, so this can only NARROW. Applied to `filter` itself
       (not just the find) because a subset request's `total` should describe
       the subset; the active list ignores `pagination` anyway, and the closed
       list — the only reader of `total` — never sends `ids`.
       ไม่มี ids = เหมือนเดิมทุกตัวอักษร. */
    /* [FEAT-20260826-TKTFILTERPARAMS] `tag` — the member set carrying that
       tag_id, global-unique ids exactly as the screen compares
       (`cg.tag_id === filterTag`). */
    if (memberSets && tag !== undefined && tag !== '') {
      const tagMembers = await this.customerTagModel.distinct('member_id', {
        tag_id: tag,
      });
      memberSets.push(tagMembers);
    }

    /* [FEAT-20260826-TKTFILTERPARAMS] `tier` — SCREEN key, computed in Node
       (member-tier-key.util.ts explains why an aggregation would drift). The
       candidate pool is the scope's own ticket-holding members (distinct over
       the filter built so far), read with the narrow projection — bounded by
       the scope's customer count, never a collection scan. Param compare is
       lowercased on both sides, same as the FE key. */
    if (memberSets && tier !== undefined && tier !== '') {
      const poolIds = await this.ticketModel.distinct('chat_user_id', filter);
      /* 🔴 ONE list of paths, used TWICE — the projection that fetches the field
         and the reader that keys it. They were two hardcoded copies until 05/09,
         which meant a vendor could change the paths and still get `null`,
         because Mongo had already stripped the field. Read once, here. */
      const tierPaths = this.customerProvider.resolve().tierPaths;
      const tierDocs =
        poolIds.length > 0
          ? await this.memberModel
              .find({ _id: { $in: poolIds } }, tierKeyProjection(tierPaths))
              .lean()
          : [];
      const wanted = String(tier).toLowerCase();
      memberSets.push(
        (tierDocs as unknown as Array<Record<string, unknown>>)
          .filter((d) => memberTierKey(d, tierPaths) === wanted)
          .map((d) => d['_id'] as Types.ObjectId),
      );
    }

    /* [FEAT-20260826-TKTFILTERPARAMS] intersect every member constraint —
       first set is the base, order preserved, so a lone constraint passes
       through exactly as it arrived. */
    if (memberSets && memberSets.length > 0) {
      let idsAllowed = memberSets[0] ?? [];
      for (const set of memberSets.slice(1)) {
        const keep = new Set(set.map(String));
        idsAllowed = idsAllowed.filter((id) => keep.has(String(id)));
      }
      filter['chat_user_id'] = { $in: idsAllowed };
    }

    /* [FEAT-20260826-TKTTABCOUNTS] 📖 docs/bottleneck_26_aug.md (S6 · 3b)
       Badge base = the filter as composed to THIS point: scope ∩ oa ∩
       category/dates ∩ every member constraint — but WITHOUT its own
       job_status (the tab family spans 0/1/2) and snapshotted BEFORE the
       `ids` subset below (a named-subset fetch must not shrink the badges).
       `counts` absent ⇒ null ⇒ nothing below runs — byte-identical. */
    const countsBase: Record<string, unknown> | null =
      counts !== undefined ? { ...filter } : null;
    if (countsBase) delete countsBase['job_status'];

    const ticketIds = parseTicketIds(ids);
    if (ticketIds.length > 0) filter['_id'] = { $in: ticketIds };

    /* [PERF-20260821-TICKETCURSOR] the seek is ANDed onto the filter for the
       FIND only; the COUNT keeps the plain filter because `total` is the size of
       the whole tab (the badge reads it), not of the page. */
    const findFilter: Record<string, unknown> = cursorKeys
      ? {
          ...filter,
          $or: ticketCursorSeek(
            cursorKeys,
            activityMode ? 'updated_at' : 'created_at',
          ),
        }
      : filter;

    let query = this.ticketModel
      .find(findFilter)
      // [PERF-20260826-TKTPOPTRIM] 📖 docs/bottleneck_26_aug.md (S2) — the LIST
      // populate carries the trim's own deny-list so the eight unread member
      // columns stop crossing the wire; trimListMember below stays as the net.
      // Member-level keys ONLY — the profile heavies must reach
      // trimListProfile in JS or its _trimmed marker (green ring) breaks.
      // Detail paths (getTicketById/updateTicket) stay FULL on purpose.
      .populate('chat_user_id', LIST_MEMBER_POPULATE_EXCLUSION)
      /**
       * [PERF-20260816-LOGTICKETSLIM] The populated hook document has exactly
       * one consumer, `formatTicket`, and it reads `_id` + `display_name` +
       * `line_oa_name` — nothing else. Without the field list Mongo shipped
       * the whole 10-106KB hook document (credentials included) per distinct
       * hook, to be discarded. The response is byte-identical either way,
       * proven by z-test/manual/prove-log-ticket-slim.js.
       *
       * Same list on the getTicketById and updateTicket populates below.
       * `chat_user_id` stays FULL on purpose: `formatTicket` ships that whole
       * document as `line_user_data`, so a field list there would change the
       * response. revert: drop the second argument at the three sites.
       */
      .populate('hook_id', 'display_name line_oa_name')
      .populate('admin_user_id', 'username display_name email role')
      // cursor mode needs the _id tiebreaker for a deterministic seek; the legacy
      // sort is left exactly as it was so nothing else reorders.
      .sort(
        cursorMode
          ? activityMode
            ? { updated_at: -1, _id: -1 }
            : { created_at: -1, _id: -1 }
          : { created_at: -1 },
      );

    const limitVal = limit === 'all' ? 'all' : Number(limit);
    let pageSize = 0;
    if (cursorMode) {
      // fetch one extra row to learn has_more without a second query
      pageSize = clampTicketPage(limit);
      query = query.limit(pageSize + 1);
    } else if (limitVal !== 'all') {
      const pageNum = Math.max(Number(page) || 1, 1);
      const limitNum = Math.max(Number(limitVal) || 10, 1);
      query = query.skip((pageNum - 1) * limitNum).limit(limitNum);
    } else if (TICKET_LIST_HARD_MAX > 0) {
      // the legacy unbounded mode, capped only once the owner raises the ceiling
      query = query.limit(TICKET_LIST_HARD_MAX);
    }

    /* [FEAT-20260826-TKTTABCOUNTS] one $group answers the whole tab family;
       `mine` = job_status 1 owned by the caller — with no (or invalid) caller
       the accumulator is a literal 0, never a comparison against null. */
    const mineUid =
      auth?.userId && isValidObjectId(String(auth.userId))
        ? new Types.ObjectId(String(auth.userId))
        : null;
    const [total, fetched, tabAgg] = await Promise.all([
      this.ticketModel.countDocuments(filter),
      query.lean(),
      countsBase
        ? (this.ticketModel.aggregate([
            { $match: countsBase },
            {
              $group: {
                _id: '$job_status',
                n: { $sum: 1 },
                mine: mineUid
                  ? {
                      $sum: {
                        $cond: [
                          {
                            $and: [
                              { $eq: ['$job_status', 1] },
                              { $eq: ['$admin_user_id', mineUid] },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                    }
                  : { $sum: 0 },
              },
            },
          ]) as Promise<Array<{ _id: number; n: number; mine: number }>>)
        : Promise.resolve(null),
    ]);
    const hasMore = cursorMode && fetched.length > pageSize;
    const tickets = hasMore ? fetched.slice(0, pageSize) : fetched;

    const formatted = await this.enrichTicketRows(
      tickets as unknown as Array<Record<string, unknown>>,
      hookIds,
    );

    const response: Record<string, unknown> = {
      success: true,
      data: formatted,
      /* [FEAT-20260905-CUSTPROV PART 4] 📖 todo/task/05092026/todo3_05092026_
         profile_panel_module.md §20-22 — the SAME `provider` resolved at the
         top of this method (before either early return). ALWAYS present
         (never conditional): `resolve()` never returns a partial provider, so
         there is no "absent" state to model here — the absent-means-default
         rule lives one level up, in how a provider ENTRY may omit the tier
         block (provider-entries.ts), not in this response.
         🔴 Additive only — `data`/`pagination` are computed identically above
         regardless of these values; hiding a control client-side must never
         change which rows were fetched, sorted or counted. */
      show_tier_badge: provider.showTierBadge,
      show_tier_filter: provider.showTierFilter,
      /* [FEAT-20260907-PROVCONDS] optional §6 switch — absent (shop-api) drops the
         key from JSON and the dashboard keeps today's screen. */
      show_follow_ups: provider.showFollowUps,
      /* [FEAT-20260907-PROVCONDS] same pair as the empty exits — the register
         box renders exactly when the profile answer is null, so these must
         ride the list envelope. Absent (shop-api) = keys dropped. */
      show_register_action: provider.showRegisterAction,
      show_walletpay_card: provider.showWalletpayCard,
      // [PERF-20260821-MEMBERSEARCH] present ONLY when the member lookup hit its
      // cap (tokens mode); absent otherwise, so every existing response is
      // byte-identical.
      ...(searchTruncated ? { search_truncated: true } : {}),
      // [FEAT-20260826-TKTTABCOUNTS] present ONLY when `counts` was asked for.
      ...(tabAgg
        ? {
            tab_counts: {
              waiting: tabAgg.find((r) => r._id === 0)?.n ?? 0,
              active: tabAgg.find((r) => r._id === 1)?.n ?? 0,
              mine: tabAgg.reduce((a, r) => a + (r.mine || 0), 0),
              ended: tabAgg.find((r) => r._id === 2)?.n ?? 0,
            },
          }
        : {}),
      // [PERF-20260826-TKTSEARCHHYBRID] present ONLY in hybrid mode — legacy/
      // tokens responses stay byte-identical (pinned).
      ...(hybridLegUsed ? { search_mode: hybridLegUsed } : {}),
    };

    if (cursorMode) {
      const last = tickets[tickets.length - 1] as
        | {
            created_at?: Date;
            updated_at?: Date;
            _id?: Types.ObjectId | string;
          }
        | undefined;
      // [FEAT-20260826-TKTACTIVITYSORT] activity mode resumes from the last
      // row's updated_at; a stampless row falls back to created_at rather
      // than crash the walk (timestamps make it near-impossible, not
      // impossible).
      const keyAt = activityMode
        ? (last?.updated_at ?? last?.created_at)
        : last?.created_at;
      response['pagination'] = {
        total,
        limit: pageSize,
        has_more: hasMore,
        next_cursor:
          hasMore && keyAt && last?._id
            ? encodeTicketCursor({
                created_at: new Date(keyAt),
                _id: String(last._id),
              })
            : null,
      };
    } else if (limitVal !== 'all') {
      const pageNum = Math.max(Number(page) || 1, 1);
      const limitNum = Math.max(Number(limitVal) || 10, 1);
      response['pagination'] = {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum),
        total_pages: Math.ceil(total / limitNum),
      };
    } else {
      response['pagination'] = {
        total,
        page: 1,
        limit: 'all',
        pages: 1,
        total_pages: 1,
      };
    }

    return response;
  }

  public async getTicketById(id: string): Promise<Record<string, unknown>> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid Ticket ID');
    }
    const ticket = await this.ticketModel
      .findById(id)
      .populate('chat_user_id')
      .populate('hook_id', 'display_name line_oa_name')
      .populate('admin_user_id', 'username display_name email role')
      .lean();

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    const populated = await this.populateAttachedFiles(ticket);
    return { success: true, data: populated };
  }

  public async updateTicket(
    id: string,
    body: Record<string, unknown>,
    auth?: AuthenticatedUser,
    // [FEAT-20260808-P3MINIMAL] opt-in fast-path — legacy ticketController.js:606
    // (`req.query.minimal === 'true'`). DEFAULT false reproduces today's behaviour
    // exactly (populate + populateAttachedFiles). When true, skip both the three
    // relational populates on the write AND populateAttachedFiles, returning the
    // lean ticket directly — a lighter payload the caller opted into. All
    // side-effects (race guards, dividers/close-resume, publish event) run
    // identically in both modes. DB-EFFECT: none (read-shaping only; no writes).
    minimal = false,
  ): Promise<Record<string, unknown>> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid Ticket ID');
    }

    const updateData = { ...body };

    /* ══ [FIX-20260823-CLAIMCAS] เจ้าของที่ผู้กดเห็นตอนกด — เงื่อนไข ไม่ใช่ข้อมูล ══
     * ถอดออกจาก `updateData` ก่อนทุกอย่าง ไม่งั้นมันไหลลง `$set` แล้วสร้าง field
     * ขยะในเอกสาร ticket · ค่านี้มีหน้าที่เดียวคือไปอยู่ในฟิลเตอร์ของคำสั่งเขียน
     * `''` (สตริงว่าง) = "ผู้กดเห็นว่ายังไม่มีใครถือ" ซึ่งต่างจาก undefined
     * (= ไม่ได้ส่งมา = ไม่ต้องตรวจ) จึงเช็คด้วย `in` ไม่ใช่ค่า truthy */
    /* 🔴 [FIX-20260824-CASGHOST] `in` ใช้ไม่ได้ที่นี่ — และมันทำงานพังจริงบน stg
       ═══════════════════════════════════════════════════════════════════════
       เดิมบรรทัดนี้เป็น `'expected_admin_user_id' in updateData` โดยตั้งใจให้
       `''` (เห็นว่าว่าง) ต่างจาก "ไม่ได้ส่งมา" — เจตนาถูก แต่กลไกผิด เพราะ
       `main.ts:132-141` เปิด `transform: true` ⇒ class-transformer สร้าง
       **ทุก property ที่ประกาศใน DTO ขึ้นมาเสมอ** แม้ client ไม่ได้ส่ง โดยให้ค่า
       `undefined` ⇒ คีย์ "มีอยู่" ตลอด ⇒ `casRequested` เป็น true **ทุกคำขอ**

       ผลที่ตามมา (เจอจริง 24/08 บน stg-omnidesk, ticket 6a8b8850…):
         `PUT /api/tickets/:id` body `{"admin_user_id":"…"}` (โอนเคส — ไม่มี
         expected) → casRequested=true → expectedOwnerRaw=undefined → falsy
         → casFilter = `{admin_user_id:{$in:[null,undefined]}}` = "ต้องยังไม่มี
         เจ้าของ" → แต่ตั๋วมีเจ้าของ (ตัวผู้กดเอง) → ไม่ match → 409
         **"เคสนี้ถูกรับไปแล้วโดยแอดมินท่านอื่น"** ทั้งที่ไม่มีใครแย่ง
       ⇒ พังทั้ง **รับเคส** และ **โอนเคส** และทุก PUT บนตั๋วที่มีเจ้าของแล้ว
       ⇒ กดซ้ำไม่มีวันหาย เพราะเงื่อนไขที่ตกไม่เคยเปลี่ยน

       ⚠️ DTO เขียนสัญญาไว้เองว่า "ไม่ส่งมา = พฤติกรรมเดิมทุกบรรทัด"
          (`dto/ticket.dto.ts:107-108`) — สัญญานั้นถูกผิดโดยบรรทัดนี้

       ✅ `!== undefined` รักษาความตั้งใจเดิมไว้ครบ:
            ไม่ส่ง  → undefined → ไม่ตรวจ (พฤติกรรมเดิม)
            ส่ง ''  → ตรวจว่า "ต้องยังว่างอยู่"      ← `''` ยังต่างจากไม่ส่ง
            ส่ง id  → ตรวจว่า "ต้องยังเป็นคนนั้น"
       ห้ามเปลี่ยนกลับเป็น `in` ตราบใดที่ ValidationPipe ยัง transform.

       revert: กลับเป็น `'expected_admin_user_id' in updateData` — แล้วโอนเคสจะพังอีก */
    const casRequested = isCasRequested(updateData);
    const expectedOwnerRaw = updateData['expected_admin_user_id'];
    delete updateData['expected_admin_user_id'];

    /* [FEAT-20260826-CLOSECLEARFU] a condition, never a stored column — same
       reason `expected_admin_user_id` is stripped one line above. Read the value
       first, then delete the key so it can never reach `$set` and invent a field
       on the ticket. ⚠️ read by VALUE: `transform: true` puts this key on every
       request as `undefined` (see [FIX-20260824-CASGHOST] above). */
    const clearFollowUpRequested = updateData['clear_follow_up'] as
      boolean | undefined;
    delete updateData['clear_follow_up'];

    /* [FEAT-20260827-PATCHAFTERCLOSE] the close-case SECTIONS. Same handling and
       the same reason as the line above: a condition, never a stored column, so
       it is read by value and deleted before `$set` could invent a field on the
       ticket. `undefined` = the dialog showed no section, or showed one and the
       admin's answer does not apply here. ไม่มี section ขึ้น = ไม่มีค่ามา = ปิดเคสปกติ */
    const patchAfterClose = updateData['patch_after_close'] as
      PatchAfterCloseAnswers | undefined;
    delete updateData['patch_after_close'];

    const before = await this.ticketModel
      .findById(id)
      .select(
        'job_status admin_user_id line_user_id chat_user_id hook_id line_oa_hook_id',
      )
      .lean();

    const adminIdObj = updateData['admin_user_id'] as
      { toString?: () => string } | undefined;
    const incomingAdminIdStr =
      typeof updateData['admin_user_id'] === 'string'
        ? updateData['admin_user_id']
        : adminIdObj && typeof adminIdObj.toString === 'function'
          ? adminIdObj.toString()
          : '';

    /* ══ [FIX-20260817-NOZEROREOPEN] one message per refusal reason ══════════
     * Used by BOTH the pre-check below and the lost-race branch after the
     * write, so a caller cannot tell the two apart — and the two strings that
     * already existed keep their exact wording (the golden suite compares them
     * against the legacy backend). ข้อความเดิมห้ามเปลี่ยน.
     */
    const closedMessage = (): string => {
      if (updateData['job_status'] === 2) return 'เคสนี้ถูกปิดไปแล้ว';
      if (updateData['job_status'] === 0) {
        return 'เคสนี้ถูกปิดไปแล้ว เปิดใหม่ต้องใช้ปุ่ม "เปิดเคส"';
      }
      return 'เคสนี้ถูกปิดไปแล้ว เคลม/รับไม่ได้';
    };

    if (before && before.job_status === 2) {
      if (updateData['job_status'] === 2) {
        throw new ConflictException(closedMessage());
      }
      const isClaim =
        updateData['admin_user_id'] !== undefined &&
        incomingAdminIdStr !== String(before.admin_user_id || '');
      if (updateData['job_status'] === 1 || isClaim) {
        throw new ConflictException(closedMessage());
      }
      /**
       * [FIX-20260817-NOZEROREOPEN] `0` used to walk straight past both this
       * guard and the write filter below, so `PUT /api/tickets/:id
       * {job_status:0}` resurrected a closed case as a HALF-BUILT one: no
       * divider, no assign-history row, `resolved_at`/`admin_user_id` still
       * pointing at whoever closed it, and — the part that reaches customers —
       * the room's `assist_status` left `false`, so the bot kept answering
       * while the queue showed a case waiting for a human.
       *
       * The route that reopens a case correctly is
       * `POST /api/tickets/reopen-by-admin` (atomic room claim → new ticket →
       * divider → history → `ticket:reopened`), which is why this one refuses
       * rather than trying to reproduce that sequence here.
       * revert: delete this block — 2 → 0 becomes writable again.
       */
      if (updateData['job_status'] === 0) {
        throw new ConflictException(closedMessage());
      }
    }

    if (updateData['job_status'] === 2 && before && before.job_status === 1) {
      // Deliberately NOT the shared isSuperUser(): legacy checks `superadmin`
      // alone here (ticketController.js:580), narrower than the group-scoping
      // rule. Widening it would let superuser/admin close other operators'
      // active tickets — a permission the legacy backend never granted.
      const roleName = (auth?.roleName || '').toLowerCase();
      const isSuper = roleName === 'superadmin';
      const currentUserId = auth?.userId;
      const ownerAdminId = before.admin_user_id;
      if (
        !isSuper &&
        ownerAdminId &&
        currentUserId &&
        String(ownerAdminId) !== String(currentUserId)
      ) {
        throw new ForbiddenException('กดปิดเคสได้เฉพาะเคสของตนเองเท่านั้น');
      }
    }

    if (updateData['job_status'] === 1) {
      if (before && before.job_status === 1) {
        const currentAdmin = before.admin_user_id
          ? String(before.admin_user_id)
          : undefined;
        if (!incomingAdminIdStr || incomingAdminIdStr === currentAdmin) {
          throw new ConflictException('Ticket already accepted');
        }
      }
    }

    if (updateData['job_status'] === 1 && !updateData['assigned_at']) {
      updateData['assigned_at'] = new Date();
    } else if (updateData['job_status'] === 2 && !updateData['resolved_at']) {
      updateData['resolved_at'] = new Date();
    }

    const isClaimWrite =
      updateData['admin_user_id'] !== undefined &&
      before &&
      incomingAdminIdStr !== String(before.admin_user_id || '');
    /**
     * [FIX-20260817-NOZEROREOPEN] `job_status !== undefined` replaces the old
     * `=== 2 || === 1` pair: ANY status write now carries `$ne: 2`, so the
     * refusal above is also atomic. The `before` read and this write are two
     * round trips — a case closed in between used to be reopened by whichever
     * request read first. Open cases are unaffected (0/1 both pass `$ne: 2`).
     */
    const refusesClosed =
      updateData['job_status'] !== undefined || Boolean(isClaimWrite);
    /**
     * [FIX-20260818-TICKETSCOPE · plan §8 = T3-3, closes audit C2.5] The filter
     * used to be `{ _id: id }` alone, so any authenticated operator could reassign,
     * close or PERMANENTLY DELETE another OA's ticket by id — the id is the only
     * thing they needed. The scope joins the same filter rather than becoming a
     * pre-check, so it composes with the closed-case guard above and the write
     * stays a single atomic operation.
     *
     * Both hook columns are matched: on the live rows `line_oa_hook_id` is set on
     * every ticket while `hook_id` is null on one, so either alone would strand a
     * row. Out of scope reads as "not found", which is the right disclosure.
     */
    const allowedTicketHooks = await getAllowedHookIds(auth, this.hookModel);
    const ticketScope = scopeFilter(allowedTicketHooks, [
      'hook_id',
      'line_oa_hook_id',
    ]);
    /* [FIX-20260823-CLAIMCAS] เงื่อนไข compare-and-swap — อยู่ในฟิลเตอร์ของคำสั่ง
       เขียนเดียวกัน จึงไม่มีช่องว่างระหว่าง "อ่านว่าใครถือ" กับ "เขียนทับ"
         · ผู้กดเห็นว่ามีคนถือ → ต้องยังเป็นคนนั้นอยู่
         · ผู้กดเห็นว่าว่าง    → ต้องยังว่างอยู่ (`null` หรือไม่มี field)
       ไม่ส่งมา = ไม่มีคีย์นี้ในฟิลเตอร์ = คิวรี่เดิมทุกตัวอักษร */
    /**
     * [FIX-20260830-CLAIMRACEGUARD] "รับเคสที่ยังว่าง" ต้องกันการแย่ง แม้ผู้เรียก
     * ไม่ได้ขอ — เพราะการกันแบบ opt-in กันได้เฉพาะผู้เรียกที่รู้ว่าต้องขอ
     * ═══════════════════════════════════════════════════════════════════════
     * `[FIX-20260823-CLAIMCAS]` ตั้งใจให้ "ไม่ส่ง = พฤติกรรมเดิม" เพื่อไม่ให้
     * **โอนเคส** พังซ้ำรอย `[FIX-20260824-CASGHOST]` — เจตนานั้นถูกและยังอยู่ครบ
     * แต่ผลข้างเคียงคือ **การกันแย่งเคสไปขึ้นกับว่า client ส่งค่ามาถูกหรือเปล่า**
     * ไม่ใช่ BE บังคับ · วัดจาก FE จริง: ปุ่มที่นำไปสู่การรับเคสมีสี่ทาง และเดิม
     * มีทางเดียวที่ส่ง `expected_admin_user_id` มา (TicketChat handleExecuteClaim)
     * ⇒ อีกสามทางเป็น last-write-wins: สองคนกดพร้อมกันได้ 200 ทั้งคู่ ไม่มี error
     *   ไม่มี log · คนแรกเห็นบนจอว่าตัวเองได้เคส ทั้งที่ DB เป็นของคนที่เขียนทีหลัง
     *
     * 🔑 ทำไมกันด้วย "เจ้าของว่าง" ไม่ใช่ "สถานะ 0 → 1"
     *    สิ่งที่สองคนแย่งกันคือ **ความเป็นเจ้าของ** ไม่ใช่ตัวเลขสถานะ · ตั๋วที่ถูก
     *    ปลดเจ้าของ (`admin_user_id: null` ขณะ `job_status` ยังเป็น 1) ยังว่างและ
     *    ยังแย่งกันได้ ⇒ ผูกกับสถานะจะเหลือรูตรงนั้น (มีเทสตรึงเคสนี้ไว้)
     *
     * 🔑 ทำไมถึง seamless — เงื่อนไขติดเฉพาะเมื่อ `before` บอกว่า **ยังไม่มีเจ้าของ**
     *    ⇒ โอนเคส (ตั๋วมีเจ้าของอยู่แล้ว) ไม่ถูกแตะเลย ซึ่งคือเคสที่พังจริงเมื่อ 24/08
     *    ⇒ ปิดเคส/เปลี่ยนหมวด/แก้ need_detail ไม่มี `admin_user_id` ในคำขอ
     *      ⇒ `isClaimWrite` เป็นเท็จ ⇒ ไม่ถูกแตะ
     *    ⇒ คำขอเดี่ยว ๆ (ไม่มีใครแย่ง) ตั๋วยังว่างจริง ฟิลเตอร์จึง match เหมือนเดิม
     *      ⇒ 200 เท่าเดิม · สิ่งเดียวที่เปลี่ยนคือ **คนที่แพ้ตอนแย่งกันจริง ได้ 409
     *      แทนที่จะได้ 200 หลอก ๆ**
     *
     * ⚠️ **`casRequested` ต้องชนะเสมอ — ห้ามสลับลำดับสาขานี้**
     *    ผู้เรียกที่ส่งเงื่อนไขมาเองต้องได้เงื่อนไขของตัวเอง ไม่ใช่ค่าที่ BE เดาให้
     *    (ไม่งั้น "รับเคสต่อ" บนตั๋วที่เพิ่งถูกปล่อยว่าง จะถูกกลบเป็น "ต้องว่าง"
     *     แล้วเขียนติดเงียบ ๆ บนความคาดหวังที่ล้าสมัย)
     *    เทสที่ตรึงข้อนี้: 'ตั๋ว**ว่าง** + ส่ง expected มา' ใน
     *    `ticket-claim-race-noexpected.spec.ts` — เป็นเคสเดียวที่แยกสองสาขานี้ออกจากกันได้
     * ⚠️ ใช้ `isClaimWrite` ตัวเดิมที่คำนวณไว้แล้วข้างบน ไม่คำนวณซ้ำ — มันคือ
     *    "คำขอนี้ตั้งเจ้าของคนใหม่จริงไหม" ซึ่งกรอง `before` เป็น null ออกให้แล้ว
     *    ⚠️ ส่วนที่กันเคส **ปลดเจ้าของ/โอนเคส** คือ `!before?.admin_user_id` ต่างหาก
     *       ไม่ใช่ `isClaimWrite` — ห้ามตัดพจน์นี้ทิ้งเด็ดขาด มันคือตัวเดียวที่ยืนระหว่าง
     *       โค้ดนี้กับการกลับมาของบั๊ก 24/08
     *
     * revert: ลบ `isUnownedClaim` + สาขาที่สามของ `casFilter` + `|| isUnownedClaim`
     *         ที่บล็อกรายงานผู้แพ้ ⇒ กลับไปเป็น opt-in ล้วนทุกบรรทัด
     */
    const isUnownedClaim =
      !casRequested && Boolean(isClaimWrite) && !before?.admin_user_id;

    const casFilter = casRequested
      ? expectedOwnerRaw
        ? { admin_user_id: expectedOwnerRaw }
        : { admin_user_id: { $in: [null, undefined] } }
      : isUnownedClaim
        ? { admin_user_id: { $in: [null, undefined] } }
        : {};

    const matchFilter = refusesClosed
      ? { _id: id, job_status: { $ne: 2 }, ...casFilter, ...ticketScope }
      : { _id: id, ...casFilter, ...ticketScope };

    // [FEAT-20260808-P3MINIMAL] legacy skips the three populates when minimal,
    // then returns the raw ticket (ticketController.js:620-625,742). Default
    // path keeps every populate exactly as before.
    const baseQuery = this.ticketModel.findOneAndUpdate(
      matchFilter,
      { $set: updateData },
      { new: true },
    );
    const ticket = await (
      minimal
        ? baseQuery
        : baseQuery
            .populate('chat_user_id')
            .populate('hook_id', 'display_name line_oa_name')
            .populate('admin_user_id', 'username display_name email role')
    ).lean();

    if (!ticket) {
      /* ══ [FIX-20260823-CLAIMCAS] แพ้การแย่งเคส — ต้องบอกความจริง ═══════════
       * ต้องมาก่อน `closedMessage()` ข้างล่าง ไม่งั้นคนที่แพ้จะได้ข้อความว่า
       * "เคสนี้ถูกปิดไปแล้ว" ซึ่ง **ไม่จริง** — เคสยังเปิดอยู่ แค่เปลี่ยนมือ
       * ⇒ แอดมินไปตามหาสาเหตุผิดทาง และกดซ้ำก็ยังได้ข้อความเดิม
       *
       * อ่านสถานะสดอีกรอบ เพราะ `before` ถูกอ่าน **ก่อน** การเขียน ⇒ ถ้ามีคนแย่ง
       * ระหว่างนั้น `before` คือของเก่า จะรายงานผิด
       * ⚠️ query เพิ่มนี้เกิด **เฉพาะตอนแพ้** ซึ่งคือกรณีที่สองคนกดพร้อมกันจริง ๆ
       *    ไม่ใช่เส้นทางปกติ ⇒ ไม่เพิ่มภาระตอนใช้งานทั่วไปแม้แต่ครั้งเดียว
       */
      /* [FIX-20260830-CLAIMRACEGUARD] `|| isUnownedClaim` — คนที่แพ้ต้องรู้ความจริง
         เงื่อนไขที่ BE เติมให้เอง (ผู้เรียกไม่ได้ส่ง expected) ก็ทำให้เขียนไม่ติดได้
         เหมือนกัน ⇒ ถ้าไม่นับรวมตรงนี้ คนที่แพ้จะตกไปที่ `closedMessage()` ข้างล่าง
         แล้วได้ข้อความ **"เคสนี้ถูกปิดไปแล้ว"** ซึ่งไม่จริง — เคสยังเปิดอยู่ แค่เปลี่ยนมือ
         ⇒ แอดมินไปตามหาสาเหตุผิดทาง และ FE แยกสองเรื่องนี้ด้วยข้อความ
           (TicketChat.tsx:1090 จับ /ถูกรับไปแล้วโดยแอดมินท่านอื่น/ เพื่อไม่ปิดหน้าเคสทิ้ง)
         `expectedOwnerRaw` เป็น undefined ในเส้นนี้ ⇒ `casOwnerText()` คืน `''`
         = "ผู้กดคาดว่ายังไม่มีเจ้าของ" ซึ่งเป็นความจริงพอดี ⇒ `ownerMoved` ทำงานถูก
         โดยไม่ต้องเพิ่มตัวแปรใหม่ */
      if (casRequested || isUnownedClaim) {
        const now = (await this.ticketModel
          .findById(id)
          .select('job_status admin_user_id')
          .lean()) as { job_status?: number; admin_user_id?: unknown } | null;

        /* [FIX-20260824-CASGHOST] ⚠️ ต้องยืนยันว่า "ถูกแย่ง" จริง ก่อนพูดว่าถูกแย่ง
           ═══════════════════════════════════════════════════════════════════
           เดิมบล็อกนี้ดึง `admin_user_id` มาแล้ว **ไม่เคยเอามาเทียบเลย** — เห็นแค่
           "เขียนไม่ติด และตั๋วยังไม่ปิด" ก็สรุปว่าถูกแย่ง แต่ `matchFilter` มีเงื่อนไข
           อีกสามตัวที่ทำให้เขียนไม่ติดได้เหมือนกัน:
             · `ticketScope`  — ไม่มีสิทธิ์ OA ของตั๋วใบนั้น
             · `job_status:{$ne:2}` — ตั๋วเพิ่งถูกปิดระหว่างทาง
             · `casFilter`    — เจ้าของไม่ตรงกับที่คาด (อันนี้เท่านั้นที่ "ถูกแย่ง" จริง)
           ⇒ คนที่ไม่มีสิทธิ์จะได้ข้อความ **"กรุณากดรับเคสต่ออีกครั้ง"** ซึ่งชวนให้กดซ้ำ
             ทั้งที่กดกี่ครั้งก็ไม่มีวันผ่าน เพราะเงื่อนไขที่ตกไม่เคยเปลี่ยน
             ⇒ แอดมินไปตามหาสาเหตุผิดทาง และเราไม่มีทางรู้จาก log ว่าจริง ๆ ตกเพราะอะไร

           ตอนนี้พูดว่า "ถูกแย่ง" เฉพาะเมื่อ **เจ้าของจริงต่างจากที่ผู้กดคาดไว้** เท่านั้น
           นอกนั้นปล่อยตกไปที่ closedMessage()/NotFound ข้างล่างตามความจริง
           ⚠️ ข้อความเดิมห้ามเปลี่ยนคำ — golden suite เทียบกับ backend เดิม และ FE
              `TicketChat.tsx:870` ตรวจจับด้วย regex /ถูกรับไปแล้วโดยแอดมินท่านอื่น/
              เพื่อแยก "ถูกแย่ง" ออกจาก "ถูกปิด" (คนละการกระทำบนหน้าจอ)

           revert: เอา `ownerMoved` ออก แล้วกลับไปเช็คแค่ `now.job_status !== 2` */
        const ownerNow = casOwnerText(now?.admin_user_id);
        const ownerExpected = casOwnerText(expectedOwnerRaw);
        const ownerMoved = ownerNow !== ownerExpected;

        if (now && now.job_status !== 2 && ownerMoved) {
          throw new ConflictException(
            'เคสนี้ถูกรับไปแล้วโดยแอดมินท่านอื่น กรุณากดรับเคสต่ออีกครั้ง',
          );
        }
      }

      // [FIX-20260817-NOZEROREOPEN] same condition as `matchFilter`, so a write
      // that lost the race reports the conflict it lost — not "Ticket not
      // found", which would send the caller looking for a deleted row.
      if (refusesClosed && before) {
        throw new ConflictException(closedMessage());
      }
      throw new NotFoundException('Ticket not found');
    }

    // [FIX-20260808-CLOSERESUME] legacy ticketController.js:696-714 — closing a
    // ticket (job_status 0/1 -> 2) resets the customer's room so the bot resumes
    // and their NEXT slip opens a fresh ticket. Without it `assist_status` stays
    // true and the customer is stranded with a muted bot after the operator ends
    // the case. Mirrors the bulk `clearTickets` reset in this same file and legacy
    // exactly; the room is keyed by (user_id, hook_id). Fire-safe: a room-reset
    // failure must not fail the close (legacy logs and returns success too).
    // NOTE: the "ปิดเคส"/"บอทกลับมาดูแลแล้ว" transcript dividers are a separate,
    // still-unported concern (needs chatHistory) — tracked as its own item.
    if (updateData['job_status'] === 2 && before && before.job_status !== 2) {
      const memberId = before.chat_user_id ?? before.line_user_id;
      const closeHookId = before.hook_id ?? before.line_oa_hook_id;
      if (memberId && closeHookId) {
        try {
          await this.chatRoomModel.updateOne(
            { user_id: memberId, hook_id: closeHookId, assist_status: true },
            {
              $set: {
                assist_status: false,
                last_assist_changed_at: new Date(),
              },
            },
          );
        } catch (roomErr) {
          this.logger.error(
            `[TICKET-CLOSE] reset assist_status failed: ${
              roomErr instanceof Error ? roomErr.message : String(roomErr)
            }`,
          );
        }
      }
    }

    /* ══ [FEAT-20260826-CLOSECLEARFU] "เลิกตามการสมัครของลูกค้าคนนี้" ═════════
     * Runs only when the admin ticked the box in the close-case confirm, and
     * only when this write actually closed the case. Full reasoning, and the
     * standing rule this deliberately overrides, live in
     * `close-case-follow-up.helper.ts` — read that before touching this.
     *
     * ⚠️ COST ON AN ORDINARY CLOSE IS ZERO. The member is not read unless the
     * flag came in as `true`; a normal ปิดเคส does exactly what it did before,
     * with no extra query. ปิดเคสปกติไม่มีคิวรีเพิ่มเลย
     *
     * ⚠️ AWAITED, NOT FIRE-AND-FORGET — unlike the dividers below, which are a
     * decoration. This one is the thing the admin actually asked for, so it must
     * finish before the response says the close is done. It still never throws:
     * the ticket is already closed by this point, and turning a successful close
     * into a 500 would tell the admin the opposite of what happened.
     *
     * revert: delete this block, the helper, and the DTO field.
     */
    if (clearFollowUpRequested === true && updateData['job_status'] === 2) {
      try {
        const memberKey = before?.chat_user_id ?? before?.line_user_id;
        /* [FIX-20260827-TKTMEMBERPARAM] BOTH names hold the member's ObjectId —
           `tickets.line_user_id` is the LEGACY NAME, not a LINE id (schema
           declares `ObjectId ref:'Member'`; measured 27/08: 17/17 rows are
           ObjectIds, 0 are LINE strings). This used to fall back to
           `{ line_user_id: … }`, which queries the MEMBERS collection's LINE
           string field with an ObjectId — never matches, so the follow-up
           clear silently did nothing for any ticket predating the dual-write.
           The old comment claimed "may carry either … depending on how it was
           opened"; the measurement disproved that belief.
           📖 todo/task/27082026/todo1_27082026_tickets-line-user-id-fix.md */
        const memberFilter: Record<string, unknown> = {
          _id: before?.chat_user_id ?? before?.line_user_id,
        };

        const member = memberKey
          ? await this.memberModel
              .findOne(memberFilter)
              .select('_id config')
              .lean()
          : null;

        const plan = buildFollowUpClear({
          becameClosed: before?.job_status !== 2,
          requested: clearFollowUpRequested,
          member,
        });

        if (plan.shouldClear && member?._id) {
          for (const key of plan.keys) {
            await clearMemberConfig({ _id: member._id }, key, {
              // The helper is written against the untyped member shape (its
              // deps take `Model<Record<string, unknown>>`) because it addresses
              // `config` by dot-path and never touches a declared field. Same
              // cast the other two clearers arrive with.
              memberModel: this.memberModel as unknown as Model<
                Record<string, unknown>
              >,
            });
          }

          /* The audit row is the ONLY record that this member was cleared on
             purpose. Without it, a missing `request_reg_at` is indistinguishable
             from "was never asked" — and the registration insight card counts
             that difference. Same shape as `member-abandon-audit.helper.ts`. */
          const actorUserId = auth?.userId;
          if (actorUserId) {
            void this.auditLogService
              .createAuditLog({
                action: 'update',
                parent: 'line_user',
                ref_id: String(member._id),
                actor: {
                  user_id: String(actorUserId),
                  username: auth?.username,
                  display_name: auth?.displayName || auth?.username,
                },
                changed_fields: plan.keys.map((field) => ({
                  field,
                  from: 'set',
                  to: null,
                })),
                note: `หยุดติดตามการสมัคร — เคลียร์ตอนปิดเคส #${String(id)}`,
              })
              .catch(() => undefined);
          } else {
            this.logger.warn(
              '[CLOSECLEARFU] cleared with no actor on the request — audit row skipped',
            );
          }
        }
      } catch (err) {
        // The close itself already succeeded; say so loudly and move on.
        this.logger.error(
          `[CLOSECLEARFU] follow-up clear failed after closing ticket ${String(id)}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    /* ══ [FEAT-20260827-PATCHAFTERCLOSE] "patch after close ticket" ═════════
     * What the admin decided in the close-case dialog's SECTIONS. Runs only on
     * a real close, only for sections the member actually qualifies for, and
     * never throws — the ticket is already closed by this point, and turning a
     * successful close into a 500 would tell the admin the opposite of what
     * happened (same posture as the block above).
     *
     * ── BOTH ENDS ────────────────────────────────────────────────────────────
     * SETS `members.ignore_abandon_assist = true` — WHOSE? the column read by
     *   `webhook/follow-up/ignore-abandon.rule.ts` (`abandonIsSwitchedOff`) and
     *   consulted by `follow-up/follow-up.gate.ts`, which then stays QUIET for
     *   this customer. It is a COLUMN, not a `config` key — deliberately not in
     *   `MEMBER_CONFIG_KEYS` (owner: "ไม่ใช่ follow up มันเปน column ใหม่").
     *   The other writer of the same column is `chat/members.service.ts`
     *   (`updateIgnoreAbandon`, the per-member switch on the contact screen).
     * CLEARS `follow_up.line.notice_deposit_at` / `notice_withdraw_at` — WHOSE?
     *   the stamps written by `webhook/notice-runtime/notice-guard.helper.ts`
     *   after a notice card is sent (cases A/B and C/D), read by
     *   `chat.service.ts` for the `?follow=` contact filter.
     *   ON WHICH ROUTE: an ADMIN ticking "ไม่ติดตาม" while closing a case. This
     *   is the SECOND clearer of that pair — the first is
     *   `content/broadcast-follow-up/clear-notice-on-multicast.ts`, which fires
     *   after a multicast reaches the member. Both are recorded in the registry.
     *   `notice_payment_at` is NOT touched by either. ห้ามเติมเข้ามาเอง
     *
     * ⚠️ It does NOT clear the registration stamps. The 26/08 version did; the
     * owner reversed that on 27/08 ("ทำแค่อย่างเดียว = ignore_abandon_assist=true")
     * because the flag stops the chase on its own and `request_reg_at` is the
     * only record the registration insight card can split on. The old path is
     * left in place above, unreachable from the new dialog, "เผื่อเปลี่ยนใจ".
     *
     * revert: delete this block, `patch-after-close.helper.ts` and the DTO field.
     */
    if (patchAfterClose && updateData['job_status'] === 2) {
      try {
        const memberKey = before?.chat_user_id ?? before?.line_user_id;
        /* [FIX-20260827-TKTMEMBERPARAM] both ticket fields hold a member
           ObjectId — see the identical lookup in the block above. */
        const member = memberKey
          ? await this.memberModel
              .findOne({ _id: memberKey })
              /* [FEAT-20260830-AUDITLINEID] `line_user_id` is selected only so
                 the audit rows below can name WHOSE follow-up was cleared.
                 `ref_id` carries the Mongo `_id`, which no admin recognises. */
              /* [FEAT-20260904-REGANYSTAMP] `raw_profile_data` joins the
                 projection because the registration gate now REFUSES to act on
                 a member who has registered. Left out, it reads `undefined`,
                 `hasRawProfile` answers false for everyone, and the gate passes
                 silently — the failure mode this projection list is famous for.
                 revert: drop `raw_profile_data` when the gate goes. */
              .select(
                '_id config ignore_abandon_assist line_user_id raw_profile_data',
              )
              .lean()
          : null;

        const plan = buildPatchAfterClose({
          becameClosed: before?.job_status !== 2,
          answers: patchAfterClose,
          member,
        });

        /* [FEAT-20260830-AUDITLINEID] read once, used by both audit rows below. */
        const memberLineUserId = (member as { line_user_id?: string } | null)
          ?.line_user_id;

        if (!plan.isNoop && member?._id) {
          if (plan.setIgnoreAbandon) {
            await this.memberModel
              .updateOne(
                { _id: member._id },
                { $set: { ignore_abandon_assist: true } },
              )
              .exec();

            /* The SAME audit helper the contact-screen switch uses, so both
               routes leave one recognisable row. It never throws and writes
               nothing when the value did not move. */
            auditAbandonShieldFlip(
              {
                memberId: String(member._id),
                before: (member as unknown as Record<string, unknown>)[
                  'ignore_abandon_assist'
                ],
                after: true,
                auth,
              },
              {
                audit: this.auditLogService,
                warn: (msg) => this.logger.warn(msg),
              },
            );
          }

          for (const key of plan.clearKeys) {
            await clearMemberConfig({ _id: member._id }, key, {
              // Same cast the other clearers arrive with — the helper addresses
              // `config` by dot-path and never touches a declared field.
              memberModel: this.memberModel as unknown as Model<
                Record<string, unknown>
              >,
            });
          }

          /* The audit row is the ONLY record that these stamps were removed on
             purpose rather than never written. Shape matches the block above. */
          const actorUserId = auth?.userId;
          if (plan.clearKeys.length && actorUserId) {
            void this.auditLogService
              .createAuditLog({
                action: 'update',
                parent: 'line_user',
                ref_id: String(member._id),
                actor: {
                  user_id: String(actorUserId),
                  username: auth?.username,
                  display_name: auth?.displayName || auth?.username,
                },
                /* [FEAT-20260830-AUDITLINEID] the LINE id rides as a row of its
                   own rather than a column: `CreateAuditLogInput` accepts only
                   ref_id / hook_id / group_id, and inventing a column would mean
                   a schema change for a value that is read, never queried.
                   `from` and `to` are the SAME id on purpose — nothing changed
                   about it; it is there to say WHO. */
                changed_fields: [
                  ...plan.clearKeys.map((field) => ({
                    field,
                    from: 'set',
                    to: null,
                  })),
                  ...(memberLineUserId
                    ? [
                        {
                          field: 'line_user_id',
                          from: memberLineUserId as unknown,
                          to: memberLineUserId as unknown,
                        },
                      ]
                    : []),
                ],
                /* [FEAT-20260830-AUDITLINEID] name the customer, not just the
                 ticket — the person reading this log has a LINE id in hand and
                 no way to turn `ref_id` into one. Omitted, never printed as
                 `undefined`, when the member carries no LINE id. */
                /* [FIX-20260901-NOTESAYSWHAT] pass the keys so the sentence
                 names what was actually cleared — same list already mapped
                 into `changed_fields` above. revert: drop the third argument. */
                note: buildClearFollowUpNote(
                  String(id),
                  memberLineUserId,
                  plan.clearKeys,
                ),
              })
              .catch(() => undefined);
          } else if (plan.clearKeys.length) {
            this.logger.warn(
              '[PATCHAFTERCLOSE] cleared with no actor on the request — audit row skipped',
            );
          }
        }
      } catch (err) {
        // The close itself already succeeded; say so loudly and move on.
        this.logger.error(
          `[PATCHAFTERCLOSE] section handling failed after closing ticket ${String(id)}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    /* ══ [FIX-20260810-TICKETDIVIDER] transcript dividers ═══════════════════
     * These stopped being written when this service was ported to NestJS — the
     * comment above says so outright. Restored here, after the write succeeded,
     * so a divider can never claim an event that did not happen.
     *
     * Four events, matching the variants the frontend already renders:
     *   accept  job_status 0 → 1
     *   assign  admin changed while already accepted (a claim/hand-over)
     *   close   → 2
     *   bot     paired with close: the room reset above means the bot resumes
     *
     * Fire-and-forget and never throws — a decoration must not fail a close.
     * เส้นคั่นพัง ห้ามทำให้ปิดเคสพัง.
     * revert: delete this block + ticket-divider.helper.ts
     */
    void (async () => {
      const dividerMemberId = before?.chat_user_id ?? before?.line_user_id;
      const dividerHookId = before?.hook_id ?? before?.line_oa_hook_id;
      if (!dividerMemberId || !dividerHookId) return;

      // [FIX-20260814-DIVIDERNAME] display name, NOT the role — see actorLabel's
      // note. `auth.displayName` rides the JWT already (auth.service.ts:188 →
      // jwt-auth.guard.ts:77); the `|| username` fallback matches every other
      // actor writer in the codebase (e.g. chat.service.ts:590).
      const actor = actorLabel(
        auth?.username,
        auth?.displayName || auth?.username,
      );
      // No readable actor means we cannot honestly name who did it, and the
      // legacy copy always carries a name — skip rather than invent one.
      if (!actor) return;

      const deps = {
        chatMessageModel: this.chatMessageModel as never,
        chatRoomModel: this.chatRoomModel as never,
        warn: (m: string) => this.logger.warn(m),
      };
      const base = {
        memberId: dividerMemberId,
        hookId: dividerHookId,
        actorName: actor,
      };

      const becameAccepted =
        updateData['job_status'] === 1 && before?.job_status !== 1;
      const becameClosed =
        updateData['job_status'] === 2 && before?.job_status !== 2;

      if (becameAccepted) {
        await writeTicketDivider(
          { ...base, variant: 'accept', content: `รับเคส โดย ${actor}` },
          deps,
        );
      } else if (isClaimWrite) {
        // Only when NOT also a fresh accept, or the transcript would show both
        // "รับเคส" and "โอนเคส" for one click.
        await writeTicketDivider(
          {
            ...base,
            variant: 'assign',
            content: `โอนเคส โดย ${actor}`,
            assignTo: updateData['admin_user_id'],
          },
          deps,
        );
      }

      if (becameClosed) {
        await writeTicketDivider(
          { ...base, variant: 'close', content: `ปิดเคส โดย ${actor}` },
          deps,
        );
        // Ordered after the close so the transcript reads close → bot resumes,
        // which is what actually happens (the room reset runs above).
        await writeTicketDivider(
          { ...base, variant: 'bot', content: 'บอทกลับมาดูแลแล้ว' },
          deps,
        );
      }
    })();

    // [FEAT-20260808-P3MINIMAL] legacy minimal branch (ticketController.js:742):
    // publish + return the ticket WITHOUT populateAttachedFiles. The publish
    // payload is field-identical to the default path (same four keys).
    if (minimal) {
      this.publishScopedTicketEvent('ticket:updated', {
        _id: ticket['_id'],
        job_status: ticket['job_status'],
        hook_id: ticket['hook_id'] || ticket['line_oa_hook_id'],
        category: ticket['category'] ?? null,
      });
      return { success: true, data: ticket };
    }

    const populated = await this.populateAttachedFiles(ticket);
    if (populated) {
      this.publishScopedTicketEvent('ticket:updated', {
        _id: populated['_id'],
        job_status: populated['job_status'],
        hook_id: populated['hook_id'] || populated['line_oa_hook_id'],
        category: populated['category'] ?? null,
      });
    }

    return { success: true, data: populated };
  }

  /**
   * [FIX-20260819-EVERTICKETED] Member ids that own at least one ticket on this
   * OA — no date window, ids only.
   *
   * Both field names are read: `chat_user_id` is the current one and
   * `line_user_id` the legacy mirror that `pre('save')` still writes, and old
   * rows exist with only the second. Missing one of them would report a customer
   * as never-ticketed purely because their case predates a rename.
   * อ่านทั้งสองชื่อ ไม่งั้นแถวเก่าจะถูกนับว่าไม่เคยมีเคส.
   */
  public async getTicketedMembers(
    hookId: string,
  ): Promise<Record<string, unknown>> {
    if (!isValidObjectId(hookId)) {
      return { success: true, data: [] };
    }
    const scope = { hook_id: new Types.ObjectId(hookId) };
    const [current, legacy] = await Promise.all([
      this.ticketModel.distinct('chat_user_id', scope),
      this.ticketModel.distinct('line_user_id', scope),
    ]);
    const ids = new Set<string>();
    for (const v of [...current, ...legacy]) {
      if (v) ids.add(String(v));
    }
    return { success: true, data: Array.from(ids) };
  }

  /**
   * [FEAT-20260820-BOTCOUNTBE] How many customers have a room and no case at all.
   *
   * WHAT IT IS FOR. The บอทดูแล tab's rows are two things: the closed cases the
   * dashboard already holds, and the conversations that never produced a ticket.
   * The dashboard fetches those rooms ONLY while that tab is open — deliberately,
   * so nothing polls in the background — which means its badge lost that half
   * from every other tab and read low. Seen in production 2026-08-20: two rows on
   * screen, the badge showing 1.
   * หน้าเว็บโหลดห้องเฉพาะตอนเปิดแท็บ ⇒ ป้ายขาดครึ่งเมื่ออยู่แท็บอื่น.
   *
   * ⚠️ IT ANSWERS ONLY THE MISSING HALF. The closed-case half is still counted by
   * the dashboard exactly as before, so no other tab's number can move because
   * this exists. ให้เฉพาะครึ่งที่ขาด · แท็บอื่นไม่ถูกแตะ.
   *
   * ⚠️ THE EXCLUSION IS THE DATABASE'S JOB. `$nin` on an indexed field, then a
   * `countDocuments`: no room document is ever shipped here to be filtered. A
   * hook with thousands of conversations costs the same as one with three.
   *
   * ⚠️ NEVER THROWS ON A BAD ID. This drives a badge; a decoration must not be
   * able to fail the page that shows it. An unusable hook id answers zero.
   *
   * Same shape as `getTicketedMembers` above, and the same reason: a windowed
   * ticket list cannot answer "has this customer EVER had a case".
   *
   * revert: delete this method and its route in `tickets.controller.ts`.
   */
  public async getNoCaseRoomCount(
    hookId: string,
    /* [FIX-20260829-BOTBADGEWINDOW] the dashboard's ⚙️ window, in days.
       Absent = unbounded = exactly what this route did before, so no existing
       caller changes behaviour. See the block above the query for why it exists. */
    withinDays?: number,
  ): Promise<Record<string, unknown>> {
    /* [FIX-20260902-BOTONESOURCE] the rule moved to `buildNoCaseRoomFilter` so
       this count and `getNoCaseRooms` can never answer differently. Keeping a
       private copy here is exactly how the dashboard's badge came to disagree
       with the rows it was counting — one rule, or it is not a rule. */
    const filter = await this.buildNoCaseRoomFilter(hookId, withinDays);
    if (!filter) return { success: true, data: { count: 0 } };
    const count = await this.chatRoomModel.countDocuments(filter);
    return { success: true, data: { count } };
  }

  /**
   * [FIX-20260902-BOTONESOURCE] The บอทดูแล tab's rooms — the same rule that
   * produced the number above, now returning the ROWS as well.
   * ===========================================================================
   * WHAT WAS WRONG. The tab's number came from two different places depending on
   * where the operator happened to be standing. From another tab it was this
   * service's count; on the tab itself the browser had downloaded the rooms and
   * counted them locally. One box, two formulas — so the same page showed 29 and
   * 28 seconds apart, and two operators looking at the same OA could see
   * different numbers at the same moment. That is not a rounding difference; it
   * means the badge was never authoritative.
   *
   * The two could not be reconciled by patching either side, because they were
   * answering DIFFERENT QUESTIONS with different data:
   *   · the browser filtered rooms it had already fetched, capped at 200 by
   *     `/api/chat` and subtracted using the ticket lists it happened to hold;
   *   · this service asked the database, unbounded, per hook.
   * Any client-side count is a count of what that browser managed to load. It can
   * never be the same number twice.
   *
   * SO THE RULE MOVES HERE, ONCE. This method and `getNoCaseRoomCount` share
   * `buildNoCaseRoomFilter` below, so a row cannot be listed without being
   * counted, or counted without being listed. The client stops deciding and
   * starts displaying.
   *
   * ⚠️ PROJECTION, NOT POPULATE. `/api/chat` populates the whole member document
   *    for every room, which is exactly why it needs a 200-row ceiling. This
   *    returns only the fields the card reads, so the tab can be fetched from any
   *    tab without becoming the page's most expensive request.
   * ⚠️ THE SHAPE MUST MATCH what `/api/chat` returns, because the dashboard turns
   *    both into a card with the same function (`roomAsPseudoTicket`): `user_data`
   *    is the member, not `user_id`. If that mapping changes in `chat.service.ts`,
   *    it changes here too — asserted by the spec so the two cannot drift quietly.
   * ⚠️ NO CEILING, and that is safe here only because of the filter: this returns
   *    the customers with NO case at all, which is a small set by definition. If
   *    it is ever large, that is a real signal and must not be hidden by a cap.
   *
   * revert: delete this method and its route; the dashboard falls back to
   * counting locally, and the badge goes back to disagreeing with itself.
   */
  public async getNoCaseRooms(
    hookId: string,
    withinDays?: number,
  ): Promise<Record<string, unknown>> {
    const filter = await this.buildNoCaseRoomFilter(hookId, withinDays);
    if (!filter) return { success: true, data: [] };

    const rooms = await this.chatRoomModel
      .find(filter)
      /* Only what the card draws. Adding a field here means adding it to the
         dashboard's `roomAsPseudoTicket` too — they are one contract. */
      .select(
        '_id hook_id user_id line_user_id last_message updated_at created_at',
      )
      .populate(
        'user_id',
        '_id display_name line_user_id picture_url phone_number',
      )
      .sort({ 'last_message.timestamp': -1 })
      .lean();

    /* Mirrors `chat.service.ts` — the populated member is handed over as
       `user_data`, never as `user_id`, because that is the key the card reads. */
    const data = rooms.map((room) => {
      const { user_id: userIdVal, ...rest } = room as unknown as Record<
        string,
        unknown
      >;
      return { ...rest, user_data: userIdVal ?? null };
    });
    return { success: true, data };
  }

  /**
   * [FIX-20260902-BOTONESOURCE] "which rooms have never had a case", in ONE place.
   *
   * Extracted so the count and the list cannot answer differently. Before this,
   * the only copy of the rule lived inside the counting method, and the dashboard
   * kept a second one in the browser — which is how the badge came to disagree
   * with the rows it was counting.
   *
   * @returns the Mongo filter, or `null` when the hook id is not usable — the
   *   caller answers empty rather than throwing, because both callers feed a
   *   badge and a badge must never be able to break the page.
   */
  private async buildNoCaseRoomFilter(
    hookId: string,
    withinDays?: number,
  ): Promise<Record<string, unknown> | null> {
    if (!isValidObjectId(hookId)) return null;
    const hook = new Types.ObjectId(hookId);
    /* both names, for the same reason `getTicketedMembers` reads both: a ticket
       may carry the member under either, and the mirror hook fills the other. */
    const [current, legacy] = await Promise.all([
      this.ticketModel.distinct('chat_user_id', { hook_id: hook }),
      this.ticketModel.distinct('line_user_id', { hook_id: hook }),
    ]);
    /* ⚠️ The VALUES `distinct` returns are used as-is — see the note in
       `getNoCaseRoomCount`; re-parsing them is the path that throws. */
    const seen = new Set<string>();
    const ticketed: unknown[] = [];
    for (const v of [...current, ...legacy]) {
      if (v === null || v === undefined) continue;
      const k = String(v);
      if (seen.has(k)) continue;
      seen.add(k);
      ticketed.push(v);
    }

    /* [FIX-20260829-BOTBADGEWINDOW] the ⚙️ window, applied in the QUERY. A junk
       or non-positive value is IGNORED rather than trusted: `new Date(NaN)` in a
       filter matches nothing and would silently zero the tab. */
    const days =
      typeof withinDays === 'number' &&
      Number.isFinite(withinDays) &&
      withinDays > 0
        ? withinDays
        : null;
    const filter: Record<string, unknown> = {
      hook_id: hook,
      user_id: { $nin: ticketed },
    };
    if (days !== null) {
      filter['updated_at'] = { $gte: new Date(Date.now() - days * 86_400_000) };
    }
    return filter;
  }

  public async getTicketMeta(
    hookIdParam?: string,
    groupIdParam?: string,
    auth?: AuthenticatedUser,
    withinDays?: unknown,
  ): Promise<Record<string, unknown>> {
    const hookIds = await this.resolveScopeHookIds(
      hookIdParam,
      groupIdParam,
      auth,
    );
    if (hookIds.length === 0) {
      return { success: true, total: 0, waiting: 0, last_updated: null };
    }

    // [FEAT-20260808-TKTSCOPE] read-only filter, no writes. Same within_days
    // window as the list, on the same created_at field, so this badge count
    // stays coherent with the scoped list. Omitted/invalid → unbounded = today.
    const withinCutoff = resolveWithinDaysCutoff(withinDays);
    const match: Record<string, unknown> = { hook_id: { $in: hookIds } };
    if (withinCutoff) match['created_at'] = { $gte: withinCutoff };

    const result = await this.ticketModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          waiting: { $sum: { $cond: [{ $eq: ['$job_status', 0] }, 1, 0] } },
          last_updated: { $max: '$updated_at' },
        },
      },
    ]);

    const meta = result[0] || { total: 0, waiting: 0, last_updated: null };
    return {
      success: true,
      total: meta.total,
      waiting: meta.waiting,
      last_updated: meta.last_updated,
    };
  }

  public async getTicketMetaBatch(
    groupsRaw?: string,
    auth?: AuthenticatedUser,
    withinDays?: unknown,
  ): Promise<Record<string, unknown>> {
    const raw = String(groupsRaw || '').trim();
    if (!raw) {
      throw new BadRequestException('groups query param is required');
    }

    const groupIds = [
      ...new Set(
        raw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ].filter((id) => isValidObjectId(id));
    if (groupIds.length === 0) {
      throw new BadRequestException('no valid group ids');
    }

    const allowed = await getAllowedHookIds(auth, this.hookModel);
    const metas: Record<string, unknown> = {};

    const hooks = await this.hookModel
      .find({ group: { $in: groupIds } })
      .select('_id group')
      .lean();
    const hooksByGroup = new Map<string, Types.ObjectId[]>(
      groupIds.map((g) => [g, []]),
    );

    for (const h of hooks) {
      if (allowed !== null && !allowed.includes(String(h._id))) continue;
      const bucket = hooksByGroup.get(String(h.group));
      if (bucket) bucket.push(h._id);
    }

    const allHookIds = Array.from(hooksByGroup.values()).reduce(
      (acc, val) => acc.concat(val),
      [] as Types.ObjectId[],
    );
    const totalsByHookGroup = new Map<string, string>();
    hooksByGroup.forEach((ids, g) =>
      ids.forEach((id) => totalsByHookGroup.set(String(id), g)),
    );

    let agg: {
      _id: Types.ObjectId;
      total: number;
      waiting: number;
      last_updated: Date | null;
    }[] = [];
    // [FEAT-20260808-TKTSCOPE] read-only filter, no writes. Same within_days
    // window as the list/meta, applied to created_at, so per-group badges stay
    // coherent with the scoped list. Omitted/invalid → unbounded = today.
    const withinCutoff = resolveWithinDaysCutoff(withinDays);
    if (allHookIds.length > 0) {
      const batchMatch: Record<string, unknown> = {
        hook_id: { $in: allHookIds },
      };
      if (withinCutoff) batchMatch['created_at'] = { $gte: withinCutoff };
      agg = await this.ticketModel.aggregate([
        { $match: batchMatch },
        {
          $group: {
            _id: '$hook_id',
            total: { $sum: 1 },
            waiting: { $sum: { $cond: [{ $eq: ['$job_status', 0] }, 1, 0] } },
            last_updated: { $max: '$updated_at' },
          },
        },
      ]);
    }

    const perGroup = new Map<
      string,
      { total: number; waiting: number; last_updated: Date | null }
    >(groupIds.map((g) => [g, { total: 0, waiting: 0, last_updated: null }]));

    for (const row of agg) {
      const g = totalsByHookGroup.get(String(row._id));
      if (!g) continue;
      const acc = perGroup.get(g);
      if (acc) {
        acc.total += row.total;
        acc.waiting += row.waiting;
        if (
          row.last_updated &&
          (!acc.last_updated ||
            new Date(row.last_updated) > new Date(acc.last_updated))
        ) {
          acc.last_updated = row.last_updated;
        }
      }
    }

    groupIds.forEach((g) => {
      metas[g] = perGroup.get(g) || {
        total: 0,
        waiting: 0,
        last_updated: null,
      };
    });

    return { success: true, metas };
  }

  public async deleteTicket(
    id: string,
    auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid Ticket ID');
    }
    /**
     * [FIX-20260818-TICKETSCOPE · plan §8 = T3-3, closes audit C2.5] This is the
     * PERMANENT delete, and it took no caller at all — an id was the whole
     * authorisation. The scope goes into the delete filter so the row is either
     * the caller's or it is not deleted; there is no window and no pre-read.
     */
    const allowed = await getAllowedHookIds(auth, this.hookModel);
    const ticket = await this.ticketModel.findOneAndDelete({
      _id: id,
      ...scopeFilter(allowed, ['hook_id', 'line_oa_hook_id']),
    });
    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }
    return { success: true, message: 'Ticket deleted successfully' };
  }

  public async clearTickets(
    hookId: string,
    body: { clear_waiting?: boolean; clear_processing?: boolean },
    auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    if (!hookId || !isValidObjectId(hookId)) {
      throw new BadRequestException('Invalid or missing hook_id');
    }

    const allowed = await getAllowedHookIds(auth, this.hookModel);
    if (allowed !== null && !allowed.includes(String(hookId))) {
      throw new ForbiddenException('insufficient OA access');
    }

    const { clear_waiting, clear_processing } = body;
    const roleName = (auth?.roleName || '').toLowerCase();
    const allowedRoles = ['superuser', 'superadmin', 'admin', 'dev'];
    if (!allowedRoles.includes(roleName)) {
      throw new ForbiddenException(
        'Forbidden: You do not have permission to perform this action',
      );
    }

    const statusesToClear: number[] = [];
    if (clear_waiting) statusesToClear.push(0);
    if (clear_processing) statusesToClear.push(1);

    if (statusesToClear.length === 0) {
      throw new BadRequestException('No statuses selected to clear');
    }

    const now = new Date();
    const ticketFilter = {
      hook_id: new Types.ObjectId(hookId),
      job_status: { $in: statusesToClear },
    };

    const scopedTickets = await this.ticketModel
      .find(ticketFilter, { chat_user_id: 1, hook_id: 1 })
      .lean();

    if (scopedTickets.length === 0) {
      return {
        success: true,
        message: 'No tickets to clear',
        ticketsClosed: 0,
        roomsReset: 0,
      };
    }

    const pairSet = new Set<string>();
    const uids = new Set<string>();
    const hookids = new Set<string>();
    for (const t of scopedTickets) {
      if (!t.chat_user_id || !t.hook_id) continue;
      pairSet.add(`${t.chat_user_id.toString()}|${t.hook_id.toString()}`);
      uids.add(t.chat_user_id.toString());
      hookids.add(t.hook_id.toString());
    }

    const candidates = await this.chatRoomModel
      .find(
        {
          assist_status: true,
          user_id: {
            $in: Array.from(uids).map((id) => new Types.ObjectId(id)),
          },
          hook_id: {
            $in: Array.from(hookids).map((id) => new Types.ObjectId(id)),
          },
        },
        { _id: 1, user_id: 1, hook_id: 1 },
      )
      .lean();

    const roomIds = candidates
      .filter(
        (r) =>
          r.user_id &&
          r.hook_id &&
          pairSet.has(`${r.user_id.toString()}|${r.hook_id.toString()}`),
      )
      .map((r) => r._id);

    const tRes = await this.ticketModel.updateMany(ticketFilter, {
      $set: { job_status: 2, resolved_at: now },
    });

    let rRes = { modifiedCount: 0 };
    if (roomIds.length > 0) {
      rRes = await this.chatRoomModel.updateMany(
        { _id: { $in: roomIds }, assist_status: true },
        { $set: { assist_status: false, last_assist_changed_at: now } },
      );
    }

    // [FEAT-20260808-AUDITSITE] writes hook_audit_logs row
    // {action:'clear_tickets', ref_id:hook_id, hook_id, changed_fields, actor} —
    // additive only, no schema change. NO parent, NO request_meta, NO note, per
    // legacy ticketController.js:976-989. The actor is built inline (not via
    // buildActor) to reproduce legacy's `display_name || username || "Admin"`
    // fallback exactly. Fire-and-forget.
    const actorUserId = auth?.userId ? String(auth.userId) : 'system';
    void this.auditLogService
      .createAuditLog({
        action: 'clear_tickets',
        actor: {
          user_id: actorUserId,
          username: auth?.username || actorUserId,
          display_name: auth?.displayName || auth?.username || 'Admin',
        },
        ref_id: hookId,
        hook_id: hookId,
        changed_fields: [
          { field: 'tickets_closed', from: 0, to: tRes.modifiedCount },
          { field: 'rooms_reset', from: 0, to: rRes.modifiedCount },
          { field: 'statuses_cleared', from: null, to: statusesToClear },
        ],
      })
      .catch(() => undefined);

    this.publishScopedTicketEvent('ticket:updated', { hook_id: hookId });

    return {
      success: true,
      message: 'Tickets cleared successfully',
      ticketsClosed: tRes.modifiedCount,
      roomsReset: rRes.modifiedCount,
    };
  }
}
