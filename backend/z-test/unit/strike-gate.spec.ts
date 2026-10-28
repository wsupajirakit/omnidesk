import {
  StrikeAdminService,
  StrikeGateService,
  StrikeService,
} from '@/modules/strike';
import { buildSuspendedPipeline } from '@/modules/strike/strike-suspend.helper';

import { fakeModel } from '../lib/strike-fakes';

/**
 * [FEAT-20260826-STRIKESUSPEND] The gate — "should the webhook stay silent".
 * ===========================================================================
 * 📖 PLAN: `todo/task/26082026/todo10_26082026_strike-suspend.md`
 *
 * Lives beside its service rather than inside `strike-service.spec.ts` for the
 * same reason the service was split out: the gate is removable as one piece, and
 * a feature you can delete should have tests you delete with it.
 *
 * `StrikeService` still appears here — the gate READS what the sink WRITES, so
 * the only honest way to set up "this customer has three strikes" is to record
 * three, through the same door the webhook uses. Building the rows by hand would
 * test the gate against a shape nothing in production produces.
 */
const HOOK_A = 'a0d00000000000000000000d';
const USER = 'Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1';

function strike(over: Record<string, unknown> = {}) {
  return {
    hookId: HOOK_A,
    lineUserId: USER,
    level: 1,
    limit: 3,
    windowSeconds: 30,
    messageType: 'text',
    occurredAt: new Date('2026-08-24T10:00:00Z'),
    ...over,
  };
}

/* ── [FEAT-20260826-STRIKESUSPEND] the gate ───────────────────────────────────
   📖 PLAN: `todo/task/26082026/todo10_26082026_strike-suspend.md`

   These prove the LATCH, which is the part that is easy to get subtly wrong:
   it must arm exactly once, stay armed without recounting, and be released by
   nothing except an admin closing the session. */

describe('isSuspended — the latch', () => {
  const cfg = { enabled: true, suspendAt: 3, suspendWindowHours: 24 };
  /* ⚠️ The shared `strike()` helper stamps a FIXED date (24/08) so the older
     specs can pin exact values. That date is outside a 24-hour window measured
     from "now", so every gate case has to say when it happened — using the
     helper as-is here would have every strike age out and prove nothing.
     เทสที่ผูกกับหน้าต่างเวลา ต้องกำหนดเวลาเอง ห้ามยืมค่าตายตัวของเทสอื่น */
  const freshStrike = () => strike({ occurredAt: new Date() });
  const build = () => {
    const sessions = fakeModel('seq', 'line_user_id');
    const events = fakeModel('occurred_at');
    // one pair of collections, two doors onto it — exactly how production wires it
    const sink = new StrikeService(sessions as never, events as never, cfg);
    const service = new StrikeGateService(
      sessions as never,
      events as never,
      cfg,
    );
    return { service, sink, sessions, events };
  };

  it('answers false for a customer who has never been blocked', async () => {
    const { service } = build();
    await expect(service.isSuspended(USER)).resolves.toBe(false);
  });

  it('answers false for a missing user id rather than reading anything', async () => {
    const { service } = build();
    await expect(service.isSuspended(undefined)).resolves.toBe(false);
  });

  it('does not lock below the threshold', async () => {
    const { service, sink } = build();
    await sink.record(freshStrike());
    await sink.record(freshStrike());
    await expect(service.isSuspended(USER)).resolves.toBe(false);
  });

  it('locks the moment the threshold is reached', async () => {
    const { service, sink, sessions } = build();
    await sink.record(freshStrike());
    await sink.record(freshStrike());
    await sink.record(freshStrike());

    await expect(service.isSuspended(USER)).resolves.toBe(true);
    // and it wrote the stamp, so "since when" is answerable
    expect(sessions.rows[0]?.['suspended_at']).toBeInstanceOf(Date);
  });

  it('🔴 stays locked without counting again', async () => {
    /* Once armed, nothing recounts — that is what makes a locked customer the
       CHEAPEST case rather than the most expensive one, and it is what the owner
       asked for: "ติดแล้วไม่นับ strike ต่อ เพราะข้อความไม่เข้าแล้ว". */
    const { service, sink, events } = build();
    await sink.record(freshStrike());
    await sink.record(freshStrike());
    await sink.record(freshStrike());
    await service.isSuspended(USER);

    const countSpy = jest.spyOn(events, 'countDocuments');
    await expect(service.isSuspended(USER)).resolves.toBe(true);
    expect(countSpy).not.toHaveBeenCalled();
  });

  it('🔴 ignores strikes older than the window', async () => {
    const { service, sink } = build();
    const old = new Date('2026-08-01T00:00:00Z');
    await sink.record(strike({ occurredAt: old }));
    await sink.record(strike({ occurredAt: old }));
    await sink.record(strike({ occurredAt: old }));

    // three strikes, but all of them a fortnight before the window opens
    await expect(service.isSuspended(USER)).resolves.toBe(false);
  });

  it('🔴 clearing the session releases the customer, with no extra code', async () => {
    /* The whole reason the latch lives on the SESSION and not on the member:
       closing opens a fresh session, and a fresh session has no stamp. Nothing
       clears the flag because nothing has to. */
    const { service, sink, sessions } = build();
    await sink.record(freshStrike());
    await sink.record(freshStrike());
    await sink.record(freshStrike());
    expect(await service.isSuspended(USER)).toBe(true);

    await sink.closeSession(String(sessions.rows[0]?.['_id']), null, 'test');

    await expect(service.isSuspended(USER)).resolves.toBe(false);
  });

  it('🔴 the arming write is guarded, so a concurrent arm cannot move the stamp', async () => {
    /* Both requests can read the session before either writes — the early return
       above cannot help them, because neither has a stamp to see yet. The guard
       lives in the update FILTER (`suspended_at: null`) so the loser is a no-op
       instead of a second write that moves "locked since" forward.
       Without it, a customer's lock time drifts by however long the race took,
       and the one column that answers "since when" answers the wrong when. */
    const { service, sink, sessions } = build();
    await sink.record(freshStrike());
    await sink.record(freshStrike());
    await sink.record(freshStrike());

    const spy = jest.spyOn(sessions, 'updateOne');
    await expect(service.isSuspended(USER)).resolves.toBe(true);

    /* ⚠️ ASSERTED ON THE FILTER, NOT BY RACING. `strike-fakes` resolves each
       call in order, so two `isSuspended` calls can never actually overlap
       inside it — a test that "raced" them here would pass with the guard
       deleted and prove nothing (measured: it did). The guard is real Mongo
       behaviour the fake cannot reproduce, so this pins the one thing that is
       checkable in process: the write is conditional.
       พิสูจน์เท่าที่พิสูจน์ได้จริง ห้ามเขียนเทสที่ดูเหมือนพิสูจน์ */
    const filter = spy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(filter).toHaveProperty('suspended_at', null);
  });

  it('answers false when the read throws, never rejects', async () => {
    // a webhook that drops real traffic because a read failed is worse than one
    // customer answered who should not have been
    const sessions = {
      findOne: () => ({
        lean: () => ({
          exec: () => Promise.reject(new Error('mongo is on fire')),
        }),
      }),
    };
    const service = new StrikeGateService(
      sessions as never,
      fakeModel('occurred_at') as never,
      cfg,
    );
    await expect(service.isSuspended(USER)).resolves.toBe(false);
  });
});

/* ── the tray's two reads ─────────────────────────────────────────────────────
   The header tray needs one list, and the per-customer modal needs to know where
   the line is. Both are additive: no existing route changes shape. */

describe('listSuspended — what the header tray shows', () => {
  const cfg = { enabled: true, suspendAt: 3, suspendWindowHours: 24 };
  const build = () => {
    const sessions = fakeModel('seq', 'line_user_id');
    const events = fakeModel('occurred_at');
    const sink = new StrikeService(sessions as never, events as never, cfg);
    const service = new StrikeGateService(
      sessions as never,
      events as never,
      cfg,
    );
    return { service, sink, sessions, events };
  };

  it('returns nobody when nobody is locked', async () => {
    const { service } = build();
    await expect(service.listSuspended()).resolves.toEqual([]);
  });

  /* ── the SELECTION rule, proven without a database ───────────────────────────
     These two used to call `listSuspended()` and read its rows. They cannot any
     more: the tray became an aggregation with two `$lookup`s on 26/08, and
     `strike-fakes.ts` refuses to model a join rather than fake one badly (see
     its `runPipeline` header).

     🔴 AND THEY MUST NOT SIMPLY BE DELETED, which was the first instinct and was
     wrong. What they actually proved is the part that decides who is on the
     screen — the `$match` and what the row carries — and none of that moved into
     the joins. So they now run the stages the fake CAN honestly run, against the
     real pipeline the service sends. Mutating `$exists: true` to `false`, or
     dropping the `$match`, still turns them red.
     ส่วนที่ตัดสินว่าใครขึ้นจอ พิสูจน์ได้โดยไม่ต้องมี join — เอาออกไม่ได้ */
  const selectionOf = (sessions: ReturnType<typeof fakeModel>) => {
    const upToTheJoins = buildSuspendedPipeline(50).slice(
      0,
      buildSuspendedPipeline(50).findIndex((st) => '$lookup' in st),
    );
    return sessions.aggregate(upToTheJoins).exec();
  };

  it('returns only the locked ones, never the merely striking', async () => {
    /* A customer on four of five strikes is not locked and must not appear —
       the tray is "who is the bot ignoring", not "who is close to it". */
    const { service, sink, sessions } = build();
    const fresh = (u: string) => ({
      hookId: 'a0d00000000000000000000d',
      lineUserId: u,
      level: 1,
      limit: 3,
      windowSeconds: 30,
      occurredAt: new Date(),
    });
    await sink.record(fresh('Ulocked'));
    await sink.record(fresh('Ulocked'));
    await sink.record(fresh('Ulocked'));
    await sink.record(fresh('Ufine'));
    await service.isSuspended('Ulocked');
    await service.isSuspended('Ufine');

    const rows = await selectionOf(sessions);
    expect(rows.map((r) => r['line_user_id'])).toEqual(['Ulocked']);
  });

  it('carries the stamp, so the tray can say since when', async () => {
    const { service, sink, sessions } = build();
    const fresh = {
      hookId: 'a0d00000000000000000000d',
      lineUserId: USER,
      level: 1,
      limit: 3,
      windowSeconds: 30,
      occurredAt: new Date(),
    };
    await sink.record(fresh);
    await sink.record(fresh);
    await sink.record(fresh);
    await service.isSuspended(USER);

    const [row] = await selectionOf(sessions);
    expect(row?.['suspended_at']).toBeInstanceOf(Date);
    expect(row?.['strike_total']).toBe(3);
  });

  it('never rejects — an empty tray beats a broken header', async () => {
    /* ⚠️ This mock must mirror the call the service ACTUALLY makes. It used to
       stub `find().sort().limit().lean()`, which the service stopped calling on
       26/08 — so it kept passing for the wrong reason (a TypeError on the
       missing method, caught by the same handler). A guard that passes for the
       wrong reason is not a guard. mock ต้องตรงกับท่าที่โค้ดเรียกจริง */
    const sessions = {
      aggregate: () => ({
        exec: () => Promise.reject(new Error('mongo is on fire')),
      }),
    };
    const service = new StrikeGateService(
      sessions as never,
      fakeModel('occurred_at') as never,
      cfg,
    );
    await expect(service.listSuspended()).resolves.toEqual([]);
  });
});

describe('suspendPolicy — the numbers the screen must not hardcode', () => {
  it('reports the configured threshold and window', () => {
    const service = new StrikeGateService(
      fakeModel('seq', 'line_user_id') as never,
      fakeModel('occurred_at') as never,
      { enabled: true, suspendAt: 7, suspendWindowHours: 12 },
    );
    /* The modal says "3 more and the bot stops answering". If the screen owned
       that 5, changing the env would make it lie — and nothing would fail. */
    expect(service.suspendPolicy()).toEqual({
      suspend_at: 7,
      window_hours: 12,
    });
  });

  it('falls back to the shipped defaults when nothing is configured', () => {
    const service = new StrikeGateService(
      fakeModel('seq', 'line_user_id') as never,
      fakeModel('occurred_at') as never,
      { enabled: true },
    );
    expect(service.suspendPolicy()).toEqual({
      suspend_at: 5,
      window_hours: 24,
    });
  });
});

/* ── [FEAT-20260827-ADMINBLOCK] the admin-minted latch reaches the gate ──────
   📖 PLAN: `todo/task/27082026/todo8_27082026_admin-block-suspend.md` */

describe('isSuspended — admin-minted latch', () => {
  const cfg = { enabled: true, suspendAt: 3, suspendWindowHours: 24 };

  it('silences exactly like a gate-armed one — with ZERO strike events', async () => {
    /* The whole point of option (ก): the admin writes the same field the gate
       reads, so the webhook goes quiet without a single fake event. If this
       ever needs events to pass, the design has regressed into option (ข). */
    const sessions = fakeModel('seq', 'line_user_id');
    const events = fakeModel('occurred_at');
    const sink = new StrikeService(sessions as never, events as never, cfg);
    const admin = new StrikeAdminService(sessions as never, sink);
    const gate = new StrikeGateService(sessions as never, events as never, cfg);

    await admin.suspendSession(
      USER,
      'a0d00000000000000000004a',
      'Block จำกัดการคุย',
    );

    expect(events.rows).toHaveLength(0);
    await expect(gate.isSuspended(USER)).resolves.toBe(true);
  });
});
