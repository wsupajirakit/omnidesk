/**
 * [FEAT-20261026-RAGENGINE] Call cap for embeddings — its OWN ledger, like translate.
 *
 * Why a separate file and not the reply ledger (`.gemini-test-call-count.json`): indexing one
 * Training Doc costs several calls at once, and sharing the reply budget would let a re-index
 * silence the customer-facing bot. Translate made the same call for the same reason
 * (`ai-translate/translate.factory.ts`, `ai-vendor/cap-ledger.ts` header table).
 * Mechanism is the shared ledger: increment BEFORE the call, persist at once, corrupt = exhausted.
 * นับแยกไฟล์ — index เอกสารต้องไม่กินงบของบอทที่ตอบลูกค้า
 */
import { resolve } from 'node:path';

import { Logger } from '@nestjs/common';

import { readCapLedger, writeCapLedger } from '@/modules/ai-vendor';

import { RAG_CONFIG } from '../rag.config';
import type { RagEmbedInput, RagEmbedder } from '../ports/embedder.port';

export const RAG_EMBED_CAP_COUNTER_FILE = resolve(
  process.cwd(),
  '.ai-rag-embed-call-count.json',
);

interface EmbedCapEntry {
  at: string;
  hookId: string | null;
  kind: 'documents' | 'query';
  texts: number;
}

export class RagEmbedCapReachedError extends Error {
  constructor(count: number, limit: number) {
    super(`RAG embedding cap reached: ${count}/${limit} calls already made`);
    this.name = 'RagEmbedCapReachedError';
  }
}

export class EmbedderCapDecorator implements RagEmbedder {
  private readonly logger = new Logger('RagEmbedderCap');

  constructor(
    private readonly inner: RagEmbedder,
    private readonly limit: number,
    private readonly counterFile: string = RAG_EMBED_CAP_COUNTER_FILE,
  ) {}

  get model(): string {
    return this.inner.model;
  }

  get dim(): number {
    return this.inner.dim;
  }

  private spend(calls: number, entry: Omit<EmbedCapEntry, 'at'>): void {
    const state = readCapLedger<EmbedCapEntry>(
      this.counterFile,
      this.limit,
      () =>
        this.logger.error(
          `[RAG-EMBED-CAP] ledger unreadable — treated as exhausted`,
        ),
    );
    if (state.count + calls > this.limit) {
      this.logger.error(
        `[RAG-EMBED-CAP] REFUSED — ${state.count}/${this.limit} used`,
      );
      throw new RagEmbedCapReachedError(state.count, this.limit);
    }
    state.count += calls;
    state.calls.push({ at: new Date().toISOString(), ...entry });
    writeCapLedger(this.counterFile, state);
  }

  async embedDocuments(
    items: readonly RagEmbedInput[],
    apiKey: string,
    hookId: string | null,
  ): Promise<Float32Array[]> {
    const calls = Math.ceil(items.length / RAG_CONFIG.embedding.batchSize);
    this.spend(calls, { hookId, kind: 'documents', texts: items.length });
    return this.inner.embedDocuments(items, apiKey, hookId);
  }

  // async so a refusal is a REJECTION, never a synchronous throw past an `await`/`.catch`
  async embedQuery(
    text: string,
    apiKey: string,
    hookId: string | null,
  ): Promise<Float32Array> {
    this.spend(1, { hookId, kind: 'query', texts: 1 });
    return this.inner.embedQuery(text, apiKey, hookId);
  }
}
