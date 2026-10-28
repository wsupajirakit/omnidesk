import { Prop, raw, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

import { legacyTimestamps } from '@/infra/mongo/schema-options';

export type HandoffTargetDocument = HydratedDocument<HandoffTarget>;

/**
 * One rule for reading a verdict out of a target's response.
 *
 * Same shape as the custom-tool result rules and evaluated by the same shared
 * evaluator, so a fix to the interpretation logic lands in both places at once.
 */
@Schema({ _id: false })
export class HandoffResultRule {
  /** Dot-path into the response body. */
  @Prop({ type: String, default: '' })
  path!: string;

  @Prop({
    type: String,
    enum: ['eq', 'neq', 'in', 'exists', 'not_exists', 'contains'],
    default: 'eq',
  })
  op!: string;

  @Prop({ type: String, default: '' })
  value!: string;

  @Prop({ type: String, default: '' })
  http_codes!: string;

  @Prop({ type: String, enum: ['success', 'fail'], default: 'fail' })
  action!: string;

  @Prop({
    type: String,
    enum: ['', 'business', 'config', 'transient', 'system'],
    default: '',
  })
  failure_type!: string;

  @Prop({ type: String, default: '' })
  error_code!: string;

  @Prop({ type: String, default: '' })
  message_path!: string;
}

const HandoffResultRuleSchema = SchemaFactory.createForClass(HandoffResultRule);

/**
 * One OA bound to this target.
 *
 * Modelled as a sub-document array rather than a pair of id arrays
 * (`hook_ids` + `disabled_hook_ids`) so each OA has exactly one source of truth
 * — two parallel arrays would have to be kept in sync forever. It also extends
 * cleanly: a new per-OA field goes here with no migration.
 */
@Schema({ _id: false })
export class HandoffTargetBinding {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  hook_id!: Types.ObjectId;

  /** False keeps the OA's config but stops dispatch to it. */
  @Prop({ type: Boolean, default: true })
  enabled!: boolean;
}

const HandoffTargetBindingSchema =
  SchemaFactory.createForClass(HandoffTargetBinding);

/** Outbound HMAC settings; same shape the custom-tool signer already consumes. */
export interface HandoffTargetAuthHmac {
  algorithm?: string;
  encoding?: string;
  message_template?: string;
  timestamp_unit?: string;
  canonical_json?: boolean;
}

/** How we authenticate to the target when we call it. */
export interface HandoffTargetAuth {
  mode?: string;
  header_name?: string;
  hmac?: HandoffTargetAuthHmac;
  token_url?: string;
  client_id?: string;
  token_expires_at?: Date | null;
}

/** How we authenticate the target when it calls us back. */
export interface HandoffTargetInboundAuth {
  mode?: string;
  header_name?: string;
  signature_algo?: string;
  signed_payload?: string;
  timestamp_header?: string;
  tolerance_sec?: number;
  ip_allowlist?: string[];
}

/** Where the callback URL we hand the target is injected in the request. */
export interface HandoffTargetCallbackInject {
  location?: string;
  field_path?: string;
}

/** The callback URL of ours the target should call. */
export interface HandoffTargetOurCallback {
  mode?: string;
  base_url_override?: string;
  inject?: HandoffTargetCallbackInject;
  include_token?: boolean;
}

/** Polling settings. Reserved — the worker does sync and callback only. */
export interface HandoffTargetPoll {
  endpoint_path?: string;
  interval_sec?: number;
  max_attempts?: number;
}

/** Where the job reference is placed so the target can deduplicate. */
export interface HandoffTargetIdempotency {
  enabled?: boolean;
  location?: string;
  field?: string;
}

/** Which verdicts actually get dispatched. */
export interface HandoffTargetCondition {
  require_subject_success?: boolean;
  require_verdict_tags?: string[];
  allow_duplicate?: boolean;
  allow_out_of_time?: boolean;
  allow_success_not_match?: boolean;
  allow_below_min_amount?: boolean;
  min_amount?: number | null;
}

/** The set of OAs this target is wired to. */
export interface HandoffTargetScope {
  bindings?: HandoffTargetBinding[];
}

export interface HandoffTargetRetry {
  max_attempts?: number;
  backoff_sec?: number[];
}

export interface HandoffTargetThrottle {
  max_concurrent?: number;
  min_interval_ms?: number;
}

/** Circuit-breaker state, stored with the config rather than in Redis. */
export interface HandoffTargetBreaker {
  fail_threshold?: number;
  cooldown_sec?: number;
  state?: string;
  consecutive_failures?: number;
  opened_at?: Date | null;
}

/**
 * An external destination we hand a verified subject (a slip, say) to.
 *
 * Dozens of rows, changed rarely.
 *
 * Secrets are stored FLAT at the top level, not nested under `auth`. That is
 * deliberate and load-bearing: the encryption helper matches a flat list of
 * field names with no dot-path support, so a nested `auth.secret_enc` would be
 * written as plaintext.
 *
 * Several fields carry schema but no reader yet — `reply_type`, `match_type`,
 * `flex_message_id`, the `multipart` attachment mode, the `oauth2_cc` auth mode
 * and the `poll`/`hybrid` result modes. They are stored so configuration and UI
 * can exist before the logic does; wiring them later is additive and needs no
 * migration.
 */
@Schema({ collection: 'handoff_targets', ...legacyTimestamps })
export class HandoffTarget {
  /**
   * Unique among live rows and immutable after creation — old history refers to
   * a target by key. Charset `/^[a-z0-9_-]{1,64}$/` and the no-edit rule are
   * enforced in the controller, not here, because they must be checked before
   * anything else is touched.
   */
  @Prop({ type: String, required: true })
  key!: string;

  @Prop({ type: String, default: '' })
  name!: string;

  /** Adapter file name; validated at boot. */
  @Prop({ type: String, default: '' })
  adapter!: string;

  /** Default off, so deploying a new target sends nothing until enabled. */
  @Prop({ type: Boolean, default: false })
  enabled!: boolean;

  /** Compared against the running environment on every send. */
  @Prop({ type: String, enum: ['dev', 'prod'], required: true })
  env_tag!: string;

  @Prop({ type: [String] })
  subject_types?: string[];

  /**
   * Routing mode: 0 off, 1 pre-send and suppress, 2 pre-send and keep, 3 post.
   * 4 and 5 are reserved. Numeric so adding a mode never needs a migration.
   */
  @Prop({ type: Number, enum: [0, 1, 2, 3, 4, 5], default: 0, required: true })
  action_type!: number;

  /** Reserved: stored so the UI can offer it, but nothing reads it yet. */
  @Prop({ type: Number, enum: [0, 1, 2, 3, 4, 5], default: 0, required: true })
  reply_type!: number;

  /**
   * Reserved multi-select of slip-result cases. Numbers, not labels, so adding
   * a case needs no migration and renaming one never touches the database — the
   * label per number lives in the front end. `[]` means every case.
   */
  @Prop({ type: [Number], enum: [0, 1, 2, 3, 4, 5], default: [] })
  match_type!: number[];

  /** Reserved soft reference to a flex message. No foreign-key check. */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  flex_message_id?: Types.ObjectId | null;

  @Prop({ type: String, default: '' })
  endpoint_url!: string;

  /**
   * Capped at the default, matching the custom-tool limit, so a send can never
   * outlive the lock that guards it.
   */
  @Prop({ type: Number, default: 8000, max: 8000 })
  timeout_ms!: number;

  /**
   * `multipart` is reserved — the adapter builds base64 or none today. A `url`
   * mode is deliberately absent until uploads are served behind signed URLs:
   * the upload path skips auth, so an emitted URL would be a permanent
   * capability link.
   */
  @Prop({
    type: String,
    enum: ['base64', 'multipart', 'none'],
    default: 'base64',
  })
  attachment_mode!: string;

  /**
   * Where the signing key comes from. `own` uses `auth_secret` below, shared by
   * every hook using this target; `custom_tool` resolves the key per firing
   * hook from that hook's linked custom tool, so each signs with its own.
   * A per-hook override still wins over both.
   */
  @Prop({ type: String, enum: ['own', 'custom_tool'], default: 'own' })
  secret_source!: string;

  /** Bearer/apikey/hmac secret, used when `secret_source` is `own`. */
  @Prop({ type: String, default: '' })
  auth_secret!: string;

  @Prop({ type: String, default: '' })
  auth_password!: string;

  /** Reserved, for the OAuth2 client-credentials mode. */
  @Prop({ type: String, default: '' })
  auth_client_secret!: string;

  /** Verifies callbacks the target sends us. */
  @Prop({ type: String, default: '' })
  inbound_secret!: string;

  @Prop({ type: String, default: '' })
  inbound_password!: string;

  @Prop({ type: String, default: '' })
  oauth_access_token!: string;

  /** Direction A: we call them. */
  @Prop(
    raw({
      mode: {
        type: String,
        enum: ['none', 'bearer', 'apikey', 'basic', 'hmac', 'oauth2_cc'],
        default: 'none',
      },
      header_name: { type: String, default: '' },
      hmac: {
        algorithm: { type: String, default: 'sha256' },
        encoding: { type: String, default: 'hex' },
        message_template: { type: String, default: '' },
        timestamp_unit: { type: String, default: 's' },
        canonical_json: { type: Boolean, default: false },
      },
      token_url: { type: String, default: '' },
      client_id: { type: String, default: '' },
      token_expires_at: { type: Date, default: null },
    }),
  )
  auth?: HandoffTargetAuth;

  /**
   * Direction B: they call us.
   *
   * `none` and `ip_allowlist` are intentionally absent as modes — behind a
   * trusted proxy the reported client IP is spoofable, so an allowlist can only
   * ever supplement a signature, never replace one.
   */
  @Prop(
    raw({
      mode: {
        type: String,
        enum: ['hmac', 'bearer', 'basic', 'query_token'],
        default: 'hmac',
      },
      header_name: { type: String, default: 'X-Signature' },
      signature_algo: { type: String, default: 'sha256' },
      signed_payload: {
        type: String,
        enum: ['raw_body', 'timestamp.raw_body'],
        default: 'raw_body',
      },
      timestamp_header: { type: String, default: '' },
      tolerance_sec: { type: Number, default: 300 },
      ip_allowlist: [String],
    }),
  )
  inbound_auth?: HandoffTargetInboundAuth;

  /** The URL of ours we hand the target to call back on. */
  @Prop(
    raw({
      mode: {
        type: String,
        enum: ['per_job', 'static', 'preregistered', 'off'],
        default: 'per_job',
      },
      base_url_override: { type: String, default: '' },
      inject: {
        location: {
          type: String,
          enum: ['body', 'query', 'header', 'none'],
          default: 'body',
        },
        field_path: { type: String, default: 'callback_url' },
      },
      include_token: { type: Boolean, default: true },
    }),
  )
  our_callback?: HandoffTargetOurCallback;

  /** `poll` and `hybrid` are reserved — the worker does sync and callback. */
  @Prop({
    type: String,
    enum: ['sync', 'callback', 'poll', 'hybrid'],
    default: 'sync',
  })
  result_mode!: string;

  @Prop({ type: Number, default: 3600 })
  result_deadline_sec!: number;

  /** Reserved: no polling loop exists yet. */
  @Prop(
    raw({
      endpoint_path: { type: String, default: '' },
      interval_sec: { type: Number, default: 60 },
      max_attempts: { type: Number, default: 10 },
    }),
  )
  poll?: HandoffTargetPoll;

  /** Ordered strategies for tying an inbound callback back to its job. */
  @Prop({ type: [String], default: ['job_ref', 'path', 'external_ref'] })
  match_strategy!: string[];

  /** Last-resort matching keys. More than one match is ambiguous, never guessed. */
  @Prop({ type: [String] })
  match_keys?: string[];

  @Prop({ type: [HandoffResultRuleSchema], default: [] })
  result_rules!: HandoffResultRule[];

  /** The idempotency key sent to the target is the job reference. */
  @Prop(
    raw({
      enabled: { type: Boolean, default: true },
      location: { type: String, enum: ['header', 'body'], default: 'header' },
      field: { type: String, default: 'Idempotency-Key' },
    }),
  )
  idempotency?: HandoffTargetIdempotency;

  /**
   * Which cases get dispatched. These six flags map one-to-one onto the slip
   * verdict cases, which makes this the single gate — `match_type` above stays
   * reserved precisely because this covers the same ground.
   */
  @Prop(
    raw({
      require_subject_success: { type: Boolean, default: true },
      require_verdict_tags: { type: [String], default: ['success'] },
      allow_duplicate: { type: Boolean, default: false },
      allow_out_of_time: { type: Boolean, default: false },
      allow_success_not_match: { type: Boolean, default: false },
      allow_below_min_amount: { type: Boolean, default: false },
      min_amount: { type: Number, default: null },
    }),
  )
  condition?: HandoffTargetCondition;

  /**
   * OA scope. Empty bindings means every OA, matching the older `hook_ids`
   * convention. Dispatch requires the target enabled AND either no bindings or
   * a binding with `enabled: true`.
   */
  @Prop(
    raw({
      bindings: [HandoffTargetBindingSchema],
    }),
  )
  scope?: HandoffTargetScope;

  @Prop({ type: Boolean, default: true })
  allow_resend!: boolean;

  @Prop(
    raw({
      max_attempts: { type: Number, default: 3 },
      backoff_sec: { type: [Number], default: [30, 300, 1800] },
    }),
  )
  retry?: HandoffTargetRetry;

  @Prop(
    raw({
      max_concurrent: { type: Number, default: 2 },
      min_interval_ms: { type: Number, default: 0 },
    }),
  )
  throttle?: HandoffTargetThrottle;

  /**
   * Breaker state lives here rather than in Redis so the state and the config
   * that governs it are one document and cannot drift apart.
   */
  @Prop(
    raw({
      fail_threshold: { type: Number, default: 5 },
      cooldown_sec: { type: Number, default: 300 },
      state: { type: String, enum: ['closed', 'open'], default: 'closed' },
      consecutive_failures: { type: Number, default: 0 },
      opened_at: { type: Date, default: null },
    }),
  )
  breaker?: HandoffTargetBreaker;

  /**
   * Registry-driven flags: user-set values whose keys and types are declared in
   * code, stored as a plain key/value Map and read back typed. Empty means the
   * feature does nothing.
   */
  @Prop({ type: Map, of: MongooseSchema.Types.Mixed, default: {} })
  config!: Map<string, unknown>;

  /** Soft delete, following the broadcast/auto-reply convention. */
  @Prop({ type: Date, default: null })
  deleted_at?: Date | null;
}

export const HandoffTargetSchema = SchemaFactory.createForClass(HandoffTarget);

/**
 * `key` is unique only among live rows, so a soft-deleted key can be recreated.
 * The partial filter is what makes that possible — a plain unique index would
 * make a deleted key unusable forever.
 *
 * Indexes here are applied by a one-shot sync script, not at boot.
 */
HandoffTargetSchema.index(
  { key: 1 },
  { unique: true, partialFilterExpression: { deleted_at: null } },
);
HandoffTargetSchema.index({ enabled: 1, subject_types: 1 });
