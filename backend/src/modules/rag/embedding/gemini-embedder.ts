/**
 * [FEAT-20261026-RAGENGINE] Gemini embeddings through the vendor gateway.
 *
 * `gemini-embedding-2` takes no `task_type`; the asymmetric retrieval task is set by the
 * documented text prefixes instead:
 *   document → `title: {heading|none} | text: {chunk}`
 *   query    → `task: search result | query: {question}`
 * One request per text inside `batchEmbedContents` — one vector each. Vectors are
 * L2-normalised here regardless of the model, so similarity is a plain dot product.
 * The key is the OA's own (decrypted), sent as a header by `geminiHttpOpts` — never in the URL.
 * ใช้ key ของร้าน ผ่านประตู ai-vendor เท่านั้น
 */
import {
  geminiBatchEmbedUrl,
  geminiHttpOpts,
  postToVendor,
} from '@/modules/ai-vendor';

import { RAG_CONFIG } from '../rag.config';
import type { RagEmbedInput, RagEmbedder } from '../ports/embedder.port';
import { l2Normalise } from '../vector/vector-math';

interface EmbedResponse {
  embeddings?: Array<{ values?: number[] }>;
}

export class GeminiEmbedder implements RagEmbedder {
  readonly model = RAG_CONFIG.embedding.model;
  readonly dim = RAG_CONFIG.embedding.dim;

  private async batch(
    texts: readonly string[],
    apiKey: string,
  ): Promise<Float32Array[]> {
    const body = {
      requests: texts.map((text) => ({
        model: `models/${this.model}`,
        content: { parts: [{ text }] },
        outputDimensionality: this.dim,
      })),
    };
    const res = await postToVendor(
      geminiBatchEmbedUrl(this.model),
      body,
      geminiHttpOpts(apiKey),
    );
    const list = (res.data as EmbedResponse | undefined)?.embeddings ?? [];
    if (list.length !== texts.length) {
      throw new Error(
        `[RAG] embedding answered ${list.length} vectors for ${texts.length} texts`,
      );
    }
    return list.map((e) => l2Normalise(e.values ?? []));
  }

  async embedDocuments(
    items: readonly RagEmbedInput[],
    apiKey: string,
  ): Promise<Float32Array[]> {
    const out: Float32Array[] = [];
    const size = RAG_CONFIG.embedding.batchSize;
    for (let i = 0; i < items.length; i += size) {
      const texts = items
        .slice(i, i + size)
        .map((it) => `title: ${it.title.trim() || 'none'} | text: ${it.text}`);
      out.push(...(await this.batch(texts, apiKey)));
    }
    return out;
  }

  async embedQuery(text: string, apiKey: string): Promise<Float32Array> {
    const [v] = await this.batch(
      [`task: search result | query: ${text}`],
      apiKey,
    );
    return v!;
  }
}
