import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

import { legacyTimestamps } from '@/infra/mongo/schema-options';

export type HandoffHookOverrideDocument = HydratedDocument<HandoffHookOverride>;

/**
 * "This hook uses its own endpoint and credentials for this target."
 *
 * No row means the hook shares the target's main endpoint and credentials, so
 * the absence of a document is itself the default behaviour. This applies to
 * plain fan-out as well as chains, not only the latter.
 *
 * The line is drawn deliberately: only the endpoint and credentials are
 * overridable. Request shape and result parsing stay shared from the target, so
 * every hook honours the same contract.
 *
 * As in the target schema, secrets are FLAT at the top level so the encryption
 * helper's flat field-name list actually matches them — nesting them would
 * store plaintext. Resolution at send time is override value first, target
 * value as fallback.
 *
 * One deliberate exclusion: the web code is NOT stored here. It is always read
 * from the hook itself at send time, so only the secret and endpoint are ever
 * per-hook.
 */
@Schema({ collection: 'handoff_hook_overrides', ...legacyTimestamps })
export class HandoffHookOverride {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  hook_id!: Types.ObjectId;

  /** References a target by key. */
  @Prop({ type: String, required: true })
  target_key!: string;

  @Prop({ type: Boolean, default: true })
  enabled!: boolean;

  /** Empty inherits the target's endpoint. */
  @Prop({ type: String, default: '' })
  endpoint_url!: string;

  /** Empty inherits the target's auth mode. */
  @Prop({ type: String, default: '' })
  auth_mode!: string;

  /**
   * Where the secret comes from. `own` uses `auth_secret` below; `custom_tool`
   * resolves the hook's linked custom-tool key at send time, so no key is typed
   * here at all.
   */
  @Prop({ type: String, enum: ['own', 'custom_tool'], default: 'own' })
  secret_source!: string;

  /** Empty inherits the target's secret. Used when `secret_source` is `own`. */
  @Prop({ type: String, default: '' })
  auth_secret!: string;

  @Prop({ type: String, default: '' })
  auth_password!: string;

  /** Soft delete. */
  @Prop({ type: Date, default: null })
  deleted_at?: Date | null;
}

export const HandoffHookOverrideSchema =
  SchemaFactory.createForClass(HandoffHookOverride);

// One live override per (hook, target) — partial so a soft-deleted pair can be
// recreated. Applied by a one-shot sync script, not at boot.
HandoffHookOverrideSchema.index(
  { hook_id: 1, target_key: 1 },
  { unique: true, partialFilterExpression: { deleted_at: null } },
);
