import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

import { legacyTimestamps } from '@/infra/mongo/schema-options';

export type HandoffChainRunDocument = HydratedDocument<HandoffChainRun>;

/**
 * One execution of a chain for one slip.
 *
 * Holds the run state — cursor and status — and the reference that ties every
 * step's job and result together: their `chain_run_id` is this document's `_id`.
 * The per-step logs stay in their own collections; only the linkage lives here.
 *
 * Dormant: a row exists only once the flag-guarded chain runner starts a run.
 */
@Schema({ collection: 'handoff_chain_runs', ...legacyTimestamps })
export class HandoffChainRun {
  @Prop({ type: String, required: true })
  chain_key!: string;

  @Prop({ type: String, enum: ['dev', 'prod'], required: true })
  env_tag!: string;

  /** The OA this run belongs to. */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  hook_id?: Types.ObjectId | null;

  @Prop({ type: String, default: '' })
  member_user_id!: string;

  @Prop({ type: String, default: '' })
  subject_type!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  subject_id?: Types.ObjectId | null;

  /** Explicit link to the slip record, alongside the generic `subject_id`. */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  slip_record_id?: Types.ObjectId | null;

  /**
   * The run is the highest level, so it carries the whole transaction snapshot
   * once and the levels below it do not duplicate the blob. Store-only and
   * null-safe — a customer may have no transaction at all.
   */
  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  raw_transaction?: unknown;

  /**
   * `locked_review` is the payment-timeout terminal state: the slip is locked
   * and flagged, and a human has to resolve it. It is a hard stop, never
   * retried automatically.
   *
   * `awaiting_retry` — [FIX-20260811-RETRYSCHEMA] paused, waiting for the
   * customer to tap [ลองใหม่]. The runner has always written this value
   * (`payment-runner.service.ts:1620`) but it was missing from this enum, so it
   * was only ever accepted because `updateOne` skips enum validation — a
   * `create`/`save` on the same value would have thrown.
   */
  @Prop({
    type: String,
    enum: [
      'running',
      'succeeded',
      'stopped',
      'replied',
      'locked_review',
      'failed',
      'awaiting_retry',
    ],
    default: 'running',
  })
  status!: string;

  /** Statement index; a retry advances it by one. */
  @Prop({ type: Number, default: 0 })
  cursor!: number;

  /* ==== [FIX-20260811-RETRYSCHEMA] the two fields the [ลองใหม่] tap needs ====
   *
   * 🔴 WITHOUT THESE THE RETRY BUTTON NEVER WORKED. `@Schema()` here sets no
   * `strict`, so mongoose's default `strict: true` applies and STRIPS any field
   * the schema does not declare — silently. The pause wrote them
   * (`payment-runner.service.ts:1615-1628`), `updateOne` answered
   * `modifiedCount: 1`, and neither value reached the database. The claim in
   * `_resume` filters on `resume_cursor`, so it matched nothing and every tap
   * answered `stale_retry`.
   *
   * PROVEN BY RUNNING IT (2026-08-11), not by reading: writing both on a real
   * row through this model, then reading the raw document back, showed
   * `resume_cursor: undefined` and `awaiting_retry_at: undefined`, and the
   * `_resume` claim returned `null`.
   *
   * WHY NOBODY HIT IT: no run had ever reached the pause path in this database
   * (`awaiting_retry` count was 0), and the runner unit tests mock `runModel`
   * as a plain object array (`paytool-p2-runner.spec.ts:491`) which no schema
   * ever touches — so `(D7b)` asserted `resume_cursor === 1` and passed while
   * production dropped it. เทสเขียวเพราะ mock ไม่ผ่าน schema.
   *
   * ⚠️ ADDITIVE, NO MIGRATION. Existing rows simply do not carry them and read
   * as `undefined`, exactly as they do today.
   *
   * revert: delete these two props and `'awaiting_retry'` above — the retry
   * button goes back to answering `stale_retry` on every tap. */

  /** Statement index the [ลองใหม่] tap resumes FROM (`cursor + 1`). */
  @Prop({ type: Number, default: null })
  resume_cursor?: number | null;

  /** When the run was paused — lets an operator see how long a tap has been owed. */
  @Prop({ type: Date, default: null })
  awaiting_retry_at?: Date | null;

  @Prop({ type: Number, default: null })
  current_step_order?: number | null;

  /**
   * Reply-first: the token from the customer's own event, tried before falling
   * back to a push. Short-lived and single-use — if it has expired the worker
   * pushes instead.
   */
  @Prop({ type: String, default: '' })
  reply_token!: string;

  /** Raised by any step that needs a human to look at the run. */
  @Prop({ type: Boolean, default: false })
  needs_review!: boolean;

  @Prop({ type: Date, default: null })
  started_at?: Date | null;

  @Prop({ type: Date, default: null })
  ended_at?: Date | null;
}

export const HandoffChainRunSchema =
  SchemaFactory.createForClass(HandoffChainRun);

// Indexes are applied by a one-shot sync script, not at boot.
HandoffChainRunSchema.index({ slip_record_id: 1 });
HandoffChainRunSchema.index({ status: 1, chain_key: 1 });
HandoffChainRunSchema.index({ needs_review: 1 });

/**
 * The history list has to scale without a collection scan: it sorts by
 * created_at descending unfiltered, and filters by member for search. Without
 * these two, both paths degrade into an in-memory sort once runs reach the
 * millions.
 */
HandoffChainRunSchema.index({ created_at: -1 });
HandoffChainRunSchema.index({ member_user_id: 1, created_at: -1 });
