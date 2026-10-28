/**
 * [FEAT-20260824-STRIKESESSION] The pipe, and nothing else.
 * ===========================================================================
 * 📖 HANDOVER DOC: `docs/strike-session.md` — read that first; it is the operating
 *    manual (what it is, the API, permissions, how to switch it on and off).
 *    Design + measurements: `docs/strike-count-design.md`.
 *
 * Owner, 24/08/2026: *"มันไม่ใช่กับ limit เดิมนะ ทำงานแบบเดิม เพราะเรานับแยก"* and
 * *"ตัว strike count ทำตัวเอง แยกอิสระ"*.
 *
 * THIS FILE EXISTS SO THE RATE LIMITER NEVER HAS TO KNOW ABOUT STRIKE TRACKING.
 * An earlier draft of the design put the recording call INSIDE
 * `UserRateLadderService.consume()` and widened its signature to carry a hook
 * id. The owner rejected that, correctly: it is an edit to the limiter, however
 * optional it looks. Nothing in `webhook/rate-limit/` or `infra/rate-limit/` is
 * touched by this feature — verify with `git diff --name-only` before commit.
 *
 * HOW IT WORKS INSTEAD: `consume()` already returns everything a strike row
 * needs — `strikeAdded`, `level`, `limit`, `windowSeconds`
 * (`webhook/rate-limit/user-rate-ladder.service.ts:56-68`). The webhook simply
 * READS that verdict, which it already holds, and hands it here.
 *
 * WHY TURNING THIS OFF CANNOT DISTURB THE LIMITER — ordering, not a promise:
 *
 *     await this.rateLimit.consume(...)   // decided, Redis already written
 *        |
 *        v  verdict in hand
 *     this.noteStrike(v, ...)             // this pipe, strictly downstream
 *
 *   Being downstream, the pipe cannot change the verdict (already computed),
 *   cannot change the limiter's Redis counter (already written), and cannot add
 *   latency (the call is never awaited). For a message that was not blocked it
 *   does not even reach here — the caller returns on `!v.strikeAdded`, which is
 *   a single property read and zero I/O.
 *
 * ⚠️ THE ONE WAY THIS COULD STILL HURT: an async throw with no catch becomes an
 * unhandled rejection, and `void` does not save you from that. `StrikeService.record`
 * therefore swallows everything itself. Do not rely on the `void` at the call
 * site. มี try/catch อยู่ใน record() เสมอ ห้ามพึ่ง void อย่างเดียว
 *
 * DIRECTION OF DEPENDENCY: `webhook` imports this token from `@/modules/strike`.
 * `strike` imports nothing from any feature module. Deleting the strike module
 * leaves the ladder files literally unaware the feature ever existed.
 *
 * revert: delete this file with the module; remove the tap in webhook.service.ts.
 */

/** Everything one strike needs, all of it already computed by the caller. */
export interface StrikeRecordInput {
  /** The OA the blocked message arrived on. */
  hookId: string;
  /** `event.source.userId` — the same value the rate limiter keys on. */
  lineUserId: string;
  /** Ladder level in force for that window (1 = base rung). */
  level: number;
  /** Messages allowed in that window, as applied. */
  limit: number;
  /** Length of that window in seconds, as applied. */
  windowSeconds: number;
  /**
   * [FEAT-20260826-STRIKESUSPEND] what that OA was CALLED at this moment.
   * Display text only — `hookId` above stays the identity. Optional: a caller
   * that does not know it simply omits it and the tray shows `n/a`.
   */
  hookAlias?: string | null;

  /** LINE message type, when known. */
  messageType?: string | null;
  /** When the block happened. The caller passes it so tests can pin it. */
  occurredAt: Date;
  /** Mongo `_id` of the member, only if the caller already had it. */
  memberId?: string | null;
}

/**
 * The seam. `StrikeService` implements it; `webhook.service.ts` injects it with
 * `@Optional()`, so an unbound token leaves the call site as a no-op.
 */
/** The shape of a rate-limit verdict, as `UserRateLadderService.consume()` returns
 *  it. Declared structurally rather than imported so this module still depends on
 *  nothing: the webhook may pass its verdict straight in, and `strike` never has
 *  to know which service produced it. ประกาศรูปเอง ไม่ import — โมดูลนี้ไม่รู้จักใคร */
export interface StrikeVerdictLike {
  strikeAdded?: boolean;
  level?: number;
  limit?: number;
  windowSeconds?: number;
}

export interface StrikeSink {
  /** Records one strike. MUST NOT throw, and MUST NOT be relied upon to await. */
  record(input: StrikeRecordInput): Promise<void>;

  /**
   * THE PLUG — the only method the webhook needs.
   *
   * Give it the verdict `consume()` just returned and it decides whether that was
   * a strike and records it. An ordinary message costs one property read and no
   * I/O. Never rejects; still call it with `.catch(() => {})` so the caller does
   * not depend on that.
   */
  recordFromVerdict(
    verdict: StrikeVerdictLike | null | undefined,
    lineUserId: string | undefined,
    hookId: string | undefined,
    messageType?: string,
    memberId?: string | null,
    /* [FEAT-20260826-STRIKESUSPEND] LAST and optional, so every existing call
       stays byte-identical and a caller that does not know the alias simply
       omits it. Display text — `hookId` above remains the identity. */
    hookAlias?: string | null,
  ): Promise<void>;
}

export const STRIKE_SINK = Symbol('STRIKE_SINK');
