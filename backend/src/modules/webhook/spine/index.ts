/**
 * [PROG-20260905-CONTRACTS] Barrel for the spine's shared contracts.
 *
 * These four files are types and one factory — no behaviour, no Nest, no imports from
 * the service. They exist so that every handler the reduction program extracts, the
 * multi-event loop and the event-type registry all speak the same shape, instead of
 * three conventions arriving in three weeks.
 */
export { type HandlerResult, HANDLED, NOT_HANDLED } from './handler-result';
export {
  type EventFacts,
  type HookFacts,
  type RequestFacts,
} from './request-facts';
export {
  type FlowState,
  type InboundRoomRef,
  initialFlowState,
} from './flow-state';
