/**
 * ==== [FEAT-20260815-WLOGDOOR] the single exit for webhook_logs writes ====
 *
 * WHAT: every `webhook_logs` row this module produces leaves through
 * `WebhookLogEmitter.write` — one door, so the strip/normalise behaviour can
 * never fork per call site again. Before this file, `webhook.service.ts` held
 * the same logic inline in `persistWebhookLog`, and 21 call sites across four
 * files each built their own payload shape against it.
 *
 * WHAT IT DOES — exactly what `persistWebhookLog` has always done, no more:
 *   1. drop keys whose value is `undefined` (a Mongoose `create` would
 *      otherwise materialise them as nulls/defaults the legacy rows never had);
 *   2. hand the result to `WebhookLogService.createLog`, which owns
 *      `resolveChannelType` + `mirrorWebhookLogFields` — the door must go
 *      THROUGH the service, never straight to the model, or the dashboard's
 *      `log_source` filter stops finding the rows ([FIX-20260808-WLOGMIRROR]).
 *
 * WHAT IT DOES **NOT** DO — on purpose:
 *   · no try/catch: a sink failure PROPAGATES. The swallow (and its error
 *     line) stays at the caller, byte-identical to before — a door that eats
 *     rows silently is the defect this refactor exists to remove.
 *   · no console output, no reshaping, no defaults. Byte-parity is pinned by
 *     [RULER-20260815-WLOGGOLDEN] (webhook-ingest-flow / webhook-flow-matrix)
 *     and by webhook-log-emitter.spec.ts.
 *
 * WHY A PLAIN CLASS, NOT @Injectable: `WebhookService` is constructed
 * POSITIONALLY by dozens of specs; adding a constructor parameter would break
 * every one. The service builds this lazily from the `WebhookLogService` it
 * already holds, so DI, the module file and every test construction stay
 * untouched. ประตูเดียว โดยไม่แตะ constructor ใคร.
 *
 * The sink is duck-typed to the same `createLog(payload)` shape as the AI
 * module's `WEBHOOK_LOG_SINK` seam (rag-engine.service.ts) — one contract for
 * "something that persists a webhook_logs row" across the codebase.
 *
 * ⚠️ WHY THIS DOOR SURVIVED THE `dev` MERGE UNTOUCHED — worth knowing before the
 * next one. `dev` fixed two defects in the same file in parallel (`5272bed`,
 * `7513555`) and the merge conflicted in six places, all of them lines where both
 * sides had written the SAME fix in different words. None of them were here: this
 * folder does not exist on `dev`, and the door's own call sites (`wlogEmit`) sit
 * in regions `dev` never edited.
 *
 * That is the pattern to keep. A refactor that lives in its own files, and touches
 * shared code only where it must, merges quietly next to other people's fixes.
 * After the merge it was verified rather than assumed — 20 `wlogEmit` call sites,
 * zero `persistWebhookLog`, zero `createLog(` callers outside this folder, 16
 * frozen row snapshots. งานที่อยู่ในไฟล์ของตัวเอง merge แล้วไม่หาย.
 *
 * revert: delete this directory and restore the loop body inside
 *         `persistWebhookLog` (webhook.service.ts) from git history.
 */

/** Anything that can persist one webhook_logs row. */
export interface WebhookLogSinkLike {
  createLog(row: Record<string, unknown>): Promise<unknown>;
}

export class WebhookLogEmitter {
  constructor(private readonly sink: WebhookLogSinkLike) {}

  /**
   * Persist one row: strip `undefined` values, pass everything else VERBATIM.
   * Throws when the sink does — the caller owns the swallow and its error line.
   */
  async write(entry: Record<string, unknown>): Promise<void> {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(entry)) {
      if (v !== undefined) clean[k] = v;
    }
    await this.sink.createLog(clean);
  }
}
