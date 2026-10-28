/**
 * [FEAT-20260907-BCASTUNUSEDRULES] A broadcast that carries audience conditions
 * it cannot use — what is said about it, and what is refused.
 * ===========================================================================
 * The defect this pins was measured on 06/09 with the LINE push counter, not
 * reasoned about: three multicasts under a rule selecting two members consumed
 * 6 push; the SAME rule on a job switched to `send_kind: 'broadcast'` consumed
 * 3 — every follower. Every run answered status "success".
 *
 * 🔴 HALF OF THIS FILE IS A NET, NOT A FEATURE TEST. `describe('the net')`
 *    exists to fail if this change touched multicast in any way. It was green
 *    before a single production line was edited and must stay green after —
 *    that is the entire proof that "multicast is untouched" is a measurement
 *    rather than a claim. Half of this file is a net, not a feature test.
 *
 * ⚠️ Numbers and cells are ASKED of `SEND_MATRIX`, never typed in, so a change
 *    to the matrix moves these cases with it instead of turning them red for
 *    the wrong reason.
 */
import type { AuthenticatedUser } from '@/common';
import {
  BroadcastsService,
  DryRunChunkSink,
  SEND_MATRIX,
  buildHistoryRow,
  carriesUnusedRules,
  cellFor,
  countersForOa,
  manualTrigger,
  refusesUnusedRulesAtSave,
  runBroadcast,
  type AbuseState,
  type BroadcastRunInput,
  type BroadcastRunPorts,
  type Clock,
  type HistoryRow,
  type OaOutcome,
  type QuotaUsage,
  type RecipientPage,
  type RecipientPager,
} from '@/modules/content';

const BCAST = SEND_MATRIX['broadcast:plain'];
const MULTI = SEND_MATRIX['multicast:plain'];
const MULTI_PERSONAL = SEND_MATRIX['multicast:personal'];

/** The stored key. Named once so a rename cannot pass silently. */
const FLAG = 'audience_rules_ignored';

/* `as const` so `op` stays the literal the audience types require — a plain
   array widens it to `string` and the whole file stops compiling. */
const RULES = [{ key: 'display_name', op: 'eq', value: 'Ann' }] as const;
const NO_RULES = [] as const;

/* ── the predicate ────────────────────────────────────────────────────────── */

describe('carriesUnusedRules — conditions on a pipe that cannot address anyone', () => {
  it('is true for a broadcast cell that carries at least one rule', () => {
    expect(carriesUnusedRules(BCAST, { match: 'and', rules: RULES })).toBe(
      true,
    );
  });

  it('is FALSE for a broadcast with no rules — "everyone" is a real answer', () => {
    /* A campaign to every follower is a normal thing to want, and on
       /message/broadcast it is exactly what happens. Flagging it would put a
       warning on every correct broadcast in the system. */
    expect(carriesUnusedRules(BCAST, { match: 'and', rules: NO_RULES })).toBe(
      false,
    );
  });

  it('is false for every multicast cell, rules or not', () => {
    for (const cell of [MULTI, MULTI_PERSONAL]) {
      expect(carriesUnusedRules(cell, { match: 'and', rules: RULES })).toBe(
        false,
      );
    }
  });

  it('never throws on a shape that came out of Mongo', () => {
    /* A row written before `target` existed carries no list at all, and this
       predicate is called on exactly such rows during an edit. */
    expect(carriesUnusedRules(BCAST, null)).toBe(false);
    expect(carriesUnusedRules(BCAST, undefined)).toBe(false);
    expect(carriesUnusedRules(BCAST, {})).toBe(false);
    expect(carriesUnusedRules(BCAST, { rules: 'not-a-list' })).toBe(false);
  });

  it('treats a job with NO send_kind as a broadcast, because the old sender is one', () => {
    /* `cellFor` resolves anything that is not 'multicast' to broadcast
       (`new-send.helpers.ts:45`), and the legacy `dispatchBroadcast` reads only
       `_id`/`message`/`hook_ids`/`sent_at` — it never looks at `target` and
       posts to LINE_BROADCAST_URL. So a pre-23/08 job with rules really does
       ignore them, and the rule is right to say so. */
    expect(carriesUnusedRules(cellFor(null, null), { rules: RULES })).toBe(
      true,
    );
  });
});

/* ── the save-time asymmetry ──────────────────────────────────────────────── */

describe('refusesUnusedRulesAtSave — the move is refused, never the state', () => {
  it('refuses a CREATE that is born in the state', () => {
    expect(refusesUnusedRulesAtSave(true, undefined)).toBe(true);
  });

  it('refuses an UPDATE that moves a clean job into it', () => {
    /* This is the multicast → broadcast switch, which is how it happens on
       screen: the conditions block is hidden for broadcast but the stored
       values are deliberately kept. */
    expect(refusesUnusedRulesAtSave(true, false)).toBe(true);
  });

  it('ALLOWS an update to a job that was already in the state', () => {
    /* 🔴 The case that makes this rule safe to ship. The dashboard sends
       `target` on every save, so a blanket refusal would make renaming such a
       job impossible — freezing rows instead of fixing them. */
    expect(refusesUnusedRulesAtSave(true, true)).toBe(false);
  });

  it('allows an update that moves OUT of the state', () => {
    expect(refusesUnusedRulesAtSave(false, true)).toBe(false);
  });

  it('allows an ordinary update that was never in the state', () => {
    expect(refusesUnusedRulesAtSave(false, false)).toBe(false);
  });
});

/* ── the stored row ───────────────────────────────────────────────────────── */

const ROW_INPUT = {
  broadcastId: 'job-1',
  runId: 'run-1',
  triggeredBy: 'manual' as const,
  startedAt: new Date('2026-09-07T09:00:00.000Z'),
  finishedAt: new Date('2026-09-07T09:00:05.000Z'),
  recipientsCaptured: {},
};

const oaOutcome = (): OaOutcome => ({
  index: 0,
  hookId: 'h1',
  counters: { ...countersForOa(2, 1), sent: 2, unsent: 0, chunksDone: 1 },
  resume: { hookId: 'h1', afterId: null, nextChunkIndex: 1 },
  unknownTags: [],
  imagesMeasured: false,
});

describe('buildHistoryRow — the flag qualifies the counts beside it', () => {
  it('writes the flag as `true` when the caller derived it', () => {
    const row = buildHistoryRow(
      { ...ROW_INPUT, cell: BCAST, audienceRulesIgnored: true },
      oaOutcome(),
    );
    expect(row[FLAG]).toBe(true);
  });

  it('OMITS the key entirely otherwise — absent, never `false`', () => {
    /* The whole safety of the schema change. `false` on every ordinary row
       would put a new field on every history document in the collection, which
       is exactly what must not happen. */
    const row = buildHistoryRow({ ...ROW_INPUT, cell: BCAST }, oaOutcome());
    expect(Object.keys(row)).not.toContain(FLAG);
  });

  it('omits the key when the caller derived it as false', () => {
    const row = buildHistoryRow(
      { ...ROW_INPUT, cell: MULTI, audienceRulesIgnored: false },
      oaOutcome(),
    );
    expect(Object.keys(row)).not.toContain(FLAG);
  });
});

/* ── driven end to end, so the wiring is proven and not assumed ───────────── */

const NOW = 1_700_000_000_000;

const HEALTHY_ABUSE: AbuseState = {
  jobIsRunning: false,
  lastRunFinishedAtMs: null,
  runsOfThisJobLastHour: 0,
  runsByThisUserLastHour: 0,
  runsInFlightGlobal: 0,
};

const EMPTY_USAGE: QuotaUsage = {
  lastHour: { recipients: 0, requests: 0 },
  lastDay: { recipients: 0, requests: 0 },
};

const pagerOver = (n: number): RecipientPager => ({
  next(_hookId, point, pageSize): Promise<RecipientPage> {
    const all = Array.from({ length: n }, (_, i) => `m-${i}`);
    const from = point.afterId === null ? 0 : Number(point.afterId) + 1;
    const page = all.slice(from, from + pageSize);
    return Promise.resolve({
      ids: page,
      lastId: page.length ? String(from + page.length - 1) : null,
    });
  },
});

interface Harness {
  readonly ports: BroadcastRunPorts;
  readonly saves: HistoryRow[][];
}

function harness(recipients: number): Harness {
  const saves: HistoryRow[][] = [];
  const clock: Clock = { now: () => NOW };
  const ports: BroadcastRunPorts = {
    claim: () => Promise.resolve({ _id: 'job1', status: 'sending' }),
    release: () => Promise.resolve({ ok: 1 }),
    countRecipients: () => Promise.resolve(recipients),
    readAbuseState: () => Promise.resolve(HEALTHY_ABUSE),
    readQuotaUsage: () => Promise.resolve(EMPTY_USAGE),
    saveHistory(rows) {
      saves.push([...rows]);
      return Promise.resolve();
    },
    pager: pagerOver(recipients),
    sink: new DryRunChunkSink(),
    clock,
  };
  return { ports, saves };
}

const runInput = (over: Partial<BroadcastRunInput>): BroadcastRunInput => ({
  jobId: 'job1',
  ownerId: 'worker-1',
  trigger: manualTrigger('run-1', 'user-1', 'Ann'),
  cell: MULTI,
  hookIds: ['h1'],
  audience: { match: 'and', rules: RULES },
  ...over,
});

const savedRows = (h: Harness): HistoryRow[] => h.saves[0] ?? [];

describe('runBroadcast — the flag reaches the stored row', () => {
  it('stamps every row of a broadcast run that carried rules', async () => {
    const h = harness(2);
    await runBroadcast(runInput({ cell: BCAST }), h.ports);
    const rows = savedRows(h);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row[FLAG]).toBe(true);
  });

  it('leaves the key off a broadcast run that set no conditions', async () => {
    const h = harness(2);
    await runBroadcast(
      runInput({ cell: BCAST, audience: { match: 'and', rules: NO_RULES } }),
      h.ports,
    );
    for (const row of savedRows(h)) {
      expect(Object.keys(row)).not.toContain(FLAG);
    }
  });

  it('records the misleading count NEXT TO the flag, which is why it exists', async () => {
    /* 🔴 THE FIELD THAT LIES IS `targeted`, NOT `matched` — corrected 07/09
       after this case failed on its first run and the counters were read
       instead of assumed. `matched` is 0 on EVERY per-OA row, broadcast and
       multicast alike, because `countersForOa` (`run-counters.ts:207-219`)
       sets `targeted`, `unsent`, `requestsPlanned` and `chunksPlanned` and
       never touches `matched`; the run-level `matched` computed at
       `run-broadcast.ts:271` goes into the RUN summary, which is not a stored
       row. The number that lies is `targeted`, not `matched`.

       The send is NOT refused (owner decision 07/09), so `targeted` keeps
       counting the people the CONDITIONS selected while LINE reached every
       follower of the channel. This case pins that the row still carries that
       number AND now carries something that contradicts reading it as reach. */
    const h = harness(2);
    await runBroadcast(runInput({ cell: BCAST }), h.ports);
    const row = savedRows(h)[0] as HistoryRow;
    expect(row['targeted']).toBe(2);
    expect(row['matched']).toBe(0);
    expect(row[FLAG]).toBe(true);
  });
});

/* ── the save door, driven through the real service ───────────────────────── */

/**
 * 🔴 THE PREDICATE CASES ABOVE PROVE A FUNCTION, NOT A FEATURE. `broadcasts.service.ts`
 *    has the two call sites that decide whether an admin is actually stopped,
 *    and a green predicate says nothing about whether they are wired. These
 *    cases go through `createBroadcast` / `updateBroadcast` themselves.
 *    A green function test does not mean the wiring exists.
 */
const HOOK_ID = 'a0d000000000000000000029';
const JOB_ID = 'a0d000000000000000000012';
const USER = {
  userId: 'admin-1',
  roleName: 'superadmin',
} as unknown as AuthenticatedUser;

const BASE = {
  name: 'promo',
  description: 'a campaign',
  hook_ids: [HOOK_ID],
  message: { type: 'text' as const, text: 'hi' },
};

/** The stored row an update is judged against. */
function makeService(stored: Record<string, unknown> = {}) {
  const row = {
    _id: JOB_ID,
    name: 'promo',
    status: 'draft',
    ...stored,
  };
  const broadcastModel = {
    create: jest.fn((doc: Record<string, unknown>) =>
      Promise.resolve({ ...row, ...doc }),
    ),
    findOne: jest.fn(() => ({ lean: () => Promise.resolve(row) })),
    findByIdAndUpdate: jest.fn((_id: unknown, u: Record<string, unknown>) => ({
      lean: () => Promise.resolve({ ...row, ...u }),
    })),
  };
  return new BroadcastsService(
    broadcastModel as never,
    {
      find: jest.fn(() => ({
        select: jest.fn().mockResolvedValue([{ _id: HOOK_ID }]),
      })),
    } as never,
    {
      findById: jest.fn(() => ({ lean: () => Promise.resolve(null) })),
    } as never,
    { create: jest.fn() } as never,
    { safeDecrypt: jest.fn((v: unknown) => v) } as never,
    { createAuditLog: jest.fn().mockResolvedValue({}) } as never,
  );
}

const TARGET_WITH_RULES = { mode: 'all', match: 'and', rules: RULES };

describe('the save door — create', () => {
  it('refuses a broadcast created with conditions', async () => {
    await expect(
      makeService().createBroadcast(USER, {
        ...BASE,
        send_kind: 'broadcast',
        target: TARGET_WITH_RULES,
      } as never),
    ).rejects.toThrow(/audience conditions cannot narrow it/);
  });

  it('allows the same conditions on a multicast', async () => {
    await expect(
      makeService().createBroadcast(USER, {
        ...BASE,
        send_kind: 'multicast',
        target: TARGET_WITH_RULES,
      } as never),
    ).resolves.toBeDefined();
  });

  it('allows a broadcast with no conditions', async () => {
    await expect(
      makeService().createBroadcast(USER, {
        ...BASE,
        send_kind: 'broadcast',
        target: { mode: 'all', rules: [] },
      }),
    ).resolves.toBeDefined();
  });
});

describe('the save door — update', () => {
  it('refuses the multicast → broadcast switch that strands the conditions', async () => {
    /* The stored row is a healthy multicast; the request flips the kind while
       the dashboard sends `target` back verbatim, as it always does. */
    const service = makeService({
      send_kind: 'multicast',
      target: TARGET_WITH_RULES,
    });
    await expect(
      service.updateBroadcast(USER, JOB_ID, {
        send_kind: 'broadcast',
        target: TARGET_WITH_RULES,
      } as never),
    ).rejects.toThrow(/audience conditions cannot narrow it/);
  });

  it('🔴 STILL LETS AN ALREADY-AFFECTED JOB BE RENAMED', async () => {
    /* The case that decides whether this rule is shippable. Four such rows
       exist on the local database today. `buildPayload` in the dashboard is
       `{ ...formData }`, so a rename carries the stored rules straight back —
       a blanket refusal would freeze those rows forever.
       A job already in this state must remain editable. */
    const service = makeService({
      send_kind: 'broadcast',
      target: TARGET_WITH_RULES,
    });
    await expect(
      service.updateBroadcast(USER, JOB_ID, {
        name: 'renamed',
        target: TARGET_WITH_RULES,
      } as never),
    ).resolves.toBeDefined();
  });

  it('lets an affected job be repaired by switching to multicast', async () => {
    const service = makeService({
      send_kind: 'broadcast',
      target: TARGET_WITH_RULES,
    });
    await expect(
      service.updateBroadcast(USER, JOB_ID, {
        send_kind: 'multicast',
        target: TARGET_WITH_RULES,
      } as never),
    ).resolves.toBeDefined();
  });

  it('lets an affected job be repaired by clearing the conditions', async () => {
    const service = makeService({
      send_kind: 'broadcast',
      target: TARGET_WITH_RULES,
    });
    await expect(
      service.updateBroadcast(USER, JOB_ID, {
        target: { mode: 'all', rules: [] },
      }),
    ).resolves.toBeDefined();
  });
});

/* ── the net ──────────────────────────────────────────────────────────────── */

describe('the net — multicast must not move a byte', () => {
  it('never stamps a multicast run, however many rules it carries', async () => {
    const h = harness(2);
    await runBroadcast(runInput({ cell: MULTI }), h.ports);
    const rows = savedRows(h);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(Object.keys(row)).not.toContain(FLAG);
  });

  it('still sends, counts and resumes a multicast exactly as before', async () => {
    const h = harness(3);
    const report = await runBroadcast(runInput({ cell: MULTI }), h.ports);
    const row = savedRows(h)[0] as HistoryRow;
    /* `'ran'` is the success outcome on this path — asked of the enum in
       `run-ports.ts:175-189`, not guessed. There is no `'ok'`. */
    expect(report.outcome).toBe('ran');
    expect(row['send_kind']).toBe('multicast');
    expect(row['targeted']).toBe(3);
    expect(row['next_chunk_index']).toBeGreaterThan(0);
  });

  it('refuses nothing it did not refuse before — the run still completes', async () => {
    /* This change adds no send-time refusal on ANY path. If a later edit turns
       the policy into a gate, this case is the one that goes red first. */
    const h = harness(2);
    const report = await runBroadcast(runInput({ cell: BCAST }), h.ports);
    expect(report.outcome).toBe('ran');
  });
});
