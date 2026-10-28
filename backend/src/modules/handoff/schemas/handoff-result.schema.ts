import { Prop, raw, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

import { legacyTimestamps } from '@/infra/mongo/schema-options';

export type HandoffResultDocument = HydratedDocument<HandoffResult>;

/** One superseded delivery, kept for audit. Capped by total size, not count. */
@Schema({ _id: false })
export class HandoffResultHistory {
  @Prop({ type: Number })
  seq?: number;

  @Prop({ type: String })
  received_via?: string;

  @Prop({ type: Date })
  received_at?: Date;

  @Prop({ type: Number })
  http_status?: number;

  @Prop({ type: MongooseSchema.Types.Mixed })
  raw?: unknown;

  @Prop({ type: Number })
  raw_bytes?: number;

  @Prop({ type: String })
  raw_sha256?: string;

  @Prop({ type: Boolean })
  truncated?: boolean;
}

const HandoffResultHistorySchema =
  SchemaFactory.createForClass(HandoffResultHistory);

/**
 * Permanent evidence of who opened the raw payload.
 *
 * Capped at 50 entries by the service (via a `$slice` push), not by the schema.
 */
@Schema({ _id: false })
export class HandoffRawView {
  @Prop({ type: Date })
  at?: Date;

  @Prop({ type: String })
  user_id?: string;

  @Prop({ type: String })
  username?: string;
}

const HandoffRawViewSchema = SchemaFactory.createForClass(HandoffRawView);

/** The outbound request exactly as it was sent, frozen at send time. */
export interface HandoffResultRequest {
  method?: string;
  url?: string;
  headers_redacted?: unknown;
  body?: unknown;
  body_bytes?: number;
  redacted_fields?: string[];
  sent_at?: Date;
}

/** The decisive response. */
export interface HandoffResultFinal {
  received_via?: string;
  received_at?: Date;
  http_status?: number;
  content_type?: string;
  headers_redacted?: unknown;
  raw?: unknown;
  raw_text?: string;
  raw_bytes?: number;
  raw_sha256?: string;
  truncated?: boolean;
  truncated_head_bytes?: number;
  truncated_tail_bytes?: number;
  redacted_fields?: string[];
  adapter_version?: number;
  parsed?: unknown;
}

/**
 * The raw verdict for a job — permanent, with no TTL.
 *
 * One row per job, sharing its `_id`. Kept in its own collection rather than as
 * a field on the job on purpose: the storage engine reads a whole document
 * before projecting, so a bloated hot document stays slow even when a query
 * selects around the big fields. Splitting it up front avoids having to split
 * it later with millions of rows in place.
 *
 * The raw payload is kept, not just the parsed verdict, because a money dispute
 * needs hash-backed proof of what the upstream actually answered, an adapter
 * change may require re-parsing it, and fields that are unused today may
 * matter later.
 */
@Schema({
  collection: 'handoff_results',
  ...legacyTimestamps,
  // `_id` is assigned explicitly from the job's id, never auto-generated.
  _id: true,
})
export class HandoffResult {
  /** Equal to the job's `_id`. There is deliberately no other index. */
  @Prop({ type: MongooseSchema.Types.ObjectId })
  _id!: Types.ObjectId;

  @Prop({ type: String, default: '' })
  job_ref!: string;

  @Prop({ type: String, default: '' })
  target_key!: string;

  @Prop({ type: String, default: '' })
  subject_type!: string;

  /** The slip record this result concerns. */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  subject_id?: Types.ObjectId | null;

  /**
   * Stored at the top level as well as inside `context`, so every level names
   * the member without needing a join and the history page can filter on it.
   */
  @Prop({ type: String, default: '' })
  member_user_id!: string;

  /** Links up to the run, which carries the full transaction snapshot. */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  chain_run_id?: Types.ObjectId | null;

  @Prop({ type: Number, default: null })
  chain_step?: number | null;

  /**
   * ══════════════════════════════════════════════════════════════════════
   * [FIX-20260818-CTXATTEMPT] WHICH PASS of the chain produced this row.
   * ══════════════════════════════════════════════════════════════════════
   * `0` = the pass the subject started (a slip arriving). `>0` = a pass the
   * customer asked for by tapping [ลองใหม่]; the value is the run's
   * `resume_cursor`, the same number `_logLeg` already uses as `generation`.
   *
   * WHY IT EXISTS: a run may walk the SAME step more than once, and both the
   * job lookup and the no-job upsert in `payment-runner.service.ts:_context`
   * keyed on (chain_run_id, chain_step[, target_key]) only. So a resume wrote
   * its verdict onto the FIRST pass's row: on production run
   * 6a83e019…1131 the retry's `walletpay_exhausted` landed on a row whose stored
   * request was a walletpay POST that had genuinely succeeded, and the retry
   * itself left no row at all. Owner-reported 18/08/2026.
   *
   * ⚠️ DECLARED, NOT INVENTED. Mongoose drops undeclared paths silently on a
   * plain update but THROWS on one with `upsert: true` — the failure mode
   * `[FIX-20260809-CTXUPSERT]` already cost a whole run. Any new key written by
   * `_context` must be declared here first. ฟิลด์ที่ไม่มีใน schema จะทำ upsert พัง.
   *
   * BACKWARD COMPATIBLE: `default: 0` applies to new documents; rows written
   * before this field existed simply have no `attempt`, which reads as "the
   * first pass" everywhere it is consumed. No migration, no backfill.
   * revert: delete this field and the `attempt` key in `_context`.
   */
  @Prop({ type: Number, default: 0 })
  attempt?: number;

  /**
   * What we sent, for dispute proof. Written once by the worker at send time
   * and then frozen. Headers are redacted — authorization and secret headers
   * are replaced before this is stored — and `redacted_fields` records which
   * ones, so the redaction itself is auditable.
   */
  // raw() keeps these as real nested paths; `@Prop({ type: {...} })` would
  // collapse them into one opaque subdocument path.
  @Prop(
    raw({
      method: String,
      url: String,
      headers_redacted: MongooseSchema.Types.Mixed,
      body: MongooseSchema.Types.Mixed,
      body_bytes: Number,
      redacted_fields: [String],
      sent_at: Date,
    }),
  )
  request?: HandoffResultRequest;

  /**
   * The decisive response. `raw` holds the payload as an object when it is
   * JSON; `raw_text` holds the original text when it is not (XML, form, HTML).
   * `raw_sha256` hashes the PRE-redaction bytes, so it proves integrity of what
   * actually arrived rather than of what we stored.
   */
  @Prop(
    raw({
      received_via: String,
      received_at: Date,
      http_status: Number,
      content_type: String,
      headers_redacted: MongooseSchema.Types.Mixed,
      raw: MongooseSchema.Types.Mixed,
      raw_text: String,
      raw_bytes: Number,
      raw_sha256: String,
      truncated: Boolean,
      truncated_head_bytes: Number,
      truncated_tail_bytes: Number,
      redacted_fields: [String],
      adapter_version: Number,
      parsed: MongooseSchema.Types.Mixed,
    }),
  )
  final?: HandoffResultFinal;

  @Prop({ type: [HandoffResultHistorySchema], default: [] })
  history!: HandoffResultHistory[];

  @Prop({ type: [HandoffRawViewSchema], default: [] })
  raw_views!: HandoffRawView[];

  /**
   * Per-step business audit context: member, slip, statement, outcome, lock and
   * review state. Non-chain results never set it, so it stays null there.
   */
  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  context?: unknown;
}

export const HandoffResultSchema = SchemaFactory.createForClass(HandoffResult);

// No extra indexes on purpose — a result is always fetched by _id.
