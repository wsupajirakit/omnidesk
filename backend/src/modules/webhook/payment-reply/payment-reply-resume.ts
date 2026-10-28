/**
 * [FIX-20260817-RETRYRESUME] Carry the runner's `resume` from its RESULT to the
 * card that renders the [ลองใหม่] button.
 *
 * ══ THE BUG THIS CLOSES ══════════════════════════════════════════════════════
 * `resume` is declared on `PaymentRunResult` (payment-runner.service.ts:267),
 * NOT inside `result.reply`:
 *
 *     { ...this._result(…, 'no_match_retry', …),
 *       resume: { run_id, next_idx } }      ← a SIBLING of reply, not a child
 *
 * Both delivery paths forwarded only the child — `sendPaymentReply(result.reply
 * as never, …)` and `deps.sendReply(result.reply, …)` — so the renderer's
 * `reply.resume` was always undefined. `buildAction` then did the right thing
 * for the wrong reason: with no resume target it removes the button rather than
 * render a dead one. Result: EVERY card told the customer to press [ลองใหม่]
 * and no card ever carried the button, leaving the run `awaiting_retry` with no
 * way for the customer to advance it. Observed live twice on 17/08.
 *
 * The `as never` cast at the call site is why the compiler never complained,
 * even though `sendPaymentReply`'s own signature declares `resume?`.
 *
 * ══ WHY A SHARED FILE FOR TWO SMALL FUNCTIONS ════════════════════════════════
 * The same two mappings were needed in three places — the new-slip path, the
 * postback (resume) path, and twice inside the renderer for the snake→camel
 * rename. Duplicating them is how they drifted apart in the first place, so both
 * halves of the bridge live here and both call sites import them. Pure, no Nest,
 * no I/O, nothing throws: these sit on the money path.
 *
 * ห้ามก๊อปตรรกะสองอันนี้ไปวางที่อื่น — ให้ import จากที่นี่ที่เดียว
 */

/** The runner's wire shape (snake_case, as stored on the run document). */
export interface ResumeTarget {
  run_id: string;
  /** The statement index to try next (= the run's `resume_cursor`). */
  next_idx: number;
}

/** The reply object the delivery path passes around, plus the lifted target. */
export interface ReplyWithResume {
  state: string;
  kind: 'text' | 'flex';
  text: string;
  actions?: string[];
  detail: string;
  resume?: ResumeTarget;
}

/**
 * Lifts `resume` off the RESULT and onto the reply the delivery path forwards.
 *
 * Returns `undefined` when there is no reply, so callers keep the early return
 * they already had (`if (!result.reply) return false`).
 * Absent `resume` stays absent — a state with nothing to advance to must not
 * gain a button.
 */
export function replyWithResume(
  /* Takes the WHOLE result. Only these members are read; both callers pass a
     richer type (directTicketId, dividerDone, stateFlex, …) which is accepted
     structurally. `ran` is named so a bare `{ ran: false }` literal type-checks
     too — an object literal is excess-property checked, a variable is not. */
  result?: {
    ran?: boolean;
    reply?: {
      state: string;
      kind: 'text' | 'flex';
      text: string;
      actions?: string[];
      detail: string;
    } | null;
    resume?: ResumeTarget;
  } | null,
): ReplyWithResume | undefined {
  const reply = result?.reply;
  if (!reply) return undefined;
  return result?.resume ? { ...reply, resume: result.resume } : { ...reply };
}

/**
 * The renderer's shape (camelCase). Kept separate from `replyWithResume` because
 * the postback handler needs the first mapping and not the second.
 *
 * `undefined` in ⇒ `undefined` out, which is exactly what `buildAction` and
 * `mintPayLinks` read as "no target ⇒ no button".
 */
export function resumeContext(
  reply: { resume?: ResumeTarget } | null | undefined,
): { runId: string; nextIdx: number } | undefined {
  const r = reply?.resume;
  return r ? { runId: r.run_id, nextIdx: r.next_idx } : undefined;
}
