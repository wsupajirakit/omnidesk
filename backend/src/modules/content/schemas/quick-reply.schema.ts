import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

import { legacyTimestamps } from '@/infra/mongo/schema-options';

export type QuickReplyDocument = HydratedDocument<QuickReply>;

/**
 * One canned message inside a QuickReplyCategory.
 *
 * Picking it in the composer inserts `text` into the draft — it is never sent
 * automatically; the operator still presses send.
 */
@Schema({ collection: 'quick_replies', ...legacyTimestamps })
export class QuickReply {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'QuickReplyCategory',
    required: true,
    index: true,
  })
  category_id!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  text!: string;

  /** Position within the category; lower sorts first. */
  @Prop({ type: Number, default: 0 })
  order!: number;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  created_by?: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  created_by_name?: string | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  updated_by?: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  updated_by_name?: string | null;

  /** Soft delete: hidden from the picker but kept for the audit trail. */
  @Prop({ type: Date, default: null, index: true })
  deleted_at?: Date | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  deleted_by?: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  deleted_by_name?: string | null;
}

export const QuickReplySchema = SchemaFactory.createForClass(QuickReply);

// The panel always reads one category in display order.
QuickReplySchema.index({ category_id: 1, order: 1 });
