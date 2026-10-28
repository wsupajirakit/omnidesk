import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type RagChunkDocument = HydratedDocument<RagChunkRow>;

/**
 * [FEAT-20261026-RAGENGINE] One embedded chunk of one hook's Training Doc.
 * Approved by the owner 26/10 (dev-local §3): a NEW collection, additive, no existing row
 * touched. Revert = drop the collection.
 *
 * Why its own collection and not a field on the hook: the whole hook document is cached in
 * Redis + in-process on every message (`hooks/hook-cache.service.ts:186-193`); hundreds of
 * 3 KB vectors there would ride every webhook turn.
 * `version` = sha256 of the document text the rows were cut from; a new version replaces the
 * old one, and vectors are reused by `hash` so an edit re-embeds only the changed chunks.
 * vector อยู่ collection แยก — ห้ามยัดลง hook เพราะ hook ถูก cache ทุกข้อความ
 */
@Schema({ collection: 'rag_chunks', versionKey: false })
export class RagChunkRow {
  @Prop({ type: Types.ObjectId, required: true })
  hook_id!: Types.ObjectId;

  @Prop({ type: String, required: true })
  version!: string;

  @Prop({ type: Number, required: true })
  ord!: number;

  @Prop({ type: String, default: '' })
  heading!: string;

  @Prop({ type: String, required: true })
  text!: string;

  @Prop({ type: String, required: true })
  hash!: string;

  /** Little-endian float32 bytes, L2-normalised (`vector/vector-math.ts`). */
  @Prop({ type: Buffer, default: null })
  vector!: Buffer | null;

  @Prop({ type: String, default: null })
  model!: string | null;

  @Prop({ type: Number, default: null })
  dim!: number | null;

  @Prop({ type: Date, default: () => new Date() })
  created_at!: Date;
}

export const RagChunkSchema = SchemaFactory.createForClass(RagChunkRow);
RagChunkSchema.index({ hook_id: 1, version: 1 });
