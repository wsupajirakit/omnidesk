import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

import { legacyTimestamps } from '@/infra/mongo/schema-options';

export type DynamicTagDocument = HydratedDocument<DynamicTag>;

/**
 * A `[[tag]]` placeholder resolved at message-build time.
 *
 * Scope is a three-way choice enforced by the controller, not by the schema:
 * a tag belongs to exactly one of `hook_id` (a single OA), `group_id` /
 * `group_ids` (whole groups), or `hook_ids` (a hand-picked subset). The schema
 * keeps all four because every tag written before scoping existed has
 * `group_id: null` and only `hook_id` set — the defaults preserve that reading.
 */
@Schema({ collection: 'dynamic_tags', ...legacyTimestamps })
export class DynamicTag {
  @Prop({ type: String, required: true, trim: true, index: true, unique: true })
  tag!: string;

  @Prop({ type: String, required: true })
  value!: string;

  @Prop({ type: String, default: '' })
  detail!: string;

  @Prop({ type: Boolean, default: true })
  status!: boolean;

  @Prop({ type: String, enum: ['api', 'system'], default: 'api' })
  type!: string;

  @Prop({ type: String, default: null })
  sub_type?: string | null;

  /** Untyped ObjectId — the referenced API row varies by `sub_type`. */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  ref_api_id?: Types.ObjectId | null;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Hook',
    default: null,
    index: true,
  })
  hook_id?: Types.ObjectId | null;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Group',
    default: null,
    index: true,
  })
  group_id?: Types.ObjectId | null;

  /**
   * Hand-picked OAs within a group. Ticking every OA is stored as `group_id`
   * instead, so a hook added to the group later inherits the tag.
   */
  @Prop({ type: [{ type: MongooseSchema.Types.ObjectId, ref: 'Hook' }] })
  hook_ids?: Types.ObjectId[];

  /**
   * Multi-group scope added alongside the original single `group_id`. Readers
   * take the union of both, which is why the single field was not removed.
   */
  @Prop({ type: [{ type: MongooseSchema.Types.ObjectId, ref: 'Group' }] })
  group_ids?: Types.ObjectId[];

  /**
   * Which hook's credentials the admin form uses when testing/previewing this
   * tag. Runtime chat still uses the credentials of the OA the customer is
   * talking to — this only affects the editor.
   */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Hook', default: null })
  primary_credential_source?: Types.ObjectId | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', index: true })
  created_by?: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  updated_by?: Types.ObjectId;

  @Prop({ type: Date, default: null })
  deleted_at?: Date | null;
}

export const DynamicTagSchema = SchemaFactory.createForClass(DynamicTag);

DynamicTagSchema.index({ tag: 1, deleted_at: 1 });
DynamicTagSchema.index({ type: 1, deleted_at: 1 });
DynamicTagSchema.index({ status: 1, deleted_at: 1 });
