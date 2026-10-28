import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

import { legacyTimestamps } from '@/infra/mongo/schema-options';

export type GroupDocument = HydratedDocument<Group>;

/**
 * A tenant/organisation grouping that scopes hooks, users, tags and flex cards.
 *
 * `deleted_at` is a soft delete: rows stay because hooks and users reference
 * them by id, and a hard delete would leave those references dangling.
 */
@Schema({ collection: 'groups', ...legacyTimestamps })
export class Group {
  @Prop({ type: String, required: true, trim: true })
  group_name!: string;

  @Prop({ type: String, default: '' })
  description!: string;

  @Prop({ type: Boolean, default: true })
  status!: boolean;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  created_by?: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  updated_by?: Types.ObjectId;

  @Prop({ type: Date, default: null })
  deleted_at?: Date | null;
}

export const GroupSchema = SchemaFactory.createForClass(Group);
