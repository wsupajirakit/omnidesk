/**
 * [FEAT-20260822-BCASTSWITCH] The seam the live sender branches into.
 * ===========================================================================
 * `broadcasts.service.ts` is the sender that works today. It gets ONE new
 * branch and nothing else — a guarded call into this seam — because a file
 * that is sending real campaigns is not the place to grow a second pipeline.
 *
 * 🔴 `@Optional()` ON THE INJECTION IS THE SAFETY. Nothing provides this yet,
 *    so the branch cannot be taken in the running system even if the switch
 *    were flipped by accident: no provider ⇒ `undefined` ⇒ the old sender runs.
 *    Two independent things must both be true before one byte reaches LINE
 *    through the new path. สองเงื่อนไขต้องจริงพร้อมกัน ไม่ใช่อันเดียว.
 *
 * ⚠️ THE RESULT SHAPE IS NOT NEGOTIABLE. `POST /broadcasts/:id/send` answers
 *    `{ data, results }` and, more importantly, the admin's history tab reads
 *    `webhook_logs` filtered on `channel:'line_api'` + `action_type:'send_broadcast'`
 *    (measured — `Broadcasts.tsx:90-99`). An implementation that stops writing
 *    those rows empties that tab with no error anywhere, so writing them is
 *    part of this contract rather than an implementation detail.
 *
 * revert: delete this file and the branch in `broadcasts.service.ts` that
 * names it; the old sender is untouched either way.
 */

/** One hook's outcome, exactly as the legacy sender reports it. */
export interface LegacySendResult extends Record<string, unknown> {
  readonly hook_id: unknown;
  readonly status: 'success' | 'error';
}

export interface NewSendOutcome {
  /** Same array the old path returns, so any direct caller sees no change. */
  readonly results: LegacySendResult[];
  /** Final job status the caller persists — `sent` or `failed`, as before. */
  readonly status: 'sent' | 'failed';
}

/**
 * What the new pipeline must be able to do to replace the old sender.
 *
 * Deliberately narrow: the caller hands over the job and gets back exactly what
 * it already knew how to persist. Everything the new pipeline adds — chunking,
 * per-OA history, resume — happens behind this line and is invisible here.
 */
export abstract class BroadcastNewSendPort {
  abstract send(
    broadcast: Record<string, unknown>,
    actor: { readonly id?: unknown; readonly name?: string },
  ): Promise<NewSendOutcome>;
}
