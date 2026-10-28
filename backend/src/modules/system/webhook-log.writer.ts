import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import {
  WebhookLog,
  type WebhookLogDocument,
} from './schemas/webhook-log.schema';

/**
 * ==== [FEAT-20260827-WLOGONEDOOR] the ONE place a `webhook_logs` row is stored ====
 *
 * WHAT: every row in this collection is created here, by this one line. Nothing
 * else in the codebase calls `webhookLogModel.create` any more — enforced by
 * `webhook-log-door-census.spec.ts`, which fails if a direct writer comes back.
 *
 * WHY IT EXISTS: the collection had TWELVE writers. `WebhookLogService.createLog`
 * served the webhook module (through `WebhookLogEmitter`), the AI/chat/slip/
 * dyntag paths and the controller — but eleven sites in external-api,
 * custom-tool, customer-link and the two broadcast senders wrote the model
 * DIRECTLY. Anything added at `createLog` (a mirror to S3, a metric, a redaction
 * pass) would silently miss those eleven, and nothing would fail to say so.
 * ⇒ ถ้าจะส่ง log ไปที่อื่น แก้ที่นี่ที่เดียว ไม่มีใครหลุด
 *
 * ⚠️ WHAT THIS METHOD MUST NEVER DO — and why it looks so empty on purpose:
 *
 *   NO stripping, NO mirroring, NO id normalisation, NO defaults. It hands the
 *   caller's object to Mongoose exactly as given. That emptiness is the whole
 *   design: the eleven sites moved here had to keep writing byte-identical rows,
 *   so the door had to add nothing. A key with the value `undefined` decides
 *   whether Mongoose materialises a schema default, so even removing those would
 *   be a behaviour change. `webhook-log-door-parity.spec.ts` pins all of it with
 *   `toStrictEqual` — a door that starts normalising turns that file red.
 *
 * THE LAYERS ABOVE IT (each real, none redundant):
 *   `webhook.service` → `WebhookLogEmitter.write`  — strips `undefined`, legacy parity
 *   AI / chat / slip / controller / dyntag ─┐
 *   `WebhookLogEmitter` ────────────────────┴→ `WebhookLogService.createLog`
 *                                              — ObjectId casts, `channel_type`
 *                                                lookup, `mirrorWebhookLogFields`
 *   the eleven migrated sites ──────────────────→ **here** (they were never
 *                                                normalised; routing them through
 *                                                `createLog` would have CHANGED
 *                                                what they write — see the todo).
 *
 * revert: put `this.logModel.create(...)` back in `WebhookLogService.createLog`,
 *         restore `@InjectModel(WebhookLog)` on the five migrated services and
 *         delete this file. The rows do not change either way.
 */
@Injectable()
export class WebhookLogWriter {
  constructor(
    @InjectModel(WebhookLog.name)
    private readonly logModel: Model<WebhookLog>,
  ) {}

  /** Store one row, verbatim. Returns the created document, as `create` does —
   *  `customer-link.service.ts` reads `_id` off it. Rejects when Mongoose does:
   *  every caller owns its own swallow, exactly as it did before the move. */
  async persist(row: Record<string, unknown>): Promise<WebhookLogDocument> {
    return this.logModel.create(row);
  }
}
