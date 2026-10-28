import { Prop, Schema, SchemaFactory, raw } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

import { legacyTimestamps } from '@/infra/mongo/schema-options';

export type CustomToolDocument = HydratedDocument<CustomTool>;

/** Dot-paths pulling customer profile fields out of a third party's response. */
@Schema({ _id: false })
export class EndpointProfileMap {
  @Prop({ type: String, default: '' })
  name!: string;

  @Prop({ type: String, default: '' })
  phone!: string;

  @Prop({ type: String, default: '' })
  code!: string;

  /** Unlike the three above, the value at this path may be an object, a string
   * or a number — readers accept all three rather than forcing one shape. */
  @Prop({ type: String, default: '' })
  tier!: string;
}

/**
 * One ordered success/failure rule evaluated against a response.
 *
 * Many upstreams answer HTTP 200 unconditionally and report the real outcome in
 * the body, so judging by status alone recorded failed account links as
 * successes. Rules are evaluated in order, first match wins, and the operator
 * set is intentionally flat (no nested AND/OR): a config language with
 * conditionals is a programming language without a debugger or tests.
 */
@Schema({ _id: false })
export class EndpointResultRule {
  @Prop({ type: String, default: '' })
  path!: string;

  @Prop({
    type: String,
    enum: ['eq', 'neq', 'in', 'exists', 'not_exists', 'contains'],
    default: 'eq',
  })
  op!: string;

  /** Comma-separated when `op` is `in`. */
  @Prop({ type: String, default: '' })
  value!: string;

  /** Match on HTTP status instead of the body, e.g. "429,503". */
  @Prop({ type: String, default: '' })
  http_codes!: string;

  @Prop({ type: String, enum: ['success', 'fail'], default: 'fail' })
  action!: string;

  /** Whose fault it was — drives retry, alerting and what the customer sees. */
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

const EndpointResultRuleSchema =
  SchemaFactory.createForClass(EndpointResultRule);

/** Maps a write endpoint's response back onto our own field names. */
@Schema({ _id: false })
export class EndpointResultMap {
  @Prop({ type: String, default: '' })
  member_id!: string;

  @Prop({ type: String, default: '' })
  phone!: string;

  @Prop({ type: String, default: '' })
  name!: string;
}

/**
 * Safe-retry settings for an endpoint.
 *
 * A timeout is not a failure, it is an unknown outcome: the upstream may or may
 * not have applied the change. An idempotency key makes the retry safe. There
 * is no cross-vendor standard for where the key goes, hence the configurable
 * header-or-body location and field name.
 *
 * Disabled by default — enabling it when the upstream ignores the key turns
 * retries into genuine duplicate requests.
 */
@Schema({ _id: false })
export class EndpointIdempotency {
  @Prop({ type: Boolean, default: false })
  enabled!: boolean;

  @Prop({ type: String, enum: ['header', 'body'], default: 'header' })
  location!: string;

  @Prop({ type: String, default: 'Idempotency-Key' })
  field!: string;

  /** Retries apply to timeouts/network errors only. A 4xx/5xx response is a
   * known outcome and is never retried. */
  @Prop({ type: Number, default: 1, min: 0, max: 3 })
  retry_on_timeout!: number;
}

/**
 * One callable endpoint on a tool.
 *
 * `_id: true` (Mongoose's default for subdocuments) is kept so the frontend can
 * edit or delete an individual row by id.
 */
@Schema({ _id: true })
export class CustomToolEndpoint {
  /** Code-facing name, unique within a tool — duplicates make `find()` return
   * the first and lose the rest silently. */
  @Prop({ type: String, required: true, trim: true, uppercase: true })
  key!: string;

  @Prop({ type: String, default: '' })
  label!: string;

  @Prop({ type: String, enum: ['auth', 'data', 'write'], default: 'data' })
  purpose!: string;

  @Prop({
    type: String,
    enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    default: 'GET',
    uppercase: true,
    required: true,
  })
  method!: string;

  @Prop({ type: String, required: true, trim: true })
  path!: string;

  /**
   * ==== [FEAT-20260903-TOPUPPERPROVIDER] which slip provider this record serves
   *
   * `''` / absent = **serves every provider**, which is what every record holds
   * today and what keeps Swiftcheck working with nothing configured (RULE B). Set it
   * only when a vendor genuinely needs its own Shop-API path.
   *
   * WHY: `shop-api/v1/customer/validate-slip` was written for Swiftcheck's envelope, so
   * a second vendor may need a different path on the customer's Shop-API. Selection
   * matches this against the slip ROW'S provenance stamp — who actually verified
   * that slip — not against the hook's current setting, because a resume can run
   * after the config changed.
   *
   * ⚠️ MEANINGFUL ONLY ON A `pay_topup` RECORD. `pay_walletpay` is deliberately NOT
   * split per provider (owner, 03/09): its body is built from the shared envelope,
   * so there is nothing vendor-shaped to route on.
   *
   * ⚠️ NOT A SECRET, and not an enum: the value list lives in the slip provider
   * register and is served to the dashboard by `GET /api/field-options/slip_provider`,
   * so there is no vendor list in the front end and none here either.
   *
   * DB-EFFECT: additive string, `default: ''`, existing records untouched, no
   * migration. revert: drop this Prop, its `normalizeEndpoints` line and
   * `payment-endpoint.helper.ts`.
   */
  @Prop({ type: String, default: '' })
  slip_provider!: string;

  @Prop({ type: Boolean, default: true })
  require_jwt!: boolean;

  @Prop({ type: Boolean, default: false })
  is_login!: boolean;

  @Prop({ type: Boolean, default: false })
  is_refresh!: boolean;

  @Prop({
    type: String,
    enum: ['json', 'form', 'form-data'],
    default: 'json',
  })
  request_type!: string;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  payload!: Record<string, unknown>;

  @Prop({ type: String, default: 'data.access_token' })
  token_path!: string;

  @Prop({ type: String, default: 'data.refresh_token' })
  refresh_token_path!: string;

  /** At most one per tool — the webhook has to know which endpoint yields the
   * customer profile without hardcoding a key name. */
  @Prop({ type: Boolean, default: false })
  is_profile!: boolean;

  /**
   * What this endpoint is *for*, so callers select it by role instead of by key
   * name. Renaming a key would otherwise break lookups silently.
   *
   * `''` is the compatibility default: tools written before roles existed fall
   * back to key-name matching, so nothing needs migrating.
   */
  @Prop({
    type: String,
    enum: [
      '',
      'profile',
      'link',
      'edit',
      'unlink',
      'login',
      'refresh',
      'site_rules',
      'other',
      // [FEAT-20260808-PAYTOOL-P1] two additive role values for the payment
      // category's ordered legs. The schema routes by role (not key name), so
      // no other endpoint field changes. revert: drop these two enum members.
      'pay_topup',
      'pay_walletpay',
    ],
    default: '',
  })
  role!: string;

  /**
   * Seconds to cache a successful response, shared across OAs.
   *
   * `null`/`0` means no caching, which is the original behaviour. Never set on
   * a per-customer endpoint (`is_profile`/`role: profile`) — one customer would
   * be served another's data.
   */
  @Prop({ type: Number, default: null, min: 0, max: 86400 })
  cache_ttl_sec?: number | null;

  /** ⚠️ `raw()`, not a sub-schema — V4, same reasoning as `hmac` below. */
  @Prop(
    raw({
      name: { type: String, default: '' },
      phone: { type: String, default: '' },
      code: { type: String, default: '' },
      tier: { type: String, default: '' },
    }),
  )
  profile_map?: EndpointProfileMap;

  /** Fail-closed: rules present but none matching counts as a failure, so a new
   * upstream error code reads as an error rather than a success. */
  @Prop({ type: [EndpointResultRuleSchema], default: [] })
  result_rules!: EndpointResultRule[];

  /** ⚠️ `raw()`, not a sub-schema — V4. */
  @Prop(
    raw({
      member_id: { type: String, default: '' },
      phone: { type: String, default: '' },
      name: { type: String, default: '' },
    }),
  )
  result_map?: EndpointResultMap;

  /**
   * ⚠️ `raw()`, not a sub-schema — V4.
   *
   * Note `retry_on_timeout` defaults to 1 here while the write-path normaliser
   * coerces an absent value to 0. That mismatch is legacy's
   * (customToolModel.js:298 vs customToolController.js:183) and is preserved:
   * the normaliser always supplies a value on an API write, so the schema
   * default only applies to rows written directly by a script.
   */
  @Prop(
    raw({
      enabled: { type: Boolean, default: false },
      location: { type: String, enum: ['header', 'body'], default: 'header' },
      field: { type: String, default: 'Idempotency-Key' },
      retry_on_timeout: { type: Number, default: 1, min: 0, max: 3 },
    }),
  )
  idempotency?: EndpointIdempotency;

  /** Disables one endpoint without deleting the row. */
  @Prop({ type: Boolean, default: true })
  status!: boolean;
}

const CustomToolEndpointSchema =
  SchemaFactory.createForClass(CustomToolEndpoint);

/**
 * HMAC request-signing recipe, used when `auth_type` is `hmac_signature`.
 *
 * The shared secret reuses the tool's `api_key` field rather than adding a new
 * one, because that field is already encrypted at rest and already carries the
 * "blank means unchanged" edit convention.
 *
 * Every value defaults to empty/null meaning "use the signer's built-in
 * defaults", so a new tool works with only a secret filled in.
 */
@Schema({ _id: false })
export class CustomToolHmac {
  /** Blank = sha256. */
  @Prop({ type: String, default: '' })
  algorithm!: string;

  /** Blank = hex. */
  @Prop({ type: String, default: '' })
  encoding!: string;

  @Prop({ type: String, default: '' })
  message!: string;

  /** Headers to attach; null = the signer's default pair. */
  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  headers?: Record<string, unknown> | null;

  @Prop({ type: String, default: '' })
  timestamp_unit!: string;

  /** null = the signer's default (true). */
  @Prop({ type: Boolean, default: null })
  canonical_json?: boolean | null;

  /** Field name carrying the site code; vendors call it site_code, agent_id… */
  @Prop({ type: String, default: '' })
  web_code_field!: string;
}

/**
 * A third-party API integration: one auth context plus the endpoints that share
 * it.
 *
 * The rule that shapes this collection: **1 tool = 1 auth context**. Same host
 * and same credentials means one tool with more endpoints; different host or
 * different credentials means a separate tool. Endpoints are embedded rather
 * than a separate collection precisely so an endpoint cannot be repointed at
 * the wrong credentials by editing a foreign key.
 *
 * There is deliberately no `hook_id`/`oa_ids[]` here. The hook→tool link is
 * stored once, on the hook (`Hook.custom_tool_id`); a reverse copy would be a
 * second source of truth that nothing could reconcile when the two disagreed.
 * "Which OAs use this tool" is a query, not a stored field.
 */
@Schema({ collection: 'custom_tools', ...legacyTimestamps })
export class CustomTool {
  @Prop({ type: String, required: true, unique: true, trim: true })
  name!: string;

  @Prop({ type: String, default: '' })
  description!: string;

  @Prop({ type: String, required: true, trim: true })
  base_url!: string;

  @Prop({
    type: String,
    enum: ['jwt_login', 'api_key', 'basic', 'none', 'hmac_signature'],
    default: 'jwt_login',
  })
  auth_type!: string;

  /**
   * [FEAT-20260808-PAYTOOL-P1] Tool-level category discriminator.
   *
   * `'generic'` = today's behaviour, byte-identical: a defaulted field
   * materialises the same value legacy would, so every stored tool and every
   * create that omits it reads back exactly as before. `'payment'` marks a tool
   * whose endpoints carry the ordered payment legs (roles `pay_topup`/
   * `pay_walletpay`). No migration — pre-feature rows read as `'generic'`.
   *
   * DB-EFFECT: additive, default `'generic'`; existing rows read as legacy/off.
   * revert: drop this @Prop (and the three-place wiring in custom-tool-normalize
   * + custom-tool-validate + custom-tools.service).
   */
  /* [FEAT-20260815-WALLETPAYCAT] `'walletpay'` added. Kept in sync BY HAND with
     `TOOL_CATEGORIES` in custom-tool-normalize.ts — Mongoose needs a literal
     here, and a value missing from this enum is rejected on save with a
     validation error rather than a silent write.
     revert: drop 'walletpay' from both places together. */
  @Prop({
    type: String,
    enum: ['generic', 'payment', 'walletpay'],
    default: 'generic',
  })
  category!: string;

  /**
   * [FEAT-20260808-PAYTOOL-P2] Revisable payment knobs (owner: "เผื่อแก้ไข").
   *
   * Deliberately `Mixed` with NO default, so it is ABSENT on every generic tool
   * — a materialised default (as `hmac` has) would add a second key to every
   * generic tool response and break the byte-identical golden. It is written
   * ONLY for a `category:'payment'` tool, by `normalizePayment` on the write
   * path (the mandatory 2-place discipline: a schema field not whitelisted in
   * custom-tool-normalize is silently dropped on save — see that file's header).
   *
   * The runner reads each key with a hardcoded fallback, so an empty/absent
   * block still runs (topup→walletpay is a fixed pair; only these knobs vary):
   *   statement_tx_path        — dot-path in Member.raw_profile_data to the
   *                              transaction object (default 'data.profile.transaction').
   *   statement_provider_code  — which statements are walletpay's (default 'walletpay').
   *   statement_status         — extra status filter, '' = off (default 'waiting-deposit').
   *   walletpay_ref_id_field      — field on a statement entry holding the refId or an
   *                              upload URL (default 'ref_id').
   *   walletpay_ref_id_query_param— if that value is a URL, the query param to extract
   *                              (default 'refid'; e.g. ?refid=<uuid>).
   *   walletpay_file_field        — multipart file field for the slip image (default 'slip').
   *   topup_to_walletpay_map      — TBD field link topup-response → walletpay body (default {}).
   *   pending_reply_text       — MATCHED_PENDING reply placeholder (default '').
   *   reply_detail             — [P2B] optional DETAIL text for the "mint" button in
   *                              the payment reply (the description, not the label).
   *                              Stored '' when absent; runner falls back to "-".
   *
   * DB-EFFECT: additive, absent on existing/generic rows, no migration.
   * revert: drop this @Prop + normalizePayment + its create/update wiring.
   */
  @Prop({ type: MongooseSchema.Types.Mixed })
  payment?: Record<string, unknown>;

  @Prop({ type: String, default: '' })
  username!: string;

  /** Encrypted at rest, together with `api_key`. */
  @Prop({ type: String, default: '' })
  password!: string;

  @Prop({ type: String, default: '' })
  api_key!: string;

  @Prop({ type: String, default: 'Authorization' })
  api_key_header!: string;

  /**
   * ⚠️ `raw({...})`, NOT `SchemaFactory.createForClass(CustomToolHmac)` — V4.
   *
   * Legacy declares this as an INLINE NESTED PATH (customToolModel.js:367-378),
   * and an inline path materialises its defaults on a newly created document. A
   * sub-schema does not: it stays `undefined` until something assigns to it.
   *
   * The difference is invisible on reads of existing rows — every stored
   * document already has the object — and shows up only on create. It was
   * caught by the golden diff reporting `missing: data.hmac` on POST
   * /api/custom-tools: legacy answered with the defaulted object, this service
   * omitted the key entirely, and the form that reads `hmac.algorithm` would
   * have thrown on a freshly created tool.
   *
   * The `CustomToolHmac` class below is retained for its type and its
   * documentation; only the storage declaration changed.
   */
  @Prop(
    raw({
      algorithm: { type: String, default: '' },
      encoding: { type: String, default: '' },
      message: { type: String, default: '' },
      headers: { type: MongooseSchema.Types.Mixed, default: null },
      timestamp_unit: { type: String, default: '' },
      canonical_json: { type: Boolean, default: null },
      web_code_field: { type: String, default: '' },
    }),
  )
  hmac?: CustomToolHmac;

  @Prop({ type: Number, default: 8000 })
  timeout_ms!: number;

  /** Disabling the tool stops every OA referencing it at once. */
  @Prop({ type: Boolean, default: true })
  status!: boolean;

  @Prop({ type: [CustomToolEndpointSchema], default: [] })
  endpoints!: CustomToolEndpoint[];

  /**
   * Stored as user ids, not names: names change and repeat, ids do not. The
   * name as it read at the time is preserved separately in the audit log.
   */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  created_by?: Types.ObjectId | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  updated_by?: Types.ObjectId | null;

  /** Soft delete — hooks may still reference the row, and deletions must stay
   * traceable. Every query has to filter on `deleted_at: null`. */
  @Prop({ type: Date, default: null })
  deleted_at?: Date | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  deleted_by?: Types.ObjectId | null;
}

export const CustomToolSchema = SchemaFactory.createForClass(CustomTool);

// Backs the admin list and the tool dropdown on the hook form.
CustomToolSchema.index({ status: 1, deleted_at: 1 });
