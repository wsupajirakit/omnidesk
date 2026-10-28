import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type AssignHistoryDocument = HydratedDocument<AssignHistory>;

/**
 * Append-only record of assignment changes on a room or ticket.
 *
 * `updatedAt` is disabled: an entry describes a moment and is never edited.
 */
@Schema({
  collection: 'assign_histories',
  timestamps: { createdAt: 'created_at', updatedAt: false },
})
export class AssignHistory {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'ChatRoom',
    required: true,
    index: true,
  })
  chat_room_id!: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Ticket',
    default: null,
    index: true,
  })
  ticket_id?: Types.ObjectId | null;

  /** Who the work went to. `null` records an unassignment. */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true,
  })
  assign_to?: Types.ObjectId | null;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true,
  })
  changed_by_id?: Types.ObjectId | null;

  @Prop({ type: String, default: null, index: true })
  action?: string | null;

  @Prop({ type: String, default: null })
  detail?: string | null;
}

export const AssignHistorySchema = SchemaFactory.createForClass(AssignHistory);

/**
 * [FEAT-20260817-ASSIGNDATERANGE] the date filter's index — owner approved 17/08.
 *
 * The page lists newest-first and now bounds by a date window, so every request
 * is `created_at: {$gte,$lte}` + `sort({created_at:-1})`. Without this index that
 * is a collection scan plus an in-memory sort; the collection had 341 rows on the
 * dev box, but this is the same shape `webhook_logs` and `hook_audit_logs` are
 * already indexed for.
 *
 * DB-EFFECT: additive index only — no field, no value, no migration, and existing
 * rows are untouched. `background: true` so a boot-time sync cannot lock the
 * collection. Dropping it only makes the query slow again.
 * เพิ่ม index เฉย ๆ ไม่แตะข้อมูล — ลบทิ้งได้ทุกเมื่อ แค่ช้าลง.
 */
AssignHistorySchema.index({ created_at: -1 }, { background: true });

/**
 * [PERF-20260824-ASGTICKETDATE] The ticket list's assign-history batch.
 *
 * WHAT IT SERVES: `tickets.service.ts` fetches the history for a whole page of
 * tickets — `find({ ticket_id: { $in: [...] } }).sort({ created_at: -1 })` —
 * and the single-ticket detail path does the same with one id.
 *
 * WHY IT IS NEEDED: `ticket_id` and `created_at` are indexed SEPARATELY above,
 * which lets Mongo seek OR sort but not both. With an `$in` of a page's worth of
 * ids it cannot explode-for-sort cheaply, so it either sorts in memory or walks
 * the date index and filters. This pairs them in the order the query uses.
 *
 * BEHAVIOUR: none. DB-EFFECT: additive index only — no field, no value, no
 * migration, existing rows untouched. `background: true` so a boot-time sync
 * cannot lock the collection.
 * revert: delete this block —
 *         db.assign_histories.dropIndex('ticket_id_1_created_at_-1')
 */
AssignHistorySchema.index(
  { ticket_id: 1, created_at: -1 },
  { background: true },
);
