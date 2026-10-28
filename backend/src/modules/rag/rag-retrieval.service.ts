/**
 * [FEAT-20261026-RAGENGINE] The engine's front door — satisfies the webhook's
 * `DocRetrievalProvider` seam (structurally; this module does not import webhook).
 *
 * Bound in `webhook.module.ts` with ONE line:
 *   { provide: DOC_RETRIEVAL_PROVIDER, useExisting: RagRetrievalService }
 * Remove that line and every hook gets `''` again — exactly the state before this module.
 *
 * Contract (unchanged from the seam's header): retrieval is an enhancement, never a dependency.
 * Off, not confident, empty, or ANY failure ⇒ `NO_RAG_CONTEXT` ⇒ the prompt is today's.
 * The settings decide nothing outside this module: `doc_retrieval !== true` returns at once.
 * พังได้ทุกจุด แต่ลูกค้าต้องได้คำตอบแบบเดิมเสมอ
 */
import { Injectable, Logger } from '@nestjs/common';

import { composeContext } from './compose/prompt-composer';
import { RagIndexService } from './indexing/rag-index.service';
import { retrieveChunks } from './retrieval/hybrid-retriever';
import { NO_RAG_CONTEXT, type RagContext, type RagSection } from './rag.types';
import { resolveRagSettings } from './settings/rag-settings';

/** What the webhook's seam hands over — a structural subset of `DocRetrievalRequest`. */
export interface RagRetrieveInput {
  question?: unknown;
  hookId?: string | null;
  hook?: Record<string, unknown> | null;
  sections?: readonly RagSection[] | null;
  apiKey?: string | null;
}

@Injectable()
export class RagRetrievalService {
  private readonly logger = new Logger('RagRetrieval');

  constructor(private readonly indexes: RagIndexService) {}

  /** The seam's original method: the `add`-mode passages, or `''`. */
  async retrieve(input: RagRetrieveInput): Promise<string> {
    return (await this.retrieveContext(input)).docText;
  }

  async retrieveContext(input: RagRetrieveInput): Promise<RagContext> {
    const settings = resolveRagSettings(input.hook);
    const question =
      typeof input.question === 'string' ? input.question.trim() : '';
    const sections = (input.sections ?? []).filter((s) => s.text.trim());
    if (!settings.enabled || !question || !sections.length)
      return NO_RAG_CONTEXT;

    const hookId = input.hookId ?? null;
    try {
      const wantVectors = settings.searchMode === 'hybrid';
      const index = await this.indexes.getIndex({
        hookId,
        sections,
        wantVectors,
        apiKey: input.apiKey,
      });
      let queryVector: Float32Array | null = null;
      const embedder = this.indexes.queryEmbedder;
      if (index.vectors && embedder && input.apiKey) {
        try {
          queryVector = await embedder.embedQuery(
            question,
            input.apiKey,
            hookId,
          );
        } catch (err) {
          this.logger.warn(
            `[RAG] query embedding failed — lexical only: ${(err as Error).message}`,
          );
        }
      }
      const result = retrieveChunks(index, question, queryVector);
      this.logger.log(
        `[RAG] hook=${hookId} mode=${settings.promptMode}/${queryVector ? 'hybrid' : 'bm25'} ` +
          `confident=${result.confident} picked=${result.debug.picked.join(',') || '-'} ` +
          `lex=${result.debug.lexicalTop.toFixed(2)} sem=${result.debug.semanticTop?.toFixed(3) ?? '-'}`,
      );
      return composeContext(
        sections,
        index.chunks,
        result.selected,
        settings.promptMode,
      );
    } catch (err) {
      this.logger.warn(
        `[RAG] retrieval failed — answering as before: ${(err as Error).message}`,
      );
      return NO_RAG_CONTEXT;
    }
  }
}
