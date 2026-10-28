import { Prop, raw, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

import { legacyTimestamps } from '@/infra/mongo/schema-options';

export type HandoffChainDocument = HydratedDocument<HandoffChain>;

/**
 * One step: run a target, classify the outcome, then route.
 *
 * Only clean TRUE and FALSE are routed by `on_true`/`on_false`. A TIMEOUT on a
 * payment step is NOT routed here — the runner handles it as a hard stop that
 * locks the slip and raises the review flag, because a timed-out payment may or
 * may not have moved money and must never silently continue.
 */
@Schema({ _id: false })
export class HandoffChainStep {
  /** Sort key. Reordering means changing this value; order is not positional. */
  @Prop({ type: Number, required: true })
  order!: number;

  /** References a target by key, so an activity is reusable across chains. */
  @Prop({ type: String, required: true })
  target_key!: string;

  @Prop({ type: Boolean, default: true })
  enabled!: boolean;

  /** Money-moving. Makes a TIMEOUT a hard stop with a lock and a review flag. */
  @Prop({ type: Boolean, default: false })
  is_payment!: boolean;

  /** continue = next enabled step by order, stop = end silently, reply = answer. */
  @Prop({
    type: String,
    enum: ['continue', 'stop', 'reply'],
    default: 'reply',
  })
  on_true!: string;

  @Prop({
    type: String,
    enum: ['continue', 'stop', 'reply'],
    default: 'continue',
  })
  on_false!: string;

  /**
   * Optional per-step override of how TRUE is read from the response. Null
   * inherits the target's own result rules. Reuses the result-rule shape so no
   * second evaluator has to exist.
   */
  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  success_when?: unknown;
}

const HandoffChainStepSchema = SchemaFactory.createForClass(HandoffChainStep);

/** One OA bound to this chain. */
@Schema({ _id: false })
export class HandoffChainBinding {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  hook_id!: Types.ObjectId;

  @Prop({ type: Boolean, default: true })
  enabled!: boolean;
}

const HandoffChainBindingSchema =
  SchemaFactory.createForClass(HandoffChainBinding);

/** The set of OAs this chain runs for. */
export interface HandoffChainScope {
  bindings?: HandoffChainBinding[];
}

/**
 * How to find the statement array inside the member's raw profile data.
 *
 * These are configuration, not constants, because the raw block differs per
 * provider. The defaults describe the one provider live today and must not be
 * treated as fixed once a second is onboarded.
 */
export interface HandoffChainStatement {
  path?: string;
  start_index?: number;
  raw_transaction_path?: string;
  walletpay_tx_path?: string;
  walletpay_provider_code?: string;
}

/**
 * An ordered chain of handoff targets run as one sequence.
 *
 * A chain is SHARED across OAs — same steps and order for every bound OA. Per-OA
 * differences in endpoint or credentials live in the hook-override collection,
 * never here, so a chain has exactly one definition.
 *
 * Dormant by default: nothing runs unless the feature flag is on, the chain is
 * enabled, and an OA is bound. With any of those missing, plain fan-out behaves
 * exactly as before.
 */
@Schema({ collection: 'handoff_chains', ...legacyTimestamps })
export class HandoffChain {
  /** Unique among live rows, immutable, charset `/^[a-z0-9_-]{1,64}$/`. */
  @Prop({ type: String, required: true })
  key!: string;

  @Prop({ type: String, default: '' })
  name!: string;

  /** Master toggle per chain. Default off. */
  @Prop({ type: Boolean, default: false })
  enabled!: boolean;

  /** Compared against the running environment on every run. */
  @Prop({ type: String, enum: ['dev', 'prod'], required: true })
  env_tag!: string;

  @Prop({ type: [String] })
  subject_types?: string[];

  /**
   * Which OAs run this chain. Empty bindings means NONE — the opposite of the
   * target collection, where empty means all. A chain is opt-in: it must be
   * explicitly bound before it can fire.
   */
  @Prop(raw({ bindings: [HandoffChainBindingSchema] }))
  scope?: HandoffChainScope;

  @Prop({ type: [HandoffChainStepSchema], default: [] })
  steps!: HandoffChainStep[];

  @Prop(
    raw({
      path: { type: String, default: 'data' },
      start_index: { type: Number, default: 0 },
      raw_transaction_path: {
        type: String,
        default: 'data.profile.transaction',
      },
      walletpay_tx_path: { type: String, default: 'data.profile.transaction' },
      walletpay_provider_code: { type: String, default: 'walletpay' },
    }),
  )
  statement?: HandoffChainStatement;

  /** Soft delete. */
  @Prop({ type: Date, default: null })
  deleted_at?: Date | null;
}

export const HandoffChainSchema = SchemaFactory.createForClass(HandoffChain);

// Unique only among live rows, so a soft-deleted key can be recreated.
// Applied by a one-shot sync script, not at boot.
HandoffChainSchema.index(
  { key: 1 },
  { unique: true, partialFilterExpression: { deleted_at: null } },
);
HandoffChainSchema.index({ enabled: 1, subject_types: 1 });
