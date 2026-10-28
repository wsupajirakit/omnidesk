/**
 * [FEAT-20261026-RAGENGINE] The embedding seam — the ONLY place the engine may spend money.
 *
 * Behind a DI token so specs inject a stub: `z-test/lib/no-ai-outbound.ts` patches only
 * `fetch`, and axios (what the vendor gateway uses) runs on Node's `http` adapter, so a
 * real call would slip past that guard. A spec must never reach the real adapter.
 * `null` binding ⇒ no embedder (mock mode) ⇒ `hybrid` degrades to `bm25`, logged.
 * เทสต้อง inject stub เสมอ — guard ของเทสกัน axios ไม่ได้
 */
export const RAG_EMBEDDER = Symbol('RAG_EMBEDDER');

export interface RagEmbedInput {
  /** Heading breadcrumb, or '' — goes into the document prefix as `title:`. */
  title: string;
  text: string;
}

export interface RagEmbedder {
  readonly model: string;
  readonly dim: number;
  /** One vector per input, same order, L2-normalised. */
  embedDocuments(
    items: readonly RagEmbedInput[],
    apiKey: string,
    hookId: string | null,
  ): Promise<Float32Array[]>;
  /** L2-normalised query vector. */
  embedQuery(
    text: string,
    apiKey: string,
    hookId: string | null,
  ): Promise<Float32Array>;
}
