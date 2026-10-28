import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

import { noTimestamps } from '@/infra/mongo/schema-options';

export type TagCounterDocument = HydratedDocument<TagCounter>;

/**
 * The `counters` collection, as the hooks module uses it.
 *
 * ⚠️ THIS IS THE SAME COLLECTION AS `system/schemas/counter.schema.ts`, and the
 * duplication is deliberate. SystemModule imports from `@/modules/hooks`
 * (oa-access, webhook-log, translation-dict), so importing the system barrel
 * from here closes an import cycle — at boot, `Hook` resolves to `undefined`
 * inside `@InjectModel` and the process dies with "Cannot read properties of
 * undefined (reading 'name')". That was observed, not theorised. Reaching past
 * the barrel with a deep path avoids the cycle but violates the layering rule
 * in eslint.config.mjs, which exists for good reason.
 *
 * Declaring the two fields here is safe because the shape is fixed and trivial:
 * a string `_id` naming the sequence and a numeric `seq`. Mongoose registers
 * models per name, so `TagCounter` and `Counter` are distinct models over one
 * collection — reads and writes go to the same documents either way, and
 * `$inc` remains atomic across both. There is no second source of truth: the
 * DATA is single, only the model binding is duplicated.
 *
 * If a third module ever needs this collection, promote it to a shared location
 * under `src/infra/mongo/` rather than adding a third copy.
 */
@Schema({ collection: 'counters', ...noTimestamps })
export class TagCounter {
  /** The sequence name. The hooks module only ever uses `dynamic_tag_ins`. */
  @Prop({ type: String, required: true })
  _id!: string;

  @Prop({ type: Number, default: 0 })
  seq!: number;
}

export const TagCounterSchema = SchemaFactory.createForClass(TagCounter);
