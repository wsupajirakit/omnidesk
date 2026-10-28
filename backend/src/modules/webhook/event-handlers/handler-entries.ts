import { followHandler } from './follow.handler';
import type { WebhookEventHandler } from './event-handler.port';

/**
 * [FEAT-20260905-EVENTREG] THE ONE LOCATION.
 *
 * Adding support for a new LINE event type is: write `<type>.handler.ts` next to this
 * file, add one line to the list below. Nothing else in the repo changes.
 *
 * Shape copied from the switchboard this repo already trusts on a money path,
 * `src/modules/slip/providers/provider-entries.ts`: one self-describing entry per line,
 * on/off by flipping `enabled`, the map key DERIVED from the implementation so the type
 * name exists once, a pure builder a spec can drive with a modified list, and a boot-time
 * throw on a list that cannot be trusted — failing at boot beats failing on a customer.
 */
export interface EventHandlerEntry {
  handler: WebhookEventHandler;
  enabled: boolean;
  /**
   * ⚠️⚠️ REQUIRED WHENEVER `enabled` IS TRUE, and the requirement is the whole point.
   *
   * 🔴 WHAT WENT WRONG, so nobody has to rediscover it. This registry shipped at SP11 with
   * `follow` ENABLED. That is a BEHAVIOUR change — every follow event started writing an
   * `event_follow` row — landing inside an INFRASTRUCTURE change, and nobody decided it.
   * The characterisation snapshot that would have caught it was not in that save point's
   * gate set, so it sat red for **fourteen save points** while every gate run reported
   * green.
   *
   * A comment saying "default to off" would not have stopped it: the default was already
   * obvious and it was still typed `true`. So the cost is moved onto the act itself —
   * turning a handler on requires WRITING DOWN who decided and when, and
   * `buildEventHandlerRegistry` refuses a list where that is missing. The same shape the
   * growth ratchet uses for a ceiling raise: allowed, but it has to be signed.
   * เปิดได้ แต่ต้องเซ็นชื่อกำกับ ไม่ใช่พิมพ์ true เฉย ๆ
   */
  enabledBy?: string;
}

/**
 * The event types the SPINE decides. Verified by grepping every `event.type` comparison
 * in `src/modules/webhook/`: the only literals are these two.
 *
 * ⚠️ A handler for either of them would create a second place where the same event is
 * decided — two owners, no way to tell which ran. `buildEventHandlerRegistry` refuses it.
 */
export const SPINE_HANDLED_EVENT_TYPES: readonly string[] = [
  'message',
  'postback',
];

/**
 * ⚠️ THE SHIPPED LIST IS INERT, AND THAT IS THE CORRECT STATE FOR INFRASTRUCTURE.
 *
 * `follow` is written, tested and ready; it is OFF because turning it on writes a row on a
 * live path and that is a product decision nobody has made. With nothing enabled the
 * registry answers `false` for every type and the spine behaves exactly as it did before
 * this feature existed — which is what "additive until a handler file exists" was always
 * supposed to mean.
 *
 * To turn one on: flip `enabled` and write `enabledBy`. Both, or the boot refuses the list.
 */
export const EVENT_HANDLER_ENTRIES: readonly EventHandlerEntry[] = [
  { handler: followHandler, enabled: false },
];

/**
 * Build the type → handler map.
 *
 * Pure and exported so a spec can drive it with a deliberately broken list — that is how
 * the three refusals below are proven rather than asserted.
 */
export function buildEventHandlerRegistry(
  entries: readonly EventHandlerEntry[] = EVENT_HANDLER_ENTRIES,
): ReadonlyMap<string, WebhookEventHandler> {
  const registry = new Map<string, WebhookEventHandler>();
  for (const entry of entries) {
    if (!entry.enabled) continue;

    const type = entry.handler.eventType;

    if (!type) {
      throw new Error(
        '[EVENTREG] a handler declares no eventType — the map key is derived from it',
      );
    }
    // THE SHADOW GUARD. Registering a spine-handled type would split ownership of an
    // event across two places, which is how "who answered?" becomes unanswerable.
    if (SPINE_HANDLED_EVENT_TYPES.includes(type)) {
      throw new Error(
        `[EVENTREG] '${type}' is handled by the spine; a registry entry would be a second owner`,
      );
    }
    if (registry.has(type)) {
      throw new Error(
        `[EVENTREG] two enabled handlers claim '${type}' — the list is ambiguous`,
      );
    }

    /* THE SIGNATURE GUARD — see `enabledBy`. It runs LAST, after the three checks above:
       an incoherent list (no type, a spine-handled type, a duplicate) is a worse error
       than an unsigned one, and reporting the signature first would mask it.

       An entry can only go live if the decision to take it live is written down, because
       the failure this prevents was not a typo: it was a behaviour change riding along
       inside an infrastructure change, unnoticed for fourteen save points. Boot-time,
       like every other refusal here — failing at boot beats failing on a customer. */
    if (!entry.enabledBy || entry.enabledBy.trim().length < 15) {
      throw new Error(
        `[EVENTREG] '${entry.handler.eventType}' is enabled but carries no ` +
          `\`enabledBy\` — turning a handler on writes rows on a live path, so the ` +
          `decision has to be recorded beside it`,
      );
    }
    registry.set(type, entry.handler);
  }
  return registry;
}
