/**
 * [FEAT-20260822-BCASTSINK] The seam a real queue slots into later.
 * ===========================================================================
 * Phases 1-3 send inline; phase 4 swaps ONE provider line inside
 * `content.module.ts` and the runner never learns about it.
 *
 * This mirrors what push core already did for itself
 * (`infra/line/push/queue/line-push-dispatcher.ts`), whose header states the
 * intent: "prepare the wrapper NOW so future callers bind to it, and a real
 * queue can slot in later without touching a single caller".
 *
 * 🔒 OUR queue lives at a DIFFERENT LEVEL from core's seam and must not be
 *    confused with it: ours = "send this chunk of this campaign", core's =
 *    "send this one LINE request". Swapping the binding in `line.module.ts`
 *    would change behaviour for every push-core caller — forbidden (แผน §0.2 S6).
 *
 * revert: delete this file with the rest of `broadcast-send/`.
 */
import type { BroadcastChunk } from './chunk';

export interface ChunkSendRequest {
  readonly chunk: BroadcastChunk;
  /** Reproducible — see `retry-key.ts`. A run must not send without one. */
  readonly retryKey: string;
  readonly hookId: string;
  readonly runId: string;
}

export interface ChunkResult {
  readonly ok: boolean;
  /** 409 means an earlier attempt with this key already succeeded. */
  readonly status?: number;
  readonly error?: string;
  /** Recipients LINE accepted in this chunk. Meaningless when `recipientsUnknown`. */
  readonly sent: number;
  /**
   * The broadcast pipe carries no recipient list, so a sink riding it cannot
   * report a headcount. `sent: 0` from such a sink means "not knowable", not
   * "nobody" — and a reader that cannot tell those apart will report a
   * successful campaign as a failed one.
   */
  readonly recipientsUnknown?: true;
  /**
   * Broken pictures swapped for the fallback while rendering this chunk.
   *
   * ⚠️ ABSENT means "not measured", `0` means "measured, none broken". The
   * history row must be able to tell those apart — see `ChunkMessages`.
   */
  readonly imagesReplaced?: number;
  /** Tags nothing knew about; they rendered as `N/A`. Absent = not measured. */
  readonly unknownTags?: readonly string[];
}

/**
 * Implementations: `InlineChunkSink` (phases 1-3) · `BullmqChunkSink` (phase 4).
 *
 * ⚠️ Never throws for a runtime failure — it returns `{ok:false}`, the same
 *    contract push core keeps, so one bad chunk cannot abort a whole campaign.
 */
export interface BroadcastChunkSink {
  send(req: ChunkSendRequest): Promise<ChunkResult>;
}
