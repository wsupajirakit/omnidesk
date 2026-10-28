import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

import { legacyTimestamps } from '@/infra/mongo/schema-options';

export type ObjectCategoryDocument = HydratedDocument<ObjectCategory>;

/** A grouping for Object library media, addressable by an external API key. */
@Schema({ collection: 'object_categories', ...legacyTimestamps })
export class ObjectCategory {
  @Prop({ type: String, required: true, trim: true, unique: true })
  name!: string;

  /** Lets an external caller select this category. Empty means unexposed. */
  @Prop({ type: String, default: '' })
  api_key!: string;

  /**
   * [FEAT-20260901-OBJSCOPE] Groups allowed to use this category.
   *
   * ⚠️ NO `default`. An absent key and `[]` both mean **unrestricted** — see the
   * filter in `object-scope/object-scope.filter.ts`, which carries a leg for
   * each. Giving this a `default: []` would rewrite the meaning of every row
   * Mongoose touches, and `broadcast.schema.ts:132-133` records why that is the
   * wrong direction: absent must stay distinguishable from "deliberately empty"
   * even though today they resolve the same way.
   *
   * Named `group_providers`, matching `object-image.schema.ts` rather than the
   * `group_ids` / `assign_group_ids` used elsewhere: one name across the two
   * Object menus was worth more than consistency with a third collection.
   *
   * revert: delete this @Prop and the group leg in the filter. Stored values
   * become an ObjectId array nothing reads.
   */
  @Prop({ type: [{ type: MongooseSchema.Types.ObjectId, ref: 'Group' }] })
  group_providers?: Types.ObjectId[];

  /** [FEAT-20260901-OBJSCOPE] OAs allowed to use this category. Same
   *  absent/`[]` = unrestricted rule as `group_providers` above. */
  @Prop({ type: [{ type: MongooseSchema.Types.ObjectId, ref: 'Hook' }] })
  hook_ids?: Types.ObjectId[];

  /**
   * [FEAT-20260901-OBJSCOPE] On/off switch.
   *
   * `Boolean` + `default: true` is the shape 4 of the 5 real switches in this
   * repo already use (`group.schema.ts:22`, `dynamic-tag.schema.ts:28`,
   * `custom-tool.schema.ts:263,447`). The outlier is `hooks.status` (Number,
   * default 0), which needs a `parseStatusFlag` helper precisely because it is
   * numeric — copying it would spread that.
   *
   * ⚠️ Mongoose applies a `default` on WRITE, not on read. Rows that predate
   * this field carry no `status` key, so a query of `{status: true}` matches
   * NONE of them. Every filter must spell it `{status: {$ne: false}}` — absent
   * reads as on, only an explicit `false` is off. That is what makes this
   * additive with no backfill.
   */
  @Prop({ type: Boolean, default: true })
  status!: boolean;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  created_by?: Types.ObjectId | null;

  /** Soft delete: set instead of removing the document. */
  @Prop({ type: Date })
  deleted_at?: Date;
}

export const ObjectCategorySchema =
  SchemaFactory.createForClass(ObjectCategory);

/* [FEAT-20260901-OBJSCOPE] The scope legs are `$in` lookups and the list sorts
   on `name`, so one index serves filter AND sort. `hook_ids` gets its own —
   a compound across both would be a parallel-array index, which MongoDB
   refuses to maintain and which fails the WRITE, not the read. */
ObjectCategorySchema.index({ group_providers: 1, name: 1 });
ObjectCategorySchema.index({ hook_ids: 1 });
