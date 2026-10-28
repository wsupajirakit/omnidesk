import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

import { legacyTimestamps } from '@/infra/mongo/schema-options';
import { type MirroringQuery } from '@/modules/chat';

export type MappingDocument = HydratedDocument<Mapping>;

/**
 * Resolves a `placeholder` to a value, either constant, from a cURL response,
 * or computed.
 *
 * `line_chatbot_ids` and `hook_ids` are the same list under an old and a new
 * name; the legacy model dual-writes them so rows written under either name
 * stay readable. Both are kept, and both compound indexes with `placeholder`
 * are declared, because lookups still go through whichever name the caller has.
 * The dual-write mirror itself is ported below (see [FIX-20260808-DUALWRITE]).
 */
@Schema({ collection: 'mappings', ...legacyTimestamps })
export class Mapping {
  /** Legacy name for the hook list. Superseded by `hook_ids`. */
  @Prop({
    type: [{ type: MongooseSchema.Types.ObjectId, ref: 'Hook', index: true }],
  })
  line_chatbot_ids?: Types.ObjectId[];

  @Prop({
    type: [{ type: MongooseSchema.Types.ObjectId, ref: 'Hook', index: true }],
  })
  hook_ids?: Types.ObjectId[];

  @Prop({
    type: [{ type: MongooseSchema.Types.ObjectId, ref: 'Group', index: true }],
  })
  providers?: Types.ObjectId[];

  @Prop({ type: String, required: true, trim: true })
  placeholder!: string;

  @Prop({ type: String, trim: true })
  source_path?: string;

  @Prop({ type: String, trim: true })
  field_path?: string;

  @Prop({ type: String, trim: true, default: null })
  fallback_source_path?: string | null;

  @Prop({ type: String, trim: true, default: null })
  fallback_field_path?: string | null;

  @Prop({
    type: String,
    required: true,
    enum: ['static', 'api_curl', 'combined_api', 'calculation'],
    default: 'static',
  })
  mapping_type!: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'CustomCurl',
    default: null,
  })
  curl_id?: Types.ObjectId | null;

  /** Inline cURL, used when the mapping does not point at a saved `curl_id`. */
  @Prop({ type: String, trim: true, default: null })
  full_curl?: string | null;

  @Prop({ type: String, trim: true, default: null })
  constant_value?: string | null;

  @Prop({ type: String, trim: true, default: null })
  calculation_formula?: string | null;

  @Prop({ type: Boolean, default: true })
  is_active!: boolean;
}

export const MappingSchema = SchemaFactory.createForClass(Mapping);

MappingSchema.index({ line_chatbot_ids: 1, placeholder: 1 });
MappingSchema.index({ hook_ids: 1, placeholder: 1 });

/**
 * [FIX-20260808-DUALWRITE] Phase 3.1c (plan peppy) dual-write mirror.
 *
 * Mirrors the channel-neutral array rename bidirectionally, exactly as the
 * legacy `Mapping` model does in `mirrorMappingHookIds`
 * (legacy-api/src/models/hook/mappingModel.js:99-105):
 *   - line_chatbot_ids ↔ hook_ids  (Phase 3.1c)
 *
 * Why: reads were cut over to `hook_ids` (sibling models AutoReply/Broadcast
 * already use it). Without this, a write that fills only the legacy array leaves
 * `hook_ids` empty, so placeholder lookups keyed on `hook_ids` miss the row.
 * Guard is presence-by-length, matching legacy, not the undefined-based
 * `mirrorPair` helper (these are arrays, empty means "not set").
 */
function mirrorMappingHookIds(
  target: Record<string, unknown> | null | undefined,
): void {
  if (!target) return;
  const oldVal = target.line_chatbot_ids;
  const newVal = target.hook_ids;
  const hasOld = Array.isArray(oldVal) && oldVal.length > 0;
  const hasNew = Array.isArray(newVal) && newVal.length > 0;
  if (hasOld && !hasNew) target.hook_ids = oldVal;
  else if (hasNew && !hasOld) target.line_chatbot_ids = newVal;
}

/** [FIX-20260808-DUALWRITE] Document write path — mirrors `this`. */
MappingSchema.pre('save', function (this: MappingDocument): void {
  mirrorMappingHookIds(this as unknown as Record<string, unknown>);
});

/**
 * [FIX-20260808-DUALWRITE] Query write path. findOneAndUpdate bypasses
 * `pre('save')`, so the mirror runs on the update document here — a port of
 * legacy `mappingModel.js:111-115`. Handles `$set` and top-level shapes.
 */
MappingSchema.pre('findOneAndUpdate', function (this: MirroringQuery): void {
  const update = this.getUpdate();
  if (!update) return;
  const set = (update as { $set?: Record<string, unknown> }).$set;
  mirrorMappingHookIds(set ?? update);
});
