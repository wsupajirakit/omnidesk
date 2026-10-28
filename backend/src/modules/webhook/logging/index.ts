/**
 * [FEAT-20260815-WLOGDOOR] Barrel for the webhook logging door.
 *
 * ⚠️ DELIBERATELY NOT re-exported from `webhook/index.ts`: other modules must
 * not reach this door (they have their own writers until phase 4 decides
 * whether the door moves to infra/). Keeping it out of the module barrel is
 * what keeps the blast radius inside `webhook/`.
 */
export {
  WebhookLogEmitter,
  type WebhookLogSinkLike,
} from './webhook-log.emitter';
export type {
  WebhookLogChannel,
  WebhookLogEvent,
  WebhookLogStatus,
} from './webhook-log.contract';
