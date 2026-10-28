import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

import { legacyTimestamps } from '@/infra/mongo/schema-options';

export type MigrationDocument = HydratedDocument<Migration>;

/**
 * A temporary compatibility shim left behind by a migration.
 *
 * Tracked with a mandatory `review_after` date so a shim cannot quietly become
 * permanent debt: every dual-written field or compatibility view has a date on
 * which someone has to justify keeping it.
 */
@Schema({ _id: false })
export class CompatArtifact {
  @Prop({
    type: String,
    enum: [
      'field',
      'collection_view',
      'index',
      'config_dual_list',
      'loose_validation',
    ],
    required: true,
  })
  type!: string;

  /** Where it lives, e.g. `Hook.line_oa_name` or `line_chat_bot (view)`. */
  @Prop({ type: String, required: true })
  location!: string;

  @Prop({ type: Date, default: Date.now })
  created_at!: Date;

  /** Earliest date the shim may be removed. Required — that is the point. */
  @Prop({ type: Date, required: true })
  review_after!: Date;

  @Prop({ type: Date, default: null })
  removed_at?: Date | null;

  /** Evidence recorded at removal, e.g. "0 reads observed over 30 days". */
  @Prop({ type: String, default: null })
  removal_evidence?: string | null;
}

const CompatArtifactSchema = SchemaFactory.createForClass(CompatArtifact);

/**
 * Migration ledger: which migrations have run, and which shims they still owe.
 *
 * `_id` is a human-readable id (`2026-07-phaseA-additive`) rather than an
 * ObjectId, which is what makes a re-run idempotent.
 */
@Schema({ collection: 'migrations', ...legacyTimestamps })
export class Migration {
  @Prop({ type: String, required: true })
  _id!: string;

  @Prop({
    type: String,
    enum: ['pending', 'in_progress', 'completed', 'rolled_back'],
    default: 'pending',
  })
  status!: string;

  @Prop({ type: Date, default: null })
  started_at?: Date | null;

  @Prop({ type: Date, default: null })
  completed_at?: Date | null;

  @Prop({ type: Date, default: null })
  rolled_back_at?: Date | null;

  @Prop({ type: [CompatArtifactSchema], default: [] })
  compat_artifacts!: CompatArtifact[];

  @Prop({ type: String, default: '' })
  notes!: string;
}

export const MigrationSchema = SchemaFactory.createForClass(Migration);
