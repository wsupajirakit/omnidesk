import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

import { legacyTimestamps } from '@/infra/mongo/schema-options';

export type CustomerTagDocument = HydratedDocument<CustomerTag>;

/**
 * Join row: which labels a customer carries.
 *
 * Stores only `tag_id` — the label text and colour live once, on the Tag. An
 * earlier version copied the text onto every row with a unique index on
 * `{member_id, label}`, which made the text the identity and collapsed two
 * groups' identically-named labels into one.
 *
 * `chat_room_id` / `hook_id` record where the label was applied. They are
 * provenance only, never a visibility filter: hiding another group's warning
 * label ("fraud", "be careful") would be more dangerous than showing it. Group
 * filtering happens in the label picker, not on labels already applied.
 */
@Schema({ collection: 'customer_tags', ...legacyTimestamps })
export class CustomerTag {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Member',
    required: true,
    index: true,
  })
  member_id!: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Tag',
    required: true,
    index: true,
  })
  tag_id!: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'ChatRoom',
    default: null,
    index: true,
  })
  chat_room_id?: Types.ObjectId | null;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Hook',
    default: null,
    index: true,
  })
  hook_id?: Types.ObjectId | null;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true,
  })
  created_by?: Types.ObjectId | null;

  /** Denormalised for display without a populate on every read. */
  @Prop({ type: String, default: null })
  created_by_name?: string | null;
}

export const CustomerTagSchema = SchemaFactory.createForClass(CustomerTag);

CustomerTagSchema.index({ member_id: 1, created_at: -1 });
// The same label cannot be applied twice to one customer — compared by id, not
// by name.
CustomerTagSchema.index({ member_id: 1, tag_id: 1 }, { unique: true });
