/**
 * [FEAT-20261026-RAGENGINE] One hook's RAG settings, resolved.
 *
 * `=== true` only for the switch: `.lean()` does not apply schema defaults, so a hook that
 * predates the field reads `undefined` — and must read as OFF
 * (same rule as `webhook/follow-up/ignore-abandon.rule.ts:17-27`).
 * The two modes fall back to the code defaults (`rag.config.ts`) when null, absent or not
 * one of the allowed values — a bad value can never switch a paid search on.
 * ค่าที่ไม่รู้จัก = ใช้ค่าเริ่มต้น (bm25 + add) ไม่มีทางเปิดโหมดเสียเงินเอง
 */
import {
  RAG_CONFIG,
  RAG_PROMPT_MODES,
  RAG_SEARCH_MODES,
  type RagPromptMode,
  type RagSearchMode,
} from '../rag.config';
import type { RagSettings } from '../rag.types';

type HookLike = Record<string, unknown> | null | undefined;

const oneOf = <T extends string>(
  allowed: readonly T[],
  value: unknown,
  fallback: T,
): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;

export function resolveRagSettings(hook: HookLike): RagSettings {
  return {
    enabled: RAG_CONFIG.engineEnabled && hook?.['doc_retrieval'] === true,
    promptMode: oneOf<RagPromptMode>(
      RAG_PROMPT_MODES,
      hook?.['rag_prompt_mode'],
      RAG_CONFIG.defaults.promptMode,
    ),
    searchMode: oneOf<RagSearchMode>(
      RAG_SEARCH_MODES,
      hook?.['rag_search_mode'],
      RAG_CONFIG.defaults.searchMode,
    ),
  };
}
