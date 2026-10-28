/**
 * [FEAT-20260820-LINEPUSHCORE] barrel — the only door into `infra/line`.
 * Matches the infra convention (crypto/redis/query-cache all barrel).
 * revert: delete `src/infra/line/` entirely.
 */
export { LineModule } from './line.module';
export { LinePushService } from './push/line-push';
export { LineQuotaApi } from './api/line-quota';
export type { LineApiReadResult, LineQuotaSummary } from './api/line-quota';
export {
  InlineLinePushQueue,
  LinePushDispatcher,
} from './push/queue/line-push-dispatcher';
export type { LinePushQueue } from './push/queue/line-push-dispatcher';
export {
  LINE_BROADCAST_URL,
  LINE_DEFAULT_TIMEOUT_MS,
  LINE_INSIGHT_FOLLOWERS_URL,
  LINE_LOADING_URL,
  LINE_MULTICAST_URL,
  LINE_PROFILE_URL_PREFIX,
  LINE_PUSH_URL,
  LINE_REPLY_URL,
} from './line-endpoints';
export { describeLineFailure, lineRequestIdOf } from './push/line-push-error';
// [FEAT-20260831-QUOTESRC] its sibling on the success side — the ids LINE returns
export { sentMessageIds } from './push/sent-message';
export type { SentMessageIds } from './push/sent-message';
// per-candidate payload builders (Phase 2) — pure functions, no I/O
export { buildChatMessages } from './push/adapters/build-payload.chat';
export type { ChatOutboundMessage } from './push/adapters/build-payload.chat';
export { buildRawMessage } from './push/adapters/build-payload.raw';
export { buildBroadcastMessage } from './push/adapters/build-payload.broadcast';
export type { BroadcastMessageInput } from './push/adapters/build-payload.broadcast';
export {
  buildImageCarouselMessages,
  buildReplyFlexMessage,
  buildReplyTextMessage,
} from './push/adapters/build-payload.webhook-reply';
export type {
  CarouselItem,
  CarouselOptions,
} from './push/adapters/build-payload.webhook-reply';
export { buildPaymentMessage } from './push/adapters/build-payload.payment';
export type { PaymentReplyBody } from './push/adapters/build-payload.payment';
export {
  buildAlreadyRegisteredTextMessage,
  buildRegisterFlexMessage,
} from './push/adapters/build-payload.register';
export { buildLinkedNoticeMessage } from './push/adapters/build-payload.customer-link';
export type { LineFailure } from './push/line-push-error';
export type {
  LineAuditEvent,
  LineMessage,
  LineRetryOption,
  LineSendKind,
  LineSendRequest,
  LineSendResult,
} from './push/line-push.types';
