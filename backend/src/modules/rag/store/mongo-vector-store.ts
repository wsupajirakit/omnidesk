/**
 * [FEAT-20261026-RAGENGINE] Vectors in Mongo, similarity in process — the default store.
 *
 * Mongo 7.0 Community (the server) has no `$vectorSearch`. One hook is a few hundred chunks:
 * 20,000 × 768 cosine measured at ~19 ms on one CPU, a hook's few hundred well under 1 ms.
 * So this store only loads and replaces rows; the retriever does the maths.
 * `replace` writes the new version FIRST and deletes the others AFTER, so a reader computing
 * the new hash never sees a half-written set (worst case: a stale version briefly co-exists).
 * เขียน version ใหม่ก่อน แล้วค่อยลบของเก่า
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import type { RagVectorRow, RagVectorStore } from '../ports/vector-store.port';
import { bufferToVector, vectorToBuffer } from '../vector/vector-math';
import { RagChunkRow } from './schemas/rag-chunk.schema';

/**
 * The stored bytes, whatever shape the driver handed back. `.lean()` returns a BSON `Binary`
 * (`{ buffer, position }`), NOT a Buffer — and `new Uint8Array(binary)` is an EMPTY array.
 * Found live 26/10 with real embeddings: after a restart every cosine read 0.000, so hybrid
 * silently ran as bm25. A hydrated document gives a Buffer, which is a Uint8Array already.
 * ค่าจาก .lean() เป็น Binary ไม่ใช่ Buffer — อ่านผิด = vector ว่าง = cosine 0 ทุกคู่
 */
function bytesOf(v: unknown): Uint8Array | null {
  if (v instanceof Uint8Array) return v;
  const bin = v as { buffer?: unknown; position?: number } | null;
  if (bin && bin.buffer instanceof Uint8Array)
    return bin.buffer.subarray(0, bin.position ?? bin.buffer.length);
  return null;
}

@Injectable()
export class MongoVectorStore implements RagVectorStore {
  constructor(
    @InjectModel(RagChunkRow.name) private readonly rows: Model<RagChunkRow>,
  ) {}

  async load(
    hookId: string,
    hashes: readonly string[],
    model: string,
    dim: number,
  ) {
    const found = new Map<string, Float32Array>();
    if (!Types.ObjectId.isValid(hookId) || !hashes.length) return found;
    const docs = await this.rows
      .find(
        {
          hook_id: new Types.ObjectId(hookId),
          hash: { $in: [...hashes] },
          model,
          dim,
          vector: { $ne: null },
        },
        { hash: 1, vector: 1 },
      )
      .lean();
    for (const d of docs) {
      const bytes = bytesOf(d.vector);
      const vec = bytes ? bufferToVector(bytes) : null;
      // a vector of the wrong size is MISSING (re-embedded), never a silent zero cosine
      if (vec && vec.length === dim) found.set(d.hash, vec);
    }
    return found;
  }

  async replace(
    hookId: string,
    version: string,
    rows: readonly RagVectorRow[],
    model: string,
    dim: number,
  ) {
    if (!Types.ObjectId.isValid(hookId)) return;
    const hook_id = new Types.ObjectId(hookId);
    await this.rows.deleteMany({ hook_id, version });
    if (rows.length) {
      await this.rows.insertMany(
        rows.map((r) => ({
          hook_id,
          version,
          ord: r.ord,
          heading: r.heading,
          text: r.text,
          hash: r.hash,
          vector: vectorToBuffer(r.vector),
          model,
          dim,
        })),
      );
    }
    await this.rows.deleteMany({ hook_id, version: { $ne: version } });
  }
}
