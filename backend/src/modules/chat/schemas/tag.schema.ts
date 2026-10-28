import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

import { legacyTimestamps } from '@/infra/mongo/schema-options';

export type TagDocument = HydratedDocument<Tag>;

/**
 * The definition of a customer label.
 *
 * Labels used to have no identity of their own: `customer_tags` stored the text
 * on every row and the whole system compared by label. That breaks as soon as
 * labels are group-scoped — group A's "VIP" and group B's "VIP" are different
 * labels — and renaming meant rewriting every row. The label now lives here
 * once and `customer_tags` stores only `tag_id`.
 *
 * Popularity counters (`use_count`, `last_used_at`) were folded in from a
 * separate `tag_stats` collection: two collections needing manual sync is debt
 * with nothing to gain once labels have ids.
 */
@Schema({ collection: 'tags', ...legacyTimestamps })
export class Tag {
  /** As typed by the admin, casing preserved. */
  @Prop({ type: String, required: true, trim: true })
  label!: string;

  /** Case-insensitive comparison key, derived from `label` on save so the two
   * can never drift apart. */
  @Prop({ type: String, required: true, index: true })
  key!: string;

  @Prop({ type: String, default: null })
  color?: string | null;

  /** Groups allowed to use this label; `[]` means every group. */
  @Prop({
    type: [{ type: MongooseSchema.Types.ObjectId, ref: 'Group' }],
    default: [],
  })
  group_ids!: Types.ObjectId[];

  @Prop({ type: Number, default: 0, index: true })
  use_count!: number;

  @Prop({ type: Date, default: null })
  last_used_at?: Date | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  created_by?: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  created_by_name?: string | null;
}

export const TagSchema = SchemaFactory.createForClass(Tag);

/**
 * No duplicate label within a group, duplicates across groups allowed.
 *
 * This is a multikey unique index — `group_ids` is an array, so Mongo expands
 * it into one (key, group) pair per element, which yields exactly that meaning.
 * Ungrouped labels (`group_ids: []`) are likewise unique among themselves.
 */
TagSchema.index({ key: 1, group_ids: 1 }, { unique: true });

// Popular-labels ordering: most used first, ties broken by most recent use.
TagSchema.index({ use_count: -1, last_used_at: -1 });
