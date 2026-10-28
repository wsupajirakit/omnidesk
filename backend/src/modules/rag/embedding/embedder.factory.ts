/**
 * [FEAT-20261026-RAGENGINE] Which embedder the engine gets — provider × cap, like translate.
 *
 *   AI_PROVIDER mock → NO embedder (null): `hybrid` degrades to `bm25` and says so in the log.
 *                      There is deliberately no scripted embedder in `src/` — a stand-in for a
 *                      real service does not enter git (dev-local §10); specs inject a stub.
 *   AI_PROVIDER real → Gemini, wrapped in its own call cap when `AI_CAP=on`.
 * Production + mock is already fatal at the reply/translate factories; nothing to add here.
 * โหมด mock = ไม่มี embedder (ค้นแค่ bm25) · ไม่มีตัวจำลองใน src
 */
import { Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import type { aiConfig } from '@/config/app.config';

import type { RagEmbedder } from '../ports/embedder.port';
import { EmbedderCapDecorator } from './embedder-cap.decorator';
import { GeminiEmbedder } from './gemini-embedder';

export function selectRagEmbedder(
  ai: Pick<
    ConfigType<typeof aiConfig>,
    'providerMode' | 'capMode' | 'capLimit'
  >,
  logger: { log: (m: string, c?: string) => void } = Logger,
): RagEmbedder | null {
  if (ai.providerMode === 'mock') {
    logger.log(
      '[RAG] embedder = none (AI_PROVIDER=mock) — hybrid search runs as bm25',
      'RagModule',
    );
    return null;
  }
  const real = new GeminiEmbedder();
  const embedder =
    ai.capMode === 'on' ? new EmbedderCapDecorator(real, ai.capLimit) : real;
  logger.log(
    `[RAG] embedder = ${real.model} · cap = ${ai.capMode}` +
      (ai.capMode === 'on' ? ` (limit ${ai.capLimit}, own ledger)` : ''),
    'RagModule',
  );
  return embedder;
}
