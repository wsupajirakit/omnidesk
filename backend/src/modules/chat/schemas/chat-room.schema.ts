import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

import { legacyTimestamps } from '@/infra/mongo/schema-options';
import {
  mirrorPair,
  mirrorUpdatePair,
  type MirroringQuery,
} from './mirror-field-pair';

export type ChatRoomDocument = HydratedDocument<ChatRoom>;

/** Denormalised preview of the newest message, for the room list. */
@Schema({ _id: false })
export class ChatRoomLastMessage {
  @Prop({ type: String })
  text?: string;

  @Prop({ type: String })
  sender_type?: string;

  @Prop({ type: Date })
  timestamp?: Date;
}

/**
 * One conversation between a customer and an OA.
 *
 * `line_user_id` and `channel_user_id` are the same value under an old and a
 * new name, dual-written by the legacy backend. Both carry a unique compound
 * index with `hook_id`, and both are kept: rows written under either name must
 * stay readable and both indexes remain live until the rename cuts over.
 *
 * `channel_user_id` is intentionally NOT `required`, unlike its legacy twin —
 * a write path missed by the migration must not fail validation on it.
 */
@Schema({ collection: 'chat_rooms', ...legacyTimestamps })
export class ChatRoom {
  /** The customer — the same `_id` as the Member document. */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Member',
    required: true,
    index: true,
  })
  user_id!: Types.ObjectId;

  @Prop({ type: String, required: true, index: true })
  line_user_id!: string;

  @Prop({ type: String, index: true })
  channel_user_id?: string;

  @Prop({ type: String, index: true })
  channel_id?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Hook', index: true })
  hook_id?: Types.ObjectId;

  /** Denormalised from the parent hook. */
  @Prop({ type: String, default: 'line' })
  channel_type!: string;

  @Prop({
    type: String,
    enum: ['active', 'archived', 'closed'],
    default: 'active',
  })
  status!: string;

  @Prop({ type: Number, default: 0 })
  unread_count!: number;

  @Prop({ type: SchemaFactory.createForClass(ChatRoomLastMessage) })
  last_message?: ChatRoomLastMessage;

  /** True while a human admin has taken the room over from the bot. */
  @Prop({ type: Boolean, default: false })
  assist_status!: boolean;

  @Prop({ type: Date })
  last_assist_changed_at?: Date;

  /* [REMOVED-20260820-ABANDON] `abandon_alerted_at` lived here — the one-time
     mark that a room's abandoned customer had been announced. The owner retired
     the whole alert on 2026-08-20, so nothing writes or reads it any more.
     Rows that already carry the value keep it; Mongoose simply stops seeing an
     undeclared path, and no query looks at it. What it meant and how the atomic
     claim worked is in `todo/be_todo27_20082026.md`. */

  @Prop({ type: Date, default: null })
  recently_assisted_at?: Date | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  assign_to?: Types.ObjectId | null;

  /** Legacy single note. Superseded by the `chat_room_notes` collection, which
   * was added alongside rather than migrating this field. */
  @Prop({ type: String, default: null })
  note?: string | null;

  /**
   * [FEAT-20260918-ROOMTRANS] THE CUSTOMER'S LANGUAGE in this room, as the
   * OPERATOR DECLARED IT. The dashboard's room modal is the definition, step 3:
   * *"ภาษาของห้องแชท · ระบุภาษาของลูกค้าในห้องนี้ เพื่อใช้แปลและตอบกลับ"*.
   *
   * ⚠️ It is NOT "the language to translate into". Direction decides that:
   *   · INBOUND (customer → operator) always lands in Thai — the operator has to
   *     read it, and translating a Burmese line into Burmese is what using this
   *     field there would do. See `translate/auto/should-auto-translate.ts`.
   *   · OUTBOUND (operator → customer) DOES use this field: the reply is
   *     translated into the customer's language before it is sent.
   * ขาเข้ากับขาออกใช้คนละค่า · ช่องนี้คือภาษาลูกค้า ใช้ตอนตอบกลับ
   *
   * `null` = not declared here; the parent hook answers instead
   * (`hook.translate_lang`). Room first, hook second, never the reverse.
   *
   * revert: drop `detected_source_lang` and point `rememberDetectedSourceLang`
   * back at this field — which restores the overwrite described below.
   */
  @Prop({ type: String, default: null })
  translate_lang?: string | null;

  /**
   * [FIX-20260918-LANGSPLIT] THE SAME QUESTION, ANSWERED BY THE MODEL instead of
   * by a person: the source language the vendor reported for the last message
   * translated here (`translations[].from`). `null` until a translation runs, or
   * when the model reported nothing — which real rows show happens about a third
   * of the time (`local_db_10_aug_26`: 19 of 28 stored entries carry a `from`).
   *
   * 🔴 WHY IT IS A SECOND FIELD rather than being written into `translate_lang`.
   * Both mean "the customer's language", so the old code writing detection into
   * `translate_lang` was not mixing two concepts — but it did silently replace
   * what a person had DECLARED with what a model GUESSED from one line, on most
   * translations. An operator who set this room to English and then received one
   * Burmese forward found the room switched to Burmese, and every later reply
   * would have gone out in it. Keeping the two apart means the declaration
   * stands, the observation is still available, and a screen can show both.
   * คนตั้งไว้ = ถือว่าตั้งใจ · โมเดลเดาได้ แต่ห้ามทับของที่คนตั้ง
   *
   * Additive and backward-compatible: `null` is what every existing row already
   * means, so nothing is migrated. แถวเก่าอ่านได้ปกติ ไม่ต้อง migrate.
   */
  @Prop({ type: String, default: null })
  detected_source_lang?: string | null;

  /**
   * [FEAT-20260918-ROOMTRANS] Whether to display original message text before/alongside translation.
   * Default false (seamless).
   *
   * ⚠️ READ THIS TOGETHER WITH `show_original_text_source` BELOW. Since 19/09 this
   * boolean is NOT the answer on its own — it is only consulted when the source
   * field says `'room'`. A reader that uses it alone shows the wrong thing for
   * every room that follows the account-wide setting. ใช้ค่านี้เดี่ยว ๆ ไม่ได้แล้ว
   */
  @Prop({ type: Boolean, default: false })
  show_original_text?: boolean;

  /**
   * [FEAT-20260919-SHOWORIGSRC] WHERE the answer above comes from — and the whole
   * reason this is a separate column instead of a third state on the boolean.
   * ===========================================================================
   * Owner, 19/09: *"เพิ่ม flag ใหม่ติดห้อง เก็บ flag ว่าใช้สำหรับห้องนี้ ค่าแบบทุกห้อง
   * หรือใช้ค่าเฉพาะห้อง"* — after we had designed the tri-state and found the trap.
   *
   * ## Why not make `show_original_text` nullable instead
   *
   * The obvious design was `boolean | null`, where `null` meant "follow the
   * account setting". It cannot work, and a live probe is what proved it rather
   * than reasoning: Mongoose 9.9.1 WRITES schema defaults on an upsert-insert,
   * and every room is born through exactly such an upsert
   * (`chat-history.service.ts` `getOrCreateRoom`, `{ upsert: true }`). So every
   * room created after 18/09 already holds a physical `false` that NO operator
   * ever chose. Under a nullable design that `false` is indistinguishable from a
   * deliberate "off", so those rooms would have silently refused to follow the
   * account setting forever — and no query could tell them apart afterwards to
   * repair them. default ที่ Mongoose เขียนให้เอง จะปลอมเป็น "คนตั้งไว้" แยกไม่ออก
   *
   * A separate column has no such history. Absent is absent: not one existing row
   * carries it, so every row in every database reads as `'all_rooms'` on the
   * first deploy, which is precisely the wanted default. **No backfill, on any
   * environment, ever.** เพิ่มคอลัมน์ใหม่ = ไม่ต้องไล่แก้แถวเก่าเลย
   *
   * ## The values
   *
   * - `'all_rooms'` — this room has no opinion; use the OPERATOR'S own account
   *   preference (`chat.show_original_text_all_rooms`). Default, and what every
   *   pre-existing row means.
   * - `'room'` — this room was configured on purpose; use `show_original_text`
   *   above and ignore the account preference.
   *
   * 🔴 `'all_rooms'` IS PER-OPERATOR, NOT PER-OA. The preference it defers to
   * lives on the logged-in user row, so two operators looking at the SAME room
   * can legitimately see different things. That is the owner's design — the
   * setting is "how I want to read", not "how this conversation is". It is also
   * why the effective value is resolved on the dashboard and not here: the
   * backend answering a room query does not know whose screen it is for.
   * ค่านี้เป็นของคนอ่าน ไม่ใช่ของห้อง คนละคนเห็นคนละแบบได้ ถูกต้องแล้ว
   *
   * Naming follows `secret_source` (`handoff-target.schema.ts`) — the repo's
   * existing word for "which side supplies this value" — and deliberately shares
   * the `show_original_text` prefix so one grep finds the pair. A reader added
   * later cannot discover the boolean without also meeting this column.
   *
   * revert: drop this column and this block. Every room then falls back to
   * reading `show_original_text` directly, which is the 18/09 behaviour.
   */
  @Prop({ type: String, enum: ['all_rooms', 'room'], default: 'all_rooms' })
  show_original_text_source?: 'all_rooms' | 'room';

  /**
   * [FEAT-20260918-ROOMTRANS] Does THIS ROOM ask for automatic translation?
   *
   * 🔴 `false` DOES NOT MEAN "muted". Owner's rule, 18/09: either level may
   * switch translation on, so the effective answer is `room OR hook` and a
   * `false` here reads as "this room asks for nothing" — the OA's switch still
   * reaches it. Translation stops only when BOTH are off. The rule and its full
   * table live in `translate/room-translate-settings.ts`; this column is just
   * one of its two inputs. ห้อง false = ไปอ่าน OA ต่อ ไม่ใช่สั่งปิด
   *
   * ⚠️ Default is `false`, not `null` (owner, 18/09: *"ห้องใหม่ ห้องใดๆก็ตามที่ไม่
   * เคยตั้ง = false"*). Under the OR rule the two are indistinguishable, so this
   * costs nothing and removes a third state from every reader: rows written
   * before today still hold `null` and behave identically, because the resolver
   * reads both through `Boolean()`. แถวเก่าที่เป็น null ยังทำงานเหมือนเดิม ไม่ต้อง migrate
   */
  @Prop({ type: Boolean, default: false })
  auto_translate?: boolean | null;

  /**
   * [FEAT-20260918-ROOMTRANS] Whether to automatically translate and send outbound composer replies
   * according to the room's translate_lang. Default false.
   */
  @Prop({ type: Boolean, default: false })
  auto_send_translated?: boolean;
}

export const ChatRoomSchema = SchemaFactory.createForClass(ChatRoom);

// One room per customer per hook, enforced on both the old and the new name.
ChatRoomSchema.index({ line_user_id: 1, hook_id: 1 }, { unique: true });
ChatRoomSchema.index({ user_id: 1, hook_id: 1 }, { unique: true });
// `background` is MongoDB's legacy non-blocking-build flag; modern servers build
// online regardless, but the option is declared to match the deployed index
// exactly so it is never rebuilt.
ChatRoomSchema.index(
  { channel_user_id: 1, hook_id: 1 },
  { unique: true, background: true },
);

// Room list sorted by most recent activity.
ChatRoomSchema.index({ 'last_message.timestamp': -1 });

/**
 * [FIX-20260809-ROOMINDEX] The room-list query's own index.
 *
 * WHAT `listRooms` ACTUALLY DOES: filters on `hook_id` (one id, or `$in` a set
 * of scoped ids) plus `status`, then sorts by `last_message.timestamp` desc.
 * The single-field index above can serve the SORT or a filter, never both — so
 * Mongo filters first and then sorts the matches IN MEMORY. On the busiest
 * dashboard path that in-memory sort grows with the number of rooms an operator
 * can see. index เดิมช่วยได้แค่ตัวเดียว ที่เหลือไป sort ใน memory.
 *
 * FIELD ORDER IS THE WHOLE POINT — equality, then sort:
 *   hook_id  (equality / $in)  →  status (equality)  →  timestamp (sort)
 * Reordering these makes the index unusable for this query: Mongo can only walk
 * the sort field in order once every preceding key is pinned to a value.
 *
 * ⚠️ ADDITIVE, NO BEHAVIOUR CHANGE. An index changes how rows are FOUND, never
 * which rows come back or in what order — the same documents in the same
 * sequence, just without the in-memory sort. Nothing in the response shape
 * moves, which is why this needs no test beyond the existing list tests staying
 * green.
 *
 * ⚠️ DB-EFFECT: builds a new index on `chat_rooms` at boot. On a large
 * collection that build costs time and disk; it is online (non-blocking) on
 * modern servers, but do not treat first boot after deploy as instant.
 * revert: delete this index — the query still works, just sorts in memory.
 */
ChatRoomSchema.index({
  hook_id: 1,
  status: 1,
  'last_message.timestamp': -1,
});

/**
 * Keeps `line_user_id` and `channel_user_id` equal on every write.
 *
 * Legacy declares these on the model (`chatRoomModel.js:109` and `:140`), and
 * this service had the columns and the unique index above without them. See
 * `mirror-field-pair.ts` for why the omission would have dropped every
 * customer after the first on any given hook.
 *
 * `pre('validate')`, not `pre('save')`: `line_user_id` is required, and
 * Mongoose validates before `pre('save')` runs — so a document carrying only
 * `channel_user_id` would fail validation before a save hook could mirror it.
 *
 * [FIX-20260808-DUALWRITE] Phase 3.2. Field pair: line_user_id <->
 * channel_user_id. Why: reads were cut over to channel_user_id; a schema that
 * declares the column but drops this mirror leaves channel_user_id null, so
 * filters on the new name (and its unique index) miss the row. Mirrors legacy
 * `chatRoomModel.js`.
 */
ChatRoomSchema.pre('validate', function (this: Record<string, unknown>) {
  mirrorPair(this, 'line_user_id', 'channel_user_id');
});

ChatRoomSchema.pre(
  ['findOneAndUpdate', 'updateOne', 'updateMany'],
  function (this: MirroringQuery) {
    mirrorUpdatePair(
      this.getQuery(),
      this.getUpdate(),
      Boolean(this.getOptions().upsert),
      'line_user_id',
      'channel_user_id',
    );
  },
);
