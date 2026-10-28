/**
 * [FEAT-20260905-MULTIEVENT] Which events of one LINE delivery this server will process.
 *
 * 📖 PLAN: `todo/task/05092026/webhook_multi_event_design.md` (track B).
 *
 * THE DEFECT THIS EXISTS TO FIX. LINE may batch several events into one POST. Legacy read
 * `req.body.events?.[0]` and never iterated, so every later event in a batch was discarded
 * without a trace — no row, no log line, nothing. The controller has already answered 200
 * by then and LINE does not redeliver, so a dropped event is a customer message lost
 * forever. The port reproduced that discard deliberately and documented it; this file is
 * where it stops being permanent.
 *
 * ⚠️ PURE, AND THAT IS THE POINT. No logging, no clock, no collaborators — it takes an
 * array and answers which slice to run and how many were left behind. Everything that has
 * a side effect lives in `run-delivery-events.ts`, so the selection rule can be proved and
 * mutation-tested without a spine, a lock or a database.
 *
 * ⚠️ THE SELECTION IS ALWAYS A PREFIX, and later code depends on it. `selected[0]` is
 * therefore always `events[0]`, which is what lets the loop hand iteration 0 the ORIGINAL
 * delivery body: the re-read at the top of the spine picks the right event, the raw
 * `incoming_line_webhook` row stores the full delivery exactly as it does today, and the
 * signature re-check HMACs the real bytes. Reordering or filtering here would break all
 * three at once. เลือกแบบ prefix เท่านั้น
 */

/** The one field the selection rule reads. Structural on purpose — see `event-handler.port.ts`. */
export interface DeliveryEventLike {
  type?: string;
}

/**
 * The ceiling on events processed from one delivery. **Code-owned, not an env knob** —
 * the same call the rate ladder made (`rate-limit/user-rate-ladder.ts`): a number that
 * protects the server from a shape nobody has ever sent belongs in code, where changing it
 * is a reviewed commit rather than a restart.
 *
 * WHY FIVE, and what the number is actually derived from. A reply token dies at 60s and
 * the staleness guard voids a reply past a cumulative 120s while still having PAID for the
 * model call. The unit that matters is therefore the per-event cost of a TAIL case — the
 * measured AI tail is 18-23s — so `120s / ~24s ≈ 5`. Past five, a tail-case event is
 * charged for and then answered into a dead token. Healthy events (~3-5s) never come near
 * it. The larger ~70s worst-normal figure is a whole-turn number including legs the loop
 * pays once, so it is not the divisor.
 *
 * ⚠️ IT IS NOT A SECURITY BOUND. `N` is signer-bound: the signature guard HMACs the whole
 * raw body, so nobody who is not LINE can make this array long. The cap protects latency
 * and the external calls a long batch would fan out into, nothing else.
 *
 * ⚠️ IT IS NOT QUOTA PROTECTION EITHER. The per-user rate ladder already brakes same-user
 * floods and it sees every event. The gap the cap closes is a MIXED-USER array, which the
 * ladder cannot see as one thing.
 *
 * ✅ ASKED AND DECIDED BY THE OWNER, 05/09: **cap = 5, overflow drops with one warn.**
 * The alternative put alongside it — no cap at all, since `N` is signer-bound and the
 * official SDK samples run uncapped — was declined. So this number is a decision, not a
 * placeholder: changing it needs a fresh one, and `webhook-event-iteration.spec.ts`
 * asserts both boundaries (five run with no warn, six run five and announce the sixth).
 * เจ้าของตัดสินแล้ว 5 · จะเปลี่ยนต้องถามใหม่
 *
 * ⚠️ AND THE FLOW SHIPS WITH THE SWITCH OFF. `WEBHOOK_MULTI_EVENT` defaults to `'off'`
 * (`env.schema.ts`), which selects a one-event prefix — byte-identical to the legacy
 * `events[0]` read. The capability is built, proven at the cap by the two boundary cases,
 * and deliberately not enabled: turning it on is tier 2, which waits on LINE's redelivery
 * switch. ของพร้อมแล้ว แต่ปิดไว้ก่อนตามที่เจ้าของสั่ง
 */
export const EVENTS_PER_DELIVERY_CAP = 5;

export interface DeliverySelectionOptions {
  /** The `WEBHOOK_MULTI_EVENT` switch. `false` reproduces the legacy `events[0]` read. */
  multiEvent: boolean;
  /** Injectable so no test hard-codes the shipped number. Defaults to the const above. */
  cap?: number;
}

export interface DeliverySelection<E> {
  /** The events to process, in the order LINE sent them. Always a prefix of the input. */
  selected: E[];
  /** How many the input carried that `selected` does not. Zero on every normal delivery. */
  dropped: number;
  /**
   * WHY the remainder was left behind, so the caller can say so in the right words:
   * `'none'` nothing was dropped · `'off'` the switch is off and this is the legacy
   * discard · `'cap'` the batch was longer than the ceiling.
   */
  reason: 'none' | 'off' | 'cap';
}

/**
 * Decide the slice. Total: an empty array answers an empty selection rather than throwing,
 * because LINE's "Verify" button posts `events: []` and that must stay a no-op.
 */
export function selectDeliveryEvents<E extends DeliveryEventLike>(
  events: readonly E[],
  opts: DeliverySelectionOptions,
): DeliverySelection<E> {
  if (events.length === 0) return { selected: [], dropped: 0, reason: 'none' };

  /* Clamped rather than trusted. The cap is a parameter so tests can set it, and a 0 or a
     negative would select NOTHING — reintroducing, in a worse form, the silent total loss
     this file exists to end. The first event is always processed; that is structural. */
  const limit = opts.multiEvent
    ? Math.max(1, opts.cap ?? EVENTS_PER_DELIVERY_CAP)
    : 1;
  const selected = events.slice(0, limit);
  const dropped = events.length - selected.length;

  return {
    selected,
    dropped,
    reason: dropped === 0 ? 'none' : opts.multiEvent ? 'cap' : 'off',
  };
}
