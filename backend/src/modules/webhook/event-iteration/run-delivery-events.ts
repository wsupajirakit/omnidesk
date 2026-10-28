/**
 * [FEAT-20260905-MULTIEVENT] Run one LINE delivery's events, in order, one at a time.
 *
 * 📖 PLAN: `todo/task/05092026/webhook_multi_event_design.md` (track B).
 *
 * WHAT THE SPINE KEEPS AND WHAT MOVED HERE. The spine keeps the two lines that decide
 * whether there is anything to do at all (`events?.[0]`, and the return when there is not
 * — that return precedes the lock and every log row, so an empty delivery still has zero
 * side effects). Everything about the BATCH is here: which slice runs, in what order, what
 * body each iteration sees, and what is said about anything left behind.
 *
 * ⚠️ SEQUENTIAL AND AWAITED, DELIBERATELY — NOT `Promise.all`.
 *   · Same user: `withUserLock` is a stampede damper, not mutual exclusion. A waiter
 *     proceeds UNLOCKED after 25s and acquisition has no queue, so firing a user's events
 *     concurrently recreates the duplicate-ticket concurrency of 2026-07-27. Submitting
 *     them one at a time means each lock is already free when the next event asks for it.
 *   · Different users: locks are per-userId, so parallel would be *safe* — and it is still
 *     not what this does. The webhook path has no `Promise.all` anywhere, the Mongo pool is
 *     deliberately sized, and 100% of observed deliveries carry one event. Parallelism
 *     would buy nothing today and re-add concurrency that was tuned away.
 *   · The order of the array is the only ordering signal LINE gives us. Keep it.
 *
 * ⚠️ FAILURE ISOLATION IS FREE, AND KEPT. The per-event unit never rejects: the spine's
 * outer catch swallows everything and the log door swallows its own failures. So event 3
 * still runs after event 2 fails, with one error row for the failure — exactly the
 * semantics a single event has today. This file adds no try/catch of its own precisely
 * because adding one would claim a guarantee it cannot make.
 *
 * ⚠️ THE ITERATION-0-ORIGINAL-BODY RULE IS LOAD-BEARING. Selection is a prefix, so
 * `selected[0] === events[0]`, and iteration 0 is handed the UNTOUCHED body: the spine's
 * re-read finds the right event, the raw delivery row stores the whole delivery, and the
 * signature re-check HMACs the real bytes. Iterations 1+ get `{...body, events: [ev]}` so
 * that same byte-identical re-read picks THEIR event — which is how the loop neutralises
 * the re-read clobber without editing the clobber. A naive loop that passed the original
 * body every time would process `events[0]` N times: N quota charges, N model calls, N
 * pushes of the same answer, with chat dedup quietly hiding the duplicate rows.
 *
 * ⚠️ EXACTLY ONE `incoming_line_webhook` ROW PER DELIVERY. Iteration 0 writes it with the
 * full body; every later iteration is told to skip it. Per-event rows (replies, errors)
 * still follow their event. This is what keeps one-row-per-delivery accounting true.
 *
 * No Nest here and no service import: everything arrives through `deps`.
 */

import {
  EVENTS_PER_DELIVERY_CAP,
  selectDeliveryEvents,
  type DeliveryEventLike,
} from './select-delivery-events';

export interface RunDeliveryEventsInput<E extends DeliveryEventLike> {
  /** The delivery body verbatim, as it arrived and as it was signed. */
  body: Record<string, unknown>;
  /** `body.events`, already read and non-empty — the spine's guard owns the empty case. */
  events: readonly E[];
  /** The `WEBHOOK_MULTI_EVENT` switch. `false` = process `events[0]` only, as legacy did. */
  multiEvent: boolean;
  /** Injectable so no test hard-codes the shipped ceiling. */
  cap?: number;
}

export interface RunDeliveryEventsDeps<E extends DeliveryEventLike> {
  /**
   * Process ONE event. The caller binds the lock and the spine into this: whatever it
   * does, it must not reject — this loop deliberately has no catch (see the header).
   *
   * @param event  the event to process
   * @param body   the body THIS iteration must see (see the iteration-0 rule)
   * @param index  its position in the selected slice; `> 0` means the delivery row is done
   */
  run: (
    event: E,
    body: Record<string, unknown>,
    index: number,
  ) => Promise<void>;
  warn: (message: string) => void;
}

export async function runDeliveryEvents<E extends DeliveryEventLike>(
  input: RunDeliveryEventsInput<E>,
  deps: RunDeliveryEventsDeps<E>,
): Promise<void> {
  const { selected, dropped, reason } = selectDeliveryEvents(input.events, {
    multiEvent: input.multiEvent,
    cap: input.cap,
  });

  /* A drop is ALWAYS said out loud, in both modes and in different words. Silence is the
     defect: today's `events[0]`-only read discards the rest with no trace at all, and a
     silent cap would simply move that same silence to offset five. The warn is the audit
     trail for a customer message that is now lost forever — the 200 went out long ago and
     LINE does not redeliver. Both counts are named so the line answers "how many" without
     anyone having to find the payload. */
  if (dropped > 0) {
    deps.warn(
      reason === 'cap'
        ? `[EVENTCAP] delivery carried ${input.events.length} events; processed ${selected.length}, dropped ${dropped} (cap ${input.cap ?? EVENTS_PER_DELIVERY_CAP})`
        : /* 🔴 `=on`, NOT `=true`. `env.schema.ts` declares this as
             `z.enum(['on','off'])`, so an operator who followed the old wording set a
             value the schema REJECTS and the service refused to boot — a log line whose
             advice breaks the thing it is trying to fix. Found 05/09; the spec had
             pinned the wrong string, so the test was guarding the defect.
             ค่าที่บอกในlog ต้องเป็นค่าที่ schema รับจริง */
          `[EVENTBATCH] delivery carried ${input.events.length} events; multi-event is OFF so ${dropped} were discarded after events[0] — set WEBHOOK_MULTI_EVENT=on to process them`,
    );
  }

  for (let index = 0; index < selected.length; index++) {
    const event = selected[index] as E;
    // Iteration 0 gets the original object, not a copy of it. See the header.
    const body = index === 0 ? input.body : { ...input.body, events: [event] };
    await deps.run(event, body, index);
  }
}
