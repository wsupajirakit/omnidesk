/**
 * [FEAT-20261026-RAGENGINE] Okapi BM25 over the chunks of ONE document — in process.
 *
 * Mongo `$text` has no Thai analyser and RediSearch does not segment Thai, so lexical
 * search runs here, on tokens from `text/thai-text.ts`. A Training Doc is ~100 chunks, so
 * building the index is milliseconds and searching it is microseconds — no dependency is
 * worth adding for that (MiniSearch was the alternative; Orama drops Thai entirely).
 * The heading is indexed with the chunk (contextual chunk), the text itself is untouched.
 * BM25 เขียนเอง — เอกสารร้านเดียวเล็ก ไม่คุ้มเพิ่ม dependency
 */
import type { RagChunk } from '../rag.types';
import { tokenise } from '../text/thai-text';

export interface LexicalHit {
  index: number;
  score: number;
}

export class Bm25Index {
  private readonly docs: Map<string, number>[] = [];
  private readonly lengths: number[] = [];
  private readonly df = new Map<string, number>();
  private readonly avgLen: number;

  constructor(
    chunks: readonly RagChunk[],
    private readonly k1 = 1.2,
    private readonly b = 0.75,
  ) {
    for (const c of chunks) {
      const tf = new Map<string, number>();
      const tokens = tokenise(`${c.heading}\n${c.text}`);
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      this.docs.push(tf);
      this.lengths.push(tokens.length);
    }
    const total = this.lengths.reduce((a, n) => a + n, 0);
    this.avgLen = this.docs.length ? total / this.docs.length : 0;
  }

  get size(): number {
    return this.docs.length;
  }

  search(query: string, limit: number): LexicalHit[] {
    const terms = [...new Set(tokenise(query))];
    const n = this.docs.length;
    if (!terms.length || !n) return [];
    const hits: LexicalHit[] = [];
    this.docs.forEach((tf, i) => {
      let score = 0;
      for (const t of terms) {
        const f = tf.get(t);
        if (!f) continue;
        const df = this.df.get(t) ?? 0;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        const norm =
          f +
          this.k1 *
            (1 - this.b + (this.b * this.lengths[i]!) / (this.avgLen || 1));
        score += idf * ((f * (this.k1 + 1)) / norm);
      }
      if (score > 0) hits.push({ index: i, score });
    });
    return hits.sort((a, z) => z.score - a.score).slice(0, limit);
  }
}
