import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

import { legacyTimestamps } from '@/infra/mongo/schema-options';

export type ChatRoomNoteDocument = HydratedDocument<ChatRoomNote>;

/**
 * An internal admin note about a customer (one customer, many notes).
 *
 * Keyed on `member_id`, not on the room: notes follow the customer across rooms
 * and tickets, so the same thread appears wherever that customer is opened.
 * `chat_room_id` / `hook_id` are context and group scoping only.
 *
 * Added alongside the legacy single `chat_rooms.note` string, which is left
 * untouched — nothing was migrated.
 */
@Schema({ collection: 'chat_room_notes', ...legacyTimestamps })
export class ChatRoomNote {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Member',
    required: true,
    index: true,
  })
  member_id!: Types.ObjectId;

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

  @Prop({ type: String, required: true, trim: true })
  content!: string;

  /**
   * Author, kept as both id and name: the id is the real reference (names
   * repeat and change), the name is there so a list renders without a populate.
   * The `updated_by` pair follows the same convention — before it existed, an
   * edited note only moved `updated_at` and could not say who edited it.
   */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true,
  })
  created_by?: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  created_by_name?: string | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  updated_by?: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  updated_by_name?: string | null;

  /** Soft delete: the row survives as a tombstone. */
  @Prop({ type: Date, default: null })
  deleted_at?: Date | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  deleted_by?: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  deleted_by_name?: string | null;
}

export const ChatRoomNoteSchema = SchemaFactory.createForClass(ChatRoomNote);

// Newest-first listing per customer is the common query.
ChatRoomNoteSchema.index({ member_id: 1, created_at: -1 });
