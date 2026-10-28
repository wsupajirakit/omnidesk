/**
 * [PROG-20260905-CONTRACTS] The mutable state gates hand to each other.
 *
 * WHY IT IS SEPARATE FROM `RequestFacts`. Facts are settled before the ladder starts and
 * never change. These fields are the opposite: one gate writes them and a later gate
 * reads them, which is exactly where a reordering bug hides. Keeping them in their own
 * type means a handler's signature says, in the type system, whether it may write flow
 * state or only read facts.
 *
 * WHY A TYPED CARRIER BEATS WHAT WE HAVE. Today these live as method-scope `let`s: 33 of
 * them, some declared 5,000 lines above their reader, any line free to reassign any of
 * them with nothing recording the fact. A handler that takes
 * `Pick<FlowState, 'skipBotProcessing'>` can only touch what its signature admits to, and
 * `tsc` — not a comment, not a reviewer — enforces it.
 *
 * THE FIELDS BELOW ARE THE MEASURED ONES: the four the assist gate writes and thirteen
 * later code lines read, plus the room the follow-up gate needs. They are the state the
 * first extractions actually cross a boundary with; the rest of the 33 `let`s stay where
 * they are until a cut needs them, because guessing at a carrier nobody uses is how a
 * god-object starts.
 *
 * ⚠️ NOTHING USES THIS YET (landed at SP4 so every track shares one shape).
 */

/** The room the turn belongs to, once bootstrapped. */
export interface InboundRoomRef {
  readonly _id?: unknown;
  readonly [key: string]: unknown;
}

export interface FlowState {
  /**
   * An operator holds the room, so the bot must stay silent. Written by the assist gate;
   * read at thirteen later code lines. The single most consequential flag in the ladder.
   */
  skipBotProcessing: boolean;

  /**
   * The room this turn belongs to. Written by the assist gate, read by the follow-up
   * gate and the register hand-off.
   *
   * ⚠️ It is assigned BEFORE the awaits that follow it, and it deliberately survives a
   * later throw — a handler that builds its verdict only at the end of a try would null
   * this on the failure path and silently change who the follow-up gate thinks the room
   * is. Measured on the real gate; the shape exists to preserve it.
   */
  inboundRoom: InboundRoomRef | null;

  /** Set when the turn must re-assist after replying; read only by the method's finally. */
  forceReAssistAfterReply: boolean;

  /** Minutes after which the auto-unassist fired, if it did. Read at four later sites. */
  autoUnassistTriggeredMinutes: number | null;
}

/** The state a turn starts with, before any gate has written to it. */
export function initialFlowState(): FlowState {
  return {
    skipBotProcessing: false,
    inboundRoom: null,
    forceReAssistAfterReply: false,
    autoUnassistTriggeredMinutes: null,
  };
}
