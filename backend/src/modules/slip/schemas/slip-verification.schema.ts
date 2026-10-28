import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

import { legacyTimestamps } from '@/infra/mongo/schema-options';

export type SlipVerificationDocument = HydratedDocument<SlipVerification>;

/**
 * The result of verifying a payment slip a customer sent in.
 *
 * `sender_line_user_id` and `sender_member_user_id` are the same value under two
 * names — the channel-neutral rename dual-writes both so reads can move over
 * without a data gap. Both are kept; documents exist carrying either.
 *
 * `virtuals: true` on toJSON/toObject is preserved from the legacy schema
 * because the dashboard reads the populated `line_user` virtual off serialised
 * documents; turning it off would silently drop that field from responses.
 */
@Schema({
  collection: 'slip_verifications',
  ...legacyTimestamps,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
})
export class SlipVerification {
  @Prop({ type: Date, required: true, index: true })
  transaction_date!: Date;

  @Prop({
    type: String,
    enum: ['success', 'failed', 'pending', 'processing'],
    default: 'pending',
    index: true,
  })
  api_status!: string;

  /** The bank's transaction reference — the natural key of a slip. */
  @Prop({ type: String, required: true, index: true })
  trans_ref!: string;

  @Prop({ type: String, index: true })
  sender_account_no?: string;

  @Prop({ type: String })
  sender_account_name?: string;

  @Prop({ type: String, index: true })
  sender_bank?: string;

  @Prop({ type: String, index: true })
  receiver_account_no?: string;

  @Prop({ type: String })
  receiver_account_name?: string;

  @Prop({ type: String, index: true })
  receiver_bank?: string;

  @Prop({ type: String, index: true })
  slip_type?: string;

  @Prop({ type: Number, required: true })
  amount!: number;

  @Prop({ type: String, default: 'Main Branch', index: true })
  branch!: string;

  /** The stored slip image this verification was run against. */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'ImageStorage',
    index: true,
  })
  internal_content_id?: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Hook',
    index: true,
    default: null,
  })
  hook_id?: Types.ObjectId | null;

  /** Legacy name. Superseded by `sender_member_user_id`. */
  @Prop({ type: String, index: true })
  sender_line_user_id?: string;

  /** Channel-neutral name; dual-written with `sender_line_user_id`. */
  @Prop({ type: String, index: true })
  sender_member_user_id?: string;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  raw_content?: unknown;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  raw_response?: unknown;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  raw_request?: unknown;

  /** Defaults to `{}`, unlike the raw_* fields above, which default to null. */
  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  metadata?: Record<string, unknown>;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  callback_response?: unknown;

  /**
   * Slip lock — money safety.
   *
   * Written only by the chain / payment runner's atomic compare-and-set. The
   * ordinary slip flow never reads or writes these five fields, which is what
   * makes the feature removable.
   *
   * A record predating the feature has no `consumed` field at all and counts as
   * unlocked: the runner matches `{$ne: true}`, which covers both missing and
   * false. That is why no backfill was needed.
   */
  @Prop({ type: Boolean, default: false })
  consumed!: boolean;

  /**
   * Informational lock tag (not enum-constrained — the `consumed` boolean is the
   * money gate; this only records WHY).
   *
   * `''` — unlocked.
   * `'success'` — terminal, money moved (topup TRUE, or walletpay matched+confirmed).
   * `'timeout'` — terminal, unknown/timeout on a payment leg ⇒ needs human review
   *   (money may or may not have moved; a hard stop, never auto-retried).
   *
   * [FEAT-20260808-PAYTOOL-P2] two additive values written by the payment runner:
   * `'processing'` — IN-FLIGHT: claimed by the atomic CAS BEFORE leg 1 (topup) so
   *   two concurrent runs on one slip cannot both proceed to topup (money-safety
   *   core). Released back to `''` (with consumed:false) if the run aborts without
   *   moving money; stamped to a terminal reason on a terminal outcome.
   * `'matched_pending'` — terminal, walletpay matched but confirmed:false (awaiting
   *   admin). Kept locked; no retry.
   * lock_reason has no schema enum, so these are additive with no migration and no
   * normalizer/validator to touch. revert: drop this comment note (behaviour reverts
   * with the runner). DB-EFFECT: additive string values, existing rows read as ''.
   */
  @Prop({ type: String, default: '' })
  lock_reason!: string;

  @Prop({ type: Date, default: null })
  consumed_at?: Date | null;

  /** The chain run that took the lock. */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  consumed_by_run?: Types.ObjectId | null;

  /** Index of the statement entry that caused the lock. */
  @Prop({ type: Number, default: null })
  consumed_stmt_idx?: number | null;

  /**
   * ==== [FEAT-20260902-SLIPPROVIDER] who verified this slip ==================
   *
   * The name of the slip-verification provider that produced `raw_response`.
   * Provenance, not configuration: it records a fact about the past, and nothing
   * may write it except the verifier.
   *
   * ABSENT MEANS "nobody recorded a provider for this row" — either it predates
   * the field, or it was written by a path that does not stamp. Every row
   * written before this deploy lacks the key, and that is the whole reason **no
   * backfill is needed** — the same argument `consumed` above makes for the slip
   * lock. Writing a value onto historical rows would destroy the only evidence
   * of which rows predate the change.
   *
   * 🔴 THERE IS NO `default`, AND THAT IS THE POINT. `default: null` was the
   * first version of this Prop and it was wrong: Mongoose materialises a default
   * on create, so **every new row would have carried an explicit `null`** and
   * "absent = predates the field" would have become false the day it deployed —
   * new Swiftcheck rows and legacy rows both reading `null`, indistinguishable.
   * Verified rather than assumed: a Prop with `default: null` puts the key on a
   * fresh document; a Prop without one leaves it off entirely.
   * ⚠️ A query cannot recover the distinction either — Mongo's `{field: null}`
   * matches missing as well, so only `$exists` separates them. Do not add a
   * default back.
   *
   * ⚠️ WHY IT EXISTS: the envelope stored on this row is written in one
   * provider's dialect, and the payment resume path re-reads the hook's tool as
   * it stands NOW. Switch a hook between the pause and the customer's tap and the
   * old envelope would be sent under the new provider's shape, with nothing
   * noticing. This field is what makes that detectable at all.
   *
   * ⚠️⚠️ A NULL STAMP MUST NOT BE RESOLVED THROUGH `DEFAULT_SLIP_PROVIDER`.
   * That constant is present-tense config; this field is a historical fact.
   * Resolve one through the other and the day someone repoints the constant,
   * every legacy row silently re-reads as the new provider — so a comparator
   * would report "no mismatch" on exactly the rows that ARE mismatched. Compare
   * only when the stamp is present, or against a frozen literal that is
   * documented as "what verified rows written before this feature".
   *
   * ⚠️ NOT WRITABLE THROUGH THE API, deliberately. It is absent from
   * `UPDATABLE_FIELDS` and from `SlipVerificationPayloadDto`, so the global
   * `forbidNonWhitelisted` pipe rejects a PUT carrying it. Do not add it to
   * either list — that would open a write path for a provenance stamp.
   *
   * DB-EFFECT: additive, **no `default`**, existing rows untouched, **no
   * migration and no backfill**. Owner approved 02/09/2026; the declaration and
   * a rollback runbook were written before this Prop was added.
   *
   * 🔴 [FIX-20260903-STAMPNOTESTALE] TWO LINES HERE WERE WRONG AND ARE CORRECTED.
   * Kept visible rather than silently edited, because both would have misled a
   * reader in the direction of undoing the decision above.
   *   · this line used to read `DB-EFFECT: additive, default: null` — which
   *     contradicted the 🔴 block above it and the decorator below it. Anyone
   *     reconciling the file by trusting the summary would have added the default
   *     back and destroyed "absent = predates the field".
   *   · it used to say **NOTHING WRITES THIS YET**. That stopped being true when
   *     the stamp landed: `slip-flow.service.ts` writes it at all three variants —
   *     the success row, the `FAIL_` row and the `ERR_` row — so every slip
   *     verified from now on is stamped, and the "absent" reading now means
   *     strictly *"written before this shipped"*.
   *
   * revert: drop this Prop and the three assignments in `slip-flow.service.ts`.
   * Values already written stay in the documents and nothing reads them.
   */
  @Prop({ type: String })
  slip_provider?: string | null;
}

export const SlipVerificationSchema =
  SchemaFactory.createForClass(SlipVerification);

// Free-text search across the reference and both account names.
SlipVerificationSchema.index({
  trans_ref: 'text',
  sender_account_name: 'text',
  receiver_account_name: 'text',
});

/**
 * Dual-write hook — ported from `slipVerificationModel.js:125`.
 *
 * `sender_line_user_id` and `sender_member_user_id` are the same value under
 * two names during the channel-neutral rename. Legacy keeps them in sync on
 * every save, in BOTH directions: a caller that sets only one gets the other
 * filled in.
 *
 * Without this the port persists only the field the caller actually sent, and
 * the detail endpoint's `sender_member_user_id || sender_line_user_id` fallback
 * reads nothing for a row written through the new name — the read looks correct
 * while the write has silently diverged. That is lesson V8: a schema carries
 * fields, not write behaviour, so the hook has to be ported with it.
 *
 * The `undefined` checks mirror legacy exactly. An explicit `null` counts as
 * "set" on both sides and is left alone, which is what legacy does — using a
 * falsiness test here would overwrite a deliberate null and diverge.
 */
SlipVerificationSchema.pre('save', function (this: SlipVerificationDocument) {
  const hasOld = this.sender_line_user_id !== undefined;
  const hasNew = this.sender_member_user_id !== undefined;
  if (hasOld && !hasNew) this.sender_member_user_id = this.sender_line_user_id;
  else if (hasNew && !hasOld)
    this.sender_line_user_id = this.sender_member_user_id;
});

/**
 * Joins to the customer record. Points at the channel-neutral field on both
 * sides, matching the rename — the legacy virtual was re-pointed at the same
 * time the fields were.
 */
SlipVerificationSchema.virtual('line_user', {
  ref: 'Member',
  localField: 'sender_member_user_id',
  foreignField: 'member_user_id',
  justOne: true,
});
