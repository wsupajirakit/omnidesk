import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

import { legacyTimestamps } from '@/infra/mongo/schema-options';

export type QuickReplyCategoryDocument = HydratedDocument<QuickReplyCategory>;

/**
 * A folder of canned quick-reply messages, shared across every operator —
 * global, not per-user and not per-hook.
 *
 * The audit fields store a display name beside each user id so the list answers
 * "who touched this" without a join; the fuller trail lives in the audit log
 * collection.
 */
@Schema({ collection: 'quick_reply_categories', ...legacyTimestamps })
export class QuickReplyCategory {
  @Prop({ type: String, required: true, trim: true })
  name!: string;

  /** Position in the category tab strip; lower sorts first. */
  @Prop({ type: Number, default: 0, index: true })
  order!: number;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  created_by?: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  created_by_name?: string | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  updated_by?: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  updated_by_name?: string | null;

  /** Soft delete: the folder is hidden but kept for the audit trail. */
  @Prop({ type: Date, default: null, index: true })
  deleted_at?: Date | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  deleted_by?: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  deleted_by_name?: string | null;
}

export const QuickReplyCategorySchema =
  SchemaFactory.createForClass(QuickReplyCategory);
