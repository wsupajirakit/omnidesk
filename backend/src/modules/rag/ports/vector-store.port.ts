/**
 * [FEAT-20261026-RAGENGINE] Where chunk vectors persist between restarts.
 *
 * Default adapter: `store/mongo-vector-store.ts` (Mongo 7.0 Community has no
 * `$vectorSearch`; one hook is a few hundred vectors, so similarity runs in process).
 * Swap the adapter — Mongo 8.2+/mongot, Redis 8 query engine, Qdrant — without touching
 * the retriever: it only ever asks for vectors by content hash.
 * เปลี่ยนที่เก็บ vector ได้โดยไม่แตะ retriever
 */
export const RAG_VECTOR_STORE = Symbol('RAG_VECTOR_STORE');

export interface RagVectorRow {
  ord: number;
  heading: string;
  text: string;
  hash: string;
  vector: Float32Array;
}

export interface RagVectorStore {
  /** Vectors already stored for this hook, by chunk hash (any version — they are content-addressed). */
  load(
    hookId: string,
    hashes: readonly string[],
    model: string,
    dim: number,
  ): Promise<Map<string, Float32Array>>;
  /** Write `version` for this hook, then drop every other version of it. */
  replace(
    hookId: string,
    version: string,
    rows: readonly RagVectorRow[],
    model: string,
    dim: number,
  ): Promise<void>;
}
