/**
 * [FEAT-20260824-STRIKESESSION] The ledger's own behaviour.
 *
 * WHAT THIS SUITE IS ALLOWED TO PROVE: the service's logic, on a fake model
 * (`z-test/lib/strike-fakes.ts` — no mongodb-memory-server in this repo).
 * WHAT IT CANNOT PROVE: that MongoDB behaves as the fake does. Two things fall
 * in that gap and are called out where they appear:
 *   · the partial unique index really rejecting a second open session
 *   · `$min` really setting a missing field on a real server
 * Both are modelled faithfully here, and both still need one look at a real
 * mongod before this is called finished.
 */
import {
  ROLLUP_SESSION_CAP,
  StrikeAdminService,
  StrikeService,
} from '@/modules/strike';
import { fakeModel, type FakeModel } from '../lib/strike-fakes';

const HOOK_A = 'a0d00000000000000000000d';
const HOOK_B = 'a0d000000000000000000082';
const USER = 'Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1';

function harness(enabled = true) {
  const sessions = fakeModel('seq', 'line_user_id');
  const events = fakeModel('occurred_at');
  const service = new StrikeService(sessions as never, events as never, {
    enabled,
  });
  return { service, sessions, events };
}

function strike(over: Partial<Parameters<StrikeService['record']>[0]> = {}) {
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

describe('StrikeService.record', () => {
  it('opens a session on the first strike and counts it', async () => {
    const { service, sessions, events } = harness();

    await service.record(strike());

    expect(sessions.rows).toHaveLength(1);
    expect(sessions.rows[0]).toMatchObject({
      line_user_id: USER,
      seq: 1,
      status: 'open',
      strike_total: 1,
      by_level: { '1': 1 },
    });
    expect(events.rows).toHaveLength(1);
  });

  it('keeps counting into the SAME session — no reset, no second ledger', async () => {
    const { service, sessions } = harness();

    await service.record(strike({ level: 1 }));
    await service.record(strike({ level: 2 }));
    await service.record(strike({ level: 2 }));
    await service.record(strike({ level: 4 }));

    expect(sessions.rows).toHaveLength(1);
    expect(sessions.rows[0]).toMatchObject({
      strike_total: 4,
      by_level: { '1': 1, '2': 2, '4': 1 },
    });
  });

  /**
   * THE SCOPE DECISION, as an executable claim. Four strikes reaching four
   * different OAs are ONE customer being blocked four times, because the rate
   * limiter's key has no OA in it (`rate-limit.service.ts:127`).
   *
   * MUTATION THAT MUST GO RED: put `hook_id` back into the session's identity.
   * Doing so turns this into four sessions of 1 — the silent-wrong-number bug
   * the design doc §4.5 describes.
   */
  it('counts one customer across different OAs into a single session', async () => {
    const { service, sessions, events } = harness();

    await service.record(strike({ hookId: HOOK_A }));
    await service.record(strike({ hookId: HOOK_B }));
    await service.record(strike({ hookId: HOOK_A }));
    await service.record(strike({ hookId: HOOK_B }));

    expect(sessions.rows).toHaveLength(1);
    expect(sessions.rows[0]?.['strike_total']).toBe(4);
    // …and the OA is still recoverable, because every event carries it.
    expect(
      events.rows
        .map((e) => e['hook_id'])
        .map(String)
        .sort(),
    ).toEqual([HOOK_A, HOOK_A, HOOK_B, HOOK_B]);
  });

  it('stamps first_strike_at once and moves last_strike_at forward', async () => {
    const { service, sessions } = harness();
    const first = new Date('2026-08-24T10:00:00Z');
    const later = new Date('2026-08-24T18:30:00Z');

    await service.record(strike({ occurredAt: first }));
    await service.record(strike({ occurredAt: later }));

    expect(sessions.rows[0]?.['first_strike_at']).toEqual(first);
    expect(sessions.rows[0]?.['last_strike_at']).toEqual(later);
  });

  it('freezes the limit and window that were actually in force', async () => {
    const { service, events } = harness();

    await service.record(strike({ level: 4, limit: 2, windowSeconds: 180 }));

    expect(events.rows[0]).toMatchObject({
      level: 4,
      limit: 2,
      window_seconds: 180,
      message_type: 'text',
    });
  });

  it('writes nothing at all when tracking is switched off', async () => {
    const { service, sessions, events } = harness(false);

    await service.record(strike());

    expect(sessions.rows).toHaveLength(0);
    expect(events.rows).toHaveLength(0);
  });

  it('never throws — a broken store must not cost the customer a reply', async () => {
    const exploding = {
      findOneAndUpdate: () => {
        throw new Error('mongo is down');
      },
    };
    const service = new StrikeService(
      exploding as never,
      fakeModel('occurred_at') as never,
      { enabled: true },
    );

    await expect(service.record(strike())).resolves.toBeUndefined();
  });

  /**
   * THE INVARIANT THE ORDERING EXISTS FOR — found by review, not by a test, and
   * only then pinned. The first version incremented the session and THEN wrote
   * the event; a rejected insert left the counter reporting a strike the log
   * could not explain, with nothing but an ERROR line to show for it.
   *
   * MUTATION THAT MUST GO RED: move `applyStrike` back above `eventModel.create`.
   */
  it('does not move the counter when the strike cannot be logged', async () => {
    const sessions = fakeModel('seq', 'line_user_id');
    const events = {
      ...fakeModel('occurred_at'),
      create: () => Promise.reject(new Error('ValidationError')),
    };
    const service = new StrikeService(sessions as never, events as never, {
      enabled: true,
    });

    await service.record(strike());

    // the session may be opened — that is just an empty ledger — but nothing
    // may be counted into it.
    expect(sessions.rows[0]?.['strike_total']).toBe(0);
    expect(sessions.rows[0]?.['by_level']).toEqual({});
  });

  it('ignores an event with no OA rather than guessing one', async () => {
    const { service, sessions } = harness();

    await service.record(strike({ hookId: '' }));

    expect(sessions.rows).toHaveLength(0);
  });
});

describe('StrikeService.closeSession — "เคลียร์ session"', () => {
  async function withOpenSession(): Promise<{
    service: StrikeService;
    sessions: FakeModel;
    events: FakeModel;
    id: string;
  }> {
    const h = harness();
    await h.service.record(strike({ level: 2 }));
    await h.service.record(strike({ level: 3 }));
    return { ...h, id: String(h.sessions.rows[0]?.['_id']) };
  }

  it('closes the session, records who closed it, and opens the next one', async () => {
    const { service, sessions, id } = await withOpenSession();

    const closed = await service.closeSession(
      id,
      'a0d00000000000000000004a',
      'customer apologised',
    );

    expect(closed).toMatchObject({ seq: 1, status: 'closed', strike_total: 2 });
    expect(sessions.rows).toHaveLength(2);
    expect(sessions.rows[1]).toMatchObject({
      seq: 2,
      status: 'open',
      strike_total: 0,
    });
  });

  it('keeps every strike of the closed session — this IS the history', async () => {
    const { service, events, id } = await withOpenSession();
    const before = events.rows.length;

    await service.closeSession(id, null, null);

    expect(events.rows).toHaveLength(before);
    expect(before).toBe(2);
  });

  it('counting restarts at zero after a clear', async () => {
    const { service, sessions, id } = await withOpenSession();
    await service.closeSession(id, null, null);

    await service.record(strike({ level: 1 }));

    const open = sessions.rows.find((r) => r['status'] === 'open');
    expect(open).toMatchObject({
      seq: 2,
      strike_total: 1,
      by_level: { '1': 1 },
    });
    // the closed one is untouched
    expect(sessions.rows[0]).toMatchObject({ seq: 1, strike_total: 2 });
  });

  it('refuses a second close so two admins cannot both succeed', async () => {
    const { service, id } = await withOpenSession();

    expect(await service.closeSession(id, null, null)).not.toBeNull();
    expect(await service.closeSession(id, null, null)).toBeNull();
  });
});

describe('StrikeService reads', () => {
  it('reports the open session, its per-level tally and its timestamps', async () => {
    const { service } = harness();
    await service.record(strike({ level: 1 }));
    await service.record(strike({ level: 3 }));

    const current = await service.currentFor(USER);

    expect(current).toMatchObject({
      seq: 1,
      status: 'open',
      strike_total: 2,
      by_level: { '1': 1, '3': 1 },
    });
  });

  it('answers null for a customer who has never been blocked', async () => {
    const { service } = harness();
    await expect(service.currentFor(USER)).resolves.toBeNull();
  });

  it('summarises strikes per level for one OA', async () => {
    const { service } = harness();
    await service.record(strike({ hookId: HOOK_A, level: 1 }));
    await service.record(strike({ hookId: HOOK_A, level: 2 }));
    await service.record(strike({ hookId: HOOK_B, level: 2 }));

    const all = await service.summarize({
      from: new Date('2026-08-01T00:00:00Z'),
      to: new Date('2026-08-31T00:00:00Z'),
    });
    const onlyA = await service.summarize({
      from: new Date('2026-08-01T00:00:00Z'),
      to: new Date('2026-08-31T00:00:00Z'),
      hookId: HOOK_A,
    });

    expect(all).toEqual({ total: 3, by_level: { '1': 1, '2': 2 } });
    expect(onlyA).toEqual({ total: 2, by_level: { '1': 1, '2': 1 } });
  });
  /* ── [FEAT-20260826-STRIKEROLLUP] the lifetime rollup ──────────────────────
     These are the cases the existing suite could not answer: everything above
     asks about ONE session, and the rollup is the only thing that folds the
     ones an admin already closed back into the number a case worker sees. */

  it('folds every session — closed ones included — into one total', async () => {
    const { service, sessions } = harness();
    // Two closed ledgers plus the open one. Written straight into the fake so
    // the shape is the one Mongo really holds, not one record() happened to make.
    await sessions.create({
      line_user_id: USER,
      seq: 1,
      status: 'closed',
      strike_total: 7,
      by_level: { '1': 5, '2': 2 },
      opened_at: new Date('2026-08-01T00:00:00Z'),
      first_strike_at: new Date('2026-08-01T03:00:00Z'),
      last_strike_at: new Date('2026-08-02T03:00:00Z'),
    });
    await sessions.create({
      line_user_id: USER,
      seq: 2,
      status: 'closed',
      strike_total: 3,
      by_level: { '1': 2, '4': 1 },
      opened_at: new Date('2026-08-10T00:00:00Z'),
      first_strike_at: new Date('2026-08-10T03:00:00Z'),
      last_strike_at: new Date('2026-08-11T03:00:00Z'),
    });
    await service.record(strike({ level: 2 }));

    const r = await service.rollupFor(USER, {});
    expect(r.scope).toBe('lifetime');
    expect(r.total).toBe(11);
    expect(r.sessions_counted).toBe(3);
    expect(r.truncated).toBe(false);
    // the open session contributed its level-2 strike on top of the closed ones
    expect(r.by_level).toEqual({ '1': 7, '2': 3, '4': 1 });
  });

  it('ADDS overlapping levels instead of overwriting them', async () => {
    // The case the one above cannot catch: with disjoint levels a merge written
    // as a spread looks identical to a sum. Same level in two sessions is the
    // only shape that tells them apart. ระดับซ้ำต้องบวก ไม่ใช่ทับ
    const { service, sessions } = harness();
    await sessions.create({
      line_user_id: USER,
      seq: 1,
      status: 'closed',
      strike_total: 2,
      by_level: { '1': 2 },
      opened_at: new Date('2026-08-01T00:00:00Z'),
    });
    await sessions.create({
      line_user_id: USER,
      seq: 2,
      status: 'open',
      strike_total: 3,
      by_level: { '1': 3 },
      opened_at: new Date('2026-08-02T00:00:00Z'),
    });

    const r = await service.rollupFor(USER, {});
    expect(r.by_level).toEqual({ '1': 5 });
    expect(r.total).toBe(5);
  });

  it('counts a session whose by_level is missing as zero, without throwing', async () => {
    // A session opened by a clear that has not earned a strike yet holds no
    // by_level at all — absent, not {}. It must contribute nothing quietly.
    const { service, sessions } = harness();
    await sessions.create({
      line_user_id: USER,
      seq: 1,
      status: 'open',
      strike_total: 0,
      opened_at: new Date('2026-08-01T00:00:00Z'),
    });

    const r = await service.rollupFor(USER, {});
    expect(r.total).toBe(0);
    expect(r.by_level).toEqual({});
    expect(r.sessions_counted).toBe(1);
  });

  it('filters by session status — cleared, not cleared, or all', async () => {
    const { service, sessions } = harness();
    await sessions.create({
      line_user_id: USER,
      seq: 1,
      status: 'closed',
      strike_total: 7,
      by_level: { '1': 7 },
      opened_at: new Date('2026-08-01T00:00:00Z'),
    });
    await sessions.create({
      line_user_id: USER,
      seq: 2,
      status: 'open',
      strike_total: 2,
      by_level: { '2': 2 },
      opened_at: new Date('2026-08-10T00:00:00Z'),
    });

    const all = await service.rollupFor(USER, {});
    const cleared = await service.rollupFor(USER, { sessionStatus: 'closed' });
    const live = await service.rollupFor(USER, { sessionStatus: 'open' });

    expect(all.total).toBe(9);
    expect(cleared.total).toBe(7);
    expect(cleared.by_level).toEqual({ '1': 7 });
    // never more than one open session — the DB's partial unique index says so
    expect(live.total).toBe(2);
    expect(live.sessions_counted).toBe(1);
  });

  it('reports truncated when the person has more sessions than the cap', async () => {
    const { service, sessions } = harness();
    for (let i = 1; i <= ROLLUP_SESSION_CAP + 1; i += 1) {
      await sessions.create({
        line_user_id: USER,
        seq: i,
        status: 'closed',
        strike_total: 1,
        by_level: { '1': 1 },
        opened_at: new Date('2026-08-01T00:00:00Z'),
      });
    }

    const r = await service.rollupFor(USER, {});
    expect(r.truncated).toBe(true);
    expect(r.sessions_counted).toBe(ROLLUP_SESSION_CAP);
  });

  it('scopes a ranged rollup to ONE person, never the whole collection', async () => {
    // The mutation this kills: reusing summarize(), whose $match carries no
    // line_user_id at all, so a second customer's strikes leak into the answer.
    const { service } = harness();
    await service.record(strike({ level: 1 }));
    await service.record(strike({ level: 2 }));
    await service.record(
      strike({ lineUserId: 'Ubbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2', level: 4 }),
    );

    const r = await service.rollupFor(USER, {
      from: new Date('2026-08-01T00:00:00Z'),
      to: new Date('2026-08-31T00:00:00Z'),
    });
    expect(r.scope).toBe('range');
    expect(r.total).toBe(2);
    expect(r.by_level).toEqual({ '1': 1, '2': 1 });
    // the ranged path counts events; it genuinely did not count sessions
    expect(r.sessions_counted).toBeNull();
  });
});

/* ── [FEAT-20260827-ADMINBLOCK] admin mints the latch — "Block จำกัดการคุย" ────
   📖 PLAN: `todo/task/27082026/todo8_27082026_admin-block-suspend.md`

   The admin block writes the SAME latch the gate writes, plus two fields the
   gate never touches (`suspended_by`, `suspended_reason`) — presence of
   `suspended_by` is what says "an admin did this, not the strike ceiling". */

describe('StrikeAdminService.suspendSession — admin block', () => {
  const ADMIN = 'a0d00000000000000000000e';
  /* the admin service borrows StrikeService's ensure door — build both on the
     SAME fake collection, exactly how the module wires them */
  const adminHarness = () => {
    const h = harness();
    const admin = new StrikeAdminService(h.sessions as never, h.service);
    return { ...h, admin };
  };

  it('creates the session first when the customer has none, then stamps all three fields', async () => {
    const { admin, sessions } = adminHarness();

    const out = await admin.suspendSession(
      USER,
      ADMIN,
      'blocked from strike modal',
    );

    expect(sessions.rows).toHaveLength(1);
    expect(out).toMatchObject({
      line_user_id: USER,
      seq: 1,
      status: 'open',
      strike_total: 0,
    });
    const row = sessions.rows[0]!;
    expect(row['suspended_at']).toBeInstanceOf(Date);
    expect(String(row['suspended_by'])).toBe(ADMIN);
    expect(row['suspended_reason']).toBe('blocked from strike modal');
  });

  it('stamps the EXISTING open session — no second ledger, seq does not move', async () => {
    const { admin, service, sessions } = adminHarness();
    await service.record(strike({ level: 2 }));

    const out = await admin.suspendSession(USER, ADMIN, null);

    expect(sessions.rows).toHaveLength(1);
    expect(out).toMatchObject({ seq: 1, strike_total: 1 });
    expect(sessions.rows[0]?.['suspended_at']).toBeInstanceOf(Date);
    // no reason given → nothing stored, absent like the gate's own rows
    expect(sessions.rows[0]?.['suspended_reason']).toBeUndefined();
  });

  it('answers null when the latch is already armed — the guard lives in the FILTER', async () => {
    /* MUTATION THAT MUST GO RED: drop `suspended_at: null` from the filter —
       the second call would then re-stamp and overwrite the first admin's mark. */
    const { admin, sessions } = adminHarness();
    await admin.suspendSession(USER, ADMIN, null);
    const first = sessions.rows[0]?.['suspended_at'];

    const second = await admin.suspendSession(USER, ADMIN, 'again');

    expect(second).toBeNull();
    expect(sessions.rows[0]?.['suspended_at']).toBe(first);
    expect(sessions.rows[0]?.['suspended_reason']).toBeUndefined();
  });

  it('refuses an unattributable block — invalid admin id writes nothing', async () => {
    /* A stamp WITHOUT `suspended_by` would be indistinguishable from a gate
       row, which is the exact data lie this feature must not tell. Unreachable
       over HTTP (the guard always supplies a real user id) — defensive only. */
    const { admin, sessions } = adminHarness();

    const out = await admin.suspendSession(USER, 'not-an-object-id', null);

    expect(out).toBeNull();
    expect(sessions.rows).toHaveLength(0);
  });

  it('เคลียร์ session เดิมปลด admin block ได้เหมือน gate ทุกประการ', async () => {
    /* The release path is the EXISTING closeSession — no separate unblock door.
       This pins that the fresh session carries none of the three fields. */
    const { admin, service, sessions } = adminHarness();
    await admin.suspendSession(USER, ADMIN, 'Block จำกัดการคุย');
    const id = String(sessions.rows[0]?.['_id']);

    const closed = await service.closeSession(id, ADMIN, 'unblock');

    expect(closed).toMatchObject({ status: 'closed' });
    expect(sessions.rows).toHaveLength(2);
    expect(sessions.rows[1]?.['suspended_at']).toBeUndefined();
    expect(sessions.rows[1]?.['suspended_by']).toBeUndefined();
    expect(sessions.rows[1]?.['suspended_reason']).toBeUndefined();
  });
});
