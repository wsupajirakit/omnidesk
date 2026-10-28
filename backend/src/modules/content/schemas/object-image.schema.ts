import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

import { legacyTimestamps } from '@/infra/mongo/schema-options';

export type ObjectImageDocument = HydratedDocument<ObjectImage>;

/**
 * An entry in the Object library: media plus the tags that select it.
 *
 * The actual files hang off this row as ImageStorage documents pointing back
 * via `object_image_id`, so one entry can hold several stored variants.
 */
@Schema({ collection: 'object_images', ...legacyTimestamps })
export class ObjectImage {
  @Prop({ type: String, default: '' })
  detail!: string;

  /**
   * Tags that select this entry.
   *
   * Typed Mixed with `default: []`, exactly as in the legacy schema: the data
   * is normally an array of strings, but Mixed also admits the single-string
   * rows written by older code. Narrowing it to `[String]` would drop those.
   */
  @Prop({ type: MongooseSchema.Types.Mixed, default: [], index: true })
  matching_tag?: unknown;

  @Prop({ type: String, default: '' })
  img_path!: string;

  @Prop({
    type: String,
    enum: ['local', 'external', 's3', 'google_drive'],
    default: 'local',
  })
  storage!: string;

  @Prop({ type: String, default: '' })
  file_type!: string;

  @Prop({
    type: [
      {
        type: MongooseSchema.Types.ObjectId,
        ref: 'ObjectCategory',
        required: true,
      },
    ],
  })
  categories?: Types.ObjectId[];

  /**
   * Groups allowed to use this entry. Empty means unrestricted.
   *
   * [FEAT-20260901-OBJSCOPE] Declared since the beginning, written on every
   * save, and until now read by NO filter anywhere — including the LINE
   * runtime, which looked entries up by `matching_tag` alone. It is now
   * honoured by the admin lists and by the reply path.
   */
  @Prop({ type: [{ type: MongooseSchema.Types.ObjectId, ref: 'Group' }] })
  group_providers?: Types.ObjectId[];

  /** [FEAT-20260901-OBJSCOPE] OAs allowed to use this entry. Absent or `[]`
   *  means unrestricted, exactly like `group_providers`. No `default` — see
   *  `object-category.schema.ts` for why absent must stay absent. */
  @Prop({ type: [{ type: MongooseSchema.Types.ObjectId, ref: 'Hook' }] })
  hook_ids?: Types.ObjectId[];

  /** [FEAT-20260901-OBJSCOPE] On/off switch. Off means the reply path serves
   *  no image, the same outcome as out-of-scope. ⚠️ Filter it as
   *  `{status: {$ne: false}}`: pre-existing rows carry no key at all, so
   *  `{status: true}` would match none of them. */
  @Prop({ type: Boolean, default: true })
  status!: boolean;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  created_by?: Types.ObjectId | null;

  /** How the entry is delivered: raw media, or wrapped in a flex message. */
  @Prop({ type: String, enum: ['media', 'flex'], default: 'flex' })
  response_type!: string;

  /** Soft delete: set instead of removing the document. */
  @Prop({ type: Date })
  deleted_at?: Date;
}

export const ObjectImageSchema = SchemaFactory.createForClass(ObjectImage);

/**
 * [FEAT-20260901-OBJSCOPE] One index per scope column, each paired with the
 * list's sort key so filter and sort are served together.
 *
 * 🔴 THESE MUST STAY SEPARATE. `matching_tag`, `group_providers` and `hook_ids`
 * are ALL array paths on the same document. MongoDB cannot maintain a compound
 * index spanning two of them — and it fails the **write**, not the read, so a
 * compound index here would break every album save with `cannot index parallel
 * arrays`. Each index below touches at most one array path plus a scalar.
 *
 * The runtime lookup (`webhook.service.ts`) deliberately gains NO index: it
 * keeps using the existing `matching_tag_1` and adds the scope legs as filters
 * on the documents that index already narrowed to.
 */
ObjectImageSchema.index({ group_providers: 1, created_at: -1 });
ObjectImageSchema.index({ hook_ids: 1, created_at: -1 });
