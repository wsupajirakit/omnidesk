import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type HandoffCallbackDocument = HydratedDocument<HandoffCallback>;

/**
 * The inbox for inbound callbacks — every one lands here before we try to match
 * it to a job.
 *
 * This exists because a target can call us back BEFORE our own POST response
 * arrives: the job is still `sending` with no external reference, so a match
 * would miss and the result would simply be lost. The inbox is both the parking
 * spot and the audit trail.
 *
 * Note the timestamp options: `created_at` only, no `updated_at`. That is not
 * an oversight — `created_at` drives the TTL below, and there is no reason to
 * churn an update stamp on a write-once record. It is why this schema does not
 * use the shared `legacyTimestamps`.
 */
@Schema({
  collection: 'handoff_callbacks',
  timestamps: { createdAt: 'created_at', updatedAt: false },
})
export class HandoffCallback {
  @Prop({ type: String, default: '' })
  target_key!: string;

  @Prop({ type: Date, default: Date.now })
  received_at!: Date;

  @Prop({ type: String, default: '' })
  remote_ip!: string;

  /**
   * Unique. Taken from the sender's header, or a hash of the raw body when they
   * send none — which is what stops a double-delivered callback creating two
   * rows.
   */
  @Prop({ type: String, required: true })
  event_id!: string;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  headers_redacted?: Record<string, unknown>;

  /** Capped by the controller before it is written. */
  @Prop({ type: String, default: '' })
  body_snippet!: string;

  @Prop({ type: Boolean, default: false })
  truncated!: boolean;

  /**
   * The raw size and hash are recorded for every callback the moment it
   * arrives. Without that, the "permanent raw plus proof hash" guarantee would
   * not hold on the callback path, only on the sync one.
   */
  @Prop({ type: Number, default: 0 })
  raw_bytes!: number;

  @Prop({ type: String, default: '' })
  raw_sha256!: string;

  @Prop({
    type: String,
    enum: ['ok', 'bad_signature', 'unauthorized', 'ip_blocked', 'malformed'],
    default: 'ok',
  })
  auth_result!: string;

  @Prop({
    type: String,
    enum: ['matched', 'pending', 'unmatched', 'ambiguous', 'dismissed'],
    default: 'pending',
  })
  match_status!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  matched_job_id?: Types.ObjectId | null;

  /** Which strategy matched: job_ref, path, external_ref, match_keys or manual. */
  @Prop({ type: String, default: '' })
  matched_by!: string;

  /** Filled in on match, which is what then enables OA scoping on the row. */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  hook_id?: Types.ObjectId | null;

  @Prop({ type: Number, default: 0 })
  rematch_count!: number;

  /** Set when the sweeper ages an unmatched row so it can flow into the TTL. */
  @Prop({ type: Date, default: null })
  auto_dismissed_at?: Date | null;

  @Prop({ type: String, default: '' })
  dismiss_reason!: string;
}

export const HandoffCallbackSchema =
  SchemaFactory.createForClass(HandoffCallback);

// Indexes are applied by a one-shot sync script, not at boot.
HandoffCallbackSchema.index({ event_id: 1 }, { unique: true });
HandoffCallbackSchema.index({ target_key: 1, match_status: 1, created_at: -1 });
HandoffCallbackSchema.index({ matched_job_id: 1 }, { sparse: true });

/**
 * A PARTIAL 30-day TTL: only matched, pending and dismissed rows expire.
 * Unmatched and ambiguous rows persist indefinitely, because undecided evidence
 * must not vanish on a timer. A sweeper ages stale unmatched rows into
 * `dismissed` so junk still cannot accumulate forever.
 *
 * The value must stay identical to the deployed index. Changing this number in
 * code alone raises IndexOptionsConflict, which Mongoose swallows — the old TTL
 * then silently stays in force. Altering it means a collMod or dropIndex first.
 */
HandoffCallbackSchema.index(
  { created_at: 1 },
  {
    expireAfterSeconds: 2_592_000,
    partialFilterExpression: {
      match_status: { $in: ['matched', 'pending', 'dismissed'] },
    },
  },
);
