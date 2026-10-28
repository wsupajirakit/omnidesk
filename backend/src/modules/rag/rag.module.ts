import { Module } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

import { aiConfig } from '@/config/app.config';

import { selectRagEmbedder } from './embedding/embedder.factory';
import { RagIndexService } from './indexing/rag-index.service';
import { RAG_EMBEDDER } from './ports/embedder.port';
import { RAG_VECTOR_STORE } from './ports/vector-store.port';
import { RagRetrievalService } from './rag-retrieval.service';
import { MongoVectorStore } from './store/mongo-vector-store';
import { RagChunkRow, RagChunkSchema } from './store/schemas/rag-chunk.schema';

/**
 * [FEAT-20261026-RAGENGINE] RAG engine — a LEAF module, plugged into the webhook by one line.
 * ===========================================================================
 * 📖 `todo/task/26102026/be_todo1_26102026_rag-engine-overhaul_demo.md`
 *
 * Imports only `config` and `ai-vendor` (the embedding gateway) — never `webhook`, so no
 * cycle; the webhook binds `DOC_RETRIEVAL_PROVIDER` to the exported service with
 * `useExisting`. Per hook it is switched by `doc_retrieval` (default off) and tuned by
 * `rag_prompt_mode` / `rag_search_mode` (null ⇒ `rag.config.ts` defaults: add + bm25).
 *
 * Replaces the retrieval half of `ai/rag-engine.service.ts`, which was never bound and never
 * ran in production; that file keeps only its live prompt/tag helpers.
 *
 * revert: delete this folder, the `RagModule` import and the `DOC_RETRIEVAL_PROVIDER` line in
 * `webhook.module.ts` — every hook then gets `''` again, as before. Drop `rag_chunks` if wanted.
 * ถอดได้ด้วยการลบบรรทัดผูกใน webhook.module.ts — ระบบกลับเป็นแบบเดิมทุกประการ
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: RagChunkRow.name, schema: RagChunkSchema },
    ]),
  ],
  providers: [
    { provide: RAG_VECTOR_STORE, useClass: MongoVectorStore },
    {
      provide: RAG_EMBEDDER,
      inject: [aiConfig.KEY],
      useFactory: (ai: ConfigType<typeof aiConfig>) => selectRagEmbedder(ai),
    },
    RagIndexService,
    RagRetrievalService,
  ],
  exports: [RagRetrievalService],
})
export class RagModule {}
