/**
 * [FEAT-20260822-BCASTCHUNK] Split recipients into the units a run sends.
 * ===========================================================================
 * A pure decision. No database, no I/O, no clock.
 *
 * 🔑 THE UNIT IS A CHUNK, NOT A RECIPIENT — and that is a load-bearing choice,
 * not a style one. Phase 4 puts a queue behind `BroadcastChunkSink`, where one
 * queue job = one chunk. If this file ever emitted one-recipient units, that
 * phase would be a rewrite instead of a swap. (แผน §PH.5.5)
 *
 * Streaming on purpose: `ChunkAccumulator` takes ids one at a time so the
 * caller can page a cursor and never hold 100,000 ids in memory.
 *
 * revert: delete this file with the rest of `broadcast-send/`.
 */
import { LINE_MULTICAST_MAX_TO } from './limits';
import { HARD_MAX_RECIPIENTS_PER_OA } from './run-guard';

export interface BroadcastChunk {
  /** 0-based, stable within a run — part of the retry key. */
  readonly index: number;
  /** LINE user ids. Never empty; never longer than the size limit. */
  readonly to: readonly string[];
}

/**
 * Keeps only one chunk of ids in memory — plus the de-dupe set, which is
 * BOUNDED on purpose.
 *
 * 🔴 THE DE-DUPE SET IS THE ONE THING HERE THAT GROWS WITH THE AUDIENCE.
 * Left unbounded it would quietly undo the whole point of streaming: 100,000
 * ids is ~3-5 MB of Set, per run, and several runs can overlap. So it is capped
 * at `HARD_MAX_RECIPIENTS_PER_OA` — the same ceiling the OA guard stops at — and once
 * the cap is reached the accumulator stops ACCEPTING rather than stops
 * REMEMBERING. Silently forgetting would let a duplicate through, which is a
 * customer being messaged twice; refusing is visible and safe.
 * เพดานเดียวกับ run-guard · เต็มแล้วหยุดรับ ไม่ใช่หยุดจำ.
 */
export class ChunkAccumulator {
  private buf: string[] = [];
  private next = 0;
  private readonly seen = new Set<string>();
  private overflowed = false;

  /**
   * @param startIndex where chunk numbering begins.
   *
   * ⚠️ CORRECTED 23/08 — this used to read "NOT COSMETIC … because the retry
   * key is built from `runId:hookId:index`". That WAS the reason, and the
   * failure it describes was real: run 1 sent `run1:h1:0` carrying U0-U499 and
   * stopped, the resumed run restarted at 0 and sent `run1:h1:0` carrying
   * U500-U999, LINE answered 409 for a key it had recorded, and 409 counts as
   * delivered — 500 people marked sent, none of them messaged.
   *
   * 🔴 THE KEY NO LONGER DEPENDS ON THIS. A second audit found the same failure
   * reachable another way (the audience shifts between attempts, so one index
   * carries two different groups), so `send-loop.helpers.ts` now builds the key
   * from a FINGERPRINT OF THE MEMBERS instead of the index. Key safety is that
   * function's job now, not this parameter's.
   *
   * The numbering still continues on resume — chunk numbers are what a log,
   * a history row and a human use to say "it stopped at chunk 3" — but a wrong
   * `startIndex` is now a readability bug, not a delivery bug.
   * คีย์ผูกกับ "กลุ่มคน" แล้ว ไม่ใช่ "ลำดับ" ⇒ index ผิดตอนนี้แค่ log อ่านสับสน ไม่ทำให้ส่งซ้ำ.
   */
  constructor(
    private readonly size: number = LINE_MULTICAST_MAX_TO,
    private readonly maxTracked: number = HARD_MAX_RECIPIENTS_PER_OA,
    startIndex = 0,
  ) {
    this.next =
      Number.isFinite(startIndex) && startIndex > 0
        ? Math.floor(startIndex)
        : 0;
    // 🔴 CLAMPED TO LINE'S CAP, not merely defaulted to it — review found that
    // `new ChunkAccumulator(1000)` produced a 1000-recipient chunk, which LINE
    // rejects wholesale: 1000 people skipped in one call. The cap is LINE's,
    // not ours to raise (`limits.ts`), so it is enforced here rather than
    // trusted to every caller. Non-integers round DOWN (2.5 → 2), never up.
    this.size =
      Number.isFinite(size) && size >= 1
        ? Math.min(Math.floor(size), LINE_MULTICAST_MAX_TO)
        : LINE_MULTICAST_MAX_TO;
  }

  /**
   * Offer one id. Returns a chunk when this id completed one, else null.
   *
   * ⚠️ Duplicates are dropped: LINE rejects a multicast whose `to` repeats an
   * id, and a duplicate would also mean sending the same person twice.
   * ⚠️ Blank / non-string ids are dropped rather than throwing — a single bad
   *    row must never take a campaign down.
   */
  push(id: unknown): BroadcastChunk | null {
    if (typeof id !== 'string') return null;
    const v = id.trim();
    if (!v || this.seen.has(v)) return null;
    if (this.seen.size >= this.maxTracked) {
      // Refuse rather than forget — see the class header.
      this.overflowed = true;
      return null;
    }
    this.seen.add(v);
    this.buf.push(v);
    return this.buf.length >= this.size ? this.flush() : null;
  }

  /** The partial chunk at the end of the stream, or null when nothing is left. */
  flush(): BroadcastChunk | null {
    if (!this.buf.length) return null;
    const chunk: BroadcastChunk = { index: this.next, to: this.buf };
    this.next += 1;
    this.buf = [];
    return chunk;
  }

  /** Chunks emitted so far — the count a run reports as its progress. */
  get chunkCount(): number {
    return this.next;
  }

  /** Distinct recipients accepted so far. Counted, never `array.length`. */
  get acceptedCount(): number {
    return this.seen.size;
  }

  /**
   * Did the stream carry more distinct recipients than the cap allows?
   *
   * ⚠️ The run MUST report this. A run that quietly stopped accepting looks
   * identical to a run whose audience was simply smaller. ต้องบอก ไม่ใช่เงียบ.
   */
  get didOverflow(): boolean {
    return this.overflowed;
  }
}

/** Convenience for tests and small lists. Same rules as the accumulator. */
export function chunkRecipients(
  ids: Iterable<unknown>,
  size: number = LINE_MULTICAST_MAX_TO,
): BroadcastChunk[] {
  const acc = new ChunkAccumulator(size);
  const out: BroadcastChunk[] = [];
  for (const id of ids) {
    const c = acc.push(id);
    if (c) out.push(c);
  }
  const last = acc.flush();
  if (last) out.push(last);
  return out;
}
