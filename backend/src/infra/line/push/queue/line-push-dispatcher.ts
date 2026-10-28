import { Injectable } from '@nestjs/common';

import { LinePushService } from '../line-push';
import type { LineSendRequest, LineSendResult } from '../line-push.types';

/**
 * ==== [FEAT-20260820-LINEPUSH25] the wrapper (ตัวห่อ) + the queue seam ====
 *
 * Owner's order: prepare the wrapper NOW so future callers bind to it, and a
 * real queue can slot in later without touching a single caller. Today it is
 * a GLASS PIPE by contract — same request in, same result out, one delegation,
 * no pacing, no state, no failure mode of its own (pinned byte-for-byte by
 * z-test/unit/line-push-dispatcher.spec.ts). ห้ามมีพฤติกรรมของตัวเองจนกว่าจะถึงวันคิวจริง.
 *
 * WHY A SEAM AND NOT A QUEUE TODAY: LINE rate-limits per endpoint PER CHANNEL,
 * so honest pacing needs per-OA state (Redis) — adding that would stop the
 * core being neutral, and nothing in the product needs it yet (broadcast is
 * manual per-OA; multicast is unused). `bullmq` is ALREADY declared in
 * package.json:45 with zero imports in src — when volume forces the issue,
 * implement `LinePushQueue` with it (worker calls LinePushService like any
 * other caller) and swap the provider binding in line.module.ts. Callers
 * that took `LinePushDispatcher` never notice. คิวมาเมื่อไหร่ สลับที่ module เดียว.
 *
 * HOW TO SWAP LATER (one place):
 *   line.module.ts →
 *     { provide: InlineLinePushQueue, useClass: BullmqLinePushQueue }
 *   (or a LINE_PUSH_QUEUE injection token if two strategies must coexist).
 *
 * revert: delete `src/infra/line/` entirely (no runtime importers yet).
 */

/** The seam a future queue implements. `enqueue` resolves with the final
 *  delivery result — a queued impl may resolve later, but resolves the same. */
export interface LinePushQueue {
  enqueue(req: LineSendRequest): Promise<LineSendResult>;
}

/** Today's only strategy: straight through to send(), zero added behaviour. */
@Injectable()
export class InlineLinePushQueue implements LinePushQueue {
  constructor(private readonly push: LinePushService) {}

  enqueue(req: LineSendRequest): Promise<LineSendResult> {
    return this.push.send(req);
  }
}

/** The wrapper callers bind to. Route every future send through this. */
@Injectable()
export class LinePushDispatcher {
  constructor(private readonly queue: InlineLinePushQueue) {}

  dispatch(req: LineSendRequest): Promise<LineSendResult> {
    return this.queue.enqueue(req);
  }
}
