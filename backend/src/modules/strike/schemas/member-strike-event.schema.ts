import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

import { legacyTimestamps } from '@/infra/mongo/schema-options';

export type MemberStrikeEventDocument = HydratedDocument<MemberStrikeEvent>;

/**
 * [FEAT-20260824-STRIKESESSION] One strike. Append-only, never edited, never
 * 📖 HANDOVER DOC: `docs/strike-session.md` — read that first; it is the operating
 *    manual (what it is, the API, permissions, how to switch it on and off).
 *    Design + measurements: `docs/strike-count-design.md`.
 *
 * deleted — not even when an admin clears the session it belongs to.
 * ===========================================================================
 * Owner, 24/08/2026: *"เคลียร์แล้วให้เริ่มนับใหม่ แต่ประวัติเดิมต้องอยู่"*.
 * Clearing closes the SESSION; these rows are what "ประวัติ" means, so no code
 * path in this module removes one.
 *
 * ONE ROW PER STRIKE, NOT PER MESSAGE. The ladder already collapses a burst:
 * `strikeAdded` is true only on the first request past the limit in a window
 * (`webhook/rate-limit/user-rate-ladder.service.ts:139`), so 200 flooded
 * messages produce exactly one row here.
 *
 * WHY THIS IS A COLLECTION AND NOT AN ARRAY ON THE SESSION: it grows without a
 * ceiling, which is MongoDB's documented unbounded-array anti-pattern and the
 * same rule `chat/config/member-config.registry.ts:11-19` already states for
 * this codebase. Measured at 1,000,000 rows: 173-225 B each, and every query
 * below stays indexed.
 *
 * WHY IT DENORMALISES `hook_id` AND `line_user_id` INSTEAD OF JOINING — measured
 * on a throwaway 1,000,000-row collection (24/08/2026, this machine):
 *
 *   insight "one OA, 7 days, per level"
 *     hook_id stored on the event                    502 ms
 *     $lookup event -> session, then filter       17,351 ms     ← 35x slower
 *   one customer's whole history, newest 50
 *     line_user_id stored on the event               0.7 ms
 *     find sessions first, then $in on session_id   19.0 ms     ← 27x slower
 *
 * The +93 B per row that buys this is the cheapest trade in the design. Every
 * denormalised value here is a value that CANNOT CHANGE ONCE WRITTEN, so there
 * is nothing that can drift and no sync job to own.
 * ค่าที่ copy มาต้องเป็นค่าที่ไม่มีวันเปลี่ยน
 *
 * ⚠️ 26/08: that sentence used to read "IMMUTABLE (an id, a level, an instant)",
 * which stopped being the whole truth when `hook_alias` was added. The rule did
 * not change — the wording was too narrow. What matters is that a copied value
 * is FROZEN AT THE MOMENT IT IS WRITTEN, not that its source can never move:
 * `limit` and `window_seconds` have always been editable at the source and are
 * stored precisely so a later edit cannot rewrite the past. `hook_alias` is the
 * same kind of value. A value that must track its source instead of freezing
 * still has no place here. ค่าที่ต้องวิ่งตามต้นทาง ยังห้ามอยู่เหมือนเดิม
 *
 * ⚠️ NO `room_id`, deliberately. It is derivable for free — `chat_rooms` has a
 * unique index on exactly `{ line_user_id, hook_id }` (chat-room.schema.ts:103),
 * the two fields already here. Storing it would also dangle: `cli/purge-old-records.ts`
 * deletes chat rooms while this history is kept for ever, and the room may not
 * even exist yet when the strike fires (rooms are created on the message-save
 * path in `chat/chat.service.ts`, while the webhook only READS one — through
 * `chatRoomModel`, which it hands to its gates — and accepts `null` everywhere).
 *
 * ⚠️ This sentence used to cite `webhook/webhook.service.ts:1418`. That anchor was
 * ALREADY WRONG before the spine reduction program started — line 1418 has been the
 * Redis lock timeout, not a room read, for as long as this file's git history goes back.
 * It is replaced with a named anchor rather than re-pointed, because a `:NNNN` into a
 * 3,500-line file rots the next time anyone edits above it, and a rotted anchor sends
 * the reader somewhere confident and wrong. Same rule as `z-test/fixtures/gate-anchors.json`.
 * อ้างชื่อ อย่าอ้างเลขบรรทัด
 *
 * revert: drop this collection together with the session one.
 */
@Schema({ collection: 'member_strike_events', ...legacyTimestamps })
export class MemberStrikeEvent {
  /** The session this strike was counted into. Never re-pointed. */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: false })
  session_id!: Types.ObjectId;

  /**
   * Which OA the message that earned the strike came through.
   *
   * ⚠️ This is the ONLY place the OA is recorded — the session is per customer,
   * not per OA, on purpose (see member-strike-session.schema.ts). Every per-OA
   * question in the system is answered from here.
   */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Hook', required: true })
  hook_id!: Types.ObjectId;

  /** Denormalised so one customer's whole history needs no join. See header. */
  @Prop({ type: String, required: true, trim: true })
  line_user_id!: string;

  /** Filled only when the caller knew it. Not a lookup key. No default. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Member' })
  member_id?: Types.ObjectId;

  /** The ladder level in force when this strike happened (1 = the base rung). */
  @Prop({ type: Number, required: true, min: 1 })
  level!: number;

  /**
   * The numbers that were actually applied, frozen at the moment it happened.
   *
   * Stored rather than recomputed because the ladder's constants are edited by
   * hand and have already changed twice (`user-rate-ladder.ts` — level 4 went
   * x4 -> x6 and the reset went 12 h -> 2 h on 23/08). Without these two fields
   * a later edit would silently rewrite the meaning of every past row.
   * ประวัติต้องอ่านได้ด้วยกติกาของวันที่มันเกิด ไม่ใช่กติกาวันนี้
   */
  @Prop({ type: Number, required: true, min: 1 })
  limit!: number;

  @Prop({ type: Number, required: true, min: 1 })
  window_seconds!: number;

  /**
   * LINE message type that tripped it (text / image / sticker / video / audio /
   * file). Kept because the owner's 23/08 decision at
   * `webhook.service.ts:3143` [OWNER-20260823-ASSISTFLOOD] turns on exactly this
   * distinction — stickers stay charged while an admin holds the room, text does
   * not — and without this column that behaviour can never be reviewed against
   * real traffic.
   */
  @Prop({ type: String, trim: true })
  message_type?: string;

  /**
   * [FEAT-20260826-STRIKESUSPEND] What that OA was CALLED when this strike
   * happened. Optional — rows written before 26/08 do not carry it.
   * 📖 PLAN: `todo/task/26082026/todo10_26082026_strike-suspend.md`
   *
   * 🔴 FOR READING ONLY. It exists so the header tray can print which OA a
   * locked customer was talking to without a join. **Nothing may branch on it.**
   * It is display text, and display text is renamed by admins; `hook_id` above
   * is the identity and is what any rule must key on.
   * alias = ให้ตาคนอ่าน · hook_id = ให้เครื่องตัดสิน
   *
   * WHY A COPY IS SAFE HERE, given this file's own rule that a denormalised
   * value must never change: this is a SNAPSHOT, exactly like `limit` and
   * `window_seconds` below it. Those are also editable at the source, and are
   * frozen for the same reason — a history has to be readable under the rules of
   * the day it happened. An admin renaming the OA tomorrow does not rewrite what
   * this strike arrived through today.
   *
   * ⚠️ AND IT BARELY MATTERS IN PRACTICE, which is why no fallback job exists:
   * a session is short — it lasts until an admin clears it, and clearing starts
   * a fresh one that will record whatever the OA is called then.
   * เคลียร์แล้วเริ่มใหม่พร้อมชื่อใหม่อยู่ดี
   *
   * revert: drop this field. `hook_id` still answers the same question through a
   * join, which is what the code did before this existed.
   */
  @Prop({ type: String, trim: true })
  hook_alias?: string;

  /** When it happened. Separate from `created_at`, which is when we wrote it. */
  @Prop({ type: Date, required: true })
  occurred_at!: Date;
}

export const MemberStrikeEventSchema =
  SchemaFactory.createForClass(MemberStrikeEvent);

/** One session's timeline, newest first. Measured 0.6 ms at 1,000,000 rows. */
MemberStrikeEventSchema.index(
  { session_id: 1, occurred_at: -1 },
  { background: true },
);

/**
 * "Which OAs contributed to this session" — the query that makes a per-OA view
 * possible even though the session itself is per customer. Cheap because it is
 * bounded by the number of hooks the customer's channel has.
 */
MemberStrikeEventSchema.index(
  { session_id: 1, hook_id: 1 },
  { background: true },
);

/** Insight over a date range for one OA. Measured 502 ms at 1,000,000 rows. */
MemberStrikeEventSchema.index(
  { hook_id: 1, occurred_at: -1 },
  { background: true },
);

/** One customer's whole history across every session. Measured 0.7 ms at 1M. */
MemberStrikeEventSchema.index(
  { line_user_id: 1, occurred_at: -1 },
  { background: true },
);
