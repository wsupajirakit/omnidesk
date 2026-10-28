import { buildEventHandlerRegistry } from './handler-entries';
import type {
  EventHandlerContext,
  EventHandlerDeps,
  WebhookEventHandler,
} from './event-handler.port';

/**
 * [FEAT-20260905-EVENTREG] The ONE function the spine calls.
 *
 * Built once at module load: the registry is a pure function of a static list, so a
 * per-event rebuild would be work with no answer that could differ.
 */
const REGISTRY = buildEventHandlerRegistry();

/**
 * Dispatch a registered event type.
 *
 * @returns true when a handler ran — the caller may return immediately.
 *          false when no handler owns this type, which is the state every event type was
 *          in before this registry existed: the spine carries on byte-for-byte as before.
 *
 * ⚠️ A HANDLER THROWING MUST NOT COST THE TURN. Registered types are the ones the spine
 * ignores, so a failure here is strictly less important than what the spine was already
 * doing. The error is logged and `true` is still returned — the event WAS this handler's,
 * and pretending otherwise would drop it into gates that were never written for it.
 */
export async function dispatchRegisteredEvent(
  ctx: EventHandlerContext,
  deps: EventHandlerDeps,
  /**
   * The registry to dispatch against. Defaults to the shipped one.
   *
   * ⚠️ IT EXISTS BECAUSE THE SHIPPED LIST IS NOW INERT. With no handler enabled, the
   * dispatch path — runs the handler, answers true, survives a throw — would have no way
   * to be exercised at all, and an untested path is how the last defect here survived
   * fourteen save points. A spec passes a list of its own; the product passes nothing.
   */
  registry: ReadonlyMap<string, WebhookEventHandler> = REGISTRY,
): Promise<boolean> {
  const handler = registry.get(ctx.event.type ?? '');
  if (!handler) return false;

  try {
    await handler.handle(ctx, deps);
  } catch (err) {
    deps.error(
      `[EVENTREG] handler '${handler.eventType}' failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  return true;
}

/** For specs and the boot log: what is registered right now. */
export function registeredEventTypes(): string[] {
  return [...REGISTRY.keys()].sort();
}
