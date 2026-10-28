import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

import { legacyTimestamps } from '@/infra/mongo/schema-options';

export type RoleDocument = HydratedDocument<Role>;

/**
 * A named permission set. Users reference a role, and the permissions it grants
 * are copied into the JWT at login.
 *
 * Ported field-for-field from the legacy `roles` collection — this schema opens
 * documents that already exist, so field names, defaults and indexes are fixed
 * by the data, not chosen here.
 */
@Schema({ collection: 'roles', ...legacyTimestamps })
export class Role {
  @Prop({ type: String, required: true, trim: true, unique: true })
  name!: string;

  @Prop({ type: String, default: '' })
  description!: string;

  /** Permission strings such as `user.manage`; `*` grants everything. */
  @Prop({ type: [String], default: [] })
  permissions!: string[];

  @Prop({ type: [{ type: MongooseSchema.Types.ObjectId, ref: 'Menu' }] })
  menu_access?: Types.ObjectId[];

  @Prop({ type: Boolean, default: true })
  active!: boolean;

  /** Soft delete: set instead of removing the document. */
  @Prop({ type: Date })
  deleted_at?: Date;
}

export const RoleSchema = SchemaFactory.createForClass(Role);
