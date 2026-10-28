/**
 * [FEAT-20261026-RAGENGINE] The rag module's public surface — the only path other modules may
 * import (`@/modules/rag`, lint-enforced). Engine internals stay private.
 */
export { RagModule } from './rag.module';
export {
  RagRetrievalService,
  type RagRetrieveInput,
} from './rag-retrieval.service';
export type { RagContext, RagSection } from './rag.types';
export { NO_RAG_CONTEXT } from './rag.types';
export {
  RAG_PROMPT_MODES,
  RAG_SEARCH_MODES,
  type RagPromptMode,
  type RagSearchMode,
} from './rag.config';
