/**
 * [FEAT-20260826-STRIKESUSPEND] The seam the webhook asks "should I stay silent".
 * ===========================================================================
 * 📖 PLAN: `todo/task/26082026/todo10_26082026_strike-suspend.md`
 *
 * A SECOND, SEPARATE PORT — not a method bolted onto `STRIKE_SINK`. The sink is
 * the WRITE side (the webhook hands it a verdict and forgets); this is the READ
 * side (the webhook asks a question and acts on the answer). Keeping them apart
 * means the tap and the gate can be plugged in independently: a deployment can
 * record strikes without ever silencing anyone, which is exactly the state this
 * repo shipped in for two days. หนึ่งพอร์ต = หนึ่งคำถาม
 *
 * ⚠️ THIS FILE IMPORTS NOTHING, on purpose — the same property
 * `strike-sink.port.ts` protects. `webhook` may depend on the shape of a
 * question without depending on the module that answers it, and `strike` stays
 * a leaf that no feature module can drag in behind it.
 *
 * ⚠️ Injected with `@Optional()`. An unbound token leaves the call site as
 * `undefined?.` — no query, no branch, byte-identical to not having the feature.
 * That is what makes "remove it and nothing changes" a fact rather than a claim,
 * and `strike-suspend-plug-patch.spec.ts` proves it on every run.
 *
 * revert: delete this file with the gate.
 */

/** DI token. `strike.module.ts` binds it to `StrikeService` with `useExisting`. */
export const STRIKE_GATE = Symbol('STRIKE_GATE');

/**
 * One row of the tray. Declared on the PORT, not on the service, so a caller can
 * name the shape without importing the implementation — the same reason this
 * file imports nothing at all.
 */
export interface SuspendedSession {
  _id: unknown;
  line_user_id: string;
  seq: number;
  strike_total: number;
  suspended_at: Date;
  /* [FEAT-20260830-TRAYWHOBLOCKED] set ONLY when an admin pressed Block
     (`strike-admin.service.ts`); the strike ceiling never writes it. Absent =
     the ceiling armed the latch. The tray reads it to label the row honestly
     instead of inferring the cause from `strike_total === 0`, which would
     mislabel a ceiling lock whose events have aged out of the window. */
  suspended_by?: string;
  opened_at: Date;

  /* Joined for display, all optional — a row whose member row is gone, or whose
     strike predates `hook_alias`, simply has fewer keys and the screen shows
     `n/a`. Never used to decide anything. */
  full_name?: string;
  display_name?: string;
  phone_number?: string;
  hook_alias?: string;
}

export interface StrikeGate {
  /**
   * Is the webhook meant to stay silent for this customer right now?
   *
   * `true` ⇒ answer nothing, store nothing, count nothing — end the event here.
   *
   * ⚠️ IT MAY ALSO SET THE LATCH. The same call that reports "locked" is the one
   * that decides a customer has just crossed the threshold and writes
   * `suspended_at`. That is deliberate: splitting "check" from "arm" would let
   * two events race between them and lock the same customer twice, and the
   * webhook has no lock of its own to hold across the pair.
   *
   * ⚠️ IT MUST NEVER THROW. A read that fails has to answer `false` — the cost of
   * a wrong `false` is one customer answered who should not have been, and the
   * cost of a wrong throw is a webhook that drops real traffic. ถามไม่ได้ = ตอบปกติ
   */
  isSuspended(lineUserId: string | undefined | null): Promise<boolean>;

  /** Everyone currently locked out, newest first. Never rejects — `[]` on failure. */
  listSuspended(limit?: number): Promise<SuspendedSession[]>;

  /** The threshold and window in force, so no screen has to hold its own copy. */
  suspendPolicy(): { suspend_at: number; window_hours: number };
}
