import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

import { legacyTimestamps } from '@/infra/mongo/schema-options';

export type SystemConfigDocument = HydratedDocument<SystemConfig>;

/** Key/value settings, including the definitions of custom outbound requests. */
@Schema({ collection: 'system_configs', ...legacyTimestamps })
export class SystemConfig {
  @Prop({ type: String, required: true })
  key!: string;

  @Prop({ type: MongooseSchema.Types.Mixed })
  value?: unknown;

  @Prop({ type: Number, default: 0 })
  flag!: number;

  @Prop({ type: String })
  detail?: string;

  @Prop({ type: String })
  path?: string;

  @Prop({ type: Number })
  priority?: number;

  @Prop({ type: Boolean })
  require_jwt?: boolean;

  @Prop({ type: String })
  custom_method?: string;

  @Prop({ type: String })
  custom_x_curl?: string;

  @Prop({ type: String })
  custom_condition?: string;
}

export const SystemConfigSchema = SchemaFactory.createForClass(SystemConfig);

// Indexes match the legacy definitions exactly. Mongo treats an index with the
// same key pattern and options as the existing one, so declaring them here does
// not rebuild anything.
SystemConfigSchema.index({ key: 1 }, { unique: true });
SystemConfigSchema.index({ flag: 1 });
