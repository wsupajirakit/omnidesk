/**
 * [FEAT-20260822-BCASTDRYSINK] A sink that sends nothing and remembers what it
 * would have sent.
 * ===========================================================================
 * Two jobs, both real:
 *
 * 1. It is the ONLY sink that exists while **D59** is unanswered. The runner is
 *    complete, but whether broadcast may reach `LinePushDispatcher` is the
 *    owner's call, so the runner is handed something that cannot send. A file
 *    that cannot reach LINE cannot change behaviour on stg.
 * 2. It stays useful after D59 as the dry-run/preview path: the admin asks
 *    "who would this reach, in how many requests?" and gets the answer from the
 *    SAME code that does the sending — not from a second implementation that
 *    drifts. ตัวพรีวิวกับตัวส่งจริงต้องเดินโค้ดเส้นเดียวกัน ไม่งั้นเลขไม่ตรง.
 *
 * ⚠️ It reports every chunk as accepted. That is correct for a preview (nothing
 *    failed because nothing was attempted) and is why a history row written
 *    from a dry run MUST record that it was one — see `is_dry_run` in the plan
 *    §PH runbook before turning this loose on real jobs.
 *
 * revert: delete this file; only the runner and its spec name it.
 */
import type {
  BroadcastChunkSink,
  ChunkResult,
  ChunkSendRequest,
} from '../chunk-sink';

export interface DryRunEntry {
  readonly hookId: string;
  readonly runId: string;
  readonly retryKey: string;
  readonly chunkIndex: number;
  readonly recipients: number;
}

export class DryRunChunkSink implements BroadcastChunkSink {
  private readonly entries: DryRunEntry[] = [];

  /**
   * ⚠️ Never throws and never rejects — the sink contract. A preview that can
   * take the runner down is worse than no preview.
   */
  send(req: ChunkSendRequest): Promise<ChunkResult> {
    this.entries.push({
      hookId: req.hookId,
      runId: req.runId,
      retryKey: req.retryKey,
      chunkIndex: req.chunk.index,
      recipients: req.chunk.to.length,
    });
    return Promise.resolve({
      ok: true,
      sent: req.chunk.to.length,
      // A preview renders nothing, so it measured nothing. Saying `0` here
      // would claim every picture was fine. ไม่ได้เรนเดอร์ = ไม่ได้วัด.
    });
  }

  /** What the run WOULD have done, in order. */
  get log(): readonly DryRunEntry[] {
    return this.entries;
  }

  get requests(): number {
    return this.entries.length;
  }

  get recipients(): number {
    return this.entries.reduce((n, e) => n + e.recipients, 0);
  }
}
