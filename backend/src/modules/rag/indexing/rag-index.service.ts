/**
 * [FEAT-20261026-RAGENGINE] Build (or reuse) the retrieval index of one hook's document.
 *
 * Versioning by content: `version` = sha256 of the sections. An edited Training Doc gets a
 * new version on the very next message — legacy's promise that "an edit is seen at once"
 * (`ai/rag-engine.service.ts:337-341`) is kept without a save hook.
 *   · lexical part (chunks + BM25) — rebuilt in process, milliseconds, cached per version;
 *   · vectors (`hybrid` only) — loaded from Mongo by chunk hash; only chunks never embedded
 *     before are sent to the embedder, then the new version is stored.
 * Embedding failure is NOT fatal: the lexical index is still returned and the miss is logged.
 * index ตาม hash ของเนื้อหา · แก้เอกสารแล้วข้อความถัดไปเห็นทันที · embed เฉพาะส่วนที่เปลี่ยน
 */
import { createHash } from 'node:crypto';

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { chunkSections } from '../chunking/structural-chunker';
import { Bm25Index } from '../lexical/bm25-index';
import { RAG_EMBEDDER, type RagEmbedder } from '../ports/embedder.port';
import {
  RAG_VECTOR_STORE,
  type RagVectorStore,
} from '../ports/vector-store.port';
import { RAG_CONFIG } from '../rag.config';
import type { RagSection } from '../rag.types';
import type { RetrievalIndex } from '../retrieval/hybrid-retriever';

export interface IndexRequest {
  hookId: string | null;
  sections: readonly RagSection[];
  wantVectors: boolean;
  apiKey: string | null | undefined;
}

@Injectable()
export class RagIndexService {
  private readonly logger = new Logger('RagIndex');
  private readonly cache = new Map<string, RetrievalIndex>();
  /* Single-flight: a burst of messages right after an edit shares ONE build, so a paid
     embedding batch (and its cap calls) is spent once, not once per message. */
  private readonly building = new Map<string, Promise<RetrievalIndex>>();

  constructor(
    @Inject(RAG_VECTOR_STORE) private readonly store: RagVectorStore,
    @Optional()
    @Inject(RAG_EMBEDDER)
    private readonly embedder: RagEmbedder | null = null,
  ) {}

  static versionOf(sections: readonly RagSection[]): string {
    return createHash('sha256').update(JSON.stringify(sections)).digest('hex');
  }

  /** True when vectors can be produced for this request at all. */
  canEmbed(req: Pick<IndexRequest, 'hookId' | 'apiKey'>): boolean {
    return !!(this.embedder && req.apiKey && req.hookId);
  }

  getIndex(req: IndexRequest): Promise<RetrievalIndex> {
    const version = RagIndexService.versionOf(req.sections);
    const vectors = req.wantVectors && this.canEmbed(req);
    const key = `${req.hookId ?? '-'}|${version}|${vectors ? 'v' : 'l'}`;
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit); // LRU touch
      return Promise.resolve(hit);
    }
    const pending = this.building.get(key);
    if (pending) return pending;
    const build = this.build(req, version, vectors, key).finally(() =>
      this.building.delete(key),
    );
    this.building.set(key, build);
    return build;
  }

  private async build(
    req: IndexRequest,
    version: string,
    vectors: boolean,
    key: string,
  ): Promise<RetrievalIndex> {
    const chunks = chunkSections(req.sections);
    const index: RetrievalIndex = {
      chunks,
      bm25: new Bm25Index(chunks),
      vectors: null,
    };
    if (vectors) {
      try {
        index.vectors = await this.loadVectors(req, version, index);
      } catch (err) {
        this.logger.warn(
          `[RAG] embedding unavailable — lexical only: ${(err as Error).message}`,
        );
        return index; // not cached: the next message may embed successfully
      }
    }
    this.cache.set(key, index);
    while (this.cache.size > RAG_CONFIG.index.cacheEntries) {
      this.cache.delete(this.cache.keys().next().value as string);
    }
    return index;
  }

  private async loadVectors(
    req: IndexRequest,
    version: string,
    index: RetrievalIndex,
  ) {
    const embedder = this.embedder!;
    const hookId = req.hookId!;
    const { chunks } = index;
    const stored = await this.store.load(
      hookId,
      chunks.map((c) => c.hash),
      embedder.model,
      embedder.dim,
    );
    const missing = chunks.filter((c) => !stored.has(c.hash));
    if (missing.length) {
      const fresh = await embedder.embedDocuments(
        missing.map((c) => ({ title: c.heading, text: c.text })),
        req.apiKey!,
        hookId,
      );
      missing.forEach((c, i) => stored.set(c.hash, fresh[i]!));
      await this.store.replace(
        hookId,
        version,
        chunks.map((c) => ({
          ord: c.ord,
          heading: c.heading,
          text: c.text,
          hash: c.hash,
          vector: stored.get(c.hash)!,
        })),
        embedder.model,
        embedder.dim,
      );
      this.logger.log(
        `[RAG] hook=${hookId} indexed ${chunks.length} chunks (${missing.length} embedded)`,
      );
    }
    return chunks.map((c) => stored.get(c.hash) ?? null);
  }

  /** The embedder, for the query side (null in mock mode). */
  get queryEmbedder(): RagEmbedder | null {
    return this.embedder;
  }
}
