import { Prop, raw, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

import { legacyTimestamps } from '@/infra/mongo/schema-options';

export type AutoReplyDocument = HydratedDocument<AutoReply>;

/** The group an auto-reply is attributed to, denormalised with its name. */
export interface AutoReplyAssignGroup {
  id?: Types.ObjectId;
  name?: string;
}

/** What gets sent when the keyword matches. */
export interface AutoReplyResponse {
  type?: string;
  text?: string;
  image_url?: string;
  flex_json?: unknown;
}

/** A keyword-triggered canned response, evaluated on every inbound message. */
@Schema({ collection: 'auto_replies', ...legacyTimestamps })
export class AutoReply {
  @Prop({ type: String, trim: true, default: '' })
  name!: string;

  /** Which channel accounts it applies to. Empty means every hook. */
  @Prop({ type: [{ type: MongooseSchema.Types.ObjectId, ref: 'Hook' }] })
  hook_ids?: Types.ObjectId[];

  /**
   * `raw()` keeps this an inline nested path rather than a sub-schema — an
   * inline path materialises `name: ''` on a new document while an un-defaulted
   * sub-schema stays absent, and the legacy schema is inline. Plain
   * `@Prop({ type: {...} })` would lose those nested defaults.
   */
  @Prop(
    raw({
      id: { type: MongooseSchema.Types.ObjectId, ref: 'Group' },
      name: { type: String, default: '' },
    }),
  )
  assign_group?: AutoReplyAssignGroup;

  @Prop({ type: String, required: true, trim: true })
  keyword!: string;

  /** How `keyword` is compared against the inbound text. */
  @Prop({
    type: String,
    enum: ['exact', 'contains', 'regex', 'loose', 'fuzzy'],
    required: true,
  })
  match_type!: string;

  /** Inline nested path — see the note on `assign_group`. */
  @Prop(
    raw({
      type: { type: String, enum: ['text', 'image', 'flex'], required: true },
      text: { type: String },
      image_url: { type: String },
      flex_json: { type: MongooseSchema.Types.Mixed },
    }),
  )
  response?: AutoReplyResponse;

  /**
   * `default: null` rather than `''`: null is an explicit "no mode chosen",
   * distinct from a mode whose name happens to be empty.
   */
  @Prop({ type: String, default: null })
  mode?: string | null;

  /** Higher wins when several rules match the same message. */
  @Prop({ type: Number, default: 0, min: 0, max: 99 })
  priority!: number;

  @Prop({ type: Boolean, default: true })
  active!: boolean;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  created_by?: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  updated_by?: Types.ObjectId;

  /** Soft delete: set instead of removing the document. */
  @Prop({ type: Date })
  deleted_at?: Date;
}

export const AutoReplySchema = SchemaFactory.createForClass(AutoReply);

// Serves the hot path: pick the active rules for this hook, highest priority
// first. The second index covers lookup by keyword within a match strategy.
AutoReplySchema.index({ hook_ids: 1, active: 1, priority: -1 });
AutoReplySchema.index({ match_type: 1, keyword: 1 });
