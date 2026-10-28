/**
 * PORTED — legacy-api/src/services/core-bot/chatHistoryService.js
 *
 * The write side of the chat screens: every inbound customer message and every
 * outbound bot/admin message lands in `chat_messages` through here, and the room
 * preview the chat list is ordered by is maintained here too. Nothing else in
 * the system writes those two collections on the ingest path, so a difference
 * here is a difference the dashboard shows.
 *
 * The port is call-for-call identical to the legacy service at the
 * service→model boundary. That is deliberate and is what
 * `z-test/unit/chat-history-parity.spec.ts` checks: it drives the legacy
 * JavaScript and this class through the same fake models and diffs the calls.
 * ONE deliberate divergence exists: the empty-hint member placeholder seeds
 * ids only instead of legacy's 'Unknown' stamps — see
 * [FIX-20260814-EAGERPROFILE] in `getOrCreateRoom` for why.
 *
 * Not wired into the webhook pipeline yet — that is a later stage.
 */

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

/* [FEAT-20260918-AUTOTRANS] the interface only — never the implementation, so
   this file cannot reach the vendor stack even by accident. */
import {
  AUTO_TRANSLATE_INBOUND,
  type AutoTranslateInboundPort,
} from './translate/auto/auto-translate.port';

/* [FEAT-20260820-BOTCAREQUIET] the tab rule, so the chime can stay quiet. */
import { BOT_CARE_EVENT_KEY, isBotCareRow } from './bot-care-flag';
import { RealtimePublisherService } from '@/infra/realtime/realtime-publisher.service';
import { Hook, type HookDocument } from '@/modules/hooks';

import {
  ChatMessage,
  ChatRoom,
  Member,
  type ChatMessageDocument,
  type ChatRoomDocument,
  type MemberDocument,
} from './schemas';

/** Anything that can stand in for an id at a call site: legacy passes strings,
 * cached hook objects carry ObjectIds. Both reach the same query. */
export type IdLike = string | Types.ObjectId | null | undefined;

/** The subset of a platform profile this service reads. Extra keys are ignored,
 * exactly as they are in legacy. */
export interface ChatProfileHint {
  displayName?: string | null;
  pictureUrl?: string | null;
  nickname?: string | null;
}

export interface LogMessageInput {
  userId?: string | null;
  senderType: string;
  /** [FEAT-20260729-ADMINSENDER] who sent it, when an admin did. Optional: the
   * webhook callers do not pass either and behave exactly as before. */
  senderId?: IdLike;
  senderName?: string | null;
  messageType?: string | null;
  content: unknown;
  hookId?: IdLike;
  channelId?: string | null;
  aiKey?: string | null;
  providerMsgId?: string | null;
  replyToken?: string | null;
  /** [FEAT-20260821-QUOTEREPLY] LINE's quote handle FOR this message
   * (`event.message.quoteToken` inbound · `sentMessages[0].quoteToken` outbound).
   * Optional: every existing caller omits it and its row is unchanged. */
  quoteToken?: string | null;
  /** [FEAT-20260821-QUOTEREPLY] the provider id of the message THIS one quotes
   * (`event.message.quotedMessageId` inbound · the quoted row's `provider_msg_id`
   * outbound). Resolves against `provider_msg_id` in the same room. */
  quotedProviderMsgId?: string | null;
  profile?: ChatProfileHint | null;
  metadata?: Record<string, unknown> | null;
  rawContent?: unknown;
  internalContentId?: IdLike;
  /** Set by a caller that already holds the hook, to skip the lookup. */
  channelType?: string | null;
}

export interface LogSystemMessageInput {
  /** The customer's `line_user_id` / `channel_user_id`. */
  lineUserId?: string | null;
  /** The customer's Member `_id`. Tickets hold this instead of the string. */
  memberId?: IdLike;
  hookId: IdLike;
  messageType: string;
  content: unknown;
  metadata?: Record<string, unknown> | null;
}

/** Mongo signals a unique-index collision with code 11000, on both the driver's
 * `MongoServerError` and Mongoose's wrapper. */
function isDuplicateKeyError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    (error as { code?: unknown }).code === 11000
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

@Injectable()
export class ChatHistoryService {
  private readonly logger = new Logger(ChatHistoryService.name);

  constructor(
    @InjectModel(ChatRoom.name)
    private readonly chatRoomModel: Model<ChatRoomDocument>,
    @InjectModel(ChatMessage.name)
    private readonly chatMessageModel: Model<ChatMessageDocument>,
    @InjectModel(Member.name)
    private readonly memberModel: Model<MemberDocument>,
    @InjectModel(Hook.name)
    private readonly hookModel: Model<HookDocument>,
    private readonly realtimePublisher: RealtimePublisherService,
    /* [FEAT-20260918-AUTOTRANS] the plug, and it is allowed to be missing.
       `@Optional()` is load-bearing three times over: an installation that does
       not want automatic translation simply does not provide it; the parity spec
       keeps constructing this service with five arguments and keeps diffing
       clean; and the chat module never gains a hard edge to the vendor stack.
       See `translate/auto/auto-translate.port.ts` for the contract.
       revert: delete this argument and the call site in `logMessage`. */
    @Optional()
    @Inject(AUTO_TRANSLATE_INBOUND)
    private readonly autoTranslate?: AutoTranslateInboundPort,
  ) {}

  /**
   * Denormalise the REAL parent hook's `channel_type` onto room/message docs at
   * write time — `Hook.channel_type` is the single source of truth. Resolved
   * once per `logMessage()` call and reused for both the room and the message,
   * so a facebook (or any future non-line) hook's chat data is never mislabeled
   * "line".
   */
  private async resolveChannelType(hookId: IdLike): Promise<string> {
    if (!hookId) return 'line';
    try {
      const hook = await this.hookModel
        .findById(hookId)
        .select('channel_type')
        .lean<{ channel_type?: string } | null>();
      return hook?.channel_type || 'line';
    } catch {
      return 'line';
    }
  }

  /**
   * Find a room by user, linked to its Member. One room per user per hook.
   */
  public async getOrCreateRoom(
    userId: string,
    profile: ChatProfileHint = {},
    channelId: string | null = null,
    hookId: IdLike = null,
    channelType = 'line',
  ): Promise<ChatRoomDocument> {
    try {
      // 1. Ensure the Member exists (atomic find-or-create placeholder).
      let lineUser: MemberDocument | null;
      try {
        // Phase 3.1e read-cutover: read the new name first.
        lineUser = await this.memberModel.findOne({ member_user_id: userId });
        if (!lineUser) {
          // The webhook controller normally creates this; if it did not, a
          // basic placeholder keeps the message from being dropped.
          //
          // [FIX-20260814-EAGERPROFILE] With NO profile hint, seed the id ONLY
          // — never fake display_name:'Unknown' / nickname / last_synced_at.
          // Since eager room-on-event (13/08) this placeholder is written
          // BEFORE the LINE profile sync in the same request
          // (webhook.service.ts:1081 → :1332); a stamped placeholder used to
          // satisfy that sync's needsRefresh guard (truthy display_name +
          // fresh last_synced_at) so the real name/picture were never fetched
          // and nickname stayed 'Unknown' forever (:1351 seeds only a falsy
          // nickname). Empty fields = schema defaults ('' / null) keep the doc
          // truthful — "never synced" — so the guard fires and fills
          // everything in this same request. Same minimal-member shape the
          // owner approved for assist (assist-notification.ts:501-506).
          // A REAL hint (FB path, callers that already hold a profile) seeds
          // exactly as before. revert: restore the 'Unknown' + new Date()
          // fallbacks below.
          const hasHint = !!(profile.displayName || profile.nickname);
          lineUser = await this.memberModel.findOneAndUpdate(
            { line_user_id: userId },
            {
              $setOnInsert: hasHint
                ? {
                    line_user_id: userId,
                    display_name: profile.displayName || 'Unknown',
                    picture_url: profile.pictureUrl || null,
                    nickname:
                      profile.nickname || profile.displayName || 'Unknown',
                    last_synced_at: new Date(),
                  }
                : { line_user_id: userId },
            },
            { upsert: true, new: true },
          );
        }
      } catch (error) {
        this.logger.error(`Member resolution failed: ${errorMessage(error)}`);
        throw error;
      }

      // 2. Resolve the room (1 room per user per hook).
      this.logger.log(`Resolving room: user=${userId}, hook=${String(hookId)}`);
      const query = {
        line_user_id: userId,
        hook_id: hookId,
      };
      const update = {
        $set: {
          user_id: lineUser!._id,
          line_user_id: userId,
          hook_id: hookId,
          channel_id: channelId,
          channel_type: channelType,
        },
        $setOnInsert: {
          status: 'active',
          unread_count: 0,
        },
      };

      let room: ChatRoomDocument | null;
      try {
        room = await this.chatRoomModel.findOneAndUpdate(query, update, {
          upsert: true,
          new: true,
          runValidators: true,
        });
      } catch (error) {
        // Seamless recovery for a legacy room whose line_user_id was never set
        // (pre-Member-re-key rows, or a dual-write mirror): the query on
        // line_user_id misses it, so the upsert tries to INSERT — and collides
        // on the unique (user_id, hook_id) index (E11000), because dedup is
        // keyed on user_id, not the field we queried. Instead of failing the
        // whole message, re-resolve by (user_id, hook_id) and backfill
        // line_user_id so the row is whole and the next lookup hits directly.
        // Normal traffic never enters this branch (fresh/complete rooms match
        // the first query). No schema or index change.
        if (isDuplicateKeyError(error)) {
          this.logger.warn(
            `Room upsert hit E11000 (legacy row missing line_user_id); recovering by (user_id, hook_id) for user=${userId}, hook=${String(hookId)}`,
          );
          room = await this.chatRoomModel.findOneAndUpdate(
            { user_id: lineUser!._id, hook_id: hookId },
            update,
            { new: true, runValidators: true },
          );
          // Truly unexpected — surface the original error, not a null room.
          if (!room) throw error;
        } else {
          throw error;
        }
      }
      this.logger.log(`Room resolved: room._id=${String(room!._id)}`);

      return room!;
    } catch (error) {
      this.logger.error(`getOrCreateRoom failed: ${errorMessage(error)}`);
      throw error;
    }
  }

  /**
   * Persist one message and keep the room's preview in step. Called for both
   * directions — inbound customer messages and outbound bot/admin ones.
   *
   * Best-effort by design: it never throws, because the caller is the webhook
   * reply path and a history write must not fail the reply.
   */
  public async logMessage(
    input: LogMessageInput,
  ): Promise<ChatMessageDocument | null> {
    const {
      userId,
      senderType,
      senderId = null,
      senderName = null,
      messageType,
      content,
      hookId,
      channelId,
      aiKey,
      providerMsgId,
      replyToken,
      quoteToken = null,
      quotedProviderMsgId = null,
      profile = null,
      metadata = {},
      rawContent = null,
      internalContentId = null,
      channelType: channelTypeHint,
    } = input;

    try {
      if (!userId) {
        this.logger.warn('Skip logging: No userId provided');
        return null;
      }

      this.logger.log(
        `Logging message for user: ${userId} | type: ${String(messageType)} | sender: ${senderType}`,
      );

      // Perf: skip the DB round-trip when the caller already has the hook in
      // hand (the webhook controller reads it off the cache) and passes its
      // channel_type directly — this sits on the reply-token-critical path, so
      // an avoidable extra query here is not free (~46ms measured on dev_test).
      const channelType =
        channelTypeHint || (await this.resolveChannelType(hookId));

      // 1. Get or create the room (channelId/hookId group it per bot).
      const room = await this.getOrCreateRoom(
        userId,
        profile || {},
        channelId ?? null,
        hookId,
        channelType,
      );
      if (!room) {
        this.logger.error(`Abort: Could not resolve room for user ${userId}`);
        return null;
      }

      // 2. A provider id we have already stored means a redelivery, not a new
      //    message: hand back the row we have instead of writing a second one.
      /* [FEAT-20260831-QUOTESRC] …and a REDELIVERY is an inbound event, which is
         why this now asks the direction as well.
         Until this lane every caller passing a provider id was inbound — checked
         site by site, all three are `senderType: 'customer'`
         (webhook.service.ts:2557, :2762, :3222) — so on the day it shipped this
         condition was a no-op. It stops being one now that the reply paths pass
         the id LINE just returned: without the direction, every bot message
         would pay for a lookup on the reply-token-critical path, hunting a
         collision that cannot exist (LINE minted that id for this message,
         seconds ago).
         Widening it back to any direction costs a read per bot message and
         buys nothing; if a future inbound path ever writes as another
         sender_type, add that type here rather than dropping the check.
         revert: delete the `senderType === 'customer' &&` clause.
         ขาออกไม่ใช่ redelivery — ไม่ต้องหา. */
      if (senderType === 'customer' && providerMsgId) {
        const existing = await this.chatMessageModel.findOne({
          provider_msg_id: providerMsgId,
        });
        if (existing) {
          this.logger.log(
            `Skip duplicate: providerMsgId ${providerMsgId} already exists`,
          );
          return existing;
        }
      }

      // 3. Create the message.
      const message = new this.chatMessageModel({
        room_id: room._id,
        hook_id: hookId || null,
        channel_type: channelType,
        ai_key: aiKey || null,
        sender_type: senderType,
        // [FEAT-20260729-ADMINSENDER] sender_id is a real ref so the user can be
        // populated later; the name is ALSO copied into metadata because a
        // display name must survive the user being renamed or deleted — an old
        // bubble should still show who wrote it.
        sender_id: senderId || null,
        message_type: messageType || 'text',
        content: content,
        provider_msg_id: providerMsgId || null,
        reply_token: replyToken || null,
        // [FEAT-20260821-QUOTEREPLY] spread, not `|| null`: these two props have
        // no default, and a `null` here would put the key on every row — the
        // exact thing the schema comment forbids. ไม่มีค่า = ไม่มี key.
        ...(quoteToken ? { quote_token: quoteToken } : {}),
        ...(quotedProviderMsgId
          ? { quoted_provider_msg_id: quotedProviderMsgId }
          : {}),
        metadata: senderName
          ? { ...(metadata || {}), sender_name: senderName }
          : metadata || {},
        raw_content: rawContent || null,
        internal_content_id: internalContentId || null,
      });

      await message.save();
      const currentDB = this.chatMessageModel.db.name;
      this.logger.log(
        `Message saved successfully | _id: ${String(message._id)} | room: ${String(room._id)} | DB: ${String(currentDB)}`,
      );

      // 4. Update room metadata (last message; unread only when the customer
      //    is the one who spoke — a bot/admin reply must not make the room look
      //    unread to the admin who just sent it).
      const roomUpdate: Record<string, unknown> = {
        $set: {
          'last_message.text':
            typeof content === 'string' ? content : `[${String(messageType)}]`,
          'last_message.sender_type': senderType,
          'last_message.timestamp': new Date(),
        },
      };

      if (senderType === 'customer') {
        roomUpdate['$inc'] = { unread_count: 1 };
      }

      const updateResult = await this.chatRoomModel.updateOne(
        { _id: room._id },
        roomUpdate,
      );
      if (updateResult.modifiedCount > 0) {
        this.logger.log(`Room metadata updated for ${String(room._id)}`);
      }

      // 5. Realtime fan-out (additive). This ONE spot covers BOTH directions —
      // inbound customer messages and outbound admin messages all funnel
      // through logMessage. The FE uses it to append the bubble in the open
      // room and bump the chat-list preview without a refresh.
      // Fire-and-forget: publishing never blocks or fails the message write.
      // Skipped when there is no hook_id — an unscoped event would fan out to
      // every operator, so no hook means no publish.
      const eventHookId = hookId ? String(hookId) : '';
      if (eventHookId) {
        /* [FEAT-20260820-BOTCAREQUIET] "กลุ่มบอทดูแล ไม่ต้องมีเสียง". The chime lives
           app-wide in the dashboard with only this event in hand, so the answer has
           to travel with it — see `bot-care-flag.ts` for why BOTH halves of the tab
           rule are needed and why anything unknown stays loud.

           ⚠️ WHERE THE TICKET MODEL COMES FROM, and why not the obvious doors.
           `Ticket` is not registered in this module, and registering it would make
           ChatModule depend on TicketsModule for a single count. The global
           `mongoose.model('Ticket')` does NOT work either — measured, not guessed:
           it throws `Schema hasn't been registered for model "Ticket"`, because
           Nest registers every model on ITS OWN connection, not on the default
           mongoose instance. So the model is read off the connection this service
           already holds through an injected model (`Model.db`), which is the same
           connection `MongooseModule.forFeature` put `Ticket` on. No new
           constructor argument, no module edge, no global lookup.
           หยิบจาก connection ที่ model ที่ inject อยู่แล้วถืออยู่ · global registry ใช้ไม่ได้

           ⚠️ Awaited BEFORE the publish, because the key must be on the event. It
           is one indexed count on a path already inside `void`, so nothing the
           customer sees waits for it. */
        void (async () => {
          let botCare = false;
          try {
            const ticketModel = this.chatRoomModel.db.models['Ticket'];
            if (ticketModel) {
              botCare = await isBotCareRow(
                { memberId: room.user_id, assistOn: room.assist_status },
                { ticketModel: ticketModel as never },
              );
            }
          } catch {
            botCare = false; // unknown = loud
          }
          await this.realtimePublisher.publish('message:new', {
            [BOT_CARE_EVENT_KEY]: botCare,
            _id: String(message._id),
            room_id: String(room._id),
            /* [FEAT-20260819-MSGEVENTUSER] the LINE user id rides along so a consumer
               keyed by CUSTOMER can attribute this event to a row. The ticket list
               returns neither `chat_room_id` nor a top-level `hook_id` — only
               `line_user_data.line_user_id` — so `room_id` alone leaves the ticket
               cards unable to tell which card a message belongs to (that is what the
               unread badge needs). Additive: an unknown key is ignored by every
               existing consumer, and nothing already published changed.
               เพิ่มคีย์เดียว ของเดิมไม่ขยับ · revert: delete this line. */
            line_user_id: room.line_user_id ? String(room.line_user_id) : null,
            hook_id: eventHookId,
            sender_type: senderType,
            // [FEAT-20260729-ADMINSENDER] carried in the event too — another
            // admin with the room open appends the bubble from this payload
            // alone, so without the name their copy would render it as a bot
            // message.
            sender_id: senderId ? String(senderId) : null,
            sender_name: senderName || null,
            message_type: messageType || 'text',
            // A short preview only — never the full body/attachment. The FE
            // refetches the room for rich content; this is enough to append and
            // reorder the list.
            preview:
              typeof content === 'string'
                ? content.slice(0, 120)
                : `[${String(messageType)}]`,
            created_at: (message as { created_at?: Date }).created_at,
          });
        })();
      }

      /* [FEAT-20260918-AUTOTRANS] 6. Automatic translation — AFTER the bubble is
         already on its way out, and only if something is plugged in.
         ⚠️ The order is the design: the realtime publish above happens first, so
            the operator sees the message at the same instant they always did.
            A translation takes seconds; nothing on this path waits for it.
         ⚠️ `void`, exactly like the publish above — the port's contract is that
            it never throws and never blocks, and a translation that fails leaves
            the row as written (original text, no entry).
         ⚠️ NOTHING HAPPENS WHEN NOTHING IS PLUGGED IN. The dependency is
            optional, so an installation without it — and the parity spec, which
            constructs this service with five arguments — makes zero extra calls
            and behaves exactly as before this feature existed.
         ไม่ผลสุทธิบ = ไม่มีอะไรเกิดขึ้น · เสียบแล้วก็ไม่หน่วงบับเบิล
         revert: delete this block and the optional constructor argument. */
      if (this.autoTranslate && senderType === 'customer') {
        /* 🔴 THE TRY/CATCH IS NOT DECORATION — a spec fails without it.
           `void plug.onInboundMessage(...)` alone is not safe twice over: a
           REJECTED promise becomes an unhandled rejection (which this process
           treats as fatal), and a plug that throws SYNCHRONOUSLY throws right
           here, inside `logMessage`'s own try — where it would be swallowed as
           "logMessage failed critically" and the method would return `null` to
           the webhook, for a translation. The wrapper contains both.
           ปลั๊กพังยังไงก็ห้ามลามมาถึงการเก็บข้อความ */
        void (async () => {
          try {
            await this.autoTranslate!.onInboundMessage({
              messageId: String(message._id),
              roomId: String(room._id),
              hookId: eventHookId || null,
              text: typeof content === 'string' ? content : '',
              senderType,
              messageType: messageType || 'text',
            });
          } catch (err) {
            this.logger.warn(
              `auto-translate plug failed for ${String(message._id)}: ${errorMessage(err)}`,
            );
          }
        })();
      }

      return message;
    } catch (error) {
      this.logger.error('logMessage failed critically:');
      this.logger.error(`- Error Message: ${errorMessage(error)}`);
      this.logger.error(
        `- Trace: ${error instanceof Error ? String(error.stack) : ''}`,
      );
      this.logger.error(
        `- Context Payload: ${JSON.stringify({
          userId,
          senderType,
          messageType,
          providerMsgId,
        })}`,
      );
      // Deliberately not rethrown: a history write must not crash the caller.
      return null;
    }
  }

  /**
   * Insert a system message into the chat stream — an inline "divider"
   * (accept / close / assign / bot event) or an internal "inline_note" that
   * admins type for themselves. These are NORMAL chat_messages with a distinct
   * `message_type`, so no schema change is needed. Differences from
   * `logMessage`:
   *   - resolves the EXISTING room by (line_user_id | channel_user_id | user_id)
   *     + hook_id; never creates one
   *   - does NOT touch `room.last_message` (a divider or an internal note must
   *     not overwrite the conversation preview) and does NOT bump `unread_count`
   *   - never sends anything outbound (this method only writes to the DB)
   *
   * Best-effort: returns null on any failure without throwing.
   */
  public async logSystemMessage(
    input: LogSystemMessageInput,
  ): Promise<ChatMessageDocument | null> {
    const {
      lineUserId,
      memberId,
      hookId,
      messageType,
      content,
      metadata = {},
    } = input;

    try {
      if ((!lineUserId && !memberId) || !hookId) {
        this.logger.warn(
          'logSystemMessage: missing lineUserId/memberId or hookId',
        );
        return null;
      }
      if (!content) {
        this.logger.warn('logSystemMessage: content is required');
        return null;
      }
      // Find the existing room only — a system line should never spawn a room.
      // Accept EITHER a raw platform id string (line_user_id/channel_user_id)
      // OR a Member ObjectId (user_id): tickets store the Member ref, chat
      // rooms store the string, so callers may hold either.
      const or: Record<string, unknown>[] = [];
      if (lineUserId) {
        or.push({ line_user_id: lineUserId }, { channel_user_id: lineUserId });
      }
      if (memberId) {
        or.push({ user_id: memberId });
      }
      const room = await this.chatRoomModel
        .findOne({
          $or: or,
          hook_id: hookId,
        })
        .select('_id channel_type')
        .lean<{ _id: Types.ObjectId; channel_type?: string } | null>();
      if (!room) {
        this.logger.warn(
          `logSystemMessage: no room for ${String(lineUserId)} @ ${String(hookId)}`,
        );
        return null;
      }
      const message = new this.chatMessageModel({
        room_id: room._id,
        hook_id: hookId,
        channel_type: room.channel_type || 'line',
        // Reuse the existing enum; message_type is the real discriminator.
        sender_type: 'admin',
        message_type: messageType,
        content,
        metadata: metadata || {},
      });
      await message.save();
      // Intentionally NOT updating room.last_message / unread_count.
      this.logger.log(
        `system message (${messageType}) saved | room: ${String(room._id)}`,
      );
      return message;
    } catch (error) {
      this.logger.error(`logSystemMessage failed: ${errorMessage(error)}`);
      return null;
    }
  }
}
