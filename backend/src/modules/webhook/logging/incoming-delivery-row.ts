/**
 * [PROG-20260905-INROW] The `incoming_line_webhook` row — the first thing written on
 * every LINE delivery, lifted out of the spine.
 *
 * WHY IT MOVED. `logging/` already owns the two rows the customer reply produces
 * (`send-outcome-rows.ts`). This is the third and the earliest: the raw inbound payload,
 * the row an incident investigation opens before any other. Keeping the reply rows in a
 * role file while the inbound row stayed a nine-field literal inside a 2,100-line method
 * meant the three rows of one turn could not be read side by side.
 *
 * ⚠️ A PURE BUILDER, exactly like its two neighbours: it takes values and returns the
 * row. The emit stays at the call site, because WHEN this row is written — fire-and-forget
 * `void`, never awaited, so a slow log cannot delay the customer's reply — is the spine's
 * contract, not this file's. `webhook-log-emitter.spec.ts` pins that `void` at the call
 * site by name.
 *
 * ⚠️ KEY ORDER IS UNCHANGED ON PURPOSE. [FEAT-20260815-WLOGDOOR] B1 chose this literal's
 * order so the stored document stayed byte-identical when the typed door landed; the ruler
 * pins the key SET and the values, not BSON order, so preserving the order here is what
 * keeps that guarantee true across this move too.
 *
 * ⚠️ `raw_request` IS THE WHOLE DELIVERY BODY, not one event. Exactly one of these rows
 * exists per delivery and it carries every event LINE sent, which is what makes the
 * one-row-per-delivery accounting in `webhook_logs` mean what it says. The multi-event
 * loop keeps that promise by emitting only for the first event of a delivery — see
 * `event-iteration/run-delivery-events.ts`.
 */

import type { WebhookLogEvent } from './webhook-log.contract';
import { asString } from './coerce-mask.util';

export interface IncomingDeliveryRowInput {
  /** The resolved hook, or undefined when the alias resolved to nothing. */
  hook?: Record<string, unknown>;
  /** `alias` as it arrived on the URL — stored even when it resolved to nothing. */
  alias?: string;
  /**
   * The two request facts the row carries. Declared STRUCTURALLY rather than as
   * `WebhookRequestMeta`: that interface lives in `webhook.service.ts`, and a role file
   * importing back from the service is the cycle every other file in this directory
   * avoids. The real `meta` satisfies this shape, so the call site passes it whole.
   */
  meta: { method: string; originalUrl: string };
  /** The delivery body verbatim: every event LINE sent, not a per-event slice. */
  body: Record<string, unknown>;
}

/** legacy:2346 — the raw inbound payload row. */
export function buildIncomingDeliveryRow(
  input: IncomingDeliveryRowInput,
): WebhookLogEvent {
  const { hook, alias, meta, body } = input;
  return {
    hook_id: asString(hook?.['_id']),
    hook_alias: alias,
    group_id: asString(hook?.['group']) ?? undefined,
    channel: 'webhook',
    action_type: 'incoming_line_webhook',
    method: meta.method,
    endpoint: meta.originalUrl,
    status: 'success',
    raw_request: body,
  };
}
