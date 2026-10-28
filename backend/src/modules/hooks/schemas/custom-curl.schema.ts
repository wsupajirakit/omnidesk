import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CustomCurlDocument = HydratedDocument<CustomCurl>;

/**
 * A saved raw cURL command, reused by mappings of type `api_curl`.
 *
 * Timestamps are Mongoose's camelCase defaults here (`createdAt`/`updatedAt`),
 * NOT the snake_case pair the rest of the ported models use: the legacy model
 * declares a plain `timestamps: true`. Rewriting them to `created_at` would make
 * this schema disagree with whatever rows already exist.
 */
@Schema({ collection: 'custom_curls', timestamps: true })
export class CustomCurl {
  @Prop({ type: String, required: true, unique: true, trim: true })
  name!: string;

  @Prop({ type: String, required: true, trim: true })
  full_curl!: string;

  @Prop({
    type: String,
    default: 'GET',
    enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  })
  method!: string;

  @Prop({ type: String, trim: true })
  description?: string;

  @Prop({ type: Boolean, default: true })
  is_active!: boolean;
}

export const CustomCurlSchema = SchemaFactory.createForClass(CustomCurl);
