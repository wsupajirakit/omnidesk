import { Prop, raw, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

import { legacyTimestamps } from '@/infra/mongo/schema-options';

export type HandoffJobDocument = HydratedDocument<HandoffJob>;

/** A reference to an attachment — never the bytes themselves. */
@Schema({ _id: false })
export class HandoffAttachment {
  @Prop({ type: String })
  kind?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId })
  storage_id?: Types.ObjectId;

  @Prop({ type: String })
  url?: string;

  @Prop({ type: String })
  mime?: string;

  @Prop({ type: Number })
  bytes?: number;

  @Prop({ type: String })
  sha256?: string;
}

const HandoffAttachmentSchema = SchemaFactory.createForClass(HandoffAttachment);

/** One delivery attempt. The array is capped by the worker at `retry.max_attempts`. */
@Schema({ _id: false })
export class HandoffAttempt {
  @Prop({ type: Number })
  no?: number;

  @Prop({ type: Date })
  started_at?: Date;

  @Prop({ type: Number })
  duration_ms?: number;

  @Prop({ type: Number })
  http_status?: number;

  @Prop({ type: String })
  error_code?: string;

  @Prop({ type: String })
  error_message?: string;
}

const HandoffAttemptSchema = SchemaFactory.createForClass(HandoffAttempt);

/** Summary of how the decisive result arrived; the raw body lives in HandoffResult. */
export interface HandoffJobResultMeta {
  received_via?: string;
  received_at?: Date;
  http_status?: number;
  adapter_version?: number;
  raw_bytes?: number;
  raw_sha256?: string;
  raw_truncated?: boolean;
  has_raw?: boolean;
}

/** Who triggered a manual send or resend. */
export interface HandoffJobActor {
  user_id?: string;
  username?: string;
}

/**
 * One dispatch to a target — the hot collection of the handoff module.
 *
 * A permanent business record with no TTL: this is the money trail. The
 * reference points one way, out of handoff — a job names its subject by slug
 * and id, and the subject never points back, so the whole module can be removed
 * without touching the slip collection.
 *
 * `snapshot` is Mixed and shaped by the subject registry rather than hardcoded
 * slip fields, so adding a new subject type means adding one file and no
 * migration. The list-column cap on that snapshot is enforced by a test in the
 * registry, not by this schema.
 */
@Schema({ collection: 'handoff_jobs', ...legacyTimestamps })
export class HandoffJob {
  /**
   * Unique public reference, echoed to the target and embedded in the callback
   * URL — which is why it is generated rather than reusing `_id`.
   */
  @Prop({ type: String, required: true })
  job_ref!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  target_id?: Types.ObjectId | null;

  /** Denormalised and immutable, so history survives a target being renamed. */
  @Prop({ type: String, default: '' })
  target_key!: string;

  /** Permanent slug. Existing values must never be changed. */
  @Prop({ type: String, default: '' })
  subject_type!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  subject_id?: Types.ObjectId | null;

  /**
   * Denormalised for OA scoping. Null means only a superadmin sees the row,
   * which is the correct fallback when the inbound event had no hook alias.
   */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  hook_id?: Types.ObjectId | null;

  @Prop({ type: String, default: '' })
  member_user_id!: string;

  /** The inbound message id — one axis of the dedupe key. */
  @Prop({ type: String, default: '' })
  source_event_id!: string;

  /** List-view fields only; the shape is owned by the subject registry. */
  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  snapshot?: Record<string, unknown>;

  /** Shape version, so an old snapshot can still be rendered later. */
  @Prop({ type: Number, default: 1 })
  snapshot_v!: number;

  @Prop({ type: [HandoffAttachmentSchema], default: [] })
  attachments!: HandoffAttachment[];

  @Prop({
    type: String,
    default: 'queued',
    enum: [
      'queued',
      'sending',
      'awaiting_result',
      'succeeded',
      'failed',
      'expired',
      'canceled',
      'unknown',
    ],
  })
  status!: string;

  @Prop({ type: String, default: '' })
  outcome_code!: string;

  /** Trimmed to 500 characters by the service before it is written. */
  @Prop({ type: String, default: '' })
  outcome_message!: string;

  /** The target's own id for this job, when it returns one. */
  @Prop({ type: String, default: '' })
  external_ref!: string;

  // raw() keeps these as real nested paths; `@Prop({ type: {...} })` would
  // collapse them into one opaque subdocument path.
  @Prop(
    raw({
      received_via: String,
      received_at: Date,
      http_status: Number,
      adapter_version: Number,
      raw_bytes: Number,
      raw_sha256: String,
      raw_truncated: Boolean,
      has_raw: Boolean,
    }),
  )
  result_meta?: HandoffJobResultMeta;

  @Prop({ type: Number, default: 1 })
  attempt_seq!: number;

  @Prop({ type: [HandoffAttemptSchema], default: [] })
  attempts!: HandoffAttempt[];

  @Prop({ type: Number, default: 0 })
  attempt_count!: number;

  /** Must have a default — the worker claim query filters on it. */
  @Prop({ type: Date, default: Date.now })
  next_attempt_at!: Date;

  /**
   * Also must default, and to the epoch rather than null: a missing field never
   * matches `{$lt: <Date>}`, so a job without it would be invisible to the
   * worker's claim query forever. Enqueue sets this and `next_attempt_at` in
   * the same insert.
   */
  @Prop({ type: Date, default: () => new Date(0) })
  locked_until!: Date;

  @Prop({ type: String, default: '' })
  lock_owner!: string;

  @Prop({ type: Date, default: null })
  result_deadline_at?: Date | null;

  @Prop({ type: Number, default: 0 })
  poll_count!: number;

  /**
   * Written once at enqueue and then frozen — a retry or poll must never
   * recompute it, or the URL the target was given stops matching.
   */
  @Prop({ type: String, default: '' })
  callback_url_sent!: string;

  @Prop({ type: String, default: '' })
  callback_token_hash!: string;

  @Prop({ type: Date, default: null })
  callback_received_at?: Date | null;

  @Prop({ type: Number, default: 0 })
  callback_count!: number;

  /** Resend chain, kept flat rather than recursive so a walk is one query. */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  root_job_id?: Types.ObjectId | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  parent_job_id?: Types.ObjectId | null;

  /**
   * Ties a step's job to its chain run. Null on every non-chain job, which is
   * what lets the chain-advance hook early-return and leave plain fan-out
   * untouched.
   */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  chain_run_id?: Types.ObjectId | null;

  @Prop({ type: Number, default: null })
  chain_step?: number | null;

  /** Unique when set; empty until enqueue computes it — hence the sparse index. */
  @Prop({ type: String, default: '' })
  dedupe_key!: string;

  /**
   * [FIX-20260818-CTXATTEMPT] WHICH PASS of the chain ran this leg. `0` = the
   * pass the subject started, `>0` = a pass the customer asked for with
   * [ลองใหม่]. Already encoded inside `dedupe_key`, but as a plain field it can
   * be QUERIED — `_context` needs "the job for THIS pass of this step", and
   * `dedupe_key` cannot answer that because two of its callers pass a cursor
   * that is deliberately not a statement index.
   * Mirrors `HandoffResult.attempt`; the pair is what keeps one pass's audit
   * row from overwriting another's. `default: 0` ⇒ old rows read as first pass.
   */
  @Prop({ type: Number, default: 0 })
  attempt!: number;

  @Prop({
    type: String,
    enum: ['auto', 'manual', 'resend'],
    default: 'auto',
  })
  triggered_by!: string;

  @Prop(raw({ user_id: String, username: String }))
  actor?: HandoffJobActor;
}

export const HandoffJobSchema = SchemaFactory.createForClass(HandoffJob);

// Indexes are applied by a one-shot sync script, not at boot.
HandoffJobSchema.index({ job_ref: 1 }, { unique: true });
HandoffJobSchema.index({ dedupe_key: 1 }, { unique: true, sparse: true });

/**
 * Worker claim and sweep. The partial filter keeps this index tiny even at tens
 * of millions of rows, because only in-flight jobs are indexed at all.
 */
HandoffJobSchema.index(
  { status: 1, next_attempt_at: 1 },
  {
    partialFilterExpression: {
      status: { $in: ['queued', 'sending', 'awaiting_result'] },
    },
  },
);
HandoffJobSchema.index({ subject_type: 1, subject_id: 1, created_at: -1 });
HandoffJobSchema.index({ chain_run_id: 1 });
HandoffJobSchema.index({ target_key: 1, status: 1, created_at: -1 });
HandoffJobSchema.index({ created_at: -1 });

/**
 * OA scoping. Deliberately its own index rather than a hook_id prefix on the
 * target_key index above — prefixing that one would stop it serving the main
 * list, which filters by target and status without a hook.
 */
HandoffJobSchema.index({ hook_id: 1, created_at: -1 });
HandoffJobSchema.index({ external_ref: 1 }, { sparse: true });

/** Sparse so subjects that carry no `trans_ref` in their snapshot cost nothing. */
HandoffJobSchema.index({ 'snapshot.trans_ref': 1 }, { sparse: true });
HandoffJobSchema.index({ root_job_id: 1, attempt_seq: 1 });
