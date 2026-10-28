/**
 * [FEAT-20261026-RAGENGINE] The engine's domain types — no Nest, no Mongo, no vendor.
 *
 * The engine knows nothing about hooks, LINE or the webhook ladder. The caller hands it
 * the document already cut into its SECTIONS (the Training Doc boxes) and the question;
 * it hands back text. That keeps `rag/` a leaf module: it imports `ai-vendor` for the
 * embedding call and nothing that could import it back.
 * module นี้ไม่รู้จัก webhook — รับเอกสารเป็น section แล้วคืนข้อความ
 */
import type { RagPromptMode, RagSearchMode } from './rag.config';

/**
 * One box of the source document, exactly as the prompt would carry it:
 * `${start}\n${text}\n${end}` — or the raw text when `start`/`end` are empty (a legacy row
 * whose single box already holds its own markers).
 */
export interface RagSection {
  start: string;
  end: string;
  text: string;
}

export interface RagChunk {
  /** Stable within one document version: `${section}:${ord}`. */
  id: string;
  section: number;
  /** Order inside its section. */
  ord: number;
  /** Nearest heading above the chunk — prepended for retrieval (contextual chunk). */
  heading: string;
  /** The original slice, byte for byte — what the prompt receives. */
  text: string;
  /** Must survive `replace` mode (control markers / document preamble). */
  pinned: boolean;
  /** sha256 of the normalised text — the embedding cache key. */
  hash: string;
}

export interface RagSettings {
  enabled: boolean;
  promptMode: RagPromptMode;
  searchMode: RagSearchMode;
}

export interface RagRequest {
  hookId: string | null;
  question: string;
  sections: RagSection[];
  settings: RagSettings;
  /** The OA's Gemini key, decrypted. Only `hybrid` uses it. */
  apiKey?: string | null;
}

/** What the prompt receives. Both empty ⇒ answer exactly as without the engine. */
export interface RagContext {
  /** `add` mode: the passages for the prompt's `Document:` block. */
  docText: string;
  /** `replace` mode: the reduced Training Doc that stands in for the full one. */
  suggestionOverride: string | null;
}

export const NO_RAG_CONTEXT: RagContext = Object.freeze({
  docText: '',
  suggestionOverride: null,
});
