import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

import { legacyTimestamps } from '@/infra/mongo/schema-options';

export type ImageStorageDocument = HydratedDocument<ImageStorage>;

/**
 * One stored media file, wherever it physically lives.
 *
 * Covers both library media (uploaded through the Object picker) and inbound
 * chat media saved by the webhook — see `source`, which is what keeps the two
 * apart.
 */
@Schema({ collection: 'image_storages', ...legacyTimestamps })
export class ImageStorage {
  /** Absent for chat media, which belongs to no Object entry. */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'ObjectImage',
    required: false,
    index: true,
  })
  object_image_id?: Types.ObjectId;

  @Prop({ type: String, required: true })
  image_url!: string;

  @Prop({ type: String, default: null })
  origin_path?: string | null;

  @Prop({ type: String, default: null })
  src_id?: string | null;

  @Prop({
    type: String,
    enum: ['local', 'google_drive', 'external_url', 'dashboard', 'internal'],
    required: true,
  })
  storage_type!: string;

  /** File extension or MIME subtype, e.g. `png`. */
  @Prop({ type: String, required: true })
  image_type!: string;

  @Prop({ type: String, default: null })
  file_path?: string | null;

  @Prop({ type: Number, default: 0 })
  file_size!: number;

  @Prop({ type: Number, default: 1, index: true })
  priority!: number;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  created_by?: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  detail_link?: string | null;

  @Prop({ type: String, default: null })
  detail_text?: string | null;

  /**
   * Where the media came from. `chat` means inbound from a customer, shown only
   * in the chat stream and never in the Object library or picker.
   *
   * No default on purpose: absent on every pre-existing record, and absent is
   * treated exactly like the legacy Object path (i.e. not chat). That is what
   * makes the field purely additive with no backfill.
   */
  @Prop({
    type: String,
    enum: ['chat', 'object'],
    required: false,
    index: true,
  })
  source?: string;

  /**
   * Explicit media kind so the UI never guesses from the extension. Set only on
   * new records; absent on legacy rows, where the reader falls back to
   * `image_type` (every legacy record is an image). Additive, no backfill.
   */
  @Prop({ type: String, enum: ['image', 'video'], required: false })
  media_kind?: string;

  /** Soft delete: set instead of removing the document. */
  @Prop({ type: Date })
  deleted_at?: Date;
}

export const ImageStorageSchema = SchemaFactory.createForClass(ImageStorage);
