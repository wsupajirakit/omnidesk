/**
 * [FEAT-20260907-BCASTUNUSEDRULES] Audience conditions on a pipe that cannot use
 * them — what we say about it, and what we refuse.
 * ===========================================================================
 * A pure decision. No database, no I/O, no clock. Switches are plain consts and
 * one function answers each question.
 *
 * 🔴 THE FACT THIS FILE EXISTS FOR, measured on 06/09 with the LINE push counter
 *    (`z-test/tmp/multicast-live.ts`, commit `9178ed9`):
 *    three multicasts carrying a rule that selects two members consumed 6 push —
 *    two each. The SAME rule, still sitting in the job document, on a job
 *    switched to `send_kind: 'broadcast'` consumed 3 — every follower. Every run
 *    answered status "success"; only the counter told them apart.
 *    A narrow rule plus a switch to broadcast reaches everybody, silently.
 *
 * WHY IT HAPPENS — three shipped lines, none of them wrong on its own:
 *   · `broadcast-run/run-broadcast.ts:195` builds the audience filter for EVERY
 *     run; the send cell is never consulted
 *   · `run-broadcast.ts:241` counts members per OA through that filter
 *   · `broadcast-send/oa-executor.ts:250-272` then posts `to: []` to
 *     `/message/broadcast`, because that endpoint carries no recipient list —
 *     so the filter built above is applied to nothing at all
 *
 * 🔴 WHAT THIS FILE DOES **NOT** DO — owner's decision, 07/09/2026: the send is
 *    NOT refused. A refusal would stop scheduled campaigns that are sending
 *    today, and the number of production jobs in this state is not knowable from
 *    here. The run proceeds exactly as it does now; this file only makes the
 *    situation SAYABLE. It does not block the send; it makes it knowable.
 *
 * ⚠️ THE CONSEQUENCE, STATED PLAINLY BECAUSE IT IS PERMANENT: since the send
 *    proceeds, `targeted` on each history row keeps counting the people the
 *    CONDITIONS selected, while LINE reached every follower of the channel.
 *    That number is not the reach and never was on this path
 *    (`oa-executor.ts:236-239` already calls the count an estimate). The flag
 *    below is the only thing in the row that says so.
 *
 * 🔴 IT IS `targeted`, NOT `matched` — corrected 07/09 by reading the counters
 *    after a test written on the opposite assumption failed on its first run.
 *    `matched` is 0 on EVERY per-OA row, broadcast and multicast alike, because
 *    `broadcast-history/run-counters.ts:207-219` (`countersForOa`) sets
 *    `targeted`/`unsent`/`requestsPlanned`/`chunksPlanned` and never touches
 *    `matched`; the run-level `matched` computed at `run-broadcast.ts:271`
 *    feeds the RUN summary, which is not a stored row. Anyone coming here for
 *    the misleading number will find it under `targeted`.
 *
 * ⚠️ MULTICAST IS NOT TOUCHED BY ANY SWITCH HERE, and that is the whole safety
 *    of the file. `addressesRecipients(cell)` is true for every `multicast:*`
 *    cell, so every question below answers "no" for them and their behaviour is
 *    byte-identical. Multicast does not move a byte.
 *
 * ⚠️ PLAIN CONSTS, NOT ENV VARS — the same rule `broadcast-var/checks/checks.config.ts`
 *    states for itself: a rule that can be flipped per environment is a rule
 *    nobody can predict from the code. Flip it here, in the diff, where a
 *    reviewer sees it.
 *
 * revert: set all three switches to `false` — every caller then behaves exactly
 * as it did before 07/09. Delete this file and its four call sites
 * (`broadcast-run/new-send.service.ts`, `broadcast-run/run-io.ts`,
 * `broadcasts.service.ts` ×2) to remove it entirely.
 */
import { addressesRecipients } from './send-loop.helpers';
import type { SendCell } from './send-matrix.registry';

/* ── the three switches, independent on purpose ─────────────────────────────
 * Each answers a different question and each reverts alone. Turning one off
 * must leave the others working — that is why they are three consts and not
 * one. Owner, 07/09: the part that touches the database must be its own
 * independently switchable piece.
 * ───────────────────────────────────────────────────────────────────────── */

/** Write a log line when a run carries rules its pipe cannot use. Costs nothing. */
export const LOG_UNUSED_RULES_ON_BROADCAST = true;

/**
 * Stamp the history row so the stored numbers can be read correctly later.
 *
 * 🔴 THIS IS THE ONE SWITCH THAT REACHES THE DATABASE, and it is separate from
 *    the log for exactly that reason. It adds an OPTIONAL boolean that is
 *    written ONLY when true — never `false`, never a default — so a row that
 *    predates this, or a row written with the switch off, is byte-identical to
 *    what the collection already holds. No existing row is read, rewritten or
 *    migrated. `false` here = nothing is ever written and the field never
 *    appears. Adding a field is allowed; disturbing what is already stored is
 *    not — absent on anything that is not this case.
 */
export const FLAG_UNUSED_RULES_ON_BROADCAST = true;

/**
 * Refuse a SAVE that moves a job INTO this state.
 *
 * ⚠️ Only the transition. A job already stored this way stays editable — see
 *    `refusesUnusedRulesAtSave` for why, and for the three precedents in
 *    `broadcasts.service.ts` that already work this way.
 */
export const REFUSE_NEW_RULES_ON_BROADCAST_AT_SAVE = true;

/**
 * Does this send carry audience conditions that its own pipe will ignore?
 *
 * `true` only when BOTH are true:
 *   · the cell does not address recipients (`recipientsPerRequest === 0`,
 *     i.e. `broadcast:*`) — asked through the shared helper rather than by
 *     comparing `sendKind` to a string, so one definition of "addresses people"
 *     serves the whole folder
 *   · at least one rule is actually set
 *
 * ⚠️ AN EMPTY RULE LIST IS NOT THIS PROBLEM. "Send to everyone" is a real thing
 *    to want, and on `/message/broadcast` it is exactly what happens. Flagging
 *    it would put a warning on every correct broadcast in the system.
 *    No conditions means "everyone, on purpose" — not a mistake.
 *
 * ⚠️ Reads `rules` defensively rather than trusting the type: this predicate is
 *    called on a value that came out of a Mongo document, and a row written
 *    before the field existed carries no list at all.
 *
 * ⚠️ The parameter is `unknown`, NOT `AudienceQuery`, for the same reason.
 *    `broadcasts.service.ts` asks it about `broadcast['target']` straight off a
 *    lean document — a value with no type at all. Narrowing the parameter would
 *    push a cast onto every caller, which is the same trust wearing a different
 *    hat. Take the raw value and check it here, rather than making every
 *    caller cast.
 */
export function carriesUnusedRules(cell: SendCell, audience: unknown): boolean {
  if (addressesRecipients(cell)) return false;
  if (typeof audience !== 'object' || audience === null) return false;
  const rules = (audience as { readonly rules?: unknown }).rules;
  return Array.isArray(rules) && rules.length > 0;
}

/** Should a run log that it is dropping its own conditions? */
export function logsUnusedRules(cell: SendCell, audience: unknown): boolean {
  return LOG_UNUSED_RULES_ON_BROADCAST && carriesUnusedRules(cell, audience);
}

/** Should this run's history rows carry the flag? */
export function flagsUnusedRules(cell: SendCell, audience: unknown): boolean {
  return FLAG_UNUSED_RULES_ON_BROADCAST && carriesUnusedRules(cell, audience);
}

/**
 * Should a save be refused — judging the row AS IT WILL BE against the row as it
 * IS?
 *
 * 🔴 THE ASYMMETRY IS THE DESIGN, NOT AN OVERSIGHT. A blanket refusal would make
 *    every job already in this state UNEDITABLE: the dashboard's `buildPayload`
 *    is `{ ...formData }`, so `target` rides on EVERY save
 *    (`BroadcastFormModal.tsx` ~:802) — renaming such a job would send its
 *    stored rules straight back and be rejected. `broadcasts.service.ts` already
 *    solves this shape three times: `ensureValidDescription` (required on
 *    create, optional on update), `ensureProfileTagsMatchCardType` (judged only
 *    when the request touches the message or the tick), and the `pending()`
 *    helper at `:657-662` which reads the row as it will be.
 *    An existing job must stay editable; a new rule must not freeze old rows.
 *
 * @param wasAlreadyUnusable what the STORED row was. `undefined` = a create,
 *        where there is no stored row and nothing to protect.
 */
export function refusesUnusedRulesAtSave(
  willBeUnusable: boolean,
  wasAlreadyUnusable: boolean | undefined,
): boolean {
  if (!REFUSE_NEW_RULES_ON_BROADCAST_AT_SAVE) return false;
  if (!willBeUnusable) return false;
  /* Already broken before this request touched it ⇒ not this request's doing,
     and refusing would freeze the row. Only the transition is refused. */
  return wasAlreadyUnusable !== true;
}

/**
 * The refusal an admin reads, while the form is still open.
 *
 * Names the way out (`/message/broadcast` has no recipient list, so use
 * multicast or clear the conditions) rather than only the rule, because a
 * refusal that does not say what to do next is a dead end.
 */
export const UNUSED_RULES_SAVE_MESSAGE =
  'a broadcast has no recipient list, so audience conditions cannot narrow it — ' +
  'LINE would deliver to every follower. Use multicast, or clear the conditions.';
