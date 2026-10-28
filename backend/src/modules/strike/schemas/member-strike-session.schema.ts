import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

import { legacyTimestamps } from '@/infra/mongo/schema-options';

export type MemberStrikeSessionDocument = HydratedDocument<MemberStrikeSession>;

/** The two states a session can be in. Widening this is a schema decision. */
export const STRIKE_SESSION_STATUS = ['open', 'closed'] as const;
export type StrikeSessionStatus = (typeof STRIKE_SESSION_STATUS)[number];

/**
 * [FEAT-20260824-STRIKESESSION] One counting period for one customer.
 * ===========================================================================
 * 📖 HANDOVER DOC: `docs/strike-session.md` — read that first; it is the operating
 *    manual (what it is, the API, permissions, how to switch it on and off).
 *    Design + measurements: `docs/strike-count-design.md`.
 *
 * Owner, 24/08/2026: track *"strike + level + session + datetime"*, one session
 * that keeps counting until an admin closes it, and *"ประวัติเดิมต้องอยู่"*.
 *
 * WHAT A SESSION IS: an open ledger. Every time the rate ladder blocks this
 * customer once in a window, `strike_total` goes up by one and the level's own
 * counter in `by_level` goes up by one. It never expires and it never resets by
 * itself — an admin closing it (PATCH) is the only way it ends, and closing
 * opens a fresh one with `seq + 1`. The closed one is never touched again.
 *
 * ⚠️ THE SCOPE IS `line_user_id`, DELIBERATELY **NOT** `hook_id`. This looks
 * wrong at first glance — mute (phase 2) feels per-OA — and it is the single
 * most important decision in this file, so read the reason before changing it:
 *
 *   The counter that PRODUCES a strike has no OA in its key:
 *     `ratelimit:<env>:default:<lineUserId>`      infra/rate-limit/rate-limit.service.ts:127
 *     `ratelimit-strike:<env>:<lineUserId>`       webhook/rate-limit/user-rate-ladder.service.ts:121
 *   and `todo/task/23082026/todo14_*.md` §3.1 records that this is intended:
 *   two OAs under one channel provider genuinely share one customer quota.
 *
 *   So if this ledger were split per OA, one customer blocked four times inside
 *   ONE shared window would land 1-1-1-1 across four sessions — depending only
 *   on which OA they happened to type into at that second. Every session would
 *   read "1" while the truth is "4". No error, no exception, just a wrong number
 *   that a future mute rule would silently act on.
 *
 *   The rule this file obeys: **a ledger must be keyed by whatever the real
 *   counter is keyed by**, or it is not recording reality.
 *   `members.line_user_id` is `unique` (chat/schemas/member.schema.ts), so one
 *   value is exactly one member — this IS "per member" as asked.
 *
 *   Per-OA questions are still answerable, because every EVENT carries
 *   `hook_id` (see member-strike-event.schema.ts). Per-OA can be derived from
 *   per-member; per-member can NOT be recovered from per-OA once split, because
 *   each split session would own its own `seq` and its own clear history.
 *
 * ⚠️ NO `muted` / `manual_mute` FIELD. Nothing reads one yet — muting is phase 2.
 * A field nobody reads is dead weight from day one; the same rule
 * `chat/config/member-config.registry.ts` STEP 5 states. Add it with its reader.
 *
 * revert: drop this collection and `src/modules/strike/`. No other collection
 * carries a reference to it, so there is nothing else to clean up.
 */
@Schema({ collection: 'member_strike_sessions', ...legacyTimestamps })
export class MemberStrikeSession {
  /**
   * The scope. Same value the rate limiter keys on (`event.source.userId`), and
   * the same value `members.line_user_id` / `chat_rooms.line_user_id` hold.
   * Stored rather than `member_id` because the webhook has this string in hand
   * with no lookup at all, while the member ObjectId may not be loaded yet.
   */
  @Prop({ type: String, required: true, trim: true })
  line_user_id!: string;

  /**
   * Convenience pointer, filled when the caller happens to know it. NEVER
   * required and never used as a lookup key — `line_user_id` is the identity.
   * No `default: null`: absent is the honest "we did not know at the time",
   * and it keeps the key out of every `toJSON()` (the reasoning
   * `tickets/schemas/first-ticket-stamp.ts:41` settled for `first_ticket_at`).
   */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Member' })
  member_id?: Types.ObjectId;

  /** 1, 2, 3 … per customer. Answers "which session was this". Never reused. */
  @Prop({ type: Number, required: true, min: 1 })
  seq!: number;

  /** `open` = counting right now. Exactly one open row per customer (index below). */
  @Prop({
    type: String,
    required: true,
    enum: STRIKE_SESSION_STATUS,
    default: 'open',
  })
  status!: StrikeSessionStatus;

  /** How many times this customer was blocked during this session. */
  @Prop({ type: Number, required: true, default: 0, min: 0 })
  strike_total!: number;

  /**
   * Per-level tally, e.g. `{ '1': 3, '2': 2, '4': 1 }` — so "แต่ละ level กี่ครั้ง"
   * is answered by the session document alone, with no aggregation over events.
   *
   * ⚠️ `Mixed` on purpose, not a fixed 1-4 sub-schema: the ladder's ceiling is a
   * code constant (`user-rate-ladder.ts` `levels`) that has already been edited
   * twice, and a fixed sub-schema would silently drop a level 5 the day someone
   * adds a rung. Mixed does not track in-place mutation, which costs nothing
   * here because this field is ONLY ever written by an atomic `$inc` — never by
   * `doc.save()`. Keep it that way.
   */
  @Prop({
    type: MongooseSchema.Types.Mixed,
    required: true,
    default: () => ({}),
  })
  by_level!: Record<string, number>;

  /**
   * First and last strike of this session.
   *
   * ⚠️ NEITHER HAS A DEFAULT, and `first_strike_at` being ABSENT is load-bearing:
   * `record()` sets it with `$min`, which sets a missing field but would keep an
   * existing `null` for ever (null sorts below dates in BSON). A `default: null`
   * here would therefore freeze the first-strike time at null on every session.
   * ห้ามใส่ default ให้สองตัวนี้ — `$min` จะพัง
   */
  @Prop({ type: Date })
  first_strike_at?: Date;

  @Prop({ type: Date })
  last_strike_at?: Date;

  @Prop({ type: Date, required: true, default: () => new Date() })
  opened_at!: Date;

  /* ── set together, once, when an admin closes the session ─────────────────
     All three stay absent while the session is open. They are written in the
     same atomic `$set` as `status: 'closed'`, so a closed session without a
     closer is impossible. */
  @Prop({ type: Date })
  closed_at?: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  closed_by?: Types.ObjectId;

  @Prop({ type: String, trim: true })
  closed_reason?: string;

  /**
   * [FEAT-20260826-STRIKESUSPEND] When the webhook stopped answering this
   * customer. Absent = it still answers.
   * 📖 PLAN: `todo/task/26082026/todo10_26082026_strike-suspend.md`
   *
   * A LATCH, NOT A DERIVED FLAG. It is set once, by the gate, the moment the
   * customer's strikes inside the configured window reach the threshold; after
   * that nothing recounts and nothing expires it. Only an admin closing the
   * session ends it — and that costs no extra code, because closing opens a
   * fresh session with `seq + 1` and a fresh session has no `suspended_at`.
   * เคลียร์ session = ปลดล็อกให้เอง ไม่ต้องเขียนตัวปลดแยก และไม่มีทางลืมปลดข้างใดข้างหนึ่ง
   *
   * ⚠️ WHY THIS DOES NOT BREAK THE RULE THIS FILE'S SIBLING STATES
   * (`member-strike-event.schema.ts`: a stored copy must be a value that can
   * never change). A value computed from a rolling window and then STORED would
   * drift — the window moves on its own and nobody is running to clear the flag.
   * This one cannot: it has one writer (the gate, on the transition) and one
   * clearer (the admin, via PATCH), and nothing else touches it. It is a
   * recorded event, not a cached calculation.
   *
   * ⚠️ A DATE, NOT A BOOLEAN, on purpose: a boolean cannot answer "since when",
   * which is the question an admin looking at a locked customer actually asks.
   * Presence alone still answers "is it on".
   *
   * revert: drop this field and the gate. Rows still holding a value are read by
   * nobody, so there is nothing to migrate in either direction.
   */
  @Prop({ type: Date })
  suspended_at?: Date;

  /* ── [FEAT-20260827-ADMINBLOCK] who minted the latch, when it was an admin ──
     📖 PLAN: `todo/task/27082026/todo8_27082026_admin-block-suspend.md`

     The latch above has TWO writers now: the gate (strike ceiling) and the
     admin block button ("Block จำกัดการคุย"). These two fields are written by
     the ADMIN PATH ONLY — the gate never touches them — so their PRESENCE is
     what says "an admin ordered this" and their absence says "the strikes did".
     No enum, no second flag, nothing derived: the same closed_by/closed_reason
     shape this schema already uses for the other admin action.
     มี suspended_by = แอดมินสั่ง · ไม่มี = ชนเพดาน strike จริง

     ⚠️ NO DEFAULTS, deliberately: absent-on-legacy is the project's additive
     rule (dev-local §3), every existing row keeps working untouched, and the
     release path costs nothing extra — closeSession opens a fresh session that
     carries none of the three fields, exactly as it already released the gate's
     latch. Nothing may ever BRANCH on these two; they are display + audit.

     revert: drop both props with the suspend route. Rows already holding
     values are read by nobody and stay valid. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  suspended_by?: Types.ObjectId;

  @Prop({ type: String, trim: true })
  suspended_reason?: string;
}

export const MemberStrikeSessionSchema =
  SchemaFactory.createForClass(MemberStrikeSession);

/**
 * THE INVARIANT, ENFORCED BY THE DATABASE: one open session per customer.
 *
 * Partial, so it only holds rows that are open — a customer with fifty closed
 * sessions contributes one key, or none. Two concurrent first-strikes therefore
 * cannot create two ledgers: the loser gets E11000 and `record()` re-reads the
 * winner (see strike.service.ts `ensureOpenSession`).
 *
 * ⚠️ This index is also why PATCH must close before it opens. Reversing those
 * two writes makes the insert collide with the row it is replacing.
 */
MemberStrikeSessionSchema.index(
  { line_user_id: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'open' },
    background: true,
  },
);

/** "Who is being blocked the most right now" — index-ordered, no in-memory sort. */
MemberStrikeSessionSchema.index(
  { status: 1, strike_total: -1 },
  { background: true },
);

/**
 * [FEAT-20260826-STRIKESUSPEND] "who is locked out right now", newest first.
 *
 * PARTIAL on purpose — it indexes ONLY the rows that carry `suspended_at`, so a
 * database full of customers who were never locked contributes nothing to it.
 * Measured on a throwaway 400,000-session collection (26/08): the same query
 * without this index is a COLLSCAN over every row, 123 ms; with it, 50 rows and
 * 1 ms. The index itself is 124 KB against 3.6 MB for the unique one above —
 * thirty times smaller, because it holds the 10% that are locked and none of the
 * rest. It therefore costs the write path nothing for the ordinary customer,
 * whose row never enters it.
 *
 * ⚠️ It exists because the header tray READS it. An index nobody reads is the
 * same dead weight as a field nobody reads (`member-config.registry.ts` STEP 5).
 * Drop it together with that screen. index ที่ไม่มีคนอ่าน = ขยะ เท่ากับ field ที่ไม่มีคนอ่าน
 */
MemberStrikeSessionSchema.index(
  { suspended_at: -1 },
  {
    partialFilterExpression: { suspended_at: { $exists: true } },
    background: true,
  },
);

/** One customer's sessions, newest first. Also serves the next-`seq` lookup. */
MemberStrikeSessionSchema.index(
  { line_user_id: 1, seq: -1 },
  { background: true },
);
