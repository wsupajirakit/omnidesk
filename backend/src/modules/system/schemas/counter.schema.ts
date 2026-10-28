import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

import { noTimestamps } from '@/infra/mongo/schema-options';

export type CounterDocument = HydratedDocument<Counter>;

/**
 * Atomic sequence generator, used for human-facing running numbers such as
 * ticket ids. One document per sequence, incremented with `$inc`.
 *
 * The legacy model does not name its collection and does not set timestamps, so
 * Mongoose derives `counters` from the model name. Both are stated explicitly
 * here: the derived name is what the existing data uses, and writing it down
 * removes the chance of a rename by accident.
 */
@Schema({ collection: 'counters', ...noTimestamps })
export class Counter {
  /** The sequence name, e.g. `ticket`. */
  @Prop({ type: String, required: true })
  _id!: string;

  @Prop({ type: Number, default: 0 })
  seq!: number;
}

export const CounterSchema = SchemaFactory.createForClass(Counter);
