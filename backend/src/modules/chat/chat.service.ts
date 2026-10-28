/**
 * LIFTED — pending rewrite.
 *
 * Source: legacy-api/src/controllers/chat/chatRoomController.js, contactController.js, customerTagController.js, chatRoomNoteController.js
 *
 * WHY IT IS NOT SPLIT YET
 * Per the accepted-debt policy in check-list.md, large legacy controllers move
 * in two steps. Step one ports the logic to TypeScript so it runs; step two
 * splits it once golden tests are in place. Doing both at once changes
 * framework and structure simultaneously, making any behavioural difference
 * unattributable. This file is step one for chat management.
 *
 * WHAT UNBLOCKS SPLITTING
 * Every /api/chat endpoint golden-green against the running legacy backend.
 *
 * "Lifted" means the same logic expressed in typed code — not JavaScript with a
 * new extension. There is no `any` and no `@ts-ignore` here.
 */

import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model, Types, isValidObjectId } from 'mongoose';

import { type AuthenticatedUser } from '@/common';
import { CryptoService } from '@/infra/crypto';
import { RealtimePublisherService } from '@/infra/realtime/realtime-publisher.service';
import {
  Hook,
  getAllowedHookIds,
  isHookOutOfScope,
  scopeFilter,
  type HookDocument,
} from '@/modules/hooks';
// [FEAT-20260814-ADMINPUSHLOG] same provider the admin-image path already uses
// (chat-media.service.ts:16) — SystemModule is imported by ChatModule already.
import { WebhookLogService } from '@/modules/system';
import { CustomerProviderService } from '@/modules/customer-provider';
/**
 * Leaf import, not the '@/modules/webhook' barrel: that barrel pulls
 * webhook.module.ts, which imports '@/modules/chat' for the ChatRoom schema —
 * the same half-initialised-module cycle documented in hooks.module.ts. The
 * service itself has no constructor dependencies, so ChatModule can register it
 * as a provider without importing WebhookModule at all.
 */
// eslint-disable-next-line no-restricted-imports
import { LineApiService } from '@/modules/webhook/line-api.service';
/* [DOC-20260821-BAGRULES] ⭐ THE BAG HAS A CENTRAL REGISTRY — READ IT BEFORE
   TOUCHING A KEY: `src/modules/chat/config/member-config.registry.ts`.

   THIS FILE READS `follow_up.line.notice_deposit_at` / `…notice_withdraw_at`
   ([FEAT-20260823-CONTACTFOLLOW]): listContacts turns `?follow=` into a member
   filter on those stamps, through `memberConfigPath` — never a hand-written
   `'config.…'` string. Read-only: nothing here writes or clears a key.

   ── BOTH ENDS ─────────────────────────────────────────────────────────────
   READS `follow_up.line.notice_deposit_at` + `…notice_withdraw_at` (filter only)
   → WHO WRITES THEM: `webhook/notice-runtime/notice-guard.helper.ts`, after a
     successful notice card send — a ROLLING RECORD, overwritten per notice.
   ← WHO CLEARS THEM: NOBODY, by design (registry entry: aging IS the reset).
   The key CONSTANTS come from `webhook/notice-runtime/notice.keys.ts`, the same
   file the writer uses, so the two ends cannot drift apart silently. */
/* The alias import is deliberate: the single-door census (member-config.spec.ts)
   counts readers by the literal `chat/config'` import — a relative './config'
   would hide this file from the very guard that protects the bag. Same escape
   the LineApiService import above uses, same reason class. */
// eslint-disable-next-line no-restricted-imports
import { memberConfigPath } from '@/modules/chat/config';
/* notice.keys.ts is a leaf constants file; the webhook BARREL would drag the
   whole module into chat and close the cycle the LineApiService note explains
   this file must avoid. */
// eslint-disable-next-line no-restricted-imports
import {
  NOTICE_DEPOSIT_AT_KEY,
  NOTICE_WITHDRAW_AT_KEY,
} from '@/modules/webhook/notice-runtime/notice.keys';

import type {
  CreateCustomerTagDto,
  CreateInlineNoteDto,
  CreateRoomNoteDto,
  ListChatRoomsDto,
  ListContactsDto,
  ListPopularTagsDto,
  ListRoomNotesQueryDto,
  SendChatReplyDto,
  SendChatStickerDto,
  SuggestTagsDto,
  SyncUserProfileDto,
  UpdateAssistStatusDto,
  UpdateNicknameDto,
  UpdateNoteContentDto,
  UpdateRoomNoteDto,
  UpdateRoomTranslateSettingsDto,
} from './dto';
import { isTranslateLanguage } from '@/modules/ai-translate';
// [FIX-20260808-CHANNELSEND] channel-agnostic outbound send — mirrors the
// legacy channels/ module. The registry resolves the hook's channel_type to a
// send adapter (or null); the service never branches on 'line'.
import { ChannelRegistry, servedByLineCore } from './channels/channel-registry';
import type { OutboundMessage } from './channels/outbound-message';
// [FEAT-20260814-ADMINPUSHLOG] audit row for anything an admin sends out — see
// that file's header for why the payload lives there and not inline here.
import { logOutboundPush } from './channels/outbound-audit';
/* [FEAT-20260821-CHATPUSHCORE] push-core candidate C — the admin chat console
   sends through the central sender instead of its own axios call.
   `LinePushDispatcher` is the WRAPPER, never `LinePushService` directly: a real
   queue can then slot in by swapping one provider binding in `line.module.ts`
   and no caller notices (`line-push.ts:52-54`).
   `extractLineReason` comes back from the old adapter on purpose — the core's
   own reason string has a different format, and the operator must not see new
   wording for a failure that has not changed. */
import { buildChatMessages } from '@/infra/line';
import {
  OUTBOUND_SEND_STRATEGY,
  type OutboundSendOutcome,
  type OutboundSendStrategy,
} from './channels/outbound-send-strategy';
import {
  findReplyCandidate,
  resolveQuoteToken,
  // [FEAT-20260831-QUOTESRC] the read side of the same id-space
  withQuotedPreviews,
} from './channels/quote-reply-lookup';
import { extractLineReason } from './channels/line-send-adapter';
/* [FEAT-20260908-CHATTRANS] the ONE place the stored translation shape lives.
   The send path is a second WRITER of the column but must never be a second
   place the shape is decided — see `translation-store.ts`. */
import { outboundTranslationEntry } from './translate/translation-store';
/* [FIX-20260918-LANGSPLIT] room-first / hook-second, resolved in one place for
   all three payloads that report it. */
import { resolveRoomTranslateSettings } from './translate/room-translate-settings';
import {
  ChatMessage,
  ChatRoom,
  ChatRoomNote,
  CustomerTag,
  Member,
  Tag,
  type ChatMessageDocument,
  type ChatRoomDocument,
  type ChatRoomNoteDocument,
  type CustomerTagDocument,
  type MemberDocument,
  type TagDocument,
} from './schemas';

const CHAT_SEARCH = {
  DAYS_BACK: 7,
  MAX_SCAN: 1000,
  MAX_RESULTS: 30,
  SNIPPET_CHARS: 90,
  MIN_QUERY: 2,
};

const ANCHOR_WINDOW = { NEWER: 20, OLDER: 20 };

/**
 * [FIX-20260809-ROOMCAP] Ceiling for a room list requested WITHOUT page/limit.
 *
 * 200 is chosen to sit above any realistic single-screen need while keeping the
 * populated result set small enough to stay off the heap-pressure path. It is
 * NOT a page size — paginated callers still use their own limit (clamped to 100
 * above); this only bounds the caller who asked for "everything".
 * HOW TO CHANGE: one number, here.
 */
const ROOM_HARD_CAP = 200;

function escapeRegex(s: string): string {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @InjectModel(ChatRoom.name)
    private readonly chatRoomModel: Model<ChatRoomDocument>,
    @InjectModel(ChatMessage.name)
    private readonly chatMessageModel: Model<ChatMessageDocument>,
    @InjectModel(Member.name)
    private readonly memberModel: Model<MemberDocument>,
    @InjectModel(ChatRoomNote.name)
    private readonly chatRoomNoteModel: Model<ChatRoomNoteDocument>,
    @InjectModel(Tag.name)
    private readonly tagModel: Model<TagDocument>,
    @InjectModel(CustomerTag.name)
    private readonly customerTagModel: Model<CustomerTagDocument>,
    @InjectModel(Hook.name)
    private readonly hookModel: Model<HookDocument>,
    private readonly realtimePublisher: RealtimePublisherService,
    private readonly crypto: CryptoService,
    private readonly lineApi: LineApiService,
    // [FIX-20260808-CHANNELSEND] The send-adapter registry. Keeps sends
    // channel-neutral — mirrors legacy getSendAdapter(hook.channel_type).
    private readonly channels: ChannelRegistry,
    // [FEAT-20260814-ADMINPUSHLOG] writes the outbound audit row
    private readonly webhookLogService: WebhookLogService,
    /* [FEAT-20260821-CHATPUSHCORE] appended LAST, as every new DI param must be:
       a spec that builds this service positionally keeps working, and one that
       builds it through the Nest container fails LOUDLY instead of silently
       handing over `undefined`.
       [FEAT-20260821-QUOTEREPLY] the dispatcher moved one layer down: this slot
       now holds the send LADDER (channels/outbound-send-strategy.ts), which owns
       the `LinePushDispatcher`. Same position, so a positional spec hands in
       `new PushOnlySendStrategy(fakeDispatcher)` and every old assertion holds. */
    @Inject(OUTBOUND_SEND_STRATEGY)
    private readonly sender: OutboundSendStrategy,
    /* [FEAT-20260907-PROVCONDS] appended LAST, same DI rule as the slot above.
       OPTIONAL (`?`) so the two positional specs that build this service with
       fewer args keep compiling; the Nest container always provides it
       (chat.module already imports CustomerProviderModule). A missing provider
       in a hand-built spec simply stamps nothing — absent = today. */
    private readonly customerProvider?: CustomerProviderService,
  ) {}

  public async listRooms(
    dto: ListChatRoomsDto,
    auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    const {
      status = 'active',
      line_bot_id: lineBotIdParam,
      hook_id: hookIdParam,
      user_id,
      group_id,
      page: rawPage,
      limit: rawLimit,
    } = dto;

    const line_bot_id = hookIdParam || lineBotIdParam;
    const paginate = rawPage !== undefined || rawLimit !== undefined;
    const page = Math.max(Number(rawPage) || 1, 1);
    const limit = Math.min(Math.max(Number(rawLimit) || 40, 1), 100);
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = {};

    if (status !== 'all') {
      filter['status'] = status;
    }

    const allowed = await getAllowedHookIds(auth, this.hookModel);
    let scopeIds: string[] | null = null;

    if (group_id && isValidObjectId(group_id)) {
      const hooks = await this.hookModel
        .find({ group: group_id })
        .select('_id')
        .lean();
      scopeIds = hooks.map((hook) => String(hook._id));
    }
    if (line_bot_id && line_bot_id !== 'all') {
      if (!isValidObjectId(line_bot_id)) {
        throw new BadRequestException('Invalid hook id');
      }
      if (scopeIds && !scopeIds.includes(String(line_bot_id))) {
        throw new ForbiddenException('insufficient OA access');
      }
      scopeIds = [String(line_bot_id)];
    }
    if (allowed !== null) {
      scopeIds =
        scopeIds === null
          ? allowed
          : scopeIds.filter((id) => allowed.includes(id));
      if (scopeIds.length === 0) {
        const emptyResponse: Record<string, unknown> = {
          success: true,
          data: [],
        };
        if (paginate) {
          emptyResponse['meta'] = { total: 0, page: 1, limit: 0, pages: 0 };
        }
        return emptyResponse;
      }
    }
    if (scopeIds !== null) {
      const objectIds = scopeIds.map((id) => new Types.ObjectId(id));
      filter['hook_id'] =
        objectIds.length === 1 ? objectIds[0] : { $in: objectIds };
    }

    if (user_id && isValidObjectId(user_id)) {
      filter['user_id'] = new Types.ObjectId(user_id);
    }

    const baseQuery = this.chatRoomModel
      .find(filter)
      .populate('user_id', '-meta')
      .sort({ 'last_message.timestamp': -1 });

    /**
     * ==== [FIX-20260809-ROOMCAP] the un-paginated path had NO ceiling ====
     *
     * WHAT WAS WRONG: `paginate` is false whenever the caller sends neither
     * `page` nor `limit`, and the old line applied `.skip().limit()` ONLY in
     * that branch — so a request without those params loaded EVERY matching
     * room, each with a populated `user_id`, into memory at once. At 100+ OAs
     * that is the most plausible real OOM / latency path in this service.
     * เรียกแบบไม่ใส่ page/limit = ดึงทุกห้องพร้อม populate เข้า memory ทีเดียว.
     *
     * THE FIX: a hard ceiling that applies even when the caller did not ask to
     * paginate. Paginated requests are untouched — they still use the caller's
     * own `limit` (already clamped to 100 above).
     *
     * ⚠️ WHY A CAP AND NOT "REJECT paginate=false": rejecting would be a
     * breaking API change for callers that rely on the un-paginated shape (the
     * response omits `total`/`page` in that mode, so the two are not
     * interchangeable). A ceiling keeps the contract and removes the blow-up.
     *
     * ⚠️ BEHAVIOUR NOTE, stated plainly: a caller that today receives MORE than
     * ROOM_HARD_CAP rooms will now receive exactly that many. That is the point
     * — but it means a dashboard listing every room across every OA silently
     * stops at the cap rather than erroring. The rooms are ordered by
     * `last_message.timestamp` desc, so what is dropped is the least recently
     * active, which is the right end to lose. If a caller genuinely needs more,
     * it should paginate.
     *
     * HOW TO CHANGE: raise/lower ROOM_HARD_CAP below. To remove the ceiling
     * entirely, revert to `if (paginate) baseQuery.skip(skip).limit(limit);` —
     * and accept the unbounded read.
     */
    if (paginate) {
      baseQuery.skip(skip).limit(limit);
    } else {
      baseQuery.limit(ROOM_HARD_CAP);
    }

    const [total, rooms] = await Promise.all([
      paginate
        ? this.chatRoomModel.countDocuments(filter)
        : Promise.resolve(null),
      baseQuery.lean(),
    ]);

    const formattedRooms = rooms.map((room) => {
      const { user_id: userIdVal, assist_status, ...rest } = room;
      return {
        ...rest,
        assist_status: Boolean(assist_status),
        user_data: userIdVal,
      };
    });

    const response: Record<string, unknown> = {
      success: true,
      data: formattedRooms,
    };
    if (paginate && total !== null) {
      response['meta'] = {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      };
    }
    return response;
  }

  public async updateNickname(
    id: string,
    dto: UpdateNicknameDto,
  ): Promise<Record<string, unknown>> {
    const { nickname } = dto;
    if (!nickname && nickname !== '') {
      throw new BadRequestException('nickname is required');
    }
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid ChatRoom ID');
    }

    const room = await this.chatRoomModel.findById(id);
    if (!room) {
      throw new NotFoundException('ChatRoom not found');
    }

    const user = await this.memberModel.findOneAndUpdate(
      { _id: room.user_id },
      { $set: { nickname } },
      { new: true },
    );

    if (!user) {
      throw new NotFoundException('Associated LINE user not found');
    }

    return {
      success: true,
      message: 'Nickname updated successfully',
      data: {
        room_id: room._id,
        nickname: user.nickname,
        line_user_id: user.line_user_id,
        user,
      },
    };
  }

  private async resolveRoomForRead(
    id: string,
    hookIdQuery: string | undefined,
    auth?: AuthenticatedUser,
  ): Promise<ChatRoomDocument> {
    let roomQuery: Record<string, unknown>;
    if (isValidObjectId(id)) {
      roomQuery = { _id: id };
    } else {
      if (!hookIdQuery) {
        throw new BadRequestException(
          'hook_id is required when querying messages by line_user_id',
        );
      }
      roomQuery = {
        channel_user_id: id,
        hook_id: isValidObjectId(hookIdQuery)
          ? new Types.ObjectId(hookIdQuery)
          : hookIdQuery,
      };
    }

    const room = await this.chatRoomModel.findOne(roomQuery);
    if (!room) {
      throw new NotFoundException('ChatRoom not found');
    }

    const allowedHooks = await getAllowedHookIds(auth, this.hookModel);
    if (allowedHooks !== null && !allowedHooks.includes(String(room.hook_id))) {
      throw new ForbiddenException('insufficient OA access');
    }

    return room;
  }

  public async searchRoomMessages(
    id: string,
    qQuery: string | undefined,
    hookIdQuery: string | undefined,
    auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    const room = await this.resolveRoomForRead(id, hookIdQuery, auth);

    const q = String(qQuery || '').trim();
    if (q.length < CHAT_SEARCH.MIN_QUERY) {
      return {
        data: [],
        scanned_from: null,
        truncated: false,
        min_query: CHAT_SEARCH.MIN_QUERY,
      };
    }

    const daysAgo = new Date(
      Date.now() - CHAT_SEARCH.DAYS_BACK * 24 * 60 * 60 * 1000,
    );

    const nth = await this.chatMessageModel
      .find({ room_id: room._id })
      .sort({ created_at: -1 })
      .skip(CHAT_SEARCH.MAX_SCAN - 1)
      .limit(1)
      .select('created_at')
      .lean();

    const capDate = (nth[0] as { created_at?: Date } | undefined)?.created_at;
    const lowerBound = capDate && capDate > daysAgo ? capDate : daysAgo;

    const rows = await this.chatMessageModel
      .find({
        room_id: room._id,
        message_type: 'text',
        created_at: { $gte: lowerBound },
        content: new RegExp(escapeRegex(q), 'i'),
      })
      .sort({ created_at: -1 })
      .limit(CHAT_SEARCH.MAX_RESULTS)
      .select('_id content sender_type created_at')
      .lean();

    const half = Math.floor(CHAT_SEARCH.SNIPPET_CHARS / 2);
    const data = rows.map((m) => {
      const text = typeof m.content === 'string' ? m.content : '';
      const at = text.toLowerCase().indexOf(q.toLowerCase());
      const start = at < 0 ? 0 : Math.max(0, at - half);
      const snippet = text.slice(start, start + CHAT_SEARCH.SNIPPET_CHARS);
      return {
        _id: m._id,
        sender_type: m.sender_type,
        created_at: (m as unknown as { created_at: Date }).created_at,
        snippet:
          (start > 0 ? '…' : '') +
          snippet +
          (start + CHAT_SEARCH.SNIPPET_CHARS < text.length ? '…' : ''),
      };
    });

    return {
      data,
      scanned_from: lowerBound,
      truncated: data.length >= CHAT_SEARCH.MAX_RESULTS,
      limits: { days: CHAT_SEARCH.DAYS_BACK, max_scan: CHAT_SEARCH.MAX_SCAN },
    };
  }

  public async getMessagesAround(
    id: string,
    messageId: string,
    hookIdQuery: string | undefined,
    auth?: AuthenticatedUser,
    /* [FEAT-20260821-QUOTEJUMP] `by: 'provider'` anchors on LINE's message id
       (`provider_msg_id`) instead of ours. A quote block names the quoted message
       in LINE's id-space (`quoted_provider_msg_id`); when that message is outside
       the loaded window the console holds no `_id` to jump to — this is the one
       read that turns the LINE id into a window. Default unchanged. */
    by: 'id' | 'provider' = 'id',
  ): Promise<Record<string, unknown>> {
    const room = await this.resolveRoomForRead(id, hookIdQuery, auth);

    if (by === 'id' && !isValidObjectId(messageId)) {
      throw new BadRequestException('invalid messageId');
    }

    const target = (await this.chatMessageModel
      .findOne(
        by === 'provider'
          ? { provider_msg_id: messageId, room_id: room._id }
          : { _id: messageId, room_id: room._id },
      )
      .select('created_at')
      .lean()) as { _id: unknown; created_at?: Date } | null;

    if (!target || !target.created_at) {
      throw new NotFoundException('message not found in this room');
    }

    const [newer, older] = await Promise.all([
      this.chatMessageModel
        .find({
          room_id: room._id,
          created_at: { $gte: target.created_at },
        })
        .populate('internal_content_id')
        .sort({ created_at: 1 })
        .limit(ANCHOR_WINDOW.NEWER)
        .lean(),
      this.chatMessageModel
        .find({
          room_id: room._id,
          created_at: { $lt: target.created_at },
        })
        .populate('internal_content_id')
        .sort({ created_at: -1 })
        .limit(ANCHOR_WINDOW.OLDER)
        .lean(),
    ]);

    /* [FEAT-20260831-QUOTESRC] a jump window is a page like any other: a bubble
       in it can quote a message that this window does not contain, and the
       console cannot resolve what it never loaded. Same one query as the list
       path; no query at all when nothing here quotes anything. */
    const data = await withQuotedPreviews(
      this.chatMessageModel,
      room._id,
      [...newer].reverse().concat(older) as never,
    );

    return {
      data,
      // our `_id` in both modes — the FE scrolls to `msg-<_id>`
      anchor_id: String(target._id),
      has_newer: newer.length >= ANCHOR_WINDOW.NEWER,
      has_older: older.length >= ANCHOR_WINDOW.OLDER,
    };
  }

  public async getRoomMessages(
    id: string,
    queryDto: {
      page?: number;
      limit?: number;
      sort?: string;
      hook_id?: string;
    },
    auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    const page = Math.max(Number(queryDto.page) || 1, 1);
    const limit = Math.max(Number(queryDto.limit) || 20, 1);
    const sort = queryDto.sort === 'asc' ? 'asc' : 'desc';

    const room = await this.resolveRoomForRead(id, queryDto.hook_id, auth);

    const lineUser = await this.memberModel
      .findById(room.user_id)
      .select('-meta');
    if (!lineUser) {
      throw new NotFoundException('Associated LINE user not found');
    }

    const query = { room_id: room._id };
    const sortOrder = sort === 'asc' ? 1 : -1;
    const skip = (page - 1) * limit;

    const [messages, total, hook] = await Promise.all([
      this.chatMessageModel
        .find(query)
        .populate('internal_content_id')
        .sort({ created_at: sortOrder })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.chatMessageModel.countDocuments(query),
      room.hook_id
        ? this.hookModel
            .findById(room.hook_id)
            .select('translate_lang auto_translate')
            .lean()
        : Promise.resolve(null),
    ]);

    /* [FEAT-20260831-QUOTESRC] the page opens with ten messages, so a bubble
       quoting anything older had nothing to resolve against and the console drew
       a stand-in. Resolve it here instead: ONE extra query, and only when this
       page actually contains a quote — a room without any costs exactly what it
       cost before. หน้าไหนไม่มี quote = ไม่มีคิวรีเพิ่ม. */
    const data = await withQuotedPreviews(
      this.chatMessageModel,
      room._id,
      messages as never,
    );

    return {
      success: true,
      room: {
        id: room._id,
        line_user_id: room.channel_user_id || room.line_user_id,
        assist_status: Boolean(room.assist_status),
        /* [FEAT-20260918-ROOMTRANS] Room translation settings & precedence —
           room first, hook second. [FIX-20260918-LANGSPLIT] the rule is one
           pure function now (`translate/room-translate-settings.ts`); it used
           to be this literal, copied here and at both ends of the settings
           route, which is three places to keep in step. */
        ...resolveRoomTranslateSettings(room, hook),
        user_data: {
          id: lineUser._id,
          display_name: lineUser.display_name,
          nickname: lineUser.nickname,
          picture_url: lineUser.picture_url,
          assist_status: Boolean(room.assist_status),
        },
      },
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
      data,
    };
  }

  public async createInlineNote(
    id: string,
    hookIdQuery: string | undefined,
    dto: CreateInlineNoteDto,
    auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    const content = (dto.content || '').trim();
    if (!content) {
      throw new BadRequestException('content is required');
    }

    let room: ChatRoomDocument | null;
    if (isValidObjectId(id)) {
      room = await this.chatRoomModel.findById(id);
    } else {
      if (!hookIdQuery) {
        throw new BadRequestException(
          'hook_id is required when using line_user_id',
        );
      }
      room = await this.chatRoomModel.findOne({
        $or: [{ line_user_id: id }, { channel_user_id: id }],
        hook_id: isValidObjectId(hookIdQuery)
          ? new Types.ObjectId(hookIdQuery)
          : hookIdQuery,
      });
    }

    if (!room) {
      throw new NotFoundException('Chat room not found');
    }

    const authorName = auth?.displayName || auth?.username || null;
    const noteMsg = await this.chatMessageModel.create({
      room_id: room._id,
      hook_id: room.hook_id,
      channel_type: room.channel_type || 'line',
      sender_type: 'bot',
      message_type: 'inline_note',
      content,
      metadata: {
        is_internal: true,
        author_name: authorName,
        author_id: auth?.userId || null,
      },
    });

    return { success: true, data: noteMsg };
  }

  /**
   * [FIX-20260818-CHATOASCOPE · plan §8 = T3-3, closes audit C2.1] `auth` is not
   * optional decoration: everything that SENDS goes through here, so without the
   * scope check below an operator of one OA could reply, push, or send media from
   * another OA's channel — spending that OA's quota and appearing to its customer
   * as that OA. The read-side twin `resolveRoomForRead` has enforced this since
   * [FIX-20260808-ACLWHITELIST]; the write side never did.
   */
  private async resolveRoomHook(
    id: string,
    hookIdQuery: string | undefined,
    auth?: AuthenticatedUser,
  ): Promise<{ room: ChatRoomDocument; hook: HookDocument }> {
    let room: ChatRoomDocument | null;
    if (isValidObjectId(id)) {
      room = await this.chatRoomModel.findById(id);
    } else {
      if (!hookIdQuery) {
        throw new BadRequestException(
          'hook_id is required when using line_user_id',
        );
      }
      room = await this.chatRoomModel.findOne({
        $or: [{ line_user_id: id }, { channel_user_id: id }],
        hook_id: isValidObjectId(hookIdQuery)
          ? new Types.ObjectId(hookIdQuery)
          : hookIdQuery,
      });
    }
    if (!room) {
      throw new NotFoundException('Chat room not found');
    }

    // Same two lines the read path uses — one rule, one place (oa-access/).
    const allowed = await getAllowedHookIds(auth, this.hookModel);
    if (isHookOutOfScope(allowed, room.hook_id)) {
      throw new ForbiddenException('insufficient OA access');
    }

    const hook = await this.hookModel.findById(room.hook_id);
    if (!hook) {
      throw new NotFoundException('Hook not found');
    }
    return { room, hook };
  }

  /**
   * [FIX-20260808-CHANNELSEND] Deliver a neutral OutboundMessage to the room's
   * customer through the channel's send adapter.
   *
   * Mirrors legacy resolveRoomHook + getSendAdapter (channels/index.js,
   * chatRoomController.js:1068-1102):
   *   1. accessToken = safeDecrypt(hook.access_token || hook.line_key)
   *   2. to = the room's customer id (channel_user_id / line_user_id)
   *   3. adapter = registry.getSendAdapter(hook.channel_type)
   *   4. adapter null (declared-but-unbuilt channel) → BadRequest, NEVER a LINE
   *      fallback; else await adapter.send({ to, accessToken }, msg).
   *
   * No hardcoded 'line' branch here — adding Facebook needs zero changes.
   */
  private async deliverOutbound(
    room: ChatRoomDocument,
    hook: HookDocument,
    msg: OutboundMessage,
    /* [FEAT-20260814-ADMINPUSHLOG] who pressed send. Optional so the two existing
       call sites compile unchanged; when absent the row records `null` rather
       than inventing an actor. */
    actor?: { id?: string | null; name?: string | null },
    /* [FEAT-20260821-QUOTEREPLY] the chat_messages `_id` the operator pressed
       Reply on. Resolved to LINE's quoteToken here (column → raw_content), placed
       on the text/sticker object by the builder, and carried by whichever rung
       of the ladder goes out. Absent = today's send, byte for byte. */
    quoteOf?: string | null,
  ): Promise<OutboundSendOutcome & { quotedProviderMsgId: string | null }> {
    const channelType = hook.channel_type || room.channel_type || undefined;
    const adapter = this.channels.getSendAdapter(channelType);
    /* [FIX-20260827-CGATECHANNEL] Gate on the TRANSPORT, not on registration.
       📖 todo/task/27082026/todo2_27082026_candidate-c-gate-channel-mismatch.md
       This used to be `if (!adapter)`, i.e. "is an adapter registered". The
       delivery below goes through `LinePushDispatcher`, which is LINE-only
       (`infra/line/push/line-push.ts` KIND_URL takes no channel argument), so a
       second registered channel would have passed here and been POSTed to
       api.line.me with its own token. `adapter` is still resolved — it is what
       the predicate reads — and the message, status and throw/return style are
       unchanged. Byte-identical today; see the predicate for the full reasoning.
       revert: `if (!adapter) {`. */
    if (!servedByLineCore(adapter)) {
      throw new BadRequestException(`channel '${channelType}' cannot send yet`);
    }

    const accessToken = this.crypto.safeDecrypt(
      hook.access_token || hook['line_key'],
    );
    if (!accessToken) {
      throw new BadRequestException('Line access token is required');
    }

    const to = room.channel_user_id || room.line_user_id;
    if (!to) {
      throw new BadRequestException('Chat room has no customer id');
    }

    /* [FEAT-20260814-ADMINPUSHLOG] Every LINE call in this codebase leaves a
       `webhook_logs` row except this one, which is why the Webhook History page
       showed nothing under "LINE Push" while operators were sending all day.
       ⚠️ The row is written on BOTH outcomes and the original error is rethrown
          untouched — the caller's error handling, and the HTTP status the
          dashboard sees, must not change because auditing was added.
       ⚠️ `logOutboundPush` never throws and is not awaited (see its header), so
          a logging failure cannot cost the customer their message. */
    const startedAt = Date.now();
    const audit = (
      error?: unknown,
      // [FEAT-20260821-QUOTEREPLY] one row per REAL call the ladder made, each
      // saying which endpoint carried it and what became of the quote.
      via?: { sendKind: 'reply' | 'push'; quote: 'kept' | 'dropped' | 'none' },
    ): void =>
      logOutboundPush(
        this.webhookLogService,
        {
          to,
          hookId: hook._id ? String(hook._id) : null,
          hookAlias: hook.alias || null,
          channelType,
          groupId: hook['group'] ? String(hook['group']) : null,
          actorId: actor?.id ?? null,
          actorName: actor?.name ?? null,
        },
        {
          kind: msg.kind,
          text: 'text' in msg ? msg.text : undefined,
          durationMs: Date.now() - startedAt,
          error,
          ...(via ?? {}),
        },
        (m) => this.logger.warn(m),
      );

    /* [FEAT-20260821-CHATPUSHCORE] the send moves to the push core.
       =====================================================================
       WHAT CHANGES ON THE WIRE: nothing. `buildChatMessages` produces the same
       objects the adapter did — proven for all four kinds, not read and agreed:
       `z-test/unit/chat-pushcore-parity.spec.ts` drives the REAL adapter with
       axios stubbed, captures what it sent, and compares.

       WHAT WE GAIN: `X-Line-Retry-Key`. The adapter had none, so an admin whose
       network stuttered could not tell whether LINE took the message — sending
       again risked a duplicate, not sending risked silence. The core sends the
       same key on every attempt and reads LINE's 409 as "an earlier attempt
       already won".

       ⚠️ THE CORE NEVER THROWS — it returns `{ok:false}` (`line-push.ts:38-40`).
       The contract HERE is the opposite: the throw is what tells the operator the
       send failed. Forgetting to convert would show "sent" for a message LINE
       refused, which is the worst way to be wrong on this screen.
       ล้มต้องโยน ไม่ใช่คืนเงียบ ๆ.

       ⚠️ TIMEOUT PASSED EXPLICITLY. The adapter chose 8s for images and 5s
       otherwise (`line-send-adapter.ts:166`, ported from legacy); the core has
       one default, so the split must travel with the request or every image send
       quietly gets the shorter budget.

       ⚠️ THE AUDIT KEEPS THE RAW AXIOS ERROR. `outbound-audit.ts:126-149` reads
       `.response.status` and `.code` off it to fill `webhook_logs`; the core
       preserves it untouched on `res.raw` for exactly this.

       `adapter` is still resolved above and still decides "can this channel send
       at all" — only the LINE call itself moved.

       revert: put back `await adapter.send({ to, accessToken }, msg);` in the
       original try/catch and drop the `linePush` constructor param. */
    /* [FEAT-20260821-QUOTEREPLY] the call moved from `linePush.dispatch` to the
       ladder. With `CHAT_REPLY_REUSE=off` (default) the ladder IS one push with
       this exact request — chat-pushcore-parity.spec.ts still deep-equals it.
       `quoteOf` → token lookup is the only new read on a plain send: none, because
       `quoteOf` is absent. The candidate lookup is skipped unless the bound
       strategy says it wants one (off = zero extra reads). */
    const quote = quoteOf
      ? await resolveQuoteToken(this.chatMessageModel, room._id, quoteOf)
      : null;
    if (quoteOf && !quote) {
      // The operator asked to quote something we cannot resolve. Say so rather
      // than silently sending a plain message they believe is a reply.
      throw new BadRequestException('quoted message not found in this room');
    }
    const quoted =
      quote && (msg.kind === 'text' || msg.kind === 'sticker')
        ? { ...msg, quoteToken: quote.quoteToken }
        : msg;
    const candidate = this.sender.wantsReplyCandidate
      ? await findReplyCandidate(this.chatMessageModel, room._id)
      : null;

    const outcome = await this.sender.send(
      {
        token: accessToken,
        to,
        messages: buildChatMessages(quoted),
        timeoutMs: msg.kind === 'image' || msg.kind === 'images' ? 8000 : 5000,
      },
      candidate,
    );
    // Every rung that really hit LINE leaves its own row — a reply that died and
    // the push that followed are two calls, and the history page shows both.
    outcome.attempts.forEach((a, i) => {
      const last = i === outcome.attempts.length - 1;
      audit(a.res.ok ? undefined : a.res.raw, {
        sendKind: a.kind,
        quote: last ? outcome.quote : a.quote,
      });
    });
    if (outcome.replyTokenSpent && outcome.spentRowId) {
      // Single-use: stamp it so the next message this minute goes straight to push.
      await this.chatMessageModel
        .updateOne(
          { _id: outcome.spentRowId },
          { $set: { reply_token_used_at: new Date() } },
        )
        .exec()
        .catch((e: Error) =>
          this.logger.warn(
            `[QUOTEREPLY] reply_token_used_at not stamped: ${e.message}`,
          ),
        );
    }
    const res = outcome.res;
    if (!res.ok) {
      const raw = res.raw;
      const reason = extractLineReason(raw) ?? res.reason;
      /* [FIX-20260909-SENDREASON] 🔴 A BARE `Error` HERE BECAME
         `500 {"error":"internal error"}` AND THE OPERATOR LEARNED NOTHING —
         the dashboard could only say "ส่งข้อความไม่สำเร็จ" with no reason to show.
         `AllExceptionsFilter` answers "internal error" for anything that is not
         an `HttpException` — correctly, since an unexpected throw may carry a
         stack or a token, and that rule is not being widened. This failure is
         not unexpected: `extractLineReason` has ALREADY built the operator-
         readable sentence ("HTTP 429 - You have reached your monthly limit"),
         and it was being thrown away one line later. Declaring it an HTTP error
         is what lets it out.
         ⚠️ 502, and LINE's own status is NOT mirrored onto our response. The
            failure is between us and LINE, not between the browser and us —
            mirroring a 401 would sign the operator out of the dashboard because
            an OA's token expired, and a mirrored 429 would look like OUR rate
            limit. One status for "the channel refused"; WHICH refusal is in the
            message, verbatim, where the operator reads it.
         ⚠️ The message is byte-identical to what it always was. Only its type
            changed, so nothing that matches on the text moves. */
      throw new BadGatewayException(
        reason ? `LINE push failed: ${reason}` : 'LINE push failed',
      );
    }
    return { ...outcome, quotedProviderMsgId: quote?.providerMsgId ?? null };
  }

  /**
   * [FEAT-20260821-QUOTEREPLY] What only LINE's response can tell us about the
   * message we just sent: its id and the quote token a customer would use to
   * quote it back (owner: "เก็บเผื่อไว้เลย"), plus which message we quoted.
   *
   * [FIX-20260909-SENDFIRST] 🔴 IT RETURNS FIELDS, IT NO LONGER WRITES THEM.
   * This used to be `recordSentMessage`: an `updateOne` that patched a row
   * created BEFORE the send. Now the row is created AFTER a successful send
   * (see `sendChatReply`), so these fields are simply part of the insert — one
   * write instead of an insert plus an immediate patch of itself, and no
   * "never throws" catch to reason about because there is no second write left
   * to fail.
   *
   * Spreads, not nulls — a send LINE answered with nothing contributes no key
   * at all, so an ordinary row keeps the exact shape it has always had.
   */
  private sentMessageFields(
    outcome: OutboundSendOutcome & { quotedProviderMsgId: string | null },
  ): Record<string, unknown> {
    const sent = (
      outcome.res.data as
        | { sentMessages?: Array<{ id?: string; quoteToken?: string }> }
        | undefined
    )?.sentMessages?.[0];
    return {
      ...(sent?.id ? { provider_msg_id: sent.id } : {}),
      ...(sent?.quoteToken ? { quote_token: sent.quoteToken } : {}),
      ...(outcome.quote === 'kept' && outcome.quotedProviderMsgId
        ? { quoted_provider_msg_id: outcome.quotedProviderMsgId }
        : {}),
    };
  }

  public async sendChatReply(
    id: string,
    hookIdQuery: string | undefined,
    dto: SendChatReplyDto,
    auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    const text = (dto.text || dto.content || '').trim();
    if (!text) {
      throw new BadRequestException('text is required');
    }
    const { room, hook } = await this.resolveRoomHook(id, hookIdQuery, auth);

    /* [FEAT-20260908-CHATTRANS] the admin's OWN wording, when they drafted in
       one language and sent another. `content` below is the TRANSLATED text —
       what the customer sees — and this holds the same message in the language
       the admin actually typed. content = สิ่งที่ลูกค้าเห็นเสมอ.

       ⚠️ THE TEXT IS WHAT DECIDES, NOT THE LANGUAGE. `original_lang` is optional
       and in practice usually ABSENT: the composer does not ask the admin what
       language they just typed in, the preview answers with `{ text }` only,
       and the panel's UI language is not the language of the draft — so the
       dashboard sends the text alone rather than guess (agent E, 09/09). An
       entry with no language still renders: the original above the divider,
       with no language pair beside it, which is exactly what is known about it.
       Refusing to store it would have made the outbound half of this feature
       silently dead for the request the dashboard actually sends.

       With no `original_text` the spread below contributes NO KEY AT ALL, so an
       ordinary send writes exactly the document it wrote yesterday — the
       "everything added is optional" rule, measured by
       `chat-outbound-translation.spec.ts` rather than asserted.

       It rides the ONE `create()` this method already performs, deliberately:
       an insert cannot half-happen, so there is no second write left to fail
       after the text has already reached the customer.
       revert: delete these three lines, the spread below, and the two DTO
       fields. */
    const originalText = (dto.original_text || '').trim();
    const originalLang = (dto.original_lang || '').trim() || null;
    /* [FEAT-20260910-OUTBOUNDTARGET] the language the customer is reading —
       picked by the admin in the composer, not detected here. Absent ⇒ null and
       the stored entry is exactly the one this method wrote yesterday. */
    const translatedLang = (dto.translated_lang || '').trim() || null;

    /* ==== [FIX-20260909-SENDFIRST] DELIVER FIRST, THEN WRITE THE ROW ========
     *
     * Owner, 09/09: *"เวลา error 429 ทำไม chat message ยังเซฟ จริง ๆ ต้องไม่เซฟนะ
     * เพราะมันไม่ 200"* · *"ถ้าส่งสำเร็จ ค่อยเซฟ chat message สิ"*.
     *
     * 🔴 THE BUG: the insert ran first and `deliverOutbound` throws when LINE
     *    refuses. The request answered with an error while the row stayed —
     *    so the thread showed a bubble the customer never received, and it
     *    looked exactly like a delivered one. On a quota 429 an operator could
     *    fill a whole conversation with messages that only exist on our side.
     *
     * 🔴 A FAILED SEND IS STILL RECORDED — just not as a message. Every attempt
     *    writes a `webhook_logs` row inside `deliverOutbound`, success or
     *    failure, with LINE's own status and reason (that is what the Webhook
     *    History page reads). The trace the old ordering was after lives there,
     *    where failed CALLS belong; `chat_messages` is what the room actually
     *    said, and an undelivered message did not happen.
     *
     * ⚠️ ORDER IS THE WHOLE FIX — nothing about the document changes. The same
     *    keys, the same values, one insert, and it now carries LINE's answer
     *    (`sentMessageFields`) instead of being patched by a second write a
     *    moment later.
     *
     * ⚠️ The two things that read `chat_messages` DURING a send are unaffected:
     *    the quote lookup reads the row being quoted, and the reply-token
     *    candidate reads `sender_type: 'customer'` only. Neither could ever see
     *    our own bot row, so moving it cannot change what goes on the wire.
     *
     * revert: move this call back below the `create()` and restore the
     *         `recordSentMessage` update. */
    // [FIX-20260808-CHANNELSEND] Actually deliver to the customer via the
    // channel adapter. Previously this method only created the DB row and
    // published realtime — the message never reached LINE.
    // [FEAT-20260814-ADMINPUSHLOG] name the operator on the audit row — the
    // chat_messages row alone cannot say who sent it when a room has several.
    const outcome = await this.deliverOutbound(
      room,
      hook,
      { kind: 'text', text },
      {
        id: auth?.userId ? String(auth.userId) : null,
        name: auth?.displayName || auth?.username || null,
      },
      dto.quote_of,
    );

    const message = await this.chatMessageModel.create({
      room_id: room._id,
      hook_id: room.hook_id,
      channel_type: room.channel_type || 'line',
      sender_type: 'bot',
      sender_id: auth?.userId ? new Types.ObjectId(auth.userId) : null,
      message_type: 'text',
      content: text,
      // [FIX-20260808-ADMINSENDER] Legacy stores the admin's display name under
      // metadata.sender_name (snake_case, chatHistoryService.js:196) — the exact
      // key the dashboard reads (ChatRoomView metadata?.sender_name) to show the
      // admin instead of "Bot". The prior camelCase senderId/senderName never
      // matched, so every admin push rendered as the AI bot. `is_push`/`is_admin`
      // are the explicit flags for the same distinction + push analytics.
      is_push: true,
      is_admin: true,
      metadata: {
        sender_name: auth?.displayName || auth?.username || null,
      },
      /* [FEAT-20260908-CHATTRANS] see above. `outboundTranslationEntry` is the
         ONE place the stored shape is decided, shared with the read path's
         writer, so the two can never disagree about what an entry looks like. */
      ...(originalText
        ? {
            translations: [
              outboundTranslationEntry(
                originalText,
                originalLang,
                translatedLang,
              ),
            ],
          }
        : {}),
      /* [FIX-20260909-SENDFIRST] what LINE said about the message it just
         accepted — part of the insert now that the insert happens afterwards.
         Contributes no key when LINE returned nothing to record. */
      ...this.sentMessageFields(outcome),
    });

    if (hook._id) {
      await this.realtimePublisher.publish('message:new', {
        hook_id: String(hook._id),
        room_id: String(room._id),
        message_id: String(message._id),
      });
    }

    return { success: true, data: message };
  }

  public async sendChatSticker(
    id: string,
    hookIdQuery: string | undefined,
    dto: SendChatStickerDto,
    auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    const { packageId, stickerId } = dto;
    if (!packageId || !stickerId) {
      throw new BadRequestException('packageId and stickerId are required');
    }
    const { room, hook } = await this.resolveRoomHook(id, hookIdQuery, auth);

    // [FIX-20260808-CHANNELSEND] Deliver the sticker to the customer via the
    // channel adapter (was create + publish only, never sent).
    // [FIX-20260909-SENDFIRST] and deliver BEFORE the row exists, for the same
    // reason as the text send above — a sticker LINE refused must not sit in
    // the thread looking sent.
    const outcome = await this.deliverOutbound(
      room,
      hook,
      { kind: 'sticker', packageId, stickerId },
      // [FEAT-20260814-ADMINPUSHLOG] stickers are an admin action too
      {
        id: auth?.userId ? String(auth.userId) : null,
        name: auth?.displayName || auth?.username || null,
      },
      dto.quote_of,
    );

    const message = await this.chatMessageModel.create({
      room_id: room._id,
      hook_id: room.hook_id,
      channel_type: room.channel_type || 'line',
      sender_type: 'bot',
      sender_id: auth?.userId ? new Types.ObjectId(auth.userId) : null,
      message_type: 'sticker',
      content: '[sticker]',
      // [FIX-20260808-ADMINSENDER] see the text-push site: metadata.sender_name
      // (snake) is what the dashboard reads; is_push/is_admin are the explicit flags.
      is_push: true,
      is_admin: true,
      metadata: {
        packageId,
        stickerId,
        sender_name: auth?.displayName || auth?.username || null,
      },
      // [FIX-20260909-SENDFIRST] LINE's answer, in the insert — see the text send
      ...this.sentMessageFields(outcome),
    });

    if (hook._id) {
      await this.realtimePublisher.publish('message:new', {
        hook_id: String(hook._id),
        room_id: String(room._id),
        message_id: String(message._id),
      });
    }

    return { success: true, data: message };
  }

  /**
   * PORTED — legacy chatRoomController.js:1276-1357.
   *
   * Resolves the OA's token, reads the profile from LINE and writes it onto the
   * member row. The LINE call goes through LineApiService, the same client the
   * webhook flow uses; there is deliberately no second one in this module.
   */
  public async syncUserProfile(
    dto: SyncUserProfileDto,
    auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    const { hook_id, line_user_id } = dto;
    if (!hook_id || !line_user_id) {
      throw new BadRequestException('hook_id and line_user_id are required');
    }

    /**
     * [FIX-20260818-CHATOASCOPE · plan §8 = T3-3] `hook_id` arrives from the
     * REQUEST BODY and decides whose LINE access token gets decrypted and spent
     * below. Without this check an operator of one OA could name another OA's
     * hook and have the server call LINE **as that OA** — burning its quota,
     * probing friendship, and overwriting the shared member row from the answer.
     *
     * The check sits BEFORE the hook is loaded on purpose: the harm is the
     * credential being used, so refusing after decrypting would still leak it.
     * เช็คก่อนถอดรหัส ไม่ใช่หลัง
     */
    const allowed = await getAllowedHookIds(auth, this.hookModel);
    if (isHookOutOfScope(allowed, hook_id)) {
      throw new ForbiddenException('insufficient OA access');
    }

    // 1. Resolve Hook to get access token
    const hook = await this.hookModel.findById(hook_id).lean();
    if (!hook) {
      throw new NotFoundException('Hook (Hook) not found');
    }

    // [FIX-20260808-FBREADY] This fetches a LINE profile via getLineProfile,
    // which is LINE-specific. A Facebook (or other) hook would send a PSID to the
    // LINE profile endpoint and fail. Refuse loudly for a non-LINE channel rather
    // than mis-call — a legacy hook with no channel_type reads as 'line' and is
    // unaffected. TODO(facebook): resolve the profile via a channel-aware fetcher.
    const channelType = (hook['channel_type'] as string | undefined) ?? 'line';
    if (channelType !== 'line') {
      throw new BadRequestException(
        `channel '${channelType}' profile sync is not supported yet — only LINE is wired`,
      );
    }

    const accessToken = this.crypto.safeDecrypt(
      hook.access_token || hook['line_key'],
    );
    if (!accessToken) {
      throw new BadRequestException('Hook has no access token configured');
    }

    // 2. Fetch Profile from LINE API
    this.logger.log(
      `[SYNC PROFILE] Fetching LINE profile using hook ${String(hook_id)}`,
    );
    const profile = await this.lineApi.getLineProfile(
      accessToken,
      line_user_id,
    );
    if (!profile) {
      /**
       * ⚠️ KNOWN DIFFERENCE, and it is forced by the client boundary.
       * Legacy answers `lineErr.response?.status || 500` with
       * `details: lineErr.response?.data || lineErr.message`, so a 401 or 404
       * from LINE is passed straight through. `getLineProfile` logs the axios
       * error and returns null — the status and the body are gone by the time
       * this line runs — so every upstream failure surfaces as 500 here. The
       * fix belongs in LineApiService (a variant that hands back the response),
       * not in a second HTTP call written here.
       *
       * `details` is dropped for the same reason: AllExceptionsFilter reduces
       * every exception to `{ error }` unless the payload carries
       * `success: false`, so the extra key would not reach the client even if
       * the value were available.
       */
      throw new InternalServerErrorException(
        'Failed to fetch profile from LINE API',
      );
    }

    // 3. Update or Create Member record
    const $set: Record<string, unknown> = {
      line_user_id,
      display_name: profile.displayName,
      picture_url: profile.pictureUrl,
      status_message: profile.statusMessage,
      last_synced_at: new Date(),
    };

    // If nickname is empty, initialize it with displayName. Legacy reads the
    // mirrored field and writes the legacy one — kept exactly that way here.
    const existingUser = await this.memberModel
      .findOne({ member_user_id: line_user_id })
      .lean();
    if (!existingUser || !existingUser.nickname) {
      $set['nickname'] = profile.displayName;
    }

    const updatedUser = await this.memberModel.findOneAndUpdate(
      { line_user_id },
      { $set },
      { upsert: true, new: true, runValidators: true },
    );

    return {
      success: true,
      message: 'User profile synced successfully',
      data: {
        id: updatedUser._id,
        line_user_id: updatedUser.line_user_id,
        display_name: updatedUser.display_name,
        nickname: updatedUser.nickname,
        picture_url: updatedUser.picture_url,
        status_message: updatedUser.status_message,
        last_synced_at: updatedUser.last_synced_at,
      },
    };
  }

  public async getAssistStatus(
    id: string,
    auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid ChatRoom ID');
    }
    const room = await this.chatRoomModel.findById(id).lean();
    if (!room) {
      throw new NotFoundException('ChatRoom not found');
    }
    // [FIX-20260818-ASSISTSCOPE · plan §8 = T3-3] assist state tells an operator
    // whether another OA's bot is live on a customer — scope it like every read.
    const allowedRead = await getAllowedHookIds(auth, this.hookModel);
    if (isHookOutOfScope(allowedRead, room.hook_id)) {
      throw new ForbiddenException('insufficient OA access');
    }
    return {
      success: true,
      data: {
        room_id: room._id,
        assist_status: Boolean(room.assist_status),
      },
    };
  }

  public async updateAssistStatus(
    id: string,
    dto: UpdateAssistStatusDto,
    auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    const { assist_status } = dto;
    if (typeof assist_status !== 'boolean') {
      throw new BadRequestException('assist_status must be a boolean');
    }
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid ChatRoom ID');
    }

    const updateFields: Record<string, unknown> = {
      assist_status,
      last_assist_changed_at: new Date(),
    };
    if (assist_status) {
      updateFields['recently_assisted_at'] = new Date();
    }

    /**
     * [FIX-20260818-ASSISTSCOPE · plan §8 = T3-3] The scope goes INSIDE the
     * filter, not in a check before it: `assist_status` is the atomic claim the
     * hand-off machinery depends on, so a read-then-write would leave a window
     * where the room moves out of scope between the two. Out of scope now looks
     * exactly like "not found", which is also the right disclosure answer.
     */
    const allowed = await getAllowedHookIds(auth, this.hookModel);
    const room = await this.chatRoomModel.findOneAndUpdate(
      { _id: id, ...scopeFilter(allowed) },
      { $set: updateFields },
      { new: true },
    );

    if (!room) {
      throw new NotFoundException('ChatRoom not found');
    }

    return {
      success: true,
      message: 'Assist status updated successfully',
      data: {
        room_id: room._id,
        assist_status: room.assist_status,
      },
    };
  }

  public async getAssistStatusByMemberId(
    memberId: string,
    auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    /**
     * [FIX-20260818-ASSISTSCOPE · plan §8 = T3-3] One member can own a room under
     * SEVERAL OAs — four do in the live data — so an unscoped lookup answered
     * from whichever row sorted first, which was routinely another OA's. Scoping
     * the query means the answer is always the caller's own room.
     */
    const allowed = await getAllowedHookIds(auth, this.hookModel);
    const rooms = await this.chatRoomModel
      .find({
        $or: [{ channel_user_id: memberId }, { line_user_id: memberId }],
        ...scopeFilter(allowed),
      })
      .lean();
    if (!rooms || rooms.length === 0) {
      throw new NotFoundException('ChatRooms not found for this Member ID');
    }
    const room = rooms[0];
    if (!room) {
      throw new NotFoundException('ChatRooms not found for this Member ID');
    }
    return {
      success: true,
      data: {
        line_user_id: room.channel_user_id || room.line_user_id,
        assist_status: Boolean(room.assist_status),
      },
    };
  }

  public async updateAssistStatusByMemberId(
    memberId: string,
    dto: UpdateAssistStatusDto,
    auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    const { assist_status } = dto;
    if (typeof assist_status !== 'boolean') {
      throw new BadRequestException('assist_status must be a boolean');
    }

    const updateFields: Record<string, unknown> = {
      assist_status,
      last_assist_changed_at: new Date(),
    };
    if (assist_status) {
      updateFields['recently_assisted_at'] = new Date();
    }

    /**
     * [FIX-20260818-ASSISTSCOPE · plan §8 = T3-3] This `updateMany` had no hook
     * filter, so one toggle wrote EVERY room that member owns — across OAs. That
     * is not a hypothetical: four LINE ids in the live data own rooms under two
     * different hooks, so ordinary use was already silencing (or un-silencing)
     * another OA's bot. เขียนข้าม OA อยู่แล้วทุกวัน ไม่ต้องมีใครตั้งใจ
     */
    const allowed = await getAllowedHookIds(auth, this.hookModel);
    const result = await this.chatRoomModel.updateMany(
      {
        $or: [{ line_user_id: memberId }, { channel_user_id: memberId }],
        ...scopeFilter(allowed),
      },
      { $set: updateFields },
    );

    if (result.matchedCount === 0) {
      throw new NotFoundException('ChatRooms not found for this Member ID');
    }

    return {
      success: true,
      message:
        'Assist status updated successfully for all rooms of this member',
      data: {
        line_user_id: memberId,
        assist_status,
        updated_count: result.modifiedCount,
      },
    };
  }

  public async updateRoomNote(
    id: string,
    dto: UpdateRoomNoteDto,
  ): Promise<Record<string, unknown>> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid ChatRoom ID');
    }

    const room = await this.chatRoomModel.findById(id);
    if (!room) {
      throw new NotFoundException('ChatRoom not found');
    }

    const newNote =
      dto.note !== undefined
        ? dto.note
          ? String(dto.note).trim()
          : null
        : null;
    room.note = newNote;
    await room.save();

    return {
      success: true,
      message: 'Chat room note updated successfully',
      data: room,
    };
  }

  /**
   * [FEAT-20260918-ROOMTRANS] Get room translation settings and effective hook defaults.
   */
  public async getRoomTranslateSettings(
    id: string,
    auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid ChatRoom ID');
    }

    const room = await this.chatRoomModel.findById(id);
    if (!room) {
      throw new NotFoundException('ChatRoom not found');
    }

    if (auth && room.hook_id) {
      const allowed = await getAllowedHookIds(auth, this.hookModel);
      if (isHookOutOfScope(allowed, room.hook_id)) {
        throw new ForbiddenException('insufficient OA access');
      }
    }

    const hook = room.hook_id
      ? await this.hookModel
          .findById(room.hook_id)
          .select('translate_lang auto_translate')
          .lean()
      : null;

    return {
      success: true,
      data: { _id: room._id, ...resolveRoomTranslateSettings(room, hook) },
    };
  }

  /**
   * [FEAT-20260918-ROOMTRANS] Update room translation settings (translate_lang, show_original_text, auto_translate).
   */
  public async updateRoomTranslateSettings(
    id: string,
    dto: UpdateRoomTranslateSettingsDto,
    auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid ChatRoom ID');
    }

    const room = await this.chatRoomModel.findById(id);
    if (!room) {
      throw new NotFoundException('ChatRoom not found');
    }

    if (auth && room.hook_id) {
      const allowed = await getAllowedHookIds(auth, this.hookModel);
      if (isHookOutOfScope(allowed, room.hook_id)) {
        throw new ForbiddenException('insufficient OA access');
      }
    }

    if (dto.translate_lang !== undefined) {
      const raw = dto.translate_lang;
      if (raw === null || raw === '' || raw === undefined) {
        room.translate_lang = null;
      } else {
        const str = String(raw).trim();
        if (!str) {
          room.translate_lang = null;
        } else if (!isTranslateLanguage(str)) {
          throw new BadRequestException(
            `Unsupported translate language '${str}'`,
          );
        } else {
          room.translate_lang = str;
        }
      }
    }

    if (dto.show_original_text !== undefined) {
      room.show_original_text = Boolean(dto.show_original_text);
    }

    /* [FEAT-20260919-SHOWORIGSRC] The two above/below are independent on purpose:
       the dashboard may switch a room to `'room'` without touching the boolean
       (it keeps whatever it held), or flip the boolean while the room is still
       following the account-wide value — in which case nothing on screen changes
       until the source is switched too. Coupling them here would mean a screen
       could no longer express "prepare the room's own value, then adopt it".
       สองค่านี้แยกกัน ตั้งอันไหนก่อนก็ได้ */
    if (dto.show_original_text_source !== undefined) {
      room.show_original_text_source = dto.show_original_text_source;
    }

    if (dto.auto_translate !== undefined) {
      room.auto_translate =
        dto.auto_translate === null ? null : Boolean(dto.auto_translate);
    }

    if (dto.auto_send_translated !== undefined) {
      room.auto_send_translated = Boolean(dto.auto_send_translated);
    }

    await room.save();

    const hook = room.hook_id
      ? await this.hookModel
          .findById(room.hook_id)
          .select('translate_lang auto_translate')
          .lean()
      : null;

    return {
      success: true,
      message: 'Chat room translation settings updated successfully',
      /* [FIX-20260918-LANGSPLIT] the SAME resolver the GET and the chat-open
         payload use, so a PATCH can never answer with a shape the next read
         disagrees with — they were three hand-written copies until now. */
      data: { _id: room._id, ...resolveRoomTranslateSettings(room, hook) },
    };
  }

  public async listContacts(
    dto: ListContactsDto,
    auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    const { group_id, hook_id, q, tag, follow, status = 'active' } = dto;
    const page = Math.max(Number(dto.page) || 1, 1);
    const limit = Math.min(Math.max(Number(dto.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const allowed = await getAllowedHookIds(auth, this.hookModel);
    let scopeIds: string[] | null = null;

    if (group_id) {
      if (!isValidObjectId(group_id)) {
        throw new BadRequestException('Invalid group id');
      }
      const hooks = await this.hookModel
        .find({ group: group_id })
        .select('_id')
        .lean();
      scopeIds = hooks.map((h) => String(h._id));
    }

    if (hook_id && hook_id !== 'all') {
      if (!isValidObjectId(hook_id)) {
        throw new BadRequestException('Invalid hook id');
      }
      if (scopeIds && !scopeIds.includes(String(hook_id))) {
        throw new ForbiddenException('insufficient OA access');
      }
      scopeIds = [String(hook_id)];
    }

    if (allowed !== null) {
      scopeIds =
        scopeIds === null
          ? allowed
          : scopeIds.filter((id) => allowed.includes(id));
      if (scopeIds.length === 0) {
        return {
          success: true,
          data: [],
          /* [FEAT-20260907-PROVCONDS] optional §6 switch, stamped at EVERY
             envelope exit of listContacts (§6.4 — a flag read at some exits
             flickers). Absent (shop-api) ⇒ key drops from JSON, screen unchanged. */
          show_follow_ups: this.customerProvider?.resolve().showFollowUps,
          show_register_action:
            this.customerProvider?.resolve().showRegisterAction,
          show_walletpay_card:
            this.customerProvider?.resolve().showWalletpayCard,
          meta: { total: 0, page: 1, limit, pages: 0, group_member_total: 0 },
        };
      }
    }

    const match: Record<string, unknown> = {};
    if (status !== 'all') match['status'] = status;
    if (scopeIds !== null) {
      const objectIds = scopeIds.map((id) => new Types.ObjectId(id));
      match['hook_id'] =
        objectIds.length === 1 ? objectIds[0] : { $in: objectIds };
    }

    if (tag && String(tag).trim()) {
      const tagId = String(tag).trim();
      if (!isValidObjectId(tagId)) {
        return {
          success: true,
          data: [],
          /* [FEAT-20260907-PROVCONDS] optional §6 switch, stamped at EVERY
             envelope exit of listContacts (§6.4 — a flag read at some exits
             flickers). Absent (shop-api) ⇒ key drops from JSON, screen unchanged. */
          show_follow_ups: this.customerProvider?.resolve().showFollowUps,
          show_register_action:
            this.customerProvider?.resolve().showRegisterAction,
          show_walletpay_card:
            this.customerProvider?.resolve().showWalletpayCard,
          meta: { total: 0, page, limit, pages: 0, group_member_total: 0 },
        };
      }
      const memberIds = await this.customerTagModel
        .find({ tag_id: tagId })
        .select('member_id')
        .lean()
        .then((rows) => rows.map((r) => r.member_id).filter(Boolean));

      if (memberIds.length === 0) {
        return {
          success: true,
          data: [],
          /* [FEAT-20260907-PROVCONDS] optional §6 switch, stamped at EVERY
             envelope exit of listContacts (§6.4 — a flag read at some exits
             flickers). Absent (shop-api) ⇒ key drops from JSON, screen unchanged. */
          show_follow_ups: this.customerProvider?.resolve().showFollowUps,
          show_register_action:
            this.customerProvider?.resolve().showRegisterAction,
          show_walletpay_card:
            this.customerProvider?.resolve().showWalletpayCard,
          meta: { total: 0, page, limit, pages: 0, group_member_total: 0 },
        };
      }
      match['user_id'] = { $in: memberIds };
    }

    /* [FEAT-20260823-CONTACTFOLLOW] Filter by the follow-up stamps a member holds.
     *
     * SHAPE — the same one `tag` above uses: resolve member ids FIRST, then match
     * `chat_rooms.user_id` BEFORE the $lookup. Matching `member.config…` after
     * the join would work but could use no index on either side and would filter
     * after every room had already been joined. Both fields here are indexed:
     * `members.config.follow_up.line.notice_*_at` (partial, `$exists:true` — the
     * exact predicate below) and `chat_rooms.user_id_1`.
     * ทำตามแพตเทิร์นเดิมของ tag · resolve ก่อน แล้วค่อยกรองห้อง
     *
     * COMPOSES WITH `tag` — `tag` may already have set `user_id.$in`. The two
     * positive cases INTERSECT rather than overwrite (overwriting would silently
     * widen a tag filter), and `none` adds `$nin` alongside, which Mongo takes on
     * the same field. ห้ามเขียนทับของ tag เดี๋ยวตัวกรองกว้างขึ้นเงียบ ๆ
     *
     * `none` is expressed as `$nin` of the STAMPED ids, never as `$in` of the
     * unstamped ones: the stamped set is the small one, and the unstamped set is
     * "almost every member".
     *
     * An unrecognised value (or none at all) leaves `match` byte-identical.
     * revert: delete this block and the `follow` field on ListContactsDto.
     */
    const followMode = String(follow ?? '').trim();
    if (['deposit', 'withdraw', 'both', 'none'].includes(followMode)) {
      /* through the ONE door — `memberConfigPath` builds `config.<key>` in the
         single place allowed to know the storage prefix, and the two key names
         come from the notice runtime that writes the stamps. The registry's
         consumers list names this read; the member-config guard greps for it. */
      const DEP = memberConfigPath(NOTICE_DEPOSIT_AT_KEY);
      const WIT = memberConfigPath(NOTICE_WITHDRAW_AT_KEY);
      const has = { $exists: true, $ne: null } as const;
      const filter: Record<string, unknown> =
        followMode === 'deposit'
          ? { [DEP]: has }
          : followMode === 'withdraw'
            ? { [WIT]: has }
            : followMode === 'both'
              ? { [DEP]: has, [WIT]: has }
              : /* none */ { $or: [{ [DEP]: has }, { [WIT]: has }] };

      const stamped = await this.memberModel
        .find(filter)
        .select('_id')
        .lean()
        .then((rows) => rows.map((r) => r._id));

      if (followMode === 'none') {
        const prev = (match['user_id'] as Record<string, unknown>) || {};
        match['user_id'] = { ...prev, $nin: stamped };
      } else {
        const prev = match['user_id'] as { $in?: unknown[] } | undefined;
        const prevIn = prev?.$in;
        /* intersect with whatever `tag` already narrowed to */
        const ids = prevIn
          ? stamped.filter((id) =>
              prevIn.some((other) => String(other) === String(id)),
            )
          : stamped;
        /* ⭐ ONE guard, not two. A draft checked `stamped.length === 0` here as
           well; a mutation run left every case green with that check deleted,
           because `[].filter(…)` is `[]` — whenever `stamped` is empty `ids` is
           empty too, so this line always fires first. The extra check could not
           change an answer, so it is gone.
           เช็คที่ไม่มีทางเป็นคนตัดสิน = หนี้ ไม่ใช่ความปลอดภัย */
        if (ids.length === 0) {
          return {
            success: true,
            data: [],
            /* [FEAT-20260907-PROVCONDS] optional §6 switch, stamped at EVERY
             envelope exit of listContacts (§6.4 — a flag read at some exits
             flickers). Absent (shop-api) ⇒ key drops from JSON, screen unchanged. */
            show_follow_ups: this.customerProvider?.resolve().showFollowUps,
            show_register_action:
              this.customerProvider?.resolve().showRegisterAction,
            show_walletpay_card:
              this.customerProvider?.resolve().showWalletpayCard,
            meta: { total: 0, page, limit, pages: 0, group_member_total: 0 },
          };
        }
        match['user_id'] = { ...(prev ?? {}), $in: ids };
      }
    }

    const groupMemberTotal = await this.chatRoomModel.countDocuments(match);

    const pipeline: mongoose.PipelineStage[] = [
      { $match: match },
      {
        $lookup: {
          from: this.memberModel.collection.name,
          localField: 'user_id',
          foreignField: '_id',
          as: 'member',
        },
      },
      { $unwind: { path: '$member', preserveNullAndEmptyArrays: true } },
    ];

    const keyword = (q || '').trim();
    if (keyword) {
      const rx = new RegExp(escapeRegex(keyword), 'i');
      pipeline.push({
        $match: {
          $or: [
            { 'member.phone_number': rx },
            { 'member.full_name': rx },
            { 'member.display_name': rx },
            { 'member.nickname': rx },
            { 'member.line_user_id': rx },
            { line_user_id: rx },
          ],
        },
      });
    }

    pipeline.push({
      $facet: {
        rows: [
          { $sort: { 'last_message.timestamp': -1, _id: -1 } },
          { $skip: skip },
          { $limit: limit },
        ],
        counted: [{ $count: 'total' }],
      },
    });

    const [facet] = await this.chatRoomModel
      .aggregate(pipeline)
      .allowDiskUse(true);
    const rows = (facet?.rows || []) as Record<string, unknown>[];
    const total = (facet?.counted?.[0]?.total || 0) as number;

    const data = rows.map((room) => {
      const { member, assist_status, ...rest } = room;
      delete (rest as Record<string, unknown>)['user_id'];
      const memberObj = member as Record<string, unknown> | null;
      if (memberObj && memberObj['meta'] !== undefined)
        delete memberObj['meta'];
      return {
        ...rest,
        assist_status: Boolean(assist_status),
        user_data: memberObj || null,
      };
    });

    return {
      success: true,
      data,
      /* [FEAT-20260907-PROVCONDS] same optional §6 switch on the MAIN exit. */
      show_follow_ups: this.customerProvider?.resolve().showFollowUps,
      show_register_action: this.customerProvider?.resolve().showRegisterAction,
      show_walletpay_card: this.customerProvider?.resolve().showWalletpayCard,
      meta: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
        group_member_total: groupMemberTotal,
      },
    };
  }

  public async listRoomNotes(
    roomId: string,
    queryDto: ListRoomNotesQueryDto,
    auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    if (!isValidObjectId(roomId)) {
      throw new NotFoundException('Chat room not found');
    }
    const room = await this.chatRoomModel
      .findById(roomId)
      .select('_id user_id hook_id')
      .lean();
    if (!room) {
      throw new NotFoundException('Chat room not found');
    }
    /* [FIX-20260818-ROOMSCOPE · plan §8 = T3-3] `hook_id` was already fetched on
       the line above and then discarded. Two lines, no extra query. */
    const allowed = await getAllowedHookIds(auth, this.hookModel);
    if (isHookOutOfScope(allowed, room.hook_id)) {
      throw new ForbiddenException('insufficient OA access');
    }
    if (!room.user_id) {
      return {
        success: true,
        data: [],
        pagination: { total: 0, page: 1, limit: 0, pages: 0 },
      };
    }

    const filter = { member_id: room.user_id };
    const total = await this.chatRoomNoteModel.countDocuments(filter);

    let query = this.chatRoomNoteModel
      .find(filter)
      .populate('created_by', 'username display_name')
      .populate('updated_by', 'username display_name')
      .sort({ created_at: -1 });

    const limitStr = queryDto.limit;
    const pageStr = queryDto.page;
    const useAll = limitStr === 'all';

    if (!useAll) {
      const p = Math.max(1, parseInt(pageStr || '1', 10) || 1);
      const l = Math.max(1, parseInt(limitStr || '50', 10) || 50);
      query = query.skip((p - 1) * l).limit(l);
    }

    const notes = await query.lean();

    const formattedNotes = notes.map((note) => {
      const { created_by, updated_by, ...rest } = note;
      const cb = created_by as unknown as { _id?: unknown } | null;
      const ub = updated_by as unknown as { _id?: unknown } | null;
      return {
        ...rest,
        created_by: cb?._id || created_by || null,
        created_by_data:
          created_by && typeof created_by === 'object' ? created_by : null,
        updated_by: ub?._id || updated_by || null,
        updated_by_data:
          updated_by && typeof updated_by === 'object' ? updated_by : null,
      };
    });

    return {
      success: true,
      data: formattedNotes,
      pagination: {
        total,
        page: useAll ? 1 : Math.max(1, parseInt(pageStr || '1', 10) || 1),
        limit: useAll
          ? total
          : Math.max(1, parseInt(limitStr || '50', 10) || 50),
        pages: useAll
          ? 1
          : Math.ceil(total / (parseInt(limitStr || '50', 10) || 50)),
      },
    };
  }

  public async createRoomNote(
    roomId: string,
    dto: CreateRoomNoteDto,
    auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    const content = (dto.content || '').trim();
    if (!content) {
      throw new BadRequestException('Note content is required');
    }
    if (!isValidObjectId(roomId)) {
      throw new NotFoundException('Chat room not found');
    }
    const room = await this.chatRoomModel
      .findById(roomId)
      .select('_id user_id hook_id')
      .lean();
    if (!room) {
      throw new NotFoundException('Chat room not found');
    }
    /* [FIX-20260818-ROOMSCOPE · plan §8 = T3-3] `hook_id` was already fetched on
       the line above and then discarded. Two lines, no extra query. */
    const allowed = await getAllowedHookIds(auth, this.hookModel);
    if (isHookOutOfScope(allowed, room.hook_id)) {
      throw new ForbiddenException('insufficient OA access');
    }
    if (!room.user_id) {
      throw new BadRequestException('Room has no customer');
    }

    const note = await this.chatRoomNoteModel.create({
      member_id: room.user_id,
      chat_room_id: room._id,
      hook_id: room.hook_id || null,
      content,
      created_by: auth?.userId ? new Types.ObjectId(auth.userId) : null,
      created_by_name: auth?.displayName || auth?.username || null,
    });

    await note.populate('created_by', 'username display_name');

    if (room.hook_id) {
      await this.realtimePublisher.publish('customer:notes_updated', {
        hook_id: String(room.hook_id),
        member_id: String(room.user_id),
        room_id: String(room._id),
        action: 'added',
        actor_name: auth?.displayName || auth?.username || null,
      });
    }

    const doc = note.toObject();
    const { created_by, updated_by, ...rest } = doc;
    const cb = created_by as unknown as { _id?: unknown } | null;
    const ub = updated_by as unknown as { _id?: unknown } | null;
    return {
      success: true,
      data: {
        ...rest,
        created_by: cb?._id || created_by || null,
        created_by_data:
          created_by && typeof created_by === 'object' ? created_by : null,
        updated_by: ub?._id || updated_by || null,
        updated_by_data:
          updated_by && typeof updated_by === 'object' ? updated_by : null,
      },
    };
  }

  public async updateNoteContent(
    noteId: string,
    dto: UpdateNoteContentDto,
    auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    if (!isValidObjectId(noteId)) {
      throw new BadRequestException('Invalid note id');
    }
    const content = (dto.content || '').trim();
    if (!content) {
      throw new BadRequestException('Note content is required');
    }

    const note = await this.chatRoomNoteModel
      .findByIdAndUpdate(
        noteId,
        {
          content,
          updated_by: auth?.userId ? new Types.ObjectId(auth.userId) : null,
          updated_by_name: auth?.displayName || auth?.username || null,
        },
        { new: true },
      )
      .populate('created_by', 'username display_name')
      .populate('updated_by', 'username display_name');

    if (!note) {
      throw new NotFoundException('Note not found');
    }

    if (note.hook_id) {
      await this.realtimePublisher.publish('customer:notes_updated', {
        hook_id: String(note.hook_id),
        member_id: String(note.member_id),
        room_id: note.chat_room_id ? String(note.chat_room_id) : '',
        action: 'edited',
        actor_name: auth?.displayName || auth?.username || null,
      });
    }

    const doc = note.toObject();
    const { created_by, updated_by, ...rest } = doc;
    const cb = created_by as unknown as { _id?: unknown } | null;
    const ub = updated_by as unknown as { _id?: unknown } | null;
    return {
      success: true,
      data: {
        ...rest,
        created_by: cb?._id || created_by || null,
        created_by_data:
          created_by && typeof created_by === 'object' ? created_by : null,
        updated_by: ub?._id || updated_by || null,
        updated_by_data:
          updated_by && typeof updated_by === 'object' ? updated_by : null,
      },
    };
  }

  public async deleteRoomNote(
    noteId: string,
    auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    if (!isValidObjectId(noteId)) {
      throw new BadRequestException('Invalid note id');
    }

    const note = await this.chatRoomNoteModel.findById(noteId);
    if (!note) {
      throw new NotFoundException('Note not found');
    }

    if (note.deleted_at) {
      const doc = note.toObject();
      const { created_by, updated_by, ...rest } = doc;
      const cb = created_by as unknown as { _id?: unknown } | null;
      const ub = updated_by as unknown as { _id?: unknown } | null;
      return {
        success: true,
        data: {
          ...rest,
          created_by: cb?._id || created_by || null,
          created_by_data:
            created_by && typeof created_by === 'object' ? created_by : null,
          updated_by: ub?._id || updated_by || null,
          updated_by_data:
            updated_by && typeof updated_by === 'object' ? updated_by : null,
        },
      };
    }

    const actorId = auth?.userId ? String(auth.userId) : null;
    const ownerId = note.created_by ? String(note.created_by) : null;
    const isSuper = (auth?.roleName || '').toLowerCase() === 'superadmin';

    if (!isSuper && (!actorId || actorId !== ownerId)) {
      throw new ForbiddenException('ลบได้เฉพาะโน๊ตของตนเอง');
    }

    const actorName = auth?.displayName || auth?.username || 'แอดมิน';
    const when = new Date();
    const stamp = when.toLocaleString('th-TH-u-ca-gregory', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    note.content = `🗑 ลบโดย ${actorName} • ${stamp}`;
    note.deleted_at = when;
    note.deleted_by = auth?.userId ? new Types.ObjectId(auth.userId) : null;
    note.deleted_by_name = actorName;

    await note.save();
    await note.populate('created_by', 'username display_name');

    if (note.hook_id) {
      await this.realtimePublisher.publish('customer:notes_updated', {
        hook_id: String(note.hook_id),
        member_id: String(note.member_id),
        room_id: note.chat_room_id ? String(note.chat_room_id) : '',
        action: 'deleted',
        actor_name: actorName,
      });
    }

    const doc = note.toObject();
    const { created_by, updated_by, ...rest } = doc;
    const cb = created_by as unknown as { _id?: unknown } | null;
    const ub = updated_by as unknown as { _id?: unknown } | null;
    return {
      success: true,
      data: {
        ...rest,
        created_by: cb?._id || created_by || null,
        created_by_data:
          created_by && typeof created_by === 'object' ? created_by : null,
        updated_by: ub?._id || updated_by || null,
        updated_by_data:
          updated_by && typeof updated_by === 'object' ? updated_by : null,
      },
    };
  }

  public async listCustomerTags(
    roomId: string,
    auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    if (!isValidObjectId(roomId)) {
      throw new NotFoundException('Chat room not found');
    }
    const room = await this.chatRoomModel
      .findById(roomId)
      .select('_id user_id hook_id')
      .lean();
    if (!room) {
      throw new NotFoundException('Chat room not found');
    }
    /* [FIX-20260818-ROOMSCOPE · plan §8 = T3-3] `hook_id` was already fetched on
       the line above and then discarded. Two lines, no extra query. */
    const allowed = await getAllowedHookIds(auth, this.hookModel);
    if (isHookOutOfScope(allowed, room.hook_id)) {
      throw new ForbiddenException('insufficient OA access');
    }
    if (!room.user_id) {
      return { success: true, data: [] };
    }

    const tags = await this.customerTagModel
      .find({ member_id: room.user_id })
      .populate('tag_id', 'label color group_ids')
      .populate('created_by', 'username display_name')
      .sort({ created_at: -1 })
      .lean();

    const formattedTags = tags.map((tag) => {
      const { created_by, tag_id, ...rest } = tag;
      const t =
        tag_id && typeof tag_id === 'object'
          ? (tag_id as unknown as Record<string, unknown>)
          : null;
      const cb =
        created_by && typeof created_by === 'object'
          ? (created_by as { _id?: unknown })
          : null;
      return {
        ...rest,
        tag_id: t?._id || tag_id || null,
        label: t?.['label'] ?? null,
        color: t?.['color'] ?? null,
        group_ids: t?.['group_ids'] || [],
        created_by: cb?._id || created_by || null,
        created_by_data:
          created_by && typeof created_by === 'object' ? created_by : null,
      };
    });

    return { success: true, data: formattedTags };
  }

  public async createCustomerTag(
    roomId: string,
    dto: CreateCustomerTagDto,
    auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    const label = (dto.label || '').trim();
    if (!label) {
      throw new BadRequestException('Tag label is required');
    }
    if (!isValidObjectId(roomId)) {
      throw new NotFoundException('Chat room not found');
    }

    const room = await this.chatRoomModel
      .findById(roomId)
      .select('_id user_id hook_id')
      .lean();
    if (!room) {
      throw new NotFoundException('Chat room not found');
    }
    /* [FIX-20260818-ROOMSCOPE · plan §8 = T3-3] `hook_id` was already fetched on
       the line above and then discarded. Two lines, no extra query. */
    const allowed = await getAllowedHookIds(auth, this.hookModel);
    if (isHookOutOfScope(allowed, room.hook_id)) {
      throw new ForbiddenException('insufficient OA access');
    }
    if (!room.user_id) {
      throw new BadRequestException('Room has no customer');
    }

    const key = label.toLowerCase();
    let tagDef = await this.tagModel.findOne({ key });
    if (!tagDef) {
      tagDef = await this.tagModel.create({
        label,
        key,
        color: dto.color || null,
        created_by: auth?.userId ? new Types.ObjectId(auth.userId) : null,
        created_by_name: auth?.displayName || auth?.username || null,
      });
    }

    try {
      const tag = await this.customerTagModel.create({
        member_id: room.user_id,
        chat_room_id: room._id,
        hook_id: room.hook_id || null,
        tag_id: tagDef._id,
        created_by: auth?.userId ? new Types.ObjectId(auth.userId) : null,
        created_by_name: auth?.displayName || auth?.username || null,
      });

      await tag.populate('created_by', 'username display_name');
      await tag.populate('tag_id', 'label color group_ids');

      await this.tagModel.updateOne(
        { _id: tagDef._id },
        { $inc: { use_count: 1 }, $set: { last_used_at: new Date() } },
      );

      if (room.hook_id) {
        await this.realtimePublisher.publish('customer:tags_updated', {
          hook_id: String(room.hook_id),
          member_id: String(room.user_id),
          room_id: String(room._id),
          action: 'added',
          actor_name: auth?.displayName || auth?.username || null,
        });
      }

      const doc = tag.toObject();
      const { created_by, tag_id, ...rest } = doc;
      const t =
        tag_id && typeof tag_id === 'object'
          ? (tag_id as unknown as Record<string, unknown>)
          : null;
      const cb =
        created_by && typeof created_by === 'object'
          ? (created_by as { _id?: unknown })
          : null;
      return {
        success: true,
        data: {
          ...rest,
          tag_id: t?._id || tag_id || null,
          label: t?.['label'] ?? null,
          color: t?.['color'] ?? null,
          group_ids: t?.['group_ids'] || [],
          created_by: cb?._id || created_by || null,
          created_by_data:
            created_by && typeof created_by === 'object' ? created_by : null,
        },
      };
    } catch (err) {
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code: number }).code === 11000
      ) {
        const existing = await this.customerTagModel
          .findOne({ member_id: room.user_id, tag_id: tagDef._id })
          .populate('created_by', 'username display_name')
          .populate('tag_id', 'label color group_ids');

        if (existing) {
          const doc = existing.toObject();
          const { created_by, tag_id, ...rest } = doc;
          const t =
            tag_id && typeof tag_id === 'object'
              ? (tag_id as unknown as Record<string, unknown>)
              : null;
          const cb =
            created_by && typeof created_by === 'object'
              ? (created_by as { _id?: unknown })
              : null;
          return {
            success: true,
            data: {
              ...rest,
              tag_id: t?._id || tag_id || null,
              label: t?.['label'] ?? null,
              color: t?.['color'] ?? null,
              group_ids: t?.['group_ids'] || [],
              created_by: cb?._id || created_by || null,
              created_by_data:
                created_by && typeof created_by === 'object'
                  ? created_by
                  : null,
            },
          };
        }
      }
      throw err;
    }
  }

  public async listPopularTags(
    dto: ListPopularTagsDto,
    auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    const limit = Math.min(
      Math.max(parseInt(dto.limit || '10', 10) || 10, 1),
      50,
    );
    /* [FIX-20260814-TAGINUSEONLY] Owner order 2026-08-14: every option in the
       tag picker must be one that is actually in use — a label nobody is tagged
       with filters to an empty list, so offering it is offering a dead end.

       ⚠️ WHY NOT `use_count`: the field is only ever incremented (`:1570`,
          `$inc: 1`) and nothing decrements it when a tag is removed from a
          customer. A tag whose last assignment was deleted therefore keeps a
          positive count forever, so trusting it would show exactly the ghosts
          this change removes. Counting the real rows is the only honest source.
          use_count มีแต่ +1 ไม่เคยลด ⇒ เชื่อไม่ได้ ต้องนับของจริง

       ⚠️ SCOPE: the query, the sort and the response shape are unchanged — this
          adds one `_id` filter and nothing else. Selecting a tag still filters
          exactly as before, and a tag already chosen by an operator keeps
          working even if it later becomes unused (this narrows the OPTIONS, not
          the filter). กรองแค่รายการที่ให้เลือก ตรรกะกรองไม่ถูกแตะ

       `distinct` runs against the same collection the picker's result set comes
       from, so an id present here always has at least one customer behind it.
       revert: delete `inUseIds` and the `_id: { $in: inUseIds }` clause. */

    /* [FEAT-20260816-TAGSCOPE] The options now follow the caller's OA
       permission — superadmin sees every in-use tag, other admins only tags in
       use on their own OAs. Until 2026-08-16 this endpoint was GLOBAL; the FE
       comment of 01/08 claiming the BE already filtered by the caller's group
       was never true. Now it is.

       HOW: `getAllowedHookIds` (this file's copy, :113 — queries `hook.group`,
       the field real rows carry) resolves the caller's OA list exactly like the
       room list at :190 does. null = superadmin = the untouched global call.
       Otherwise the in-use count only sees `customer_tags` rows whose `hook_id`
       is one of the caller's OAs, so every option offered filters to a
       non-empty result INSIDE that admin's own view.

       ⚠️ `customer_tags.hook_id` is provenance and defaults to null (schema
          :47-53). A null-provenance row is counted for superadmin only — in
          this DB every row carries a hook_id (verified 16/08: 3/3), so nothing
          is hidden today; if such rows ever appear they drop out of scoped
          admins' OPTIONS only, never out of the applied chips on tickets (the
          ticket-list join is deliberately unscoped and untouched).
       ⚠️ Fail-closed: no auth / no groups ⇒ `$in: []` ⇒ no options — never
          fall back to global.
       revert: drop the `auth` param here and in the controller, and always
       call `distinct('tag_id')`. */
    const allowedHookIds = await getAllowedHookIds(auth, this.hookModel);
    const inUseIds =
      allowedHookIds === null
        ? await this.customerTagModel.distinct('tag_id')
        : await this.customerTagModel.distinct('tag_id', {
            hook_id: { $in: allowedHookIds },
          });

    const rows = await this.tagModel
      .find({ _id: { $in: inUseIds } })
      .sort({ use_count: -1, last_used_at: -1 })
      .limit(limit)
      .lean();

    return {
      success: true,
      data: rows.map((r) => ({
        _id: r._id,
        label: r.label,
        color: r.color || null,
        use_count: r.use_count || 0,
      })),
    };
  }

  public async suggestTags(
    dto: SuggestTagsDto,
  ): Promise<Record<string, unknown>> {
    const q = String(dto.q || '')
      .trim()
      .toLowerCase();
    if (!q) return { success: true, data: [] };

    const rows = await this.tagModel
      .find({ key: { $regex: escapeRegex(q) } })
      .sort({ use_count: -1, last_used_at: -1 })
      .limit(10)
      .lean();

    return {
      success: true,
      data: rows.map((r) => ({
        _id: r._id,
        label: r.label,
        color: r.color || null,
        use_count: r.use_count || 0,
      })),
    };
  }

  public async deleteCustomerTag(
    tagId: string,
    auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    if (!isValidObjectId(tagId)) {
      throw new BadRequestException('Invalid tag id');
    }
    const tag = await this.customerTagModel.findByIdAndDelete(tagId);
    if (!tag) {
      throw new NotFoundException('Tag not found');
    }

    if (tag.hook_id) {
      await this.realtimePublisher.publish('customer:tags_updated', {
        hook_id: String(tag.hook_id),
        member_id: String(tag.member_id),
        room_id: tag.chat_room_id ? String(tag.chat_room_id) : '',
        action: 'removed',
        actor_name: auth?.displayName || auth?.username || null,
      });
    }

    return { success: true, data: { _id: tagId } };
  }
}
