import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type HookAuditLogDocument = HydratedDocument<HookAuditLog>;

/** One before/after pair inside an audit entry's `changed_fields`. */
@Schema({ _id: false })
export class AuditChangedField {
  @Prop({ type: String, required: true })
  field!: string;

  @Prop({ type: MongooseSchema.Types.Mixed })
  from?: unknown;

  @Prop({ type: MongooseSchema.Types.Mixed })
  to?: unknown;
}

/**
 * Who performed the action, captured by value.
 *
 * The username is denormalised on purpose: a rename or a deleted account must
 * not rewrite history, so the log keeps the name as it read at the time.
 */
@Schema({ _id: false })
export class AuditActor {
  @Prop({ type: String, required: true })
  user_id!: string;

  @Prop({ type: String, required: true })
  username!: string;

  @Prop({ type: String })
  display_name?: string;
}

@Schema({ _id: false })
export class AuditRequestMeta {
  @Prop({ type: String })
  request_id?: string;

  @Prop({ type: String })
  ip?: string;

  @Prop({ type: String })
  user_agent?: string;
}

/**
 * Append-only audit trail for hook-scoped administrative actions.
 *
 * `updatedAt` is disabled in the legacy model — an entry is written once and
 * never edited, so an updated timestamp would only ever be misleading.
 * `ref_id` is an untyped ObjectId (no `ref`) because the same collection records
 * changes to hooks, flex cards, dynamic tags and more.
 */
@Schema({
  collection: 'hook_audit_logs',
  timestamps: { createdAt: 'created_at', updatedAt: false },
})
export class HookAuditLog {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  ref_id!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, index: true })
  hook_id?: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null, index: true })
  group_id?: Types.ObjectId | null;

  /**
   * [FIX-20260818-AUDITCLONE] `clone` เพิ่มเข้ามา — เป็นการเติมค่าที่อนุญาต (additive)
   *
   * อาการจริง 18/08: `POST /audit/logs` ตอบ 500
   * `HookAuditLog validation failed: action: 'clone' is not a valid enum value`
   * ทุกครั้งที่กด Copy Item เพราะฟอร์มส่ง `action: 'clone'` มาตั้งแต่เดิม
   * (`omnidesk-console/pages/hook/HookFormPage.tsx:248`) แต่ enum นี้ไม่มีค่านั้น
   * ⇒ การ clone ไม่พัง (audit เป็น non-blocking) แต่ **ประวัติว่าใครโคลนอะไรหายทุกใบ**
   *
   * ผลกับข้อมูลเดิม: ไม่มี — เป็นการขยายรายการค่าที่ยอมรับ แถวเก่าทุกแถวยังอ่าน/เขียนได้
   * เท่าเดิม ไม่มี migration ไม่มี backfill · revert: ลบบรรทัด `'clone',` ออก แล้วแถว
   * action=clone ที่เขียนไปแล้วจะอ่านได้ปกติ (mongoose ตรวจ enum ตอนเขียนเท่านั้น)
   */
  @Prop({
    type: String,
    required: true,
    enum: [
      'create',
      'update',
      'delete',
      'send',
      'cancel',
      'toggle_status',
      'toggle_fast_mode',
      'login',
      'bulk_delete',
      'clear_tickets',
      'clone',
      /* [FIX-20260909-AUDITTRANSLATE] `translate` — the SECOND time this exact
         trap has been sprung, and the note above records the first.
         The chat translate route has written an audit row since the day it
         shipped and NOT ONE has ever landed: mongoose refused every insert with
         "`translate` is not a valid enum value", the route fires the write as
         `void auditMessageTranslate(...)` so the rejection never reached a
         caller, and the only trace was a WARN line nobody was reading. The
         owner found it by looking at the audit screen and asking why pressing
         translate left no record.
         ⚠️ WHY THE FIRE-AND-FORGET IS STILL RIGHT: an audit failure must never
         cost the admin their translation. The fix is that the write succeeds,
         not that the route starts throwing.
         DB-EFFECT: additive enum value, and mongoose validates enums on WRITE
         only — existing rows are unaffected and no migration is needed.
         revert: delete this line; translate rows stop being accepted again. */
      'translate',
    ],
  })
  action!: string;

  @Prop({ type: [SchemaFactory.createForClass(AuditChangedField)] })
  changed_fields?: AuditChangedField[];

  @Prop({ type: SchemaFactory.createForClass(AuditActor) })
  actor?: AuditActor;

  @Prop({ type: SchemaFactory.createForClass(AuditRequestMeta) })
  request_meta?: AuditRequestMeta;

  /** Groups related entries written by one bulk operation. */
  @Prop({ type: String })
  parent?: string;

  @Prop({ type: String })
  note?: string;

  @Prop({ type: Number })
  version?: number;
}

export const HookAuditLogSchema = SchemaFactory.createForClass(HookAuditLog);

HookAuditLogSchema.index({ ref_id: 1, created_at: -1 });
HookAuditLogSchema.index({ hook_id: 1, created_at: -1 });
HookAuditLogSchema.index({ parent: 1, created_at: -1 });
HookAuditLogSchema.index({ 'actor.user_id': 1, created_at: -1 });
HookAuditLogSchema.index({ created_at: -1 });
