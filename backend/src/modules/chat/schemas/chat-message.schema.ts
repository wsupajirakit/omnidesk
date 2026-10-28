import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

import { legacyTimestamps } from '@/infra/mongo/schema-options';

export type ChatMessageDocument = HydratedDocument<ChatMessage>;

/**
 * [FEAT-20260908-CHATTRANS] ONE rendering of this message in another language.
 *
 * `_id: false` — a stored translation has no identity of its own; it is
 * addressed by `lang` and nothing ever links to it. Same shape and same reason
 * as `hook-audit-log.schema.ts`'s `changed_fields`.
 *
 * ⚠️ ONLY `text` IS REQUIRED. The three language fields are all nullable, and a
 * null is never a defect — it is the only honest answer to "which language?"
 * when nobody was in a position to say. THE ONE RULE: a language is recorded
 * when it was STATED, never when it could be guessed.
 * ไม่รู้ = null · ห้ามเดา.
 *
 *   READ side  — an admin pressed translate on a customer's message:
 *     `lang` = `to` = the language they picked (both always set)
 *     `from` = null unless the caller stated a source. The UI never asks for
 *              one (owner, 09/09: *"เราไม่จำเป็นต้องเลือก src lang เพราะว่าเรารู้อยู่แล้ว
 *              และ ai ก็คิดได้อยู่แล้ว"*) — the model detects it, and we are not told
 *              what it decided. NOT `''`, NOT `'auto'`, and NOT back-filled
 *              from a hook locale or the panel's UI language.
 *
 *   SEND side  — the admin drafted in one language and sent another:
 *     `text`  = the admin's own wording; `content` holds what the customer got
 *     `lang`  = `from` = `original_lang` IF the request stated it. It usually
 *              does not: the composer never asks the admin what language they
 *              just typed in, and the panel's UI language is not it.
 *     `to`    = null always — the request carries the original and (sometimes)
 *              its language, and never the language `content` ended up in.
 *
 * 🔴 The dashboard renders the `from → to` pair only when the ends are set, so
 * a guess here would put a language on screen that nobody chose.
 *
 * DIRECTION IS DERIVED, NEVER STORED, and the nulls keep the derivation honest:
 *   `lang === to`   ⇒ translated AFTER the fact (a customer message, on press)
 *   `lang === from` ⇒ translated BEFORE sending (the admin's own original)
 *   both null       ⇒ an original whose language was never stated — the FE
 *                     shows the text without a language pair, which is exactly
 *                     what is known about it.
 */
@Schema({ _id: false })
export class MessageTranslation {
  /**
   * The language of `text` — and, on the read path, the cache key the `$ne`
   * guard matches on.
   *
   * ⚠️ Nullable ONLY because of the send path, where the language of the
   * admin's own draft is genuinely unknown. Every entry the READ path writes
   * carries a real code, and `chat-translate-route.spec.ts` pins that: the
   * duplicate guard is keyed on this field, so a stored `null` there would make
   * the cache unlookupable. An outbound entry is never pushed and never looked
   * up by language, which is why the null is harmless where it does occur.
   */
  @Prop({ type: String, default: null })
  lang!: string | null;

  /** The only field that is always there. Without it there is no entry. */
  @Prop({ type: String, required: true })
  text!: string;

  /** The source language, when the caller stated one. See the header. */
  @Prop({ type: String, default: null })
  from!: string | null;

  /** The target language. Always set on the read path; see the header. */
  @Prop({ type: String, default: null })
  to!: string | null;
}

export const MessageTranslationSchema =
  SchemaFactory.createForClass(MessageTranslation);

/** One message in a room, from a customer, the bot, or an admin. */
@Schema({ collection: 'chat_messages', ...legacyTimestamps })
export class ChatMessage {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'ChatRoom',
    required: true,
    index: true,
  })
  room_id!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Hook', index: true })
  hook_id?: Types.ObjectId;

  /** Denormalised from the parent hook so a message can be routed without
   * loading it. */
  @Prop({ type: String, default: 'line' })
  channel_type!: string;

  @Prop({ type: String, default: null })
  ai_key?: string | null;

  /**
   * [FEAT-20260808-ISPUSH] True ONLY for a message an admin pushed out manually
   * (text/reply, sticker, or image via the chat panel). Everything else — customer
   * messages, AI bot replies, system dividers — keeps the `false` default, so no
   * other write path needs to pass it. Purpose: cheap future analytics (how many
   * pushes today, by whom, on which OA) via `count({ is_push: true, sender_id, hook_id })`.
   * Additive + default false ⇒ zero impact on existing reads/writes.
   */
  @Prop({ type: Boolean, default: false })
  is_push!: boolean;

  /**
   * [FEAT-20260808-ISADMIN] True when a human ADMIN produced this outgoing
   * message (as opposed to the AI bot). `sender_type` stays 'bot' on purpose —
   * it encodes DIRECTION (outgoing), which legacy explicitly forbids changing
   * (chatRoomController.js:911). Legacy distinguishes bot-vs-admin only by the
   * presence of `metadata.sender_name`; this flag is the same signal made
   * explicit so the frontend can branch on `is_admin` directly instead of
   * sniffing metadata. Default false ⇒ AI replies / customer / system rows are
   * untouched. Revert: delete this field + the `is_admin: true` at the push sites.
   */
  @Prop({ type: Boolean, default: false })
  is_admin!: boolean;

  @Prop({
    type: String,
    enum: ['customer', 'bot', 'admin'],
    required: true,
  })
  sender_type!: string;

  /** Set only for admin messages; bot and customer messages leave it null. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  sender_id?: Types.ObjectId | null;

  @Prop({ type: String, default: 'text' })
  message_type!: string;

  /** Mixed: text messages store a string, richer types store an object. */
  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  content!: unknown;

  /** Provider-side message id, indexed for inbound de-duplication. */
  @Prop({ type: String, index: true })
  provider_msg_id?: string;

  /**
   * [FEAT-20260820-QUOTEID] The message THIS one quotes, in the provider's own
   * id-space — the raw material for a quote/reply bubble in the chat UI.
   * Owner, 2026-08-20: "เพิ่ม field column ... อนาคตเอาไว้ทำ quote ui reply ·
   * เรายังไม่ใช้จริงทำเผื่อไว้".
   *
   * Resolved against the field directly above it, which is the whole reason for
   * the name — LINE calls it `quotedMessageId`, but in this schema its id-space is
   * called `provider_msg_id`, and our own `_id` is a message id too:
   *
   *   findOne({ room_id, provider_msg_id: <quoted_provider_msg_id> })
   *
   * ⚠️ NO DEFAULT, unlike most fields in this class. `default: null` would write a
   * key into every new message — into the websocket payload and into the snapshots
   * this suite compares — for a feature nothing uses yet. A String path with no
   * default is simply absent, which is the honest reading of "quotes nothing".
   * Confirmed on live rows before choosing: 229 of 466 messages carry no
   * `provider_msg_id` key at all, and that prop is declared the same way.
   * ไม่ใส่ default ⇒ แถวใหม่ไม่มี key นี้เลย = seamless จริง.
   *
   * ⚠️ NOT INDEXED. Resolving a quote reads `provider_msg_id`, which is indexed
   * already. An index here would only answer "who quoted this message", which
   * nothing asks. ทิศที่คิวรี่จริงคือ provider_msg_id ไม่ใช่ field นี้.
   *
   * ⚠️ NOTHING WRITES IT YET. When the quote UI is built, three layers change
   * together or the value is lost on the way back:
   *   1. `webhook.service.ts` — read `event.message.quotedMessageId`
   *   2. `chat-history.service.ts::logMessage` — the one door that writes this row
   *   3. the dashboard's message normalizer — it rebuilds objects field by field
   * Sending a quoted reply needs LINE's `quoteToken` instead: a different,
   * short-lived value and a different field. Not added today.
   *
   * revert: delete this prop. Nothing has ever written it.
   */
  @Prop({ type: String })
  quoted_provider_msg_id?: string;

  /**
   * [FEAT-20260821-QUOTEREPLY] LINE's quote token FOR THIS MESSAGE — the handle
   * someone else uses to quote it. Two doors write it, nothing else:
   *   · inbound  — `chat-history.service.ts::logMessage` copies
   *                `event.message.quoteToken` (text · sticker · image · video)
   *   · outbound — the admin send stores `sentMessages[0].quoteToken` from LINE's
   *                response, so a customer quoting OUR bubble resolves later
   *                (owner 21/08: "เก็บเผื่อไว้เลย ห้ามกระทบ").
   * Per LINE: never expires, reusable, accepted by reply AND push. The 211 rows
   * that predate this field still carry the token inside
   * `raw_content.events[0].message.quoteToken`; the read side falls back to that,
   * NO backfill (owner's standing rule). Same seamless shape as the prop above: no
   * default ⇒ absent on every legacy row and on every send LINE returns no token
   * for (flex/template). NOT indexed — nothing looks a message up BY its token.
   * revert: stop the two writers; the prop is harmless.
   */
  @Prop({ type: String })
  quote_token?: string;

  @Prop({ type: String, index: true })
  reply_token?: string;

  /**
   * [FEAT-20260821-QUOTEREPLY] Set on an INBOUND row when the admin console spent
   * its `reply_token` (dynamic reply-reuse, `channels/outbound-send-strategy.ts`).
   * A reply token is single-use and dies at 60 s; without this stamp a second admin
   * message inside that minute would burn a guaranteed 400 before falling back to
   * push. Written ONLY by the reuse strategy on a successful reply; with
   * `CHAT_REPLY_REUSE=off` it is never written. The bot's own consumption is not
   * tracked here — the strategy only fires in admin-held rooms where the bot is
   * silent (WH-G10). No default, not indexed. revert: delete the strategy's write.
   */
  @Prop({ type: Date })
  reply_token_used_at?: Date;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  metadata!: Record<string, unknown>;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  raw_content?: unknown;

  /** Points at the stored copy of an image, kept separately from `content`. */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'ImageStorage',
    default: null,
    index: true,
  })
  internal_content_id?: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  category?: string | null;

  /**
   * [FEAT-20260908-CHATTRANS] the same message, rendered in other languages.
   * Written by exactly two doors, both of which go through
   * `chat/translate/translation-store.ts`:
   *   · a customer message an admin pressed translate on — one atomic `$push`
   *     per language, guarded by `'translations.lang': { $ne: lang }`
   *   · an admin send that was drafted in another language — the ORIGINAL text
   *     rides the same single insert `sendChatReply` already does
   *
   * `content` is always the text the CUSTOMER saw; this column always holds the
   * same message in the OTHER language. content = สิ่งที่ลูกค้าเห็นเสมอ.
   *
   * ⚠️⚠️ `default: undefined` IS LOAD-BEARING, NOT DECORATION — and unlike the
   * String props above, leaving the option out here does NOT give an absent key.
   * Mongoose installs a default of `[]` on EVERY array path unless it is passed
   * one explicitly (`node_modules/mongoose/lib/schema/array.js:110` reads
   *   if (!('defaultValue' in this) || this.defaultValue != null) this.default(fn)
   * and that `fn` returns `[]`). Drop this option and every new message row is
   * written with `translations: []`, and every legacy row hydrated through this
   * model reports the key too — on a collection with no purge and no TTL, and
   * into every websocket payload and every response snapshot, for a feature the
   * row never used. The identical warning, and the same library line, is at
   * `member.schema.ts:250-265` — read it before touching this line.
   * ⚠️ That field's own spec greps the whole repo for its NAME and fails if
   *    anything outside its schema mentions it, so this citation deliberately
   *    gives the file and lines WITHOUT naming the field. A doc reference is not
   *    a writer, but a text search cannot tell the two apart.
   * ถอด default: undefined ออกเมื่อไหร่ แถวใหม่ทุกแถวก็มี key นี้ทันที.
   *
   * ⇒ The guard for it must assert the key is ABSENT
   * (`'translations' in doc.toObject() === false`). `toEqual([])` passes in BOTH
   * worlds and proves nothing — see `chat-message-translations-field.spec.ts`.
   *
   * ⚠️ NOT INDEXED, deliberately. Nothing queries by translation; the one query
   * that touches this column addresses the message by `_id` and reads
   * `translations.lang` only as a `$ne` predicate on that single document.
   *
   * DB-EFFECT: one additive array field, absent on every existing row. No
   * migration, no backfill, no index.
   * revert: stop the two writers, delete this prop, then
   *         db.chat_messages.updateMany({}, { $unset: { translations: '' } })
   *         ⚠️ text already DELIVERED to a customer cannot be un-sent.
   */
  @Prop({ type: [MessageTranslationSchema], default: undefined })
  translations?: MessageTranslation[];
}

export const ChatMessageSchema = SchemaFactory.createForClass(ChatMessage);

// Thread view: newest-first within a room.
ChatMessageSchema.index({ room_id: 1, created_at: -1 });

/**
 * [PERF-20260822-TKTIMGIDX] The ticket list's attachment lookup.
 *
 * WHAT IT SERVES: `enrichTicketRows` (tickets.service.ts) runs
 * `find({ room_id: { $in: [...] }, message_type: 'image' })` on every list
 * load, then keeps only a 13-minute window per ticket, capped at 10 files.
 *
 * WHY IT IS NEEDED: the index above stops at `room_id`, so `message_type` was
 * a post-filter — the server read every message of every room in the list to
 * discard almost all of them. Measured on a 409-ticket / 412-room clone:
 * 1,812 documents read to return 81 (95.5% waste). With this index the read
 * drops to 81 — exactly what is returned. The waste grew with CHAT HISTORY,
 * not with ticket count, so it worsened silently as the system aged.
 *
 * `created_at: -1` is the third key so the same index also serves the sort and
 * any future date-range narrowing of that query without another index.
 *
 * BEHAVIOUR: none. No query text changes; this only removes wasted reads.
 * Proof: z-test/manual/prove-ticket-image-index.js (docsExamined must equal
 * nReturned) and z-test/unit/ticket-image-index.spec.ts.
 *
 * DB-EFFECT: one additive index. No document is written; existing rows are
 * untouched and readable exactly as before.
 * revert: delete this block —
 *         db.chat_messages.dropIndex('room_id_1_message_type_1_created_at_-1')
 */
ChatMessageSchema.index(
  { room_id: 1, message_type: 1, created_at: -1 },
  { background: true },
);

/**
 * [PERF-20260824-MSGHOOKDATE] The daily insight report's message scan.
 *
 * WHAT IT SERVES: `insight-reports.service.ts` matches
 * `{ sender_type: 'customer', created_at: {$gte, $lte}, hook_id }` for ONE day.
 *
 * WHY IT IS NEEDED: `hook_id` carries only a single-field index, and neither
 * index above leads with anything but `room_id` — there is no standalone
 * `created_at` index either. So a report about TODAY reads every message that
 * OA has ever received and discards all but one day of it. Equality first
 * (`hook_id`), range second (`created_at`), which is the order the planner can
 * seek with; reversing the two keys would make it unusable for this query.
 *
 * This one compounds with the fact that `chat_messages` has NO TTL and no purge
 * (`src/cli/purge-old-records.ts` excludes it on purpose), so the set being
 * scanned only ever grows.
 *
 * BEHAVIOUR: none — no query text changes and result order is unaffected.
 * DB-EFFECT: additive index only. No document written, no migration, existing
 * rows untouched and readable exactly as before.
 * ⚠️ Mongoose builds missing indexes at boot, and this is the largest collection
 * in the system — on production prefer creating it manually in the background
 * BEFORE deploying this schema.
 * revert: delete this block —
 *         db.chat_messages.dropIndex('hook_id_1_created_at_-1')
 */
ChatMessageSchema.index({ hook_id: 1, created_at: -1 }, { background: true });

/**
 * [PERF-20260824-MSGSENDERDATE] "The last message from the CUSTOMER in a room."
 *
 * WHAT IT SERVES: three call sites, all the same shape —
 *   webhook.service.ts  `{ room_id, sender_type: 'customer' }` sort created_at:-1
 *   abandon-trigger.helper.ts   same, `sender_type: 'bot'`
 *   channels/quote-reply-lookup.ts   same shape again
 *
 * WHY IT IS NEEDED: with only `{room_id, created_at}` above, `sender_type` is a
 * residual filter — the walk starts at the newest message in the room and skips
 * every one written by the bot since the customer last spoke. In a room the bot
 * has been talking into (broadcast, follow-up, notices) that prefix is unbounded.
 * There is no blocking sort here, so this is waste rather than a failure — but
 * it is waste on the per-event path, paid on every inbound message.
 *
 * One index serves all three sites because they differ only in the VALUE of
 * `sender_type`, not in the shape.
 *
 * BEHAVIOUR: none. DB-EFFECT: additive index only, no document changes.
 * revert: delete this block —
 *         db.chat_messages.dropIndex('room_id_1_sender_type_1_created_at_-1')
 */
ChatMessageSchema.index(
  { room_id: 1, sender_type: 1, created_at: -1 },
  { background: true },
);

/**
 * [FIX-20260808-AIKEYSTRIP] `ai_key` is an internal provenance tag: the webhook
 * stores a MASKED token (`maskToken(...)`, chat-history.service.ts) and an admin
 * push stores `null`. It has NO frontend consumer and NO internal reader, yet the
 * push/reply and message responses echoed it back in the body. Strip it from every
 * serialized response (toJSON = HTTP output; toObject for parity) while keeping the
 * column in the database — this changes ONLY what leaves over the wire.
 * Revert: delete this block.
 */
ChatMessageSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.ai_key;
    return ret;
  },
});
ChatMessageSchema.set('toObject', {
  transform: (_doc, ret) => {
    delete ret.ai_key;
    return ret;
  },
});
