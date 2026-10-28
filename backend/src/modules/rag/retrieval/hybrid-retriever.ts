/**
 * [FEAT-20261026-RAGENGINE] Pick the chunks a question needs — pure, no I/O.
 *
 * Pipeline (2026 practice, sized for one shop's document):
 *   1. lexical  — BM25 top-N (always; free)
 *   2. semantic — cosine top-N (only when `hybrid` and vectors exist)
 *   3. fusion   — reciprocal rank fusion, Σ 1/(k+rank) — scale-free, no score calibration
 *   4. MMR      — relevance vs. redundancy, so the K picks are not near-duplicates
 *   5. small-to-big — pull ±N neighbours of each pick from the same section AND heading
 *                      (a long paragraph split in two — never the next topic)
 *   6. budget   — stop adding once the character budget is spent (pinned chunks excluded)
 * Confidence = a real lexical hit OR a real semantic hit. Not confident ⇒ the caller answers
 * exactly as without the engine (full document, no extra block) — a wrong passage stated
 * confidently is worse than no passage.
 * ไม่มั่นใจ = ถอยไปแบบเดิม ดีกว่าส่ง chunk ผิด
 */
import { RAG_CONFIG } from '../rag.config';
import type { RagChunk } from '../rag.types';
import { tokenise } from '../text/thai-text';
import type { Bm25Index } from '../lexical/bm25-index';
import { cosine } from '../vector/vector-math';

export interface RetrievalIndex {
  chunks: readonly RagChunk[];
  bm25: Bm25Index;
  /** Same order as `chunks`; null when the index is lexical-only. */
  vectors: readonly (Float32Array | null)[] | null;
}

export interface RetrievalResult {
  /** Chunk indexes in document order. Empty when not confident. */
  selected: number[];
  confident: boolean;
  debug: { lexicalTop: number; semanticTop: number | null; picked: string[] };
}

/** The tuning knobs as plain numbers (the config object is `as const`, so its type is literal). */
export type RetrieveConfig = {
  readonly [K in keyof typeof RAG_CONFIG.retrieve]: number;
};
type Cfg = RetrieveConfig;

function semanticHits(index: RetrievalIndex, q: Float32Array, limit: number) {
  if (!index.vectors) return [];
  const hits: { index: number; score: number }[] = [];
  index.vectors.forEach(
    (v, i) => v && hits.push({ index: i, score: cosine(q, v) }),
  );
  return hits.sort((a, z) => z.score - a.score).slice(0, limit);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export function retrieveChunks(
  index: RetrievalIndex,
  question: string,
  queryVector: Float32Array | null,
  cfg: Cfg = RAG_CONFIG.retrieve,
): RetrievalResult {
  const lexical = index.bm25.search(question, cfg.candidates);
  const semantic = queryVector
    ? semanticHits(index, queryVector, cfg.candidates)
    : [];
  const lexicalTop = lexical[0]?.score ?? 0;
  const semanticTop = semantic.length ? semantic[0]!.score : null;
  const confident =
    lexicalTop >= cfg.minLexicalScore || (semanticTop ?? -1) >= cfg.minCosine;
  if (!confident)
    return {
      selected: [],
      confident,
      debug: { lexicalTop, semanticTop, picked: [] },
    };

  const fused = new Map<number, number>();
  for (const list of [lexical, semantic]) {
    list.forEach((h, rank) =>
      fused.set(h.index, (fused.get(h.index) ?? 0) + 1 / (cfg.rrfK + rank + 1)),
    );
  }
  const ranked = [...fused.entries()].sort((a, z) => z[1] - a[1]);
  const maxScore = ranked[0]?.[1] || 1;

  const tokens = new Map<number, Set<string>>();
  const tok = (i: number) => {
    let s = tokens.get(i);
    if (!s) tokens.set(i, (s = new Set(tokenise(index.chunks[i]!.text))));
    return s;
  };
  const sim = (i: number, j: number) => {
    const vi = index.vectors?.[i];
    const vj = index.vectors?.[j];
    return vi && vj ? cosine(vi, vj) : jaccard(tok(i), tok(j));
  };

  const picks: number[] = [];
  const pool = ranked.map(([i]) => i);
  while (picks.length < cfg.topK && pool.length) {
    let best = 0;
    let bestScore = -Infinity;
    pool.forEach((i, at) => {
      const rel = (fused.get(i) ?? 0) / maxScore;
      const red = picks.length ? Math.max(...picks.map((p) => sim(i, p))) : 0;
      const s = cfg.mmrLambda * rel - (1 - cfg.mmrLambda) * red;
      if (s > bestScore) [bestScore, best] = [s, at];
    });
    picks.push(pool.splice(best, 1)[0]!);
  }

  const chosen = new Set<number>();
  let spent = 0;
  const take = (i: number) => {
    const c = index.chunks[i];
    if (!c || chosen.has(i)) return;
    if (!c.pinned && spent + c.text.length > cfg.budgetChars && chosen.size)
      return;
    chosen.add(i);
    if (!c.pinned) spent += c.text.length;
  };
  for (const p of picks) take(p);
  for (const p of picks) {
    const c = index.chunks[p]!;
    for (let d = 1; d <= cfg.neighbours; d++) {
      for (const j of [p - d, p + d]) {
        const n = index.chunks[j];
        // same box and same heading — a neighbour across a heading is another topic
        if (n && n.section === c.section && n.heading === c.heading) take(j);
      }
    }
  }
  const selected = [...chosen].sort((a, z) => a - z);
  return {
    selected,
    confident,
    debug: {
      lexicalTop,
      semanticTop,
      picked: picks.map((i) => index.chunks[i]!.id),
    },
  };
}
