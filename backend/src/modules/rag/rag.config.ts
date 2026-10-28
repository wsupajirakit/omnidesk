/**
 * [FEAT-20261026-RAGENGINE] Code-level knobs of the RAG engine — one place, no env.
 *
 * The owner keeps switches in code rather than env (`strike/strike.config.ts:17-33`,
 * `ai-vendors/resolve-vendor-key.ts:4-7`: "everything per hook, env only AI_PROVIDER").
 * Per-hook choices live on the hook (`doc_retrieval`, `rag_prompt_mode`, `rag_search_mode`);
 * this file holds the defaults those choices fall back to and the engine's tuning.
 *
 * ⚠️ DEFAULTS MUST TOUCH NOBODY (owner, 26/10): a hook with `doc_retrieval !== true` never
 *    reaches the engine at all; a hook that turns it on but sets nothing else gets
 *    `bm25` (no AI call, no spend) + `add` (the full Training Doc stays in the prompt).
 *    ค่าเริ่มต้นต้องไม่กระทบใคร — เปิดแล้วก็ยังไม่เสียเงิน และเอกสารทั้งฉบับยังอยู่
 *
 * revert: delete `src/modules/rag/` and its binding line in `webhook.module.ts`.
 */

export const RAG_PROMPT_MODES = ['add', 'replace'] as const;
export type RagPromptMode = (typeof RAG_PROMPT_MODES)[number];

export const RAG_SEARCH_MODES = ['bm25', 'hybrid'] as const;
export type RagSearchMode = (typeof RAG_SEARCH_MODES)[number];

export const RAG_CONFIG = {
  /** Fleet-wide kill switch in code. false ⇒ the engine answers "no context" for everyone. */
  engineEnabled: true,

  defaults: {
    promptMode: 'add' as RagPromptMode,
    searchMode: 'bm25' as RagSearchMode,
  },

  chunk: {
    /** Pack paragraphs up to about this many characters per chunk. */
    targetChars: 900,
    /** A single paragraph longer than this is split at line / word boundaries. */
    maxChars: 1400,
  },

  retrieve: {
    /** Chunks finally selected (before neighbour expansion). */
    topK: 6,
    /** Candidates taken from EACH retriever before fusion (20 performs best in published retrieval benchmarks). */
    candidates: 20,
    /** Reciprocal-rank-fusion constant (MongoDB `$rankFusion` / literature default). */
    rrfK: 60,
    /** MMR trade-off: 1 = pure relevance, 0 = pure diversity. */
    mmrLambda: 0.75,
    /** Neighbours on each side pulled in with a selected chunk (small-to-big). */
    neighbours: 1,
    /** Character budget for the retrieved text (pinned chunks are outside it). */
    budgetChars: 6000,
    /**
     * Lowest BM25 score that counts as a real lexical hit. BM25 scales with corpus size, so
     * this stays low: a word found in ONE chunk of a 3-chunk doc scores ~0.98, while a word
     * present in EVERY chunk has idf < 0.2 and stays under it (measured in rag-engine specs).
     */
    minLexicalScore: 0.5,
    /** Lowest cosine that counts as a real semantic hit. */
    minCosine: 0.55,
  },

  /**
   * Chunks that `replace` mode must always keep: they carry control markers the prompt
   * pipeline acts on (`[[[history]]]` is detected in the suggestion by `prompt-assembly.ts`,
   * `{{ctx…}}` is substituted there too). Dropping one would silently change behaviour.
   * ห้ามทิ้ง chunk ที่มีตัวควบคุม — ไม่งั้น history/ctx หายเงียบ
   */
  pinnedPatterns: [
    /\[\[\[history\]\]\]/i,
    /\{\{\s*ctx[^}]*\}\}/i,
  ] as readonly RegExp[],

  embedding: {
    /** Google's current embedding model (001 shuts down 14/05/2028 at the earliest). */
    model: 'gemini-embedding-2',
    /** 768 loses almost nothing vs 3072 (MTEB 67.99 vs 68.17) and is 4× cheaper to store. */
    dim: 768,
    /** Texts per batchEmbedContents call. */
    batchSize: 64,
  },

  index: {
    /** In-process index cache entries (one per hook × document version × search mode). */
    cacheEntries: 64,
  },
} as const;
