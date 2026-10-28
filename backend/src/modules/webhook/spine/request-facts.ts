/**
 * [PROG-20260905-CONTRACTS] The facts a turn is decided from — read-only, built once.
 *
 * WHY. Today the gates read ~33 method-scope `let`s directly, some of them declared
 * 5,000 lines above the read. When a gate body moves to its own file it needs those
 * values as arguments, and writing them out at every call site costs ~24 lines each —
 * across ~30 handlers that is more code added back than the program removes. One frozen
 * facts object is what keeps a call site at six lines instead of twenty-four.
 *
 * READ-ONLY IS THE POINT. Everything here is settled by the time the first gate runs and
 * nothing downstream may change it. `readonly` says so to the compiler, so a handler
 * cannot quietly reassign what a later gate reads — the failure mode that makes a 5,000
 * line method frightening in the first place.
 *
 * MUTABLE state (the flags gates write for later gates to read) is a different thing and
 * lives in `flow-state.ts`, deliberately separate: mixing the two is how "who wrote this"
 * becomes unanswerable.
 *
 * ⚠️ NOTHING USES THIS YET. It is the shape the first extracted handler will take
 * (SP9+), landed now so that track A's cuts, track B's loop and track C's registry all
 * take the same one. Three conventions would be worse than none.
 */

/** The LINE event as the spine sees it after the re-read at the top of the method. */
export interface EventFacts {
  /** `event.type` — 'message' | 'postback' | anything LINE may add later. */
  readonly type: string;
  /** `event.source.userId`; the per-user lock keys on it. */
  readonly userId?: string;
  /** Present only while LINE's short-lived token is valid. */
  readonly replyToken?: string;
  /** `message.type` for message events: text, image, sticker, video, audio, file. */
  readonly messageType?: string;
  /** The raw event, for the handlers that still need a field nobody has named yet. */
  readonly raw: Record<string, unknown>;
}

/** Credentials and identifiers derived from the hook row once, near the top of the turn. */
export interface HookFacts {
  readonly id?: string;
  readonly alias?: string;
  /** 0 = the hook is switched off; the out-of-hours arm owns that case. */
  readonly status?: number;
  readonly channelId?: string;
  readonly accessToken?: string;
  /** The hook row itself — decisions the extracted gates have not yet been given names for. */
  readonly raw: Record<string, unknown>;
}

/**
 * Everything a handler may READ. Assembled once; never reassigned.
 *
 * `logContext` is the bag every log row spreads. It is carried here rather than rebuilt
 * per handler because the outer catch reads the same object — two copies would drift and
 * the drift would only show in a webhook_log row nobody reads until an incident.
 */
export interface RequestFacts {
  readonly event: EventFacts;
  readonly hook: HookFacts;
  readonly logContext: Readonly<Record<string, unknown>>;
}
