import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

import { legacyTimestamps } from '@/infra/mongo/schema-options';

export type BroadcastHistoryDocument = HydratedDocument<BroadcastHistory>;

/**
 * [FEAT-20260822-BCASTHISTORY] What a broadcast run actually did.
 * ===========================================================================
 * ONE ROW = ONE OA, WITHIN ONE RUN. A job sent to five OAs writes five rows
 * that share a `run_id`.
 *
 * 🔴 NO TTL, ON PURPOSE. `webhook_logs` expires (30-45 days) because it is
 * request noise; "which campaign reached whom, when, and who ordered it" is
 * EVIDENCE, and this repo already draws that line for itself —
 * `webhook-log.schema.ts:227-229` says `hook_audit_logs` is deliberately left
 * without a TTL for exactly this reason, and `assign_histories`, `tickets` and
 * `chat_messages` are all in the same group.
 * ⚠️ Do not "tidy" a TTL onto this collection because its neighbours have one.
 *    ห้ามใส่ TTL — เป็นหลักฐาน ไม่ใช่ log.
 *
 * 🔴 NO RECIPIENT IDS. The counts live here; the id LISTS do not, and turning
 * them on is a separate decision with its own switches
 * (`broadcast-history/recipient-ledger.ts`). 100,000 ids is 4-6 MB, and a
 * document that grows without a ceiling is what this repo's own rule keeps out
 * of a row (`chat/config/member-config.registry.ts:10-18`).
 *
 * 🔑 IT IS ALSO THE MEMORY OF TWO GUARDS. `abuse-guard` asks "how many runs in
 * the last hour" and `global-quota` asks "how many recipients today"; both read
 * this collection. That is why `started_at` is indexed on its own — see
 * `broadcast-history/usage-queries.ts`.
 *
 * revert: drop the collection and delete this file. Nothing else reads it.
 */
@Schema({ collection: 'broadcasts_histories', ...legacyTimestamps })
export class BroadcastHistory {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Broadcast',
    required: true,
  })
  broadcast_id!: Types.ObjectId;

  /**
   * One press of send = one `run_id`, shared by every OA of that run.
   *
   * ⚠️ Also the first component of each chunk's `X-Line-Retry-Key`, so it must
   * be stable for the whole run and never reused by another.
   */
  @Prop({ type: String, required: true })
  run_id!: string;

  /**
   * Snapshots taken at send time.
   *
   * The job or the OA may be renamed or deleted later; a history row that then
   * reads "unknown" answers nothing.
   *
   * ⚠️ NOT RELATED TO `assign_histories`. That collection is the append-only
   * record of ticket/room ASSIGNMENT changes and belongs to `chat/` — a
   * different feature entirely. It only ever appears near this one because a
   * search for "history" finds both. อย่าเอาไปปนกับงาน ticket.
   */
  @Prop({ type: String })
  broadcast_name?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Hook' })
  hook_id?: Types.ObjectId;

  @Prop({ type: String })
  hook_alias?: string;

  /** `broadcast` or `multicast` — which LINE endpoint this row's send used. */
  @Prop({ type: String })
  send_kind?: string;

  /** `plain` or `personal` — the type the admin ticked. */
  @Prop({ type: String })
  card_type?: string;

  /* ── counts: "ทำไปเท่าไหร่" ─────────────────────────────────────────────
   * Every one is incremented as the run goes, never measured from an array —
   * recipients are streamed, so nothing ever holds the full list.
   * ───────────────────────────────────────────────────────────────────── */

  /** Selected by the audience rules, before de-duplication. */
  @Prop({ type: Number, default: 0 })
  matched!: number;

  /** What we actually aimed at, after blanks and duplicates were dropped. */
  @Prop({ type: Number, default: 0 })
  targeted!: number;

  /**
   * [FEAT-20260907-BCASTUNUSEDRULES] `targeted` above does NOT describe the
   * reach of this row.
   *
   * 🔴 WRITTEN ONLY ON A `send_kind: 'broadcast'` ROUND WHOSE JOB CARRIED
   *    AUDIENCE CONDITIONS. `/message/broadcast` takes no recipient list, so
   *    LINE delivered to every follower of the channel — while `targeted` above
   *    counted the people the CONDITIONS selected. Without this flag the row
   *    reads as a narrow send and nothing contradicts it.
   *
   * ⚠️ `matched` is NOT the field to look at, on this path or any other: it is
   *    0 on every per-OA row ever written, because `countersForOa`
   *    (`broadcast-history/run-counters.ts:207-219`) never sets it. Recorded
   *    here so the next reader does not chase the wrong column.
   *    (Measured 06/09 with the push counter: a rule selecting 2 people on a
   *    broadcast job consumed push for 3 — everyone. See
   *    `broadcast-send/audience-on-broadcast.policy.ts`.)
   *
   * ⚠️ ABSENT, NEVER `false`. No `default`, and the writer omits the key
   *    entirely unless it is true (`broadcast-history/history-row.ts`), so:
   *    every row written before 07/09 is untouched, every ordinary round is
   *    byte-identical to what it was, and no migration or backfill exists or is
   *    needed. Absent means "not this case" — it does not mean "not recorded",
   *    because the flag is derived at write time from values the row already
   *    has. A key may be added; existing rows and ordinary rounds must stay
   *    byte-identical.
   *
   * ⚠️ Reading it is optional by construction — every existing reader
   *    (`broadcast-history/history-read.ts`, the dashboard's run detail) never
   *    asks for it and keeps working unchanged.
   *
   * revert: set `FLAG_UNUSED_RULES_ON_BROADCAST` to `false` in the policy file —
   * nothing further is written. Rows already carrying it stay as they are; the
   * field is additive, so leaving them is safe.
   */
  @Prop({ type: Boolean })
  audience_rules_ignored?: boolean;

  @Prop({ type: Number, default: 0 })
  sent!: number;

  @Prop({ type: Number, default: 0 })
  failed!: number;

  /** Targeted but never attempted — stopped early, refused, chunk skipped. */
  @Prop({ type: Number, default: 0 })
  unsent!: number;

  @Prop({ type: Number, default: 0 })
  requests_planned!: number;

  @Prop({ type: Number, default: 0 })
  requests_made!: number;

  @Prop({ type: Number, default: 0 })
  chunks_planned!: number;

  @Prop({ type: Number, default: 0 })
  chunks_done!: number;

  /**
   * Image URLs swapped for the fallback.
   *
   * 🔴 NO DEFAULT, and that is the whole point. `history-row.ts` deliberately
   * OMITS this field when nothing looked at the pictures — a preview renders
   * nothing, so it measured nothing — and `default: 0` silently filled the gap
   * back in. Every dry-run row and every `broadcast`-pipe row would have read
   * as "every picture was fine", which is exactly the lie the omission exists
   * to prevent. An audit measured it through a real Mongoose model.
   *
   * ⇒ **absent = nobody looked · 0 = looked, none broken**
   * ⇒ a reader MUST treat `undefined` and `0` as different answers.
   * ไม่มี field = ไม่ได้วัด · เป็น 0 = วัดแล้วไม่มีปัญหา — default ทำลายความต่างนี้.
   */
  @Prop({ type: Number })
  images_replaced?: number;

  /**
   * [FEAT-20260823-BCASTHISTTAGS] Tags this run could not fill — they rendered
   * `N/A` and a customer saw that.
   *
   * Approved by the owner 23/08. Before it, the render counted them and threw
   * them away: `preview` could show them BEFORE a send and nothing could show
   * them after, so "what went out wrong last Tuesday" was unanswerable.
   * นับแล้วทิ้ง ⇒ ย้อนดูไม่ได้เลย.
   *
   * 🔴 SAME ABSENT-vs-EMPTY RULE AS `images_replaced` DIRECTLY ABOVE, and for
   *    the same reason:
   *      · **absent** = this run rendered nothing, so nothing was measured
   *      · **`[]`**   = it rendered, and every tag resolved
   *    `default: []` would erase that difference AND write an array into every
   *    existing document on its first save. ไม่มี field ≠ อาเรย์ว่าง.
   *
   * ⚠️ TAG NAMES ONLY — never a value, never a recipient id. A tag name is
   *    configuration the admin typed; what it resolved to for one person is
   *    that person's data, and `recipient-ledger.ts` is the rule that keeps
   *    such things out of a history row. เก็บชื่อ tag ไม่เก็บค่า.
   *
   * revert: delete this `@Prop`. Rows carrying it become an orphan column and
   * the preview stays the only place tags are reported — where it was before.
   */
  @Prop({ type: [String] })
  unknown_tags?: string[];

  /* ── outcome: "ครบไหม" ──────────────────────────────────────────────── */

  /**
   * DERIVED from the counts by `summarizeRun`, never typed by hand.
   *
   * ⚠️ `refused` (never started) is a different fact from `matched: 0` (nobody
   * qualified), and `stopped` is different again. Collapsing them would make a
   * row unreadable months later.
   */
  @Prop({
    type: String,
    enum: ['success', 'partial', 'error', 'refused', 'stopped'],
  })
  status?: string;

  /** Why a run stopped or was refused — the guard's own reason string. */
  @Prop({ type: String })
  stop_reason?: string;

  @Prop({ type: String })
  error_message?: string;

  /* ── who, when, and how stale the data was ──────────────────────────── */

  @Prop({ type: String, enum: ['manual', 'scheduler'] })
  triggered_by?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  triggered_by_user?: Types.ObjectId;

  @Prop({ type: String })
  triggered_by_name?: string;

  @Prop({ type: Date })
  started_at?: Date;

  @Prop({ type: Date })
  finished_at?: Date;

  /**
   * Age in days of the site-rules blob this run rendered with.
   *
   * The owner's rule is "เก่าก็เอา" — stale data is still sent — so this is
   * recorded rather than enforced. Without it, "why did the card say the old
   * minimum deposit" has no answer. บันทึกอายุ ไม่ได้ห้ามส่ง.
   */
  @Prop({ type: Number })
  site_rules_age_days?: number;

  /* ── resume: where this row's OA got to ─────────────────────────────── */

  /**
   * `_id` of the last member in the last COMPLETED chunk.
   *
   * 🔑 This is what makes a restart safe without storing the audience: the run
   * carries on from `_id > resume_after_id`. It replaces the recipient snapshot
   * the plan originally proposed (D52) — see `broadcast-send/resume.ts`.
   * ⚠️ Written ONLY after a chunk is accepted. Advancing it on a failure would
   *    step the cursor over 500 people who never come back.
   */
  @Prop({ type: String })
  resume_after_id?: string;

  @Prop({ type: Number, default: 0 })
  next_chunk_index!: number;

  /**
   * Which recipient id lists were captured for this row, if any.
   *
   * Stored so a reader can tell "we did not record them" from "there were
   * none". All false unless a switch in `recipient-ledger.ts` is turned on.
   */
  @Prop({ type: MongooseSchema.Types.Mixed })
  recipients_captured?: Record<string, boolean>;

  /**
   * [FEAT-20260824-RUNSNAPSHOT] What the campaign was SET TO when this round ran.
   *
   * Owner, 24/08: *"ประวัติต้องบอกว่า board หรือ multi พร้อมบอก job detail ที่รัน
   * เงื่อนไขทั้งหมด ว่าตอนนั้น job ตั้งอะไรไว้"*.
   *
   * 🔴 COPIED, NEVER JOINED. A campaign can be edited at any time, so resolving
   *    its settings when the history is READ would show today's rules beside a
   *    run from last week — the history would silently start lying the moment
   *    anybody touched the job. A run record has to freeze what was true then.
   *    job แก้ได้ตลอด ⇒ join ตอนอ่าน = ประวัติโกหกทันทีที่มีคนแก้ job.
   *
   * ⚠️ `Mixed` and NO `default`. The shape it holds — `target.rules`,
   *    `schedule`, `flex_id`, `hook_ids` — is exactly the shape those fields
   *    have on `broadcasts`, and pinning a sub-schema here would mean editing
   *    two files every time one of them grows. A `default` would also stamp an
   *    empty object onto every historic row on its first save, making "never
   *    captured" indistinguishable from "captured nothing".
   *    absent = รอบนี้บันทึกก่อนมีฟีเจอร์ · {} = บันทึกแล้วแต่ job ไม่ได้ตั้งอะไร.
   *
   * ⚠️ READ-ONLY. Nothing decides anything from this — the run already happened.
   *    It exists so a person can answer "why did this round reach these people".
   *
   * revert: drop this field and the one line that writes it. Rows that hold one
   * keep a plain object nothing reads.
   */
  @Prop({ type: MongooseSchema.Types.Mixed })
  settings_snapshot?: Record<string, unknown>;
}

export const BroadcastHistorySchema =
  SchemaFactory.createForClass(BroadcastHistory);

/** Open one job and read its history, newest first. */
BroadcastHistorySchema.index({ broadcast_id: 1, started_at: -1 });

/**
 * The whole-system view, and the memory both guards read.
 *
 * `abuse-guard` counts runs in the last hour and `global-quota` sums recipients
 * over an hour and a day; both are range queries on this key alone.
 */
BroadcastHistorySchema.index({ started_at: -1 });

/** Gather every OA of one press of send. */
BroadcastHistorySchema.index({ run_id: 1 });

/** Per-OA history. */
BroadcastHistorySchema.index({ hook_id: 1, started_at: -1 });

/**
 * Per-user rate accounting for `abuse-guard`.
 *
 * ⚠️ The fifth index, one beyond the four the plan first listed: counting "runs
 * by THIS user in the last hour" on `{started_at}` alone would scan every run
 * by everybody. Named here rather than added quietly. index ที่ห้า ต้องบอก.
 */
BroadcastHistorySchema.index({ triggered_by_user: 1, started_at: -1 });

/**
 * [FEAT-20260825-BCASTREPORTIDX] The two report shapes the five above cannot
 * serve, added for the statistics screens the owner is building.
 *
 * Owner, 25/08: *"ต้องคิวรี่สถิติ ออกแบบทุกบที่ จะทำรายงาน + best practice
 * ห้ามกระทบมั่ว / ห้ามสร้างหนี้"* — and, asked directly about retention:
 * **NO TTL on this collection.** Run history is the raw material for those
 * reports, so it is kept. `webhook_logs` already expires at 45 days
 * (`created_at_ttl45`, `system/webhook-log-ttl.ts`); this collection does not,
 * and that is a decision, not an omission. เก็บยาวไว้ทำรายงาน ไม่ใส่ TTL.
 *
 * ⚠️ EQUALITY FIRST, RANGE LAST — the compound rule. `started_at` is the sort
 * and the range in every report ("this month", "last 7 days"), so it comes
 * second; putting it first would make the equality term useless.
 *
 * ⚠️ ADDITIVE ONLY. No field is added, renamed or removed, nothing is written
 * differently, and every existing query keeps the index it already used —
 * Mongo picks per query. Dropping these two later changes no behaviour, only
 * speed. เพิ่มอย่างเดียว ถอดออกก็ไม่กระทบพฤติกรรม.
 *
 * ⚠️ `background: true` is NOT set because Mongo ≥4.2 builds every index the
 * hybrid way; passing it is a no-op that reads as a promise it does not make.
 *
 * revert: delete these two `index()` calls, then
 *   db.broadcasts_histories.dropIndex("<name>") on each deployed database.
 */

/* "How did the sends go this period, and which failures?" — the report that
   opens every review. Without this, filtering by outcome scans the period. */
BroadcastHistorySchema.index({ status: 1, started_at: -1 });

/* "multicast vs broadcast, and which card type, over time" — the comparison
   the owner asked for by name. `send_kind` leads because a report always fixes
   it first and then asks about the card. เลือกวิธีส่งก่อน แล้วค่อยถามชนิดการ์ด. */
BroadcastHistorySchema.index({ send_kind: 1, card_type: 1, started_at: -1 });
