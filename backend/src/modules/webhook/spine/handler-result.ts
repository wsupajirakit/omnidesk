/**
 * [PROG-20260905-CONTRACTS] What a spine handler answers.
 *
 * WHY THIS EXISTS. The reduction program moves gate bodies out of
 * `processLockedEvent` into role directories. Each move leaves one guarded call in the
 * spine, and the spine has to decide from the answer whether to return or fall through.
 * If every handler invents its own answer shape, the ladder stops being readable — which
 * is the whole point of moving anything.
 *
 * THE CONTRACT IS NOT NEW. It is the one `hook-reply/customer-register.handler.ts`
 * already states in its own header and has used since 08/08:
 *
 *   handled: true  — this handler dealt with the turn; the caller returns immediately.
 *   handled: false — not its turn; fall through to the next gate, byte-for-byte as before.
 *
 * WRITING IT DOWN CHANGES NOTHING TODAY. No existing handler is edited to use this type;
 * it is the shape the NEW files take, so the ladder reads the same way at every rung.
 *
 * ⚠️ `handled` IS ABOUT CONTROL FLOW, NOT SUCCESS. A handler that tried to reply and got
 * a 400 from LINE has still consumed the turn — it answers `true`. A handler that decided
 * the turn was not its business answers `false`. Conflating "handled" with "worked" is how
 * a failed send turns into a second reply on the same message.
 */
export interface HandlerResult {
  /** true = the caller must `return` now; false = fall through to the next gate. */
  handled: boolean;
}

/** The turn was consumed. */
export const HANDLED: HandlerResult = Object.freeze({ handled: true });

/** Not this handler's turn — the spine carries on exactly as it did before. */
export const NOT_HANDLED: HandlerResult = Object.freeze({ handled: false });
