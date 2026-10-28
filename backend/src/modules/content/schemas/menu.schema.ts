import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

import { legacyTimestamps } from '@/infra/mongo/schema-options';

export type MenuDocument = HydratedDocument<Menu>;

/**
 * A dashboard navigation entry.
 *
 * Menus are the unit roles grant access to (`Role.menu_access`), so the tree is
 * data rather than code. `parent_menu` is a self-reference — a null parent is a
 * top-level item.
 */
@Schema({ collection: 'menus', ...legacyTimestamps })
export class Menu {
  @Prop({ type: String, required: true, trim: true })
  label!: string;

  /** Route path. Unique — see the index below; it is the natural key. */
  @Prop({ type: String, required: true, trim: true })
  path!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Menu' })
  parent_menu?: Types.ObjectId;

  /** Every one of these must be held before the item is rendered. */
  @Prop({ type: [String], default: [] })
  required_permissions!: string[];

  @Prop({ type: Number, default: 0 })
  order!: number;

  @Prop({ type: Boolean, default: true })
  visible!: boolean;

  @Prop({ type: MongooseSchema.Types.Mixed })
  meta?: Record<string, unknown>;

  /** Soft delete: the item disappears from the nav but the row stays. */
  @Prop({ type: Date })
  deleted_at?: Date;
}

export const MenuSchema = SchemaFactory.createForClass(Menu);

MenuSchema.index({ path: 1 }, { unique: true });
