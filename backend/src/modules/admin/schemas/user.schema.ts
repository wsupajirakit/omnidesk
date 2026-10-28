import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

import { legacyTimestamps } from '@/infra/mongo/schema-options';

export type UserDocument = HydratedDocument<User>;

/**
 * An operator account.
 *
 * Ported field-for-field from the legacy `users` collection. Several defaults
 * below look unusual and are deliberate — see the comments; changing them would
 * change how existing accounts behave.
 */
@Schema({ collection: 'users', ...legacyTimestamps })
export class User {
  @Prop({
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    unique: true,
  })
  username!: string;

  /** PBKDF2 digest. Never selected into a response — see R4/R5 in check-list. */
  @Prop({ type: String, required: true })
  password_hash!: string;

  @Prop({ type: String, default: '' })
  display_name!: string;

  @Prop({ type: String, default: '' })
  email!: string;

  @Prop({ type: String, default: '' })
  phone!: string;

  /** Short-lived key for password reset flows. */
  @Prop({ type: String, default: '' })
  temp_key!: string;

  @Prop({ type: Date })
  temp_key_expires_at?: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Role' })
  role?: Types.ObjectId;

  @Prop({
    type: [{ type: MongooseSchema.Types.ObjectId, ref: 'Group' }],
    default: [],
  })
  groups!: Types.ObjectId[];

  /**
   * Per-OA allowlist.
   *
   * `default: undefined` is load-bearing, not laziness: **absent** means a
   * legacy account that sees every OA in its groups, while an array — including
   * an empty one — means exactly those hooks and nothing else. Defaulting to
   * `[]` would silently revoke access for every account created before the
   * allowlist existed.
   */
  @Prop({
    type: [{ type: MongooseSchema.Types.ObjectId, ref: 'Hook' }],
    default: undefined,
  })
  allowed_hooks?: Types.ObjectId[];

  /**
   * Per-user UI preferences (language, theme, per-table column layout).
   *
   * Mixed and absent by default so an account without it falls back to code
   * defaults — no migration needed. Written lazily on first login or first
   * settings change.
   */
  @Prop({ type: MongooseSchema.Types.Mixed, default: undefined })
  preferences?: Record<string, unknown>;

  @Prop({ type: Boolean, default: true })
  active!: boolean;

  /** Permissions granted directly, on top of whatever the role provides. */
  @Prop({ type: [String], default: [] })
  permissions!: string[];

  /**
   * Bumped to invalidate every token issued before the change — the mechanism
   * behind logout-everywhere and forced re-login after a permission change.
   */
  @Prop({ type: Number, default: 0 })
  token_version!: number;

  @Prop({ type: Date })
  last_login?: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  created_by?: Types.ObjectId | null;

  @Prop({ type: MongooseSchema.Types.Mixed })
  meta?: Record<string, unknown>;

  /** Soft delete: authentication rejects the account but the row stays. */
  @Prop({ type: Date })
  deleted_at?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
