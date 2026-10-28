import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

import { legacyTimestamps } from '@/infra/mongo/schema-options';

export type TranslationDictDocument = HydratedDocument<TranslationDict>;

/**
 * Offline translation dictionary: what a raw API value means, in a given domain.
 *
 * Identity is the five-field unique index at the bottom. Two rules about it were
 * learned the hard way and must survive this port:
 *
 * 1. **Nullable identity fields default to `null`, never `""`.** Mongo treats
 *    `""`, `null` and a missing field as three distinct values, so mixing them
 *    lets duplicate rows through a unique index. That happened before, when
 *    `path` defaulted to `""` while `scope` defaulted to `null`.
 * 2. **`path_canon` never carries array indices** (`items[].status`, not
 *    `items[0].status`). Storing indexed paths inflated the table with rows that
 *    carried no information — measured at 483 of 653 rows — because the index
 *    position never determined the translation.
 *
 * A row with all three nullables null is the base layer, which is what the
 * seeder writes. Rows with a tool, scope or path are deliberate overrides.
 * The service falls back to an in-code seed if this collection is empty, so
 * losing it degrades quality rather than breaking replies.
 */
@Schema({ collection: 'translation_dict', ...legacyTimestamps })
export class TranslationDict {
  /**
   * The value's domain — the set of values it can take (`promo_status`,
   * `deposit_status`). Named after what the value *is*, never after the path it
   * was found at.
   */
  @Prop({ type: String, required: true, trim: true, index: true })
  dict_name!: string;

  /** Raw value from the API, stored with original casing but matched lowercase. */
  @Prop({ type: String, required: true, trim: true })
  key!: string;

  /**
   * `null` = base layer, applies to every tool. An id scopes the row to one
   * vendor's vocabulary — the same field can mean `enable|disable` for one
   * partner and `active|banned` for another.
   */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'CustomTool',
    default: null,
    index: true,
  })
  custom_tool_id?: Types.ObjectId | null;

  /** `null` = every position in the domain. Canonical form, no array indices. */
  @Prop({ type: String, default: null, index: true })
  path_canon?: string | null;

  /** `null` = every site; a site code overrides the wording for that site only. */
  @Prop({ type: String, default: null })
  scope?: string | null;

  @Prop({ type: String, default: '' })
  value_th!: string;

  @Prop({ type: String, default: '' })
  value_en!: string;

  /** Long-form description; falls back to `value_th` when empty. */
  @Prop({ type: String, default: '' })
  desc_th!: string;

  /** `seed` rows may be overwritten by a later seed run; `admin` rows may not. */
  @Prop({ type: String, enum: ['seed', 'admin'], default: 'seed' })
  source!: 'seed' | 'admin';

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  updated_by?: Types.ObjectId | null;
}

export const TranslationDictSchema =
  SchemaFactory.createForClass(TranslationDict);

/**
 * Identity. All five fields are required for correctness: an upsert that filters
 * on fewer once overwrote one domain's wording with another's.
 */
TranslationDictSchema.index(
  { custom_tool_id: 1, dict_name: 1, key: 1, path_canon: 1, scope: 1 },
  { unique: true, name: 'transdict_identity' },
);

/** Boot loads the whole table; a stable sort keeps results byte-comparable. */
TranslationDictSchema.index({ dict_name: 1, key: 1 });
