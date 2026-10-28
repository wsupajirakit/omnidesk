import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  HydratedDocument,
  model,
  Schema as MongooseSchema,
  Types,
} from 'mongoose';

import { legacyTimestamps } from '@/infra/mongo/schema-options';
import { type MirroringQuery } from '@/modules/chat';

/* [FEAT-20260820-FIRSTTICKET] the stamp rule lives beside this file so it can be
   tested without mongoose and deleted without touching the schema's own logic. */
import { stampFirstTicketAt } from './first-ticket-stamp';

export type TicketDocument = HydratedDocument<Ticket>;

/**
 * A support request raised from a chat message.
 *
 * Two field pairs exist because a channel-neutral rename is in progress:
 * `line_oa_hook_id`/`hook_id` and `line_user_id`/`chat_user_id`. The legacy
 * backend dual-writes both names on every save so reads can be cut over with no
 * data gap; both are kept here because documents exist carrying either one.
 *
 * The legacy model implements that mirroring in `pre('save')` and
 * `pre('findOneAndUpdate')` hooks, plus a hook that stamps `channel_type` from
 * the parent Hook. Those hooks are ported below (see [FIX-20260808-DUALWRITE]) —
 * declaring the columns without the mirror leaves the new name null, and reads
 * that were cut over to it miss the row.
 */
@Schema({ collection: 'tickets', ...legacyTimestamps })
export class Ticket {
  /** Legacy name for the owning channel account. Superseded by `hook_id`. */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Hook',
    default: null,
    index: true,
  })
  line_oa_hook_id?: Types.ObjectId | null;

  /** Channel-neutral name; dual-written with `line_oa_hook_id`. */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Hook',
    default: null,
    index: true,
  })
  hook_id?: Types.ObjectId | null;

  /**
   * Denormalised from the parent hook, which is the source of truth.
   *
   * ⭐ THIS FIELD IS THE CHANNEL WRAPPER, and it is what makes the misleading
   * `line_*` names below harmless. Which messaging channel a ticket belongs to
   * is answered HERE and nowhere else — never by reading a field name. The
   * value is stamped in `pre('save')` from `hooks.channel_type` (allowed:
   * `line`, `facebook`), so an OA created as facebook produces facebook
   * tickets with no code change anywhere. ช่องทางอ่านจากคอลัมน์นี้เท่านั้น
   * ห้ามเดาจากชื่อฟิลด์.
   *
   * WHAT THE `line_*` NAMES ACTUALLY MEAN — none of them is LINE-specific:
   *   `line_user_id`    = the member's `_id` (see the 🔴 note below) — mirrored
   *                       with `chat_user_id`, which is the honest name
   *   `line_oa_hook_id` = the hook `_id` — mirrored with `hook_id`
   * Both pairs are kept in sync by `mirrorTicketRefFields` in BOTH directions,
   * so a writer may use either name and a reader may trust either one. Measured
   * 29/08/2026 on the full collection: 0 rows missing a side, 0 rows disagreeing.
   * ⇒ dropping a legacy name later needs no migration and no backfill; it is
   * blocked only on the FE call sites that still send it, not on the data.
   * ชื่อเก่าเหลือไว้เพราะ FE ยังเรียก ไม่ใช่เพราะข้อมูลไม่พร้อม.
   */
  @Prop({ type: String, default: 'line' })
  channel_type!: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'ChatMessage',
    default: null,
    index: true,
  })
  chat_msg_id?: Types.ObjectId | null;

  /**
   * Legacy name for the customer. Superseded by `chat_user_id`.
   *
   * 🔴 THE NAME LIES — this is the member's `_id`, NEVER a LINE id, despite
   * `chat_rooms.line_user_id` / `members.line_user_id` (same name!) holding the
   * LINE "Uxxx…" string. Four call sites have been burned by assuming
   * otherwise: ticket-divider.helper.ts:163, ticket-category-upgrade.helper.ts:157,
   * payment-ticket.helper.ts:381, and the close-case member fallback (27/08).
   * Matching a ticket on a LINE id finds nothing, SILENTLY. Resolve the member
   * first and match on the ObjectId — and the list filter now 400s on a
   * non-ObjectId instead of silently dropping itself ([FIX-20260827-TKTMEMBERPARAM]).
   * 📖 todo/task/27082026/todo1_27082026_tickets-line-user-id-fix.md
   * ชื่อเดียวกัน คนละความหมายแล้วแต่ collection — ที่นี่คือ member _id เสมอ
   */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Member',
    default: null,
    index: true,
  })
  line_user_id?: Types.ObjectId | null;

  /** Channel-neutral name; dual-written with `line_user_id`. */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Member',
    default: null,
    index: true,
  })
  chat_user_id?: Types.ObjectId | null;

  /**
   * [NOTE-20260815-TICKETCATEGORY] ONLY TWO VALUES ARE IN USE: `'Payment'` and
   * `'Other'`. Owner-stated 15/08/2026 — nothing else is used.
   *
   * Verified against the live database on that date, not assumed:
   *     Other    120 tickets
   *     Payment   18 tickets
   * No other value exists in any row.
   *
   * WHO WRITES THEM
   *   · `'Payment'` — `payment-ticket.helper.ts:212` (the payment runner's own
   *     ticket), and `assist-notification.ts:547` when a payment flex is
   *     detected, where the category is deliberately LOCKED so the AI cannot
   *     override it.
   *   · `'Other'`   — `assist-notification.ts:547/648/706`, i.e. everything else,
   *     including a flex error with no prior customer message.
   *
   * ⚠️ THE TYPE IS A BARE STRING WITH NO ENUM, ON PURPOSE-BY-ACCIDENT: Mongoose
   * will store whatever it is handed. `assist-summary.provider.ts:64` still
   * documents a THIRD and FOURTH value the model may return —
   * `'Collection'` and `'IT'` — and nothing normalises them, so an AI verdict
   * would land in this column verbatim. Neither has ever appeared in the data.
   * ⇒ Treat `Payment` / `Other` as the contract. If a `Collection` or `IT` row
   * ever shows up, it came from the model, not from a deliberate decision.
   *
   * ⚠️ DO NOT add an `enum` here without checking every writer first — an enum
   * makes Mongoose REJECT the document, and the ticket write is wrapped in a
   * catch, so a rejected ticket would disappear silently. That exact failure
   * mode cost a day on `webhook_logs.status` (`[FIX-20260815-SUPPRESSEDENUM]`).
   * ใช้แค่ Payment กับ Other · ห้ามใส่ enum โดยไม่ไล่ทุกที่ที่เขียนก่อน.
   */
  @Prop({ type: String, default: null, index: true })
  category?: string | null;

  /**
   * [FEAT-20260815-CATUPGRADE] When the system upgraded this ticket's category
   * from `Other` to `Payment` — `null` means it never did.
   *
   * WHY IT EXISTS: a ticket opened by the assist flow starts as `Other`, because
   * at that moment nobody knows what the customer wants. If a slip arrives
   * afterwards, while the room is still waiting for an admin, the case IS about
   * payment — but the ticket keeps saying `Other` and the admin queue is sorted
   * by the wrong label. The upgrade fixes that; this column is what keeps it
   * from happening twice.
   *
   * ⚠️ IT IS THE ONE-SHOT LATCH, NOT A LOG. `ticket-category-upgrade.helper.ts`
   * puts `category_upgraded_at: null` in the `findOneAndUpdate` FILTER, so the
   * write and the check are one atomic operation: concurrent slips race, exactly
   * one wins, the rest match nothing and do nothing. A boolean would work as a
   * flag but would not answer "when", which is what makes an unexpected upgrade
   * traceable afterwards.
   *
   * ⚠️ ONE DIRECTION ONLY. Nothing downgrades a ticket back to `Other`, and an
   * admin who sets the category by hand is never overwritten (the filter also
   * requires `category: 'Other'`). ยกระดับทางเดียว ครั้งเดียว.
   *
   * DATA EFFECT — additive, no migration. The 138 existing tickets simply do not
   * have the field; Mongoose reads that as `undefined`, which the filter treats
   * as "never upgraded" — the truthful answer. Nothing else reads this column.
   *
   * revert: delete this @Prop, `ticket-category-upgrade.helper.ts`, its export in
   * `tickets/index.ts`, and the single call in `webhook.service.ts`. Values
   * already written stay in the documents and are simply never read again.
   */
  @Prop({ type: Date, default: null })
  category_upgraded_at?: Date | null;

  @Prop({ type: String, default: null })
  need_detail?: string | null;

  @Prop({ type: String, default: null, index: true })
  chat_status?: string | null;

  @Prop({ type: Number, default: 0, index: true })
  job_status!: number;

  /**
   * ==== [FEAT-20260810-PAYTICKET] ticket ที่ระบบเปิดให้เอง (ไม่ได้มาจาก assist) ====
   *
   * `true`  = ระบบยิงเปิดตรง ๆ เช่น topup ตอบ `member-not-match`
   *           (ดู `payment/payment-ticket.helper.ts`)
   * `false` = ทางปกติ — ลูกค้าทัก แล้ว AI ขึ้น tag `[[[assist]]]`
   *
   * ⚠️ default `false` เพื่อความ seamless: ticket เก่าทุกใบที่ไม่มี field นี้
   * อ่านได้เป็น `false` ทันที **ไม่ต้อง migrate** และหน้าเว็บที่ยังไม่รู้จัก field นี้
   * ก็ทำงานเหมือนเดิมทุกประการ
   *
   * ใช้ทำอะไรได้: แยกสถิติ / กรองในหน้า log ว่าเคสไหนระบบเปิดเอง
   * revert: ลบ 2 prop นี้ — ค่าที่เขียนไว้ค้างใน DB แต่ไม่มีใครอ่าน
   */
  @Prop({ type: Boolean, default: false })
  direct_ticket?: boolean;

  /**
   * เหตุผลที่ระบบเปิด ticket ให้เอง — อ่านแล้วรู้ทันทีว่ามาจากเส้นไหน
   *
   * `null` (ค่าเริ่มต้น / ticket ปกติ) = ไม่ได้เปิดตรง จึงไม่มีเหตุผลให้บันทึก
   * ตัวอย่างค่า: `'payment:member-not-match'`
   *
   * ⚠️ เก็บเป็น string อิสระ ไม่ใช่ enum — เผื่อมีเส้นอื่นมาเปิด ticket ตรงในอนาคต
   * จะได้ไม่ต้องแก้ schema ทุกครั้ง (แต่ควรตั้งชื่อเป็น `<โมดูล>:<สาเหตุ>`)
   */
  @Prop({ type: String, default: null })
  direct_ticket_detail?: string | null;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true,
  })
  admin_user_id?: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  assigned_at?: Date | null;

  @Prop({ type: Date, default: null })
  resolved_at?: Date | null;
}

export const TicketSchema = SchemaFactory.createForClass(Ticket);

TicketSchema.index({ created_at: -1, hook_id: 1 });

/**
 * Covers the hot list path as a seek rather than a scan: the ticket list filters
 * on hook_id (optionally job_status) and sorts created_at descending, and the
 * meta lookup matches `hook_id: {$in: [...]}`. The single-field indexes above
 * only permit an index intersection; this one serves the whole filter and sort.
 *
 * `background: true` so an index sync at boot never locks the collection, which
 * has bitten this collection before.
 */
TicketSchema.index(
  { hook_id: 1, job_status: 1, created_at: -1 },
  { background: true },
);

/**
 * [PERF-20260821-TICKETCURSOR] The cursor list sorts on (created_at, _id) so a
 * seek is deterministic when two tickets share a timestamp. Without the `_id`
 * tiebreaker in the index Mongo cannot serve that sort from the index and falls
 * back to an in-memory SORT of the whole filtered set — the very cost the cursor
 * exists to remove. ADDITIVE: the index above keeps serving the legacy sort
 * exactly as before. `background: true` for the same reason as above.
 * DB-EFFECT: one new index, no document changes. revert: delete this call.
 */
TicketSchema.index(
  { hook_id: 1, job_status: 1, created_at: -1, _id: -1 },
  { background: true },
);

/**
 * [FEAT-20260826-TKTACTIVITYSORT] 📖 docs/bottleneck_26_aug.md (S7 · 3c)
 * The activity walk's own index — the twin of the created_at one above, for
 * `sort=activity` cursor paging (option ก, owner-approved 26/08): the open
 * tab pages by "last touched" so page 1 is the working set, while the screen
 * keeps folding lastMsgAt client-side exactly as today.
 *
 * ⚠️ DB-EFFECT: ONE new index, no document change. On stg/prod build it
 * manually in background BEFORE booting the code that declares it — mongoose
 * fires createIndex at boot and a large collection must not block there.
 * revert: drop this declaration + `db.tickets.dropIndex(
 * 'hook_id_1_job_status_1_updated_at_-1__id_-1')`.
 */
TicketSchema.index(
  { hook_id: 1, job_status: 1, updated_at: -1, _id: -1 },
  { background: true },
);

/**
 * [PERF-20260824-TKTUSERLATEST] "This member's most recent ticket on this hook."
 *
 * WHAT IT SERVES: the per-event auto-unassist lookup in `webhook.service.ts` —
 * `findOne({ chat_user_id, hook_id }).sort({ created_at: -1 })`. It runs on
 * inbound events, so it is on the customer's reply path.
 *
 * WHY IT IS NEEDED: this is the "index exists but the key order makes it
 * unusable" case. The compound above leads `hook_id, job_status, created_at`,
 * and this query supplies `hook_id` but NOT `job_status` — so `created_at` is
 * unreachable as a sort key and the planner falls back to
 * `{created_at: -1, hook_id: 1}`, walking the ticket collection newest-first
 * until it meets a matching `chat_user_id`. For a member with NO ticket yet —
 * the common case for a new customer — it walks the entire collection and
 * returns nothing.
 *
 * Compare `ticket-category-upgrade.helper.ts`, which supplies `job_status` and
 * is fully served by the compound above. Same collection, one key apart.
 *
 * BEHAVIOUR: none — same query, same result, same order.
 * DB-EFFECT: additive index only; no document written, no migration.
 * `background: true` for the same reason as the two above.
 * revert: delete this block —
 *         db.tickets.dropIndex('chat_user_id_1_hook_id_1_created_at_-1')
 */
TicketSchema.index(
  { chat_user_id: 1, hook_id: 1, created_at: -1 },
  { background: true },
);

/**
 * [FIX-20260808-DUALWRITE] Phase 3.1a/3.1b (plan peppy) dual-write mirror.
 *
 * Mirrors the two channel-neutral renames bidirectionally, exactly as the legacy
 * `Ticket` model does in `mirrorTicketRefFields`
 * (legacy-api/src/models/ticket/ticketModel.js:93-100):
 *   - line_oa_hook_id ↔ hook_id  (Phase 3.1a)
 *   - line_user_id    ↔ chat_user_id  (Phase 3.1b)
 *
 * Why: reads were cut over to the new names (the ticket list filters `hook_id`).
 * Without this, a write that sets only the legacy name leaves the new name null,
 * so the row never appears in the list and the admin is never prompted to claim
 * it. This is a null-guarded copy (both fields have `default: null`, so they are
 * present-as-null on a document, not undefined — hence a bespoke guard rather
 * than the undefined-based `mirrorPair` helper used by member/chat-room).
 */
function mirrorTicketRefFields(
  target: Record<string, unknown> | null | undefined,
): void {
  if (!target) return;
  if (target.hook_id == null && target.line_oa_hook_id != null) {
    target.hook_id = target.line_oa_hook_id;
  } else if (target.line_oa_hook_id == null && target.hook_id != null) {
    target.line_oa_hook_id = target.hook_id;
  }

  if (target.chat_user_id == null && target.line_user_id != null) {
    target.chat_user_id = target.line_user_id;
  } else if (target.line_user_id == null && target.chat_user_id != null) {
    target.line_user_id = target.chat_user_id;
  }
}

/**
 * [FIX-20260808-DUALWRITE] Phase 3.1a/3.1b + channel_type stamp (plan peppy).
 *
 * Document write path. Mirrors the ref-field pairs, then stamps `channel_type`
 * from the parent Hook (the single source of truth) whenever the hook link is
 * new or changed — a straight port of legacy `ticketModel.js:106-118`. The stamp
 * is best-effort and must never block a save. Async pre-hooks in Mongoose are
 * promise-style, so we resolve/throw rather than call `next`.
 */
TicketSchema.pre('save', async function (this: TicketDocument): Promise<void> {
  mirrorTicketRefFields(this as unknown as Record<string, unknown>);
  /* [FEAT-20260820-FIRSTTICKET] remember whether this save is the document's
     first, because `post('save')` cannot tell: Mongoose has already cleared
     `isNew` by the time it runs. `$locals` is per-document scratch space that is
     never persisted. jaw จำไว้ก่อน เพราะ post จะอ่าน isNew ไม่ได้แล้ว. */
  this.$locals.wasNew = this.isNew;
  if (
    this.line_oa_hook_id &&
    (this.isNew || this.isModified('line_oa_hook_id'))
  ) {
    try {
      const hook = await model('Hook')
        .findById(this.line_oa_hook_id)
        .select('channel_type')
        .lean<{ channel_type?: string } | null>();
      if (hook && hook.channel_type) this.channel_type = hook.channel_type;
    } catch {
      // best-effort denormalization; never block a ticket save on this
    }
  }
});

/**
 * [FEAT-20260820-FIRSTTICKET] Stamp the member's first-ever ticket date.
 *
 * WHY `post` AND NOT `pre`: "first ticket" has to mean a ticket that EXISTS. A
 * stamp written in `pre` survives a failed save, leaving a member marked as
 * having had a case that was never stored. `post('save')` runs only after the
 * write succeeded. จดหลังเซฟสำเร็จเท่านั้น.
 *
 * WHY IT IS SAFE TO RUN ON EVERY TICKET: the member update is first-writer-wins
 * in its own filter, so after the first ticket it matches nothing and writes
 * nothing — one indexed query, no document rewritten. See
 * `first-ticket-stamp.ts` for the rule, the seamless argument and the removal
 * steps.
 *
 * `model('Member')` rather than an import: the same mongoose-registry lookup the
 * hook above already uses for `Hook`, so this file gains no new dependency on
 * another module. Never awaited by the caller and never throws — a lost stamp
 * must not turn a saved ticket into an error.
 *
 * revert: delete this hook, the `$locals.wasNew` line in the `pre` hook above,
 * and `first-ticket-stamp.ts`.
 */
TicketSchema.post('save', function (this: TicketDocument): void {
  if (!this.$locals.wasNew) return;
  /* ⚠️ THE `model()` LOOKUP MUST BE INSIDE THIS TRY, not only the write.
     `model('Member')` THROWS `MissingSchemaError` when that model is not
     registered on the connection — and a post-save hook that throws rejects the
     `create()` that triggered it, so an unregistered model would turn every
     ticket creation into an error. Found by running it for real: the helper's
     own try/catch is too late, because the lookup happens while building its
     arguments. The `pre` hook above guards its `model('Hook')` call the same way.
     ต้องครอบตั้งแต่ตอนหา model · ไม่งั้น hook โยน แล้ว create() พังทั้งใบ. */
  try {
    /* `chat_user_id` is filled by `mirrorTicketRefFields` in the `pre` hook above
       even when the creating path only set `line_user_id`, so this reads one name
       and covers all four creation paths. */
    const memberId =
      (this as unknown as Record<string, unknown>)['chat_user_id'] ??
      (this as unknown as Record<string, unknown>)['line_user_id'];
    void stampFirstTicketAt(
      memberId,
      (this as unknown as { created_at?: Date }).created_at ?? new Date(),
      {
        /* the mongoose registry hands back a generic Model; the helper only ever
           calls `updateOne(...).exec()`, which that satisfies. */
        memberModel: model('Member'),
      },
    );
  } catch {
    // best-effort: a ticket is never lost because its stamp could not be written
  }
});

/**
 * [FIX-20260808-DUALWRITE] Phase 3.1a/3.1b (plan peppy).
 *
 * findOneAndUpdate/updateOne/updateMany all bypass `pre('save')`, so the same
 * dual-write mirror is applied to the update document here. Handles both `$set`
 * and top-level update shapes.
 *
 * [FIX-20260808-FBREADY] Coverage widened to updateOne/updateMany beyond legacy
 * `ticketModel.js:122-126` (save + findOneAndUpdate only). This is an
 * INTENTIONAL hardening superset, NOT parity drift: no current code writes a
 * ticket ref field via updateOne/updateMany (verified — the one updateMany sets
 * only job_status/resolved_at), so the added ops change no existing write's
 * result. They exist so a FUTURE writer using those ops cannot silently leave
 * `hook_id`/`chat_user_id` null and drop the ticket from the neutral-name list
 * (the exact failure this migration bug caused). Matches Member/ChatRoom, which
 * already cover all three ops.
 */
TicketSchema.pre(
  ['findOneAndUpdate', 'updateOne', 'updateMany'],
  function (this: MirroringQuery): void {
    const update = this.getUpdate();
    if (!update) return;
    const set = (update as { $set?: Record<string, unknown> }).$set;
    mirrorTicketRefFields(set ?? update);
  },
);
