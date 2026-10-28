import {
  EVENTS_PER_DELIVERY_CAP,
  selectDeliveryEvents,
} from '../../src/modules/webhook/event-iteration/select-delivery-events';
import { runDeliveryEvents } from '../../src/modules/webhook/event-iteration/run-delivery-events';

import { envSchema } from '../../src/config/env.schema';

/**
 * [FEAT-20260905-MULTIEVENT] The selection rule and the loop, proved without a spine.
 *
 * 📖 PLAN: `todo/task/05092026/webhook_multi_event_design.md` (track B).
 *
 * WHY A PURE UNIT AS WELL AS THE END-TO-END CASES IN `webhook-ingest-flow.spec.ts`.
 * The end-to-end cases prove the loop works through the real `processLockedEvent`; they
 * cannot cheaply prove the things that only matter when they go WRONG — a body accidentally
 * shared between iterations, a cap of zero selecting nothing, an event running before its
 * predecessor finished. Those need a harness that can watch each call as it happens, and
 * that harness is only possible because this module takes no service, no lock and no clock.
 */

type Ev = { type?: string; id: string };
const ev = (id: string): Ev => ({ type: 'message', id });

describe('[FEAT-20260905-MULTIEVENT] selectDeliveryEvents', () => {
  const OFF = { multiEvent: false };
  const ON = { multiEvent: true };

  it('with the switch OFF, selects exactly the first event — the legacy read', () => {
    const out = selectDeliveryEvents([ev('a'), ev('b'), ev('c')], OFF);
    expect(out.selected.map((e) => e.id)).toEqual(['a']);
    expect(out.dropped).toBe(2);
    // The reason travels with the count so the caller can say WHY in the right words.
    expect(out.reason).toBe('off');
  });

  it('with the switch ON, selects the whole batch when it fits under the cap', () => {
    const out = selectDeliveryEvents([ev('a'), ev('b'), ev('c')], ON);
    expect(out.selected.map((e) => e.id)).toEqual(['a', 'b', 'c']);
    expect(out.dropped).toBe(0);
    expect(out.reason).toBe('none');
  });

  it('selects a PREFIX, never a filtered or reordered set', () => {
    /* Load-bearing, not stylistic. Three separate things depend on `selected[0] ===
       events[0]`: the spine's re-read finds the right event, the raw delivery row stores
       the full body, and the signature re-check HMACs the real bytes. A rule that ever
       skipped or reordered would break all three at once, silently. */
    const input = [ev('a'), ev('b'), ev('c'), ev('d')];
    const out = selectDeliveryEvents(input, { multiEvent: true, cap: 3 });
    expect(out.selected).toEqual(input.slice(0, 3));
    expect(out.selected[0]).toBe(input[0]);
  });

  it('stops at the cap and reports the remainder as a cap drop', () => {
    const many = Array.from({ length: 9 }, (_, i) => ev(`e${i}`));
    const out = selectDeliveryEvents(many, { multiEvent: true, cap: 4 });
    expect(out.selected).toHaveLength(4);
    expect(out.dropped).toBe(5);
    expect(out.reason).toBe('cap');
  });

  it('ships a cap of 5, and the tests never hard-code it', () => {
    // The const is the contract; the parameter exists so no case here depends on the
    // shipped number. If the owner changes it, exactly this assertion moves.
    expect(EVENTS_PER_DELIVERY_CAP).toBe(5);
    const many = Array.from({ length: 8 }, (_, i) => ev(`e${i}`));
    expect(selectDeliveryEvents(many, ON).selected).toHaveLength(
      EVENTS_PER_DELIVERY_CAP,
    );
  });

  it('never selects nothing when a cap of zero is passed in', () => {
    /* The cap is a parameter, so a caller CAN pass 0 — and 0 would select nothing, which
       is total silent loss: a worse version of the very defect this module exists to end.
       Clamped, so "the first event is always processed" is structural rather than a
       convention somebody has to remember. */
    const out = selectDeliveryEvents([ev('a'), ev('b')], {
      multiEvent: true,
      cap: 0,
    });
    expect(out.selected.map((e) => e.id)).toEqual(['a']);
    expect(out.dropped).toBe(1);
  });

  it('answers an empty selection for an empty delivery instead of throwing', () => {
    // LINE's "Verify" button posts `events: []`. It must stay a total no-op.
    expect(selectDeliveryEvents([], ON)).toEqual({
      selected: [],
      dropped: 0,
      reason: 'none',
    });
  });
});

describe('[FEAT-20260905-MULTIEVENT] runDeliveryEvents', () => {
  const harness = (events: Ev[], multiEvent: boolean, cap?: number) => {
    const body = { events, destination: 'U-oa' };
    const seen: { id: string; index: number; body: Record<string, unknown> }[] =
      [];
    const warns: string[] = [];
    let concurrent = 0;
    let maxConcurrent = 0;

    const run = async (): Promise<void> => {
      await runDeliveryEvents(
        { body, events, multiEvent, cap },
        {
          warn: (m) => warns.push(m),
          run: async (event, eventBody, index) => {
            concurrent++;
            maxConcurrent = Math.max(maxConcurrent, concurrent);
            // A real turn awaits I/O; without a tick, a parallel bug cannot show itself.
            await new Promise((r) => setTimeout(r, 0));
            seen.push({ id: event.id, index, body: eventBody });
            concurrent--;
          },
        },
      );
    };
    return { body, seen, warns, run, peak: () => maxConcurrent };
  };

  it('runs every selected event once, in array order', async () => {
    const h = harness([ev('a'), ev('b'), ev('c')], true);
    await h.run();
    expect(h.seen.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(h.seen.map((s) => s.index)).toEqual([0, 1, 2]);
  });

  it('⭐ runs a FULL BATCH OF FIVE — the shipped cap, end to end', async () => {
    /* [PROG-20260905-CAP5] The owner's decision, 05/09: cap = 5, overflow drops with a
       warn. Everything else here proves a PROPERTY (order, isolation, one-at-a-time) on
       two or three events; nothing exercised the number the flow actually ships with, so
       "the code is ready for five events" rested on those properties generalising rather
       than on anyone having run five.

       This runs five. All five reach the runner, in order, each exactly once, each with
       its own index — and NOTHING is dropped, because five is the cap and not one past
       it. That last clause is the half a smaller case cannot state: an off-by-one that
       treated the cap as exclusive would still pass every test above.
       เพดานคือ 5 ก็ต้องมีเทสที่ยิงครบ 5 จริง ไม่ใช่เทส 2 แล้วอนุมานเอา */
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const h = harness(ids.map(ev), true, EVENTS_PER_DELIVERY_CAP);
    await h.run();

    expect(EVENTS_PER_DELIVERY_CAP).toBe(5);
    expect(h.seen.map((s) => s.id)).toEqual(ids);
    expect(h.seen.map((s) => s.index)).toEqual([0, 1, 2, 3, 4]);
    expect(h.peak()).toBe(1);
    // exactly at the cap is not over it — no drop, so no warn
    expect(h.warns).toEqual([]);
  });

  it('⭐ six events on a cap of five: five run, the sixth is announced', async () => {
    /* The other side of the same boundary. The five that fit still run in order, and the
       one that does not is named out loud — a dropped event is a customer message lost
       forever (LINE has already had its 200 and does not redeliver), so the warn IS the
       audit trail. */
    const h = harness(
      ['a', 'b', 'c', 'd', 'e', 'f'].map(ev),
      true,
      EVENTS_PER_DELIVERY_CAP,
    );
    await h.run();

    expect(h.seen.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(h.warns).toHaveLength(1);
    expect(h.warns[0]).toContain('[EVENTCAP]');
    expect(h.warns[0]).toContain('carried 6 events');
    expect(h.warns[0]).toContain('processed 5');
    expect(h.warns[0]).toContain('dropped 1');
  });

  it('runs them ONE AT A TIME — never two in flight', async () => {
    /* `withUserLock` is a stampede damper, not mutual exclusion: a waiter proceeds
       UNLOCKED after 25s and acquisition has no queue. Firing a user's events
       concurrently recreates the duplicate-ticket concurrency of 2026-07-27. The peak is
       measured rather than asserted from the shape of the code, because `Promise.all` and
       a `for await` look almost identical at a glance. */
    const h = harness([ev('a'), ev('b'), ev('c')], true);
    await h.run();
    expect(h.peak()).toBe(1);
  });

  it('hands iteration 0 the ORIGINAL body object, not a copy', async () => {
    /* Reference equality on purpose, and it is the single most load-bearing line in this
       file. Iteration 0's body is what the raw `incoming_line_webhook` row stores and what
       the signature re-check HMACs; a copy would still pass a deep-equality check today
       and would drift the day anything else is added to the body. */
    const h = harness([ev('a'), ev('b')], true);
    await h.run();
    expect(h.seen[0]!.body).toBe(h.body);
  });

  it('hands every LATER iteration a body sliced to its own single event', async () => {
    /* This is what neutralises the spine's re-read of `events[0]` without editing the
       re-read. Without it the loop processes the FIRST event N times: N quota charges, N
       model calls, N pushes of one answer — and chat dedup hides the duplicate rows, so
       the count-based assertion a reviewer reaches for first stays green. */
    const h = harness([ev('a'), ev('b'), ev('c')], true);
    await h.run();
    expect(h.seen[1]!.body).not.toBe(h.body);
    expect((h.seen[1]!.body['events'] as Ev[]).map((e) => e.id)).toEqual(['b']);
    expect((h.seen[2]!.body['events'] as Ev[]).map((e) => e.id)).toEqual(['c']);
    // The rest of the delivery is carried through untouched — only `events` is replaced.
    expect(h.seen[1]!.body['destination']).toBe('U-oa');
  });

  it('with the switch OFF, calls the runner once with the original body and index 0', async () => {
    // The whole "toggle OFF is byte-identical" claim, in one case: same event, same body
    // object, and an index of 0 means nothing is suppressed downstream either.
    const h = harness([ev('a'), ev('b'), ev('c')], false);
    await h.run();
    expect(h.seen).toHaveLength(1);
    expect(h.seen[0]!.id).toBe('a');
    expect(h.seen[0]!.index).toBe(0);
    expect(h.seen[0]!.body).toBe(h.body);
  });

  it('announces an OFF-mode discard — the silence is the defect, not the drop', async () => {
    const h = harness([ev('a'), ev('b')], false);
    await h.run();
    expect(h.warns).toHaveLength(1);
    expect(h.warns[0]).toContain('[EVENTBATCH]');
    expect(h.warns[0]).toContain('carried 2 events');
    /* 🔴 THE VALUE IN THE HINT MUST BE ONE THE SCHEMA ACCEPTS, and this case used to
       assert the opposite. It pinned `WEBHOOK_MULTI_EVENT=true` while `env.schema.ts`
       declares `z.enum(['on','off'])` — so an operator who followed the log line set a
       value the schema rejects and the service refused to boot. The test was guarding
       the defect rather than catching it.
       Both halves are asserted now: the wording, AND that the wording is a legal value.
       เทสต้องผูกกับ schema ไม่ใช่กับสตริงที่พิมพ์ไว้เฉย ๆ */
    expect(h.warns[0]).toContain('WEBHOOK_MULTI_EVENT=on');
    expect(h.warns[0]).not.toContain('WEBHOOK_MULTI_EVENT=true');
    const field = envSchema.shape.WEBHOOK_MULTI_EVENT;
    expect(() => field.parse('on')).not.toThrow();
    expect(() => field.parse('true')).toThrow();
  });

  it('announces a cap drop in different words, naming both counts', async () => {
    // Two causes, two messages. A single shared line would leave whoever reads the log
    // unable to tell "the switch is off" from "the batch was too long".
    const h = harness([ev('a'), ev('b'), ev('c'), ev('d')], true, 2);
    await h.run();
    expect(h.warns).toHaveLength(1);
    expect(h.warns[0]).toContain('[EVENTCAP]');
    expect(h.warns[0]).toContain('processed 2');
    expect(h.warns[0]).toContain('dropped 2');
  });

  it('says nothing at all when nothing was dropped', async () => {
    // Every real delivery observed to date is single-event. A line per delivery would
    // drown the log it is supposed to be an audit trail in.
    const h = harness([ev('a')], true);
    await h.run();
    expect(h.warns).toEqual([]);
    const off = harness([ev('a')], false);
    await off.run();
    expect(off.warns).toEqual([]);
  });

  it('does not swallow a rejection — the caller owns failure, as it does today', async () => {
    /* Deliberately NOT isolating errors here. The per-event unit already cannot reject:
       the spine's outer catch swallows everything and the log door swallows its own
       failures, so a later event runs regardless. Adding a try/catch in this file would
       claim a guarantee it cannot make and would hide a runner that started throwing. */
    await expect(
      runDeliveryEvents(
        { body: { events: [ev('a')] }, events: [ev('a')], multiEvent: true },
        { warn: () => undefined, run: () => Promise.reject(new Error('boom')) },
      ),
    ).rejects.toThrow('boom');
  });
});
