import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';
import { extname } from 'node:path';

import type { AuthenticatedUser } from '@/common';
import { coreConfig } from '@/config/app.config';
import { CryptoService } from '@/infra/crypto';
import { RealtimePublisherService } from '@/infra/realtime/realtime-publisher.service';
import { ImageStorage, type ImageStorageDocument } from '@/modules/content';
import { Hook, type HookDocument } from '@/modules/hooks';
// [FEAT-20260808-MEDIALOG] the ONE writer of webhook_logs (applies the
// channel↔log_source mirror) — legacy chatRoomController.js:1036 uses
// webhookLogService.createLog for the outbound chat-image row.
import { WebhookLogService } from '@/modules/system';
// [FIX-20260808-VIDEORETRY] The ingest downloader that re-fetches a transcoded
// video. Injected as a plain provider (its only dep is the ImageStorage model,
// which ChatModule already registers) so ChatModule need NOT import WebhookModule
// — WebhookModule imports ChatModule, and the reverse would be circular.
import { LineContentService } from '@/modules/webhook/line-content.service';

// [FIX-20260808-CHANNELSEND] channel-agnostic outbound image delivery — mirrors
// legacy channels/ module. See chat.service.ts for the text/sticker sends.
import { ChannelRegistry, servedByLineCore } from './channels/channel-registry';
/* [FEAT-20260821-CHATPUSHCORE] push-core candidate C — the image half of the
   admin chat console. Bound to the DISPATCHER (the wrapper), never to
   `LinePushService`: a queue can slot in later by swapping one provider
   binding and this file never notices (`line-push.ts:52-54`). */
import { buildChatMessages } from '@/infra/line';
import {
  OUTBOUND_SEND_STRATEGY,
  type OutboundSendStrategy,
} from './channels/outbound-send-strategy';
import { findReplyCandidate } from './channels/quote-reply-lookup';
import { extractLineReason } from './channels/line-send-adapter';
// [FEAT-20260816-MULTIIMG] the ONE place that knows LINE's 5-objects-per-push
// ceiling and the owner's overflow arrangement. Deliberately not in the barrel.
import { planImagePushBatches } from './channels/outbound-image-batch';
import {
  ChatMessage,
  ChatRoom,
  type ChatMessageDocument,
  type ChatRoomDocument,
} from './schemas';

/**
 * Chat media: outbound images and the manual video retry.
 *
 * Ported from `legacy-api/src/controllers/chat/chatRoomController.js`
 * (`sendChatImage`, `retryVideoDownload`). Kept out of `chat.service.ts`
 * because that file is already on the lifted-file waiver at ~1,500 lines;
 * adding to it would deepen debt this module is trying to pay down.
 *
 * [FIX-20260808-CHANNELSEND] OUTBOUND DELIVERY IS NOW IMPLEMENTED — the image
 * (+ optional text caption) is pushed to the customer through the channel's send
 * adapter, mirroring the legacy channels/ module. See `sendChatImage` below.
 */

/**
 * [FIX-20260808-CHANNELSEND] Historical marker, kept for the golden tests that
 * import it. Legacy `sendChatImage` does four things: store the upload, PUSH it
 * to the customer through the channel's send adapter, log the bubble, and write
 * an outbound webhook log. [FEAT-20260808-MEDIALOG] ALL FOUR are now ported: the
 * store + push + bubble log were already here, and the outbound webhook_logs row
 * is now written by `logImageOutbound` on both the success and error paths
 * (legacy `logOutboundWebhookLog`, kind:"image"). The push goes through
 * `ChannelRegistry.getSendAdapter(hook.channel_type)` with the decrypted token —
 * the same adapter path as `sendChatReply` / `sendChatSticker`.
 */
export const MEDIA_SEND_UNPORTED =
  'outbound channel delivery is not implemented in this service yet';

/**
 * A rejection from these endpoints, which do NOT use the shared `{ error }`
 * envelope.
 *
 * Legacy answers every chat-media failure as `{ success: false, error }` — the
 * chat UI branches on `success`, so dropping that key changes what the screen
 * does even though the status and the message are identical. `AllExceptionsFilter`
 * would reduce a thrown exception to `{ error }`, so these are returned and
 * written by the controller instead. Proven by the golden diff: `success` came
 * back as `missing:` on all five rejection cases before this existed.
 */
export interface ChatMediaError {
  success: false;
  error: string;
  /** Status the controller must send. */
  status: number;
}

export const isChatMediaError = (v: unknown): v is ChatMediaError =>
  typeof v === 'object' && v !== null && 'success' in v && 'status' in v;

const reject = (error: string, status: number): ChatMediaError => ({
  success: false,
  error,
  status,
});

/** Uploaded file, as multer presents it. */
export interface UploadedImageFile {
  filename: string;
  originalname: string;
  path: string;
  size: number;
}

@Injectable()
export class ChatMediaService {
  private readonly logger = new Logger(ChatMediaService.name);

  constructor(
    @InjectModel(ChatRoom.name)
    private readonly chatRoomModel: Model<ChatRoomDocument>,
    @InjectModel(ChatMessage.name)
    private readonly chatMessageModel: Model<ChatMessageDocument>,
    @InjectModel(Hook.name)
    private readonly hookModel: Model<HookDocument>,
    @InjectModel(ImageStorage.name)
    private readonly imageStorageModel: Model<ImageStorageDocument>,
    private readonly realtimePublisher: RealtimePublisherService,
    // [FIX-20260808-CHANNELSEND] Token decryption + adapter registry for the
    // outbound image push. Mirrors legacy resolveRoomHook + getSendAdapter.
    private readonly crypto: CryptoService,
    private readonly channels: ChannelRegistry,
    // [FIX-20260808-VIDEORETRY] Re-download of a video LINE had not finished
    // transcoding when the webhook first arrived. See retryVideoDownload.
    private readonly lineContent: LineContentService,
    @Inject(coreConfig.KEY)
    private readonly config: ConfigType<typeof coreConfig>,
    // [FEAT-20260808-MEDIALOG] outbound webhook_logs writer for the chat-image
    // send, matching legacy logOutboundWebhookLog (chatRoomController.js:1022).
    private readonly webhookLogService: WebhookLogService,
    /* [FEAT-20260821-CHATPUSHCORE] appended LAST — positional callers keep
       working, container-built specs fail loudly instead of getting undefined.
       [FEAT-20260821-QUOTEREPLY] same slot now holds the send ladder, which owns
       the dispatcher — see chat.service.ts for the reasoning. */
    @Inject(OUTBOUND_SEND_STRATEGY)
    private readonly sender: OutboundSendStrategy,
  ) {}

  /**
   * Resolve the room and its hook, by room id or by channel user id.
   *
   * Mirrors legacy `resolveRoomHook`, minus the token decryption and adapter
   * lookup (see MEDIA_SEND_UNPORTED). The two error strings and the status each
   * maps to are copied exactly, because they are what the golden diff compares:
   * "hook_id is required …" is a 400, "Chat room not found" / "Hook not found"
   * are 404s.
   */
  private async resolveRoomHook(
    id: string,
    hookIdQuery: string | undefined,
  ): Promise<{ room: ChatRoomDocument; hook: HookDocument } | ChatMediaError> {
    let room: ChatRoomDocument | null;
    if (isValidObjectId(id)) {
      room = await this.chatRoomModel.findById(id);
    } else {
      if (!hookIdQuery) {
        return reject('hook_id is required when using line_user_id', 400);
      }
      room = await this.chatRoomModel.findOne({
        $or: [{ line_user_id: id }, { channel_user_id: id }],
        hook_id: isValidObjectId(hookIdQuery)
          ? new Types.ObjectId(hookIdQuery)
          : hookIdQuery,
      });
    }
    if (!room) return reject('Chat room not found', 404);

    const hook = await this.hookModel.findById(room.hook_id);
    if (!hook) return reject('Hook not found', 404);

    return { room, hook };
  }

  /**
   * POST /api/chat/:id/send-image and /api/chat/:id/push-image.
   *
   * Both paths reach this one method, exactly as legacy routes them to one
   * controller function. `push-image` is the current name; `send-image` is kept
   * because a frontend deployed before the rename still calls it, and dropping
   * it would break during any staggered deploy.
   */
  public async sendChatImage(
    id: string,
    hookIdQuery: string | undefined,
    // [FEAT-20260816-MULTIIMG] a single file (legacy callers + the pinned spec)
    // or up to 5 — the controller merges the old `image` field and the new
    // `images[]` field into one ordered array before calling here.
    file: UploadedImageFile | UploadedImageFile[] | undefined,
    text: string,
    auth?: AuthenticatedUser,
    // [FIX-20260808-IMGBASEURL] request host fallback (protocol://host) for the
    // absolute image URL when PUBLIC_BASE_URL/BASE_URL are unset — legacy parity.
    fallbackBaseUrl?: string,
  ): Promise<Record<string, unknown> | ChatMediaError> {
    // [FEAT-20260808-MEDIALOG] start clock for the webhook_log duration_ms, set
    // BEFORE any DB/network work exactly as legacy (chatRoomController.js:1116).
    const startTime = Date.now();

    // Checked first, before the room lookup — legacy answers this 400 without
    // touching the database. The error string is pinned by the golden suite.
    const files = Array.isArray(file) ? file : file ? [file] : [];
    if (files.length === 0) return reject('image file is required', 400);
    // Defence in depth: multer already caps `images` at 5, but `image`(1) +
    // `images`(5) in one hand-crafted request would make 6 — refuse before any
    // row is written, so a rejected send never leaves orphan bubbles.
    if (files.length > 5) {
      return reject('up to 5 images per send', 400);
    }

    const resolved = await this.resolveRoomHook(id, hookIdQuery);
    if (isChatMediaError(resolved)) return resolved;
    const { room, hook } = resolved;

    /**
     * The RELATIVE url is what gets stored, matching inbound customer images,
     * so the chat UI resolves it against its own API base. Storing an absolute
     * url here previously broke the admin's own image bubble whenever the host
     * changed. (The absolute https url is what the channel would need, and that
     * is the part not ported.)
     */
    // [FEAT-20260816-MULTIIMG] one storage row + one image bubble per file, in
    // upload order — each row keeps the exact single-image shape (no schema
    // change; N rows of the shape that always existed).
    const relativeUrls: string[] = [];
    const bubbles: Array<{ _id: unknown }> = [];
    for (const f of files) {
      const relativeUrl = `/uploads/images/${f.filename}`;
      relativeUrls.push(relativeUrl);
      const ext = extname(f.originalname).substring(1).toLowerCase();

      // `object_image_id` is simply omitted rather than set to null: a chat image
      // has no parent Object entry, and the schema declares it optional, so an
      // absent key and an explicit null read identically to every consumer.
      const storage = await this.imageStorageModel.create({
        image_url: relativeUrl,
        origin_path: 'chat_send',
        storage_type: 'dashboard',
        image_type: ext,
        file_path: f.path,
        file_size: f.size,
        created_by: auth?.userId ? new Types.ObjectId(auth.userId) : null,
        // Chat stream media, never the Object library — this flag is what keeps
        // the two apart in every later query.
        source: 'chat',
        media_kind: 'image',
      });

      const imgMsg = await this.chatMessageModel.create({
        room_id: room._id,
        hook_id: room.hook_id,
        channel_type: room.channel_type || 'line',
        sender_type: 'bot',
        sender_id: auth?.userId ? new Types.ObjectId(auth.userId) : null,
        message_type: 'image',
        content: '[image]',
        internal_content_id: storage._id,
        // [FIX-20260808-ADMINSENDER] metadata.sender_name (snake) is what the
        // dashboard reads to show the admin instead of "Bot"; is_push/is_admin are
        // the explicit flags. See chat.service.ts text-push site for the rationale.
        is_push: true,
        is_admin: true,
        metadata: {
          sender_name: auth?.displayName || auth?.username || null,
        },
      });
      bubbles.push(imgMsg);
    }
    const imgMsg = bubbles[0];

    // A caption rides as its own text message, matching legacy.
    if (text) {
      const capMsg = await this.chatMessageModel.create({
        room_id: room._id,
        hook_id: room.hook_id,
        channel_type: room.channel_type || 'line',
        sender_type: 'bot',
        sender_id: auth?.userId ? new Types.ObjectId(auth.userId) : null,
        message_type: 'text',
        content: text,
        // [FIX-20260808-ADMINSENDER] admin caption — same flags + sender_name.
        is_push: true,
        is_admin: true,
        metadata: {
          sender_name: auth?.displayName || auth?.username || null,
        },
      });
      // [FEAT-20260816-MULTIIMG] the caption bubble now rides the realtime
      // announce below too (owner 16/08: "เด้งครบทุกใบ") — before this it was
      // the one bubble that only appeared after a refresh.
      bubbles.push(capMsg);
    }

    // [FIX-20260808-CHANNELSEND] Deliver the image (+ optional caption) to the
    // customer via the channel's send adapter — was store + bubble only, never
    // pushed. Mirrors legacy sendChatImage. The DB stores the RELATIVE url (so
    // the admin bubble resolves against its own base); LINE gets the ABSOLUTE
    // https url built from PUBLIC_BASE_URL/BASE_URL, forced to https because LINE
    // rejects non-https originalContentUrl. The store + realtime publish below
    // are unchanged (seamless admin echo).
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
      return reject(`channel '${channelType}' cannot send yet`, 400);
    }
    const accessToken = this.crypto.safeDecrypt(
      hook.access_token || (hook as unknown as { line_key?: string }).line_key,
    );
    if (!accessToken) {
      return reject('Line access token is required', 400);
    }
    const to = room.channel_user_id || room.line_user_id;
    // [FIX-20260808-IMGBASEURL] PUBLIC_BASE_URL / BASE_URL, else the request host
    // (legacy chatRoomController.js:1131). Forced to https because LINE rejects a
    // non-https originalContentUrl. Empty base ⇒ a relative url ⇒ LINE 400, which
    // is exactly the failure this fallback removes on hosts without BASE_URL set.
    const publicBase = (
      this.config.publicBaseUrl ||
      this.config.baseUrl ||
      fallbackBaseUrl ||
      ''
    )
      .replace(/\/+$/, '')
      .replace(/^http:\/\//, 'https://');
    const absoluteImageUrls = relativeUrls.map((u) => `${publicBase}${u}`);

    // [FIX-20260808-IMGSENDFAIL] legacy chatRoomController.js:1186-1201 wraps the
    // outbound push so a LINE-send failure returns a `{success:false, error:"Failed
    // to send image: <reason>"}` envelope with the upstream status — NOT an uncaught
    // 500 "internal error". The image row + admin bubble are already stored above,
    // so the echo persists on refresh; only the outbound push failed. The most
    // common cause is LINE being unable to fetch the image because PUBLIC_BASE_URL
    // is unset or not a public https origin (e.g. local dev, where LINE cannot
    // reach localhost). Matching legacy's envelope makes the failure diagnosable.
    // [FEAT-20260816-MULTIIMG] Batch plan: ≤5 objects → one call; 5 images +
    // caption → the owner's two-call arrangement ([text, img1..4] then [img5]).
    // A single image produces exactly the legacy call — same messages, same
    // order — so nothing existing moves.
    const batches = planImagePushBatches(absoluteImageUrls, text || undefined);

    /* [FEAT-20260821-QUOTEREPLY] 5+1 is TWO calls and a reply token is single-use:
       the candidate (if the bound strategy wants one at all) goes to batch 0 ONLY.
       Batch 1 is push no matter what happened to batch 0 — reply succeeded (token
       spent) or reply died (then batch 0 was already pushed). So the worst case is
       exactly today's two pushes, never a third call. Images carry no quoteToken
       (LINE's ImageMessage has no such field), so `quote_of` does not reach here. */
    const candidate = this.sender.wantsReplyCandidate
      ? await findReplyCandidate(this.chatMessageModel, room._id)
      : null;

    for (const [i, batch] of batches.entries()) {
      try {
        /* [FEAT-20260821-CHATPUSHCORE] the image send moves to the push core.
           ==================================================================
           Same payload on the wire — `buildChatMessages` and the old adapter are
           compared byte-for-byte in `z-test/unit/chat-pushcore-parity.spec.ts`,
           including the caption-first overflow batch this loop produces.

           ⚠️ 8s, not the core's default. Images get the longer budget because
           LINE fetches them (`line-send-adapter.ts:166`, ported from legacy);
           passing nothing would silently shorten every image send.

           ⚠️ ONE ROW PER REAL HTTP CALL stays true — this is inside the batch
           loop, and a non-ok result throws into the catch below exactly where
           the adapter used to throw, so a two-call send still writes two rows
           and a failed second call still logs a failure for that call alone.

           ⚠️ The core never throws; the loop's catch is the whole error path
           here, so a non-ok result MUST become one. หนึ่งคอลจริง = หนึ่งแถว.

           revert: put back `await adapter.send({to,accessToken},{kind:'images',…})`
           and drop the `linePush` constructor param. */
        const outcome = await this.sender.send(
          {
            token: accessToken,
            to,
            messages: buildChatMessages({
              kind: 'images',
              imageUrls: batch.imageUrls,
              text: batch.text,
              textFirst: batch.textFirst,
            }),
            timeoutMs: 8000,
          },
          i === 0 ? candidate : null,
        );
        if (outcome.replyTokenSpent && outcome.spentRowId) {
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
        // A reply rung that died before the push that worked is its own real
        // HTTP call — it gets its own error row, so the history shows both.
        outcome.attempts.slice(0, -1).forEach((a) => {
          const raw = (a.res.raw ?? {}) as {
            response?: { status?: number; data?: unknown };
            code?: string;
            message?: string;
          };
          this.logImageOutbound({
            room,
            hook,
            to,
            imageUrls: batch.imageUrls,
            text: batch.text,
            textFirst: batch.textFirst,
            durationMs: Date.now() - startTime,
            sendKind: a.kind,
            error: { ...raw, message: raw.message ?? a.res.reason },
          });
        });
        const res = outcome.res;
        if (!res.ok) {
          /* ⚠️ A REAL Error CARRYING axios's FIELDS — not the raw value, and not
             a bare new Error either.
             The catch below reads `.response.status` for the envelope the FE
             shows and `.response.data` for the log reason; a fresh Error has
             neither, so a 400 from LINE would reach the operator as a 500 and
             the log would lose LINE's own message. Throwing `res.raw` straight
             would carry them, but `res.raw` is `unknown` and may not be an
             Error at all (`only-throw-error`). So: build an Error, copy the two
             fields the catch needs onto it.
             โยนของที่เป็น Error จริง แต่พก status กับ data ของ axios ไปด้วย. */
          const raw = (res.raw ?? {}) as {
            response?: unknown;
            code?: unknown;
          };
          const reason = extractLineReason(res.raw) ?? res.reason;
          throw Object.assign(
            new Error(
              reason ? `LINE push failed: ${reason}` : 'LINE push failed',
            ),
            raw.response !== undefined ? { response: raw.response } : {},
            raw.code !== undefined ? { code: raw.code } : {},
          );
        }
        // [FEAT-20260808-MEDIALOG] one success webhook_logs row per REAL HTTP
        // call — a two-call send writes two rows, mirroring what LINE saw.
        this.logImageOutbound({
          room,
          hook,
          to,
          imageUrls: batch.imageUrls,
          text: batch.text,
          textFirst: batch.textFirst,
          durationMs: Date.now() - startTime,
          sendKind: outcome.sentKind,
        });
      } catch (sendErr) {
        const err = sendErr as {
          response?: { status?: number; data?: unknown };
          code?: string;
          message?: string;
        };
        const reason = err?.response?.data
          ? JSON.stringify(err.response.data)
          : err?.message || 'unknown error';
        this.logger.error(`[sendChatImage] LINE image push failed: ${reason}`);

        // [FEAT-20260808-MEDIALOG] error outbound webhook_logs row — legacy logs
        // the failure the same way in its catch (chatRoomController.js:1191-1198).
        // Legacy's error payload omits imageUrl (only `text`), so it is dropped here
        // too. Written BEFORE returning, matching legacy order.
        this.logImageOutbound({
          room,
          hook,
          to,
          text: batch.text,
          error: err,
          durationMs: Date.now() - startTime,
        });

        // A multi-call send names which call died ("2/2") — the bubbles are
        // already stored, so on a call-2 failure the customer HAS the first
        // batch; the envelope must not pretend nothing was delivered.
        // No bubble is announced on any failure (legacy behaviour: publish
        // only after a fully successful send; a refresh still shows them).
        const batchTag =
          batches.length > 1 ? ` (batch ${i + 1}/${batches.length})` : '';
        return reject(
          `Failed to send image${batchTag}: ${reason}`,
          err?.response?.status || 500,
        );
      }
    }

    // [FEAT-20260816-MULTIIMG] announce EVERY stored bubble (images + caption)
    // — owner 16/08: "เด้งครบทุกใบ". Same payload shape the single-image path
    // always published; ChatRoomView refetches content by message_id.
    for (const b of bubbles) {
      await this.realtimePublisher.publish('message:new', {
        hook_id: String(room.hook_id),
        room_id: String(room._id),
        message_id: String(b._id),
      });
    }

    /* [FIX-20260828-SENDIMGSHAPE] The response must carry the STORED IMAGE, not
       just its id.
       ===================================================================
       Owner, 28/08: sending two images worked, sending one showed "[image]".
       The two paths differ on the console: a multi-image send refetches the
       transcript (so the row arrives through `listMessages`, which populates
       `internal_content_id`), while a single-image send appends THIS response
       directly to avoid the blink ([FIX-20260728-NOBLINK], TicketChat.tsx).
       `create()` hands back the raw ObjectId, so that one bubble had no
       `image_url`, fell through to the text bubble, and rendered its `content`
       — which is the literal placeholder "[image]".
       Populating here makes one send response describe the message the same way
       the list endpoint does, so every caller sees one shape instead of two.
       Cost is one read on a path that has already written a file and called
       LINE. Best-effort on purpose: the image HAS been delivered by now, and a
       populate hiccup must never turn a successful send into an error — the
       console still refetches on its own and would recover the picture.
       revert: return `imgMsg` unpopulated and make the console refetch after a
       single-image send too (drop the `count === 1` branch in TicketChat). */
    let populated: unknown = null;
    try {
      /* Read back rather than populating the document in place: `bubbles` is
         deliberately typed `{ _id: unknown }` because publishing only needs the
         id, and widening it here would pull a Mongoose document type through
         code that does not want one. */
      populated = imgMsg
        ? await this.chatMessageModel
            .findById(imgMsg._id as Types.ObjectId)
            .populate('internal_content_id')
            .lean()
        : null;
    } catch (e) {
      this.logger.warn(
        `[CHATIMG] populate after send failed, returning the raw row: ${(e as Error).message}`,
      );
    }

    return { success: true, data: populated ?? imgMsg };
  }

  /**
   * [FEAT-20260808-MEDIALOG] Outbound webhook_logs row for a chat-image send.
   *
   * Ported 1:1 from legacy `logOutboundWebhookLog` for `kind:"image"`
   * (legacy-api chatRoomController.js:1022-1073). Fire-and-forget: legacy does not
   * await it and swallows its own errors, so a log failure never fails the send.
   * Writes into the EXISTING `webhook_logs` collection via `WebhookLogService`
   * (the one path that applies the channel↔log_source mirror) — additive only, no
   * schema change. The fixed fields (channel/log_source "line_api",
   * action_type "push_message", POST to the push endpoint) are legacy's verbatim.
   */
  private logImageOutbound(args: {
    room: ChatRoomDocument;
    hook: HookDocument;
    to: string | undefined;
    // [FEAT-20260816-MULTIIMG] one row per real HTTP call: the batch's urls +
    // whether its caption led (the overflow call) or trailed (everywhere else).
    imageUrls?: string[];
    text?: string;
    textFirst?: boolean;
    /** [FEAT-20260821-QUOTEREPLY] which endpoint really carried it. Absent = push. */
    sendKind?: 'reply' | 'push';
    responseData?: unknown;
    error?: {
      response?: { status?: number; data?: unknown };
      code?: string;
      message?: string;
    };
    durationMs: number;
  }): void {
    const {
      room,
      hook,
      to,
      imageUrls,
      text,
      textFirst,
      responseData,
      error,
      durationMs,
    } = args;
    const isError = !!error;
    const hookRecord = hook as unknown as Record<string, unknown>;

    // legacy line messages block (kind:"image"): image bubbles + optional
    // caption, in the order the call actually carried them.
    const imageObjs: Array<Record<string, unknown>> = (imageUrls ?? []).map(
      (u) => ({
        type: 'image',
        originalContentUrl: u,
        previewImageUrl: u,
      }),
    );
    const textObjs = text ? [{ type: 'text', text }] : [];
    const lineMessages: Array<Record<string, unknown>> = textFirst
      ? [...textObjs, ...imageObjs]
      : [...imageObjs, ...textObjs];

    // legacy `payload` for kind:"image" is `{ imageUrl, text }` on success and
    // `{ text }` on error; payload_summary spreads it after `{to, kind}`.
    // A one-image call keeps the singular `imageUrl` key byte-identical to
    // legacy; only a genuine multi-image call carries `imageUrls` (additive).
    const payload: Record<string, unknown> = isError
      ? { text: text || undefined }
      : imageUrls && imageUrls.length > 1
        ? { imageUrls, text: text || undefined }
        : { imageUrl: imageUrls?.[0], text: text || undefined };

    void this.webhookLogService
      .createLog({
        hook_id: hookRecord['_id'] ? String(hookRecord['_id']) : undefined,
        hook_alias: (hookRecord['alias'] as string) || undefined,
        channel_type:
          room.channel_type || (hookRecord['channel_type'] as string) || 'line',
        group_id: hookRecord['group'] ? String(hookRecord['group']) : undefined,
        channel: 'line_api',
        log_source: 'line_api',
        action_type: 'push_message',
        method: 'POST',
        endpoint:
          args.sendKind === 'reply'
            ? 'https://api.line.me/v2/bot/message/reply'
            : 'https://api.line.me/v2/bot/message/push',
        status: isError ? 'error' : 'success',
        http_status: isError ? error?.response?.status || 500 : 200,
        error_code: isError
          ? error?.code || String(error?.response?.status || 500)
          : undefined,
        error_message: isError ? this.extractErrorReason(error) : undefined,
        duration_ms: durationMs,
        payload_summary: {
          to: to || null,
          kind: 'image',
          ...payload,
          ...(args.sendKind
            ? { send: { kind: args.sendKind, quote: 'none' } }
            : {}),
        },
        raw_request: {
          to: to || null,
          messages: lineMessages,
        },
        response_summary: isError
          ? undefined
          : (responseData as Record<string, unknown>) || { status: 'success' },
        raw_response: isError
          ? error?.response?.data || { message: error?.message }
          : (responseData as Record<string, unknown>) || { status: 'success' },
      })
      .catch((err: Error) =>
        this.logger.error(`WebhookLog createLog error: ${err.message}`),
      );
  }

  /**
   * [FEAT-20260808-MEDIALOG] Human-readable LINE error reason, ported from legacy
   * `extractErrorReason` (chatRoomController.js:985-1020) — HTTP status + the
   * upstream message/details, request id, and the timeout hint.
   */
  private extractErrorReason(error?: {
    response?: {
      status?: number;
      data?: unknown;
      headers?: Record<string, unknown>;
    };
    code?: string;
    message?: string;
  }): string {
    const status = error?.response?.status;
    const data = error?.response?.data as
      string | Record<string, unknown> | undefined;
    const headers = error?.response?.headers || {};
    const reqId =
      (headers['x-line-request-id'] as string) ||
      (headers['x-request-id'] as string);

    const parts: string[] = [];
    if (status) parts.push(`HTTP ${status}`);

    if (data) {
      if (typeof data === 'string') {
        parts.push(data);
      } else if (typeof data === 'object') {
        const mainMsg =
          (data['message'] as string) ||
          (data['error_description'] as string) ||
          (data['error'] as string) ||
          (data['detail'] as string);
        if (mainMsg) parts.push(mainMsg);

        const details = data['details'];
        if (Array.isArray(details) && details.length > 0) {
          const detailStr = details
            .map((d: Record<string, unknown>) =>
              d['property']
                ? `${String(d['property'])}: ${String(d['message'])}`
                : (d['message'] as string),
            )
            .filter(Boolean)
            .join(', ');
          if (detailStr) parts.push(`(${detailStr})`);
        } else if (Object.keys(data).length > 1) {
          parts.push(`(${JSON.stringify(data)})`);
        }
      }
    } else if (error?.message) {
      parts.push(error.message);
    }

    if (reqId) parts.push(`[reqId: ${reqId}]`);
    if (error?.code === 'ECONNABORTED') {
      parts.push('Request timeout (LINE API did not respond in time)');
    }

    return parts.length > 0 ? parts.join(' - ') : 'Unknown LINE error';
  }

  /**
   * POST /api/chat/message/:messageId/retry-video.
   *
   * The button an admin presses for a message stored as `video_pending` — LINE
   * had not finished transcoding when the webhook arrived.
   *
   * [FIX-20260808-VIDEORETRY] Fully ported now (was a stub). Decrypts the OA
   * token, calls `lineContentService.downloadAndSaveVideo`, and on success
   * promotes the row `video_pending → video`, then emits `message:updated` so
   * every admin viewing the room sees the bubble become playable without a
   * refresh. If the download still returns null (LINE not done transcoding) the
   * message is left untouched and the admin may press again — unlimited retries,
   * matching legacy `chatRoomController.retryVideoDownload`.
   */
  public async retryVideoDownload(
    messageId: string,
  ): Promise<Record<string, unknown> | ChatMediaError> {
    if (!isValidObjectId(messageId)) {
      return reject('messageId ไม่ถูกต้อง', 400);
    }

    const message = await this.chatMessageModel.findById(messageId);
    if (!message) return reject('ไม่พบข้อความนี้', 404);

    if (message.message_type !== 'video_pending') {
      return reject('ข้อความนี้ไม่ใช่วิดีโอที่รอโหลด', 400);
    }
    if (!message.provider_msg_id) {
      // Should not happen — the webhook always records it — but kept because
      // legacy answers 400 here rather than throwing.
      return reject(
        'ไม่มี LINE message id ผูกกับข้อความนี้ ไม่สามารถโหลดซ้ำได้',
        400,
      );
    }

    const hook = await this.hookModel.findById(message.hook_id).lean();
    if (!hook) return reject('ไม่พบ hook ของข้อความนี้', 404);

    // access_token || line_key — legacy reads either; safeDecrypt returns '' when
    // the ciphertext is absent/garbage rather than throwing.
    const accessToken = this.crypto.safeDecrypt(
      hook.access_token || (hook as unknown as { line_key?: string }).line_key,
    );
    if (!accessToken) return reject('Hook ไม่มี access token', 400);

    const storageId = await this.lineContent.downloadAndSaveVideo(
      message.provider_msg_id,
      accessToken,
    );
    if (!storageId) {
      // Still not ready — leave the message as video_pending, let the admin press
      // again (unlimited). Legacy answers 200 + success:false here, NOT an error.
      return {
        success: false,
        message:
          'วิดีโอยังไม่พร้อม (LINE อาจยังประมวลผลไม่เสร็จ) ลองใหม่อีกครั้ง',
      };
    }

    message.internal_content_id = storageId;
    message.message_type = 'video';
    await message.save();

    // Send the resolved url back with the response so FE can play immediately —
    // returning only the _id would force a second fetch for a row we just wrote.
    const storage = await this.imageStorageModel.findById(storageId).lean();
    const internalContentPayload = storage
      ? {
          _id: String(storage._id),
          image_url: storage.image_url,
          storage_type: storage.storage_type,
          image_type: storage.image_type,
          media_kind: storage.media_kind,
          file_size: storage.file_size,
        }
      : { _id: String(storageId) };

    // Realtime: other admins in this room see pending → playable live. hook_id is
    // required by the publisher's scoping guarantee; fire-and-forget like every
    // other publish — a realtime failure must not fail the endpoint.
    // Field names mirror legacy publishMessageEvent(..., "message:updated") EXACTLY
    // — the dashboard's ChatRoomView locates the bubble by `data._id` and reads
    // `data.room_id` / `data.message_type` / `data.internal_content_id`. Emitting
    // `message_id` instead of `_id` would silently no-op on the FE.
    await this.realtimePublisher.publish('message:updated', {
      hook_id: String(message.hook_id),
      _id: String(message._id),
      room_id: String(message.room_id),
      message_type: 'video',
      internal_content_id: internalContentPayload,
    });

    return {
      success: true,
      data: {
        _id: String(message._id),
        message_type: 'video',
        internal_content_id: internalContentPayload,
      },
    };
  }
}
