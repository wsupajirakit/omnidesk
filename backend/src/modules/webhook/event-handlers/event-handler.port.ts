/**
 * [FEAT-20260905-EVENTREG] What a webhook event handler is.
 *
 * WHY THIS EXISTS. Adding support for a new LINE event type used to mean reading a
 * 2,800-line method to work out where the condition belongs, and then hoping. This port
 * plus `handler-entries.ts` makes the answer mechanical: **write one file, add one line**.
 *
 * ⚠️ ADMISSIBILITY IS THE WHOLE SAFETY STORY. This registry may only ever serve event
 * types the spine IGNORES. The spine handles `message` and `postback` — verified by
 * grepping every `event.type` comparison in the module, which yields exactly those two
 * literals and nothing else. A handler registered for either of them would create a
 * SECOND place where the same event is decided, which is precisely the bug factory the
 * research rejected (dossier anti-pattern #13). `handler-entries.ts` refuses such an entry
 * at boot, not at runtime.
 *
 * No Nest in this directory: everything arrives through `deps`, so `rm -rf` of this folder
 * plus one call site is a complete revert.
 */

/**
 * The LINE event as the dispatcher passes it on — deliberately NOT the LINE SDK type.
 *
 * No index signature: the spine's own `LineEvent` does not have one, and adding it here
 * would force a cast at the only call site, which is where a type error is worth having.
 * A handler that needs a field this interface does not name should name it here — that
 * edit is the record of a new dependency on the event shape.
 */
export interface WebhookEventLike {
  type?: string;
  source?: { userId?: string; type?: string };
  replyToken?: string;
}

/** What every handler is given about the turn. Read-only. */
export interface EventHandlerContext {
  readonly event: WebhookEventLike;
  readonly hook: Record<string, unknown> | null | undefined;
  readonly alias?: string;
  /** The bag log rows spread, so a handler's row matches every other row of the turn. */
  readonly logContext: Readonly<Record<string, unknown>>;
}

/** The collaborators a handler may use. Every one optional-by-construction at the seam. */
export interface EventHandlerDeps {
  log: (message: string) => void;
  error: (message: string) => void;
  /** Writes a `webhook_logs` row. Awaited by the dispatcher's caller, never fire-and-forget. */
  emitWlog: (row: Record<string, unknown>) => Promise<void>;
}

export interface WebhookEventHandler {
  /**
   * The LINE event type this handler owns — `follow`, `unfollow`, `unsend`, …
   * The registry key is DERIVED from this field, so the type is written once.
   */
  readonly eventType: string;
  /** One line explaining what the handler does; surfaced in the boot log and in tests. */
  readonly describe: string;
  handle(ctx: EventHandlerContext, deps: EventHandlerDeps): Promise<void>;
}
