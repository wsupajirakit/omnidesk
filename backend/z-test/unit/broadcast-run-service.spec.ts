/**
 * [FEAT-20260822-BCASTRUNSVC] The run orchestration, driven end to end.
 * ===========================================================================
 * Every seam is a port, so a whole campaign — flood guard, claim, live ceiling,
 * global budget, send, history, release — happens in memory with no Mongo and
 * no LINE. The cases that matter here are the ugly ones: the claim that loses
 * the race, the ceiling that moved since the job was saved, and the throw that
 * must still hand the job back. ถ้าเทสต้องมี DB ไม่มีใครเขียนเคสน่าเกลียด แล้วเคสน่าเกลียดคือที่พัง.
 *
 * ⚠️ NOT ONE NUMBER IN THIS FILE IS TYPED BY HAND where a module owns it: the
 *    ceilings come from `SEND_MATRIX` and `GLOBAL_QUOTA`, so raising a limit
 *    moves these tests with it instead of turning them red for the wrong reason.
 */
import {
  DryRunChunkSink,
  GLOBAL_QUOTA,
  MIN_SECONDS_BETWEEN_RUNS,
  SEND_MATRIX,
  manualTrigger,
  type BroadcastChunkSink,
  type ChunkResult,
  type ChunkSendRequest,
  type ClaimQuery,
  type Clock,
  type HistoryRow,
  type QuotaUsage,
  type RecipientPage,
  type RecipientPager,
  type SendCell,
} from '@/modules/content';
/**
 * ⚠️ A RELATIVE IMPORT, ON PURPOSE. `content/index.ts` does not export
 *    `broadcast-run/` yet — wiring the barrel is a separate change — and this
 *    spec must not be the thing that forces it. Swap to '@/modules/content'
 *    once the line is there.
 */
import {
  runBroadcast,
  type AbuseState,
  type BroadcastRunInput,
  type BroadcastRunPorts,
} from '@/modules/content';

const PLAIN = SEND_MATRIX['multicast:plain'];
const PERSONAL = SEND_MATRIX['multicast:personal'];

/** The per-OA recipient ceiling of a cell, asked rather than remembered. */
const ceilingOf = (cell: SendCell): number => cell.maxRecipientsPerOa ?? 0;

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

const ids = (n: number, prefix: string): string[] =>
  Array.from({ length: n }, (_, i) => `${prefix}-${i}`);

/** A pager over plain arrays, keyed by position — the shape Mongo gives. */
function arrayPager(idsByHook: Record<string, string[]>): RecipientPager {
  return {
    next(hookId, point, pageSize): Promise<RecipientPage> {
      const all = idsByHook[hookId] ?? [];
      const from = point.afterId === null ? 0 : Number(point.afterId) + 1;
      const page = all.slice(from, from + pageSize);
      const lastId = page.length ? String(from + page.length - 1) : null;
      return Promise.resolve({ ids: page, lastId });
    },
  };
}

/** A sink whose answer per chunk the test dictates. */
function scriptedSink(
  answer: (req: ChunkSendRequest, n: number) => ChunkResult,
): BroadcastChunkSink & { readonly calls: ChunkSendRequest[] } {
  const calls: ChunkSendRequest[] = [];
  return {
    calls,
    send(req) {
      calls.push(req);
      return Promise.resolve(answer(req, calls.length));
    },
  };
}

interface HarnessOptions {
  readonly recipients?: Record<string, number>;
  readonly claim?: 'ok' | 'taken' | 'throw';
  readonly abuse?: Partial<AbuseState> | 'throw';
  readonly usage?: QuotaUsage | 'throw';
  readonly sink?: BroadcastChunkSink;
  readonly pager?: RecipientPager;
  readonly countThrowsFor?: readonly string[];
  readonly saveThrows?: boolean;
  readonly releaseThrows?: boolean;
}

interface Harness {
  readonly ports: BroadcastRunPorts;
  readonly claims: ClaimQuery[];
  readonly releases: ClaimQuery[];
  readonly saves: HistoryRow[][];
  readonly counted: { hookId: string; filter: Record<string, unknown> }[];
  readonly dry: DryRunChunkSink;
}

function harness(opts: HarnessOptions = {}): Harness {
  const recipients = opts.recipients ?? {};
  const claims: ClaimQuery[] = [];
  const releases: ClaimQuery[] = [];
  const saves: HistoryRow[][] = [];
  const counted: { hookId: string; filter: Record<string, unknown> }[] = [];
  const dry = new DryRunChunkSink();
  const clock: Clock = { now: () => NOW };

  const pager =
    opts.pager ??
    arrayPager(
      Object.fromEntries(
        Object.entries(recipients).map(([hookId, n]) => [
          hookId,
          ids(n, hookId),
        ]),
      ),
    );

  const ports: BroadcastRunPorts = {
    claim(query) {
      claims.push(query);
      if (opts.claim === 'taken') return Promise.resolve(null);
      if (opts.claim === 'throw')
        return Promise.reject(new Error('mongo down'));
      return Promise.resolve({ _id: 'job1', status: 'sending' });
    },
    release(query) {
      releases.push(query);
      if (opts.releaseThrows)
        return Promise.reject(new Error('release failed'));
      return Promise.resolve({ ok: 1 });
    },
    countRecipients(hookId, filter) {
      counted.push({ hookId, filter });
      if (opts.countThrowsFor?.includes(hookId)) {
        return Promise.reject(new Error('count failed'));
      }
      return Promise.resolve(recipients[hookId] ?? 0);
    },
    readAbuseState() {
      if (opts.abuse === 'throw')
        return Promise.reject(new Error('no counters'));
      return Promise.resolve({ ...HEALTHY_ABUSE, ...(opts.abuse ?? {}) });
    },
    readQuotaUsage() {
      if (opts.usage === 'throw') return Promise.reject(new Error('no usage'));
      return Promise.resolve(opts.usage ?? EMPTY_USAGE);
    },
    saveHistory(rows) {
      if (opts.saveThrows) return Promise.reject(new Error('write failed'));
      saves.push([...rows]);
      return Promise.resolve();
    },
    pager,
    sink: opts.sink ?? dry,
    clock,
  };

  return { ports, claims, releases, saves, counted, dry };
}

const input = (over: Partial<BroadcastRunInput> = {}): BroadcastRunInput => ({
  jobId: 'job1',
  ownerId: 'worker-1',
  trigger: manualTrigger('run-1', 'user-1', 'Ann'),
  cell: PLAIN,
  hookIds: ['h1', 'h2'],
  audience: {
    match: 'and',
    rules: [{ key: 'display_name', op: 'eq', value: 'Ann' }],
  },
  ...over,
});

/** The rows of the single write the run is allowed to make. */
const rowsOf = (h: Harness): HistoryRow[] => h.saves[0] ?? [];

describe('runBroadcast — the happy path', () => {
  it('claims the job, sends every OA and releases it as sent', async () => {
    const h = harness({ recipients: { h1: 600, h2: 200 } });

    const report = await runBroadcast(input(), h.ports);

    expect(report.outcome).toBe('ran');
    expect(report.claimed).toBe(true);
    expect(report.released).toBe(true);

    // The claim is the lock: it must flip `scheduled` → `sending` atomically.
    expect(h.claims).toHaveLength(1);
    expect(h.claims[0]?.filter).toMatchObject({ _id: 'job1' });
    expect(h.claims[0]?.update.$set).toMatchObject({
      status: 'sending',
      claimed_by: 'worker-1',
    });

    // 600 chunks into 500 + 100; 200 goes in one.
    expect(h.dry.log.map((e) => [e.hookId, e.recipients])).toEqual([
      ['h1', 500],
      ['h1', 100],
      ['h2', 200],
    ]);

    expect(h.releases).toHaveLength(1);
    expect(h.releases[0]?.filter).toMatchObject({
      _id: 'job1',
      status: 'sending',
      claimed_by: 'worker-1',
    });
    expect(h.releases[0]?.update.$set).toEqual({ status: 'sent' });
    expect(h.releases[0]?.update.$unset).toEqual({
      claimed_at: '',
      claimed_by: '',
      lease_until: '',
    });
  });

  it('writes ONE history row per OA, each carrying its own counts', async () => {
    const h = harness({ recipients: { h1: 600, h2: 200, h3: 10 } });

    const report = await runBroadcast(
      input({ hookIds: ['h1', 'h2', 'h3'] }),
      h.ports,
    );

    expect(report.historyRowsWritten).toBe(3);
    // One write, not three: a half-written run answers "how did OA #3 do?"
    // differently depending on when it is asked.
    expect(h.saves).toHaveLength(1);
    expect(rowsOf(h).map((r) => r.hook_id)).toEqual(['h1', 'h2', 'h3']);
    expect(rowsOf(h).map((r) => r.sent)).toEqual([600, 200, 10]);
    expect(rowsOf(h).map((r) => r.status)).toEqual([
      'success',
      'success',
      'success',
    ]);
    expect(rowsOf(h).map((r) => r.run_id)).toEqual(['run-1', 'run-1', 'run-1']);
  });

  it('renews the lease through the port while it sends', async () => {
    const renewals: ClaimQuery[] = [];
    const h = harness({ recipients: { h1: 600, h2: 200 } });
    const ports: BroadcastRunPorts = {
      ...h.ports,
      renewLease(query) {
        renewals.push(query);
        return Promise.resolve({});
      },
    };

    await runBroadcast(input(), ports);

    // One per chunk sent, and each may only extend OUR OWN claim.
    expect(h.dry.log).toHaveLength(3);
    expect(renewals).toHaveLength(3);
    expect(renewals[0]?.filter).toMatchObject({
      status: 'sending',
      claimed_by: 'worker-1',
    });
  });

  it('sends nothing extra when no lease port is supplied', async () => {
    const h = harness({ recipients: { h1: 10, h2: 10 } });
    const report = await runBroadcast(input(), h.ports);
    expect(report.outcome).toBe('ran');
    expect(h.dry.recipients).toBe(20);
  });
});

describe('runBroadcast — the claim is the lock, and losing is normal', () => {
  it('does nothing at all when another process already holds the job', async () => {
    const h = harness({ recipients: { h1: 600, h2: 200 }, claim: 'taken' });

    const report = await runBroadcast(input(), h.ports);

    expect(report.outcome).toBe('not-claimed');
    expect(report.claimed).toBe(false);
    expect(report.released).toBe(false);
    expect(report.releaseStatus).toBeUndefined();
    expect(h.dry.requests).toBe(0);
    expect(h.saves).toHaveLength(0);
    // 🔴 The release is what would steal the job back from the winner.
    expect(h.releases).toHaveLength(0);
  });

  it('never reaches the port with a job id it cannot build a claim from', async () => {
    const h = harness({ recipients: { h1: 600 } });

    const report = await runBroadcast(input({ jobId: '' }), h.ports);

    expect(report.outcome).toBe('not-claimable');
    expect(h.claims).toHaveLength(0);
    expect(h.releases).toHaveLength(0);
    expect(h.dry.requests).toBe(0);
  });
});

describe('runBroadcast — the flood guard runs BEFORE the claim', () => {
  it('refuses a job that is already sending, without claiming it', async () => {
    const h = harness({
      recipients: { h1: 600, h2: 200 },
      abuse: { jobIsRunning: true },
    });

    const report = await runBroadcast(input(), h.ports);

    expect(report.outcome).toBe('refused-abuse');
    expect(h.claims).toHaveLength(0);
    expect(h.releases).toHaveLength(0);
    expect(h.saves).toHaveLength(0);
    expect(h.dry.requests).toBe(0);
  });

  it('refuses inside the cooldown, without claiming', async () => {
    const h = harness({
      recipients: { h1: 600 },
      abuse: { lastRunFinishedAtMs: NOW - MIN_SECONDS_BETWEEN_RUNS * 1000 + 1 },
    });

    const report = await runBroadcast(input(), h.ports);

    expect(report.outcome).toBe('refused-abuse');
    expect(h.claims).toHaveLength(0);
  });

  it('refuses when the counters cannot be read — never sends blind', async () => {
    const h = harness({ recipients: { h1: 600 }, abuse: 'throw' });

    const report = await runBroadcast(input(), h.ports);

    expect(report.outcome).toBe('refused-abuse');
    expect(h.claims).toHaveLength(0);
    expect(h.dry.requests).toBe(0);
  });
});

describe('runBroadcast — the ceiling is re-checked at RUN time', () => {
  it('counts every OA live, with the filter built from the rules right now', async () => {
    const h = harness({ recipients: { h1: 10, h2: 20 } });

    await runBroadcast(input(), h.ports);

    expect(h.counted).toEqual([
      { hookId: 'h1', filter: { display_name: 'Ann' } },
      { hookId: 'h2', filter: { display_name: 'Ann' } },
    ]);
  });

  it('refuses the SAME job once the audience has grown past the ceiling', async () => {
    const job = input({ hookIds: ['h1'] });
    const small = harness({ recipients: { h1: 10 } });
    const grown = harness({ recipients: { h1: ceilingOf(PLAIN) + 1 } });

    const before = await runBroadcast(job, small.ports);
    const after = await runBroadcast(job, grown.ports);

    expect(before.outcome).toBe('ran');
    expect(after.outcome).toBe('refused-plan');
    expect(grown.dry.requests).toBe(0);
  });

  it('an over-ceiling run claims, writes refused rows and releases without sending', async () => {
    const over = ceilingOf(PLAIN) + 1;
    const h = harness({ recipients: { h1: over, h2: over } });

    const report = await runBroadcast(input(), h.ports);

    expect(report.outcome).toBe('refused-plan');
    expect(h.claims).toHaveLength(1);
    expect(h.dry.requests).toBe(0);
    expect(rowsOf(h)).toHaveLength(2);
    expect(rowsOf(h).map((r) => r.status)).toEqual(['refused', 'refused']);
    // The counts say what it WOULD have reached — a refused row of zeroes
    // cannot be told apart from a run that matched nobody.
    expect(rowsOf(h).map((r) => r.targeted)).toEqual([over, over]);
    // Back to `scheduled`: it never ran, so nothing may retire the job.
    expect(h.releases[0]?.update.$set).toEqual({ status: 'scheduled' });
  });

  it('refuses fatally when the job targets more OAs than the combination allows', async () => {
    const hookIds = ids(PERSONAL.maxHooks + 1, 'h');
    const h = harness({
      recipients: Object.fromEntries(hookIds.map((id) => [id, 5])),
    });

    const report = await runBroadcast(
      input({ cell: PERSONAL, hookIds }),
      h.ports,
    );

    expect(report.outcome).toBe('refused-plan');
    expect(report.detail).toContain(String(hookIds.length));
    expect(h.dry.requests).toBe(0);
    expect(h.releases).toHaveLength(1);
  });

  it('skips only the OA whose count cannot be read, and still gives it a row', async () => {
    const h = harness({
      recipients: { h1: 100, h2: 200 },
      countThrowsFor: ['h1'],
    });

    const report = await runBroadcast(input(), h.ports);

    expect(report.outcome).toBe('ran');
    // 🔴 The other OA keeps its campaign — one unreadable OA is not a dead run.
    expect(h.dry.log.map((e) => e.hookId)).toEqual(['h2']);
    expect(h.dry.recipients).toBe(200);

    expect(rowsOf(h).map((r) => r.hook_id)).toEqual(['h1', 'h2']);
    expect(rowsOf(h)[0]?.status).toBe('refused');
    expect(String(rowsOf(h)[0]?.error_message)).toContain('could not be read');
    expect(rowsOf(h)[1]?.status).toBe('success');
    expect(rowsOf(h)[1]?.sent).toBe(200);
  });

  it('refuses a rule it cannot build, rather than sending to a wider list', async () => {
    const h = harness({ recipients: { h1: 10, h2: 10 } });

    const report = await runBroadcast(
      input({
        audience: {
          match: 'and',
          rules: [{ key: 'not-a-field', op: 'eq', value: 1 }],
        },
      }),
      h.ports,
    );

    expect(report.outcome).toBe('refused-audience');
    expect(h.counted).toHaveLength(0);
    expect(h.dry.requests).toBe(0);
    expect(rowsOf(h)).toHaveLength(2);
    expect(h.releases[0]?.update.$set).toEqual({ status: 'scheduled' });
  });
});

describe('runBroadcast — the global budget', () => {
  it('refuses a run that would cross the hourly ceiling, and sends nothing', async () => {
    const h = harness({
      recipients: { h1: 600, h2: 200 },
      usage: {
        lastHour: {
          recipients: GLOBAL_QUOTA.hour.recipients - 100,
          requests: 0,
        },
        lastDay: { recipients: 0, requests: 0 },
      },
    });

    const report = await runBroadcast(input(), h.ports);

    expect(report.outcome).toBe('refused-quota');
    expect(h.dry.requests).toBe(0);
    expect(h.releases).toHaveLength(1);
    expect(h.releases[0]?.update.$set).toEqual({ status: 'scheduled' });
    expect(rowsOf(h).map((r) => r.status)).toEqual(['refused', 'refused']);
  });

  it('lets a run through when the same ceiling still has room', async () => {
    const h = harness({
      recipients: { h1: 600, h2: 200 },
      usage: {
        lastHour: {
          recipients: GLOBAL_QUOTA.hour.recipients - 801,
          requests: 0,
        },
        lastDay: { recipients: 0, requests: 0 },
      },
    });

    const report = await runBroadcast(input(), h.ports);

    expect(report.outcome).toBe('ran');
    expect(h.dry.recipients).toBe(800);
  });

  it('refuses when the usage cannot be read', async () => {
    const h = harness({ recipients: { h1: 600, h2: 200 }, usage: 'throw' });

    const report = await runBroadcast(input(), h.ports);

    expect(report.outcome).toBe('refused-quota');
    expect(h.dry.requests).toBe(0);
    expect(h.releases).toHaveLength(1);
  });
});

describe('runBroadcast — the job is ALWAYS handed back', () => {
  it('releases after a throw in the middle of the run', async () => {
    const h = harness({ recipients: { h1: 600, h2: 200 } });
    const ports: BroadcastRunPorts = {
      ...h.ports,
      pager: {
        next: () => Promise.reject(new Error('cursor exploded')),
      },
    };

    const report = await runBroadcast(input(), ports);

    expect(report.outcome).toBe('crashed');
    expect(report.error).toBe('cursor exploded');
    // 🔴 The whole point: a job left in `sending` is invisible until its lease
    // expires, so the release must survive the throw.
    expect(h.releases).toHaveLength(1);
    expect(h.releases[0]?.update.$set).toEqual({ status: 'failed' });
    expect(report.released).toBe(true);
  });

  it('attempts a release even when the CLAIM write threw — it may have landed', async () => {
    const h = harness({ recipients: { h1: 600 }, claim: 'throw' });

    const report = await runBroadcast(input(), h.ports);

    expect(report.outcome).toBe('crashed');
    expect(report.claimed).toBe(false);
    expect(h.releases).toHaveLength(1);
    expect(h.releases[0]?.filter).toMatchObject({ claimed_by: 'worker-1' });
    expect(h.dry.requests).toBe(0);
  });

  it('does not lose the release when the history write fails', async () => {
    const h = harness({ recipients: { h1: 600, h2: 200 }, saveThrows: true });

    const report = await runBroadcast(input(), h.ports);

    expect(report.outcome).toBe('ran');
    expect(report.historyRowsWritten).toBe(0);
    expect(report.error).toBe('write failed');
    expect(h.releases).toHaveLength(1);
    expect(h.releases[0]?.update.$set).toEqual({ status: 'sent' });
  });

  it('reports a release that throws instead of throwing out', async () => {
    const h = harness({ recipients: { h1: 10 }, releaseThrows: true });

    const report = await runBroadcast(input({ hookIds: ['h1'] }), h.ports);

    expect(report.outcome).toBe('ran');
    expect(report.released).toBe(false);
    expect(h.releases).toHaveLength(1);
  });
});

describe('runBroadcast — what the job rests at', () => {
  it('a partly delivered run rests at `sent`, not `failed`', async () => {
    // The first chunk is rejected; the rest land.
    const sink = scriptedSink((_req, n) =>
      n === 1 ? { ok: false, sent: 0, error: 'nope' } : { ok: true, sent: 0 },
    );
    const h = harness({ recipients: { h1: 600, h2: 200 }, sink });

    const report = await runBroadcast(input(), h.ports);

    expect(report.result?.summary.status).toBe('partial');
    expect(h.releases[0]?.update.$set).toEqual({ status: 'sent' });
    expect(rowsOf(h)[0]?.failed).toBe(500);
    expect(rowsOf(h)[0]?.sent).toBe(100);
  });

  it('a run nothing accepted rests at `failed`', async () => {
    const sink = scriptedSink(() => ({ ok: false, sent: 0, error: 'nope' }));
    const h = harness({ recipients: { h1: 600, h2: 200 }, sink });

    const report = await runBroadcast(input(), h.ports);

    expect(report.result?.summary.status).toBe('error');
    expect(h.releases[0]?.update.$set).toEqual({ status: 'failed' });
  });

  it('a repeating job goes back to `scheduled` so its next round can claim it', async () => {
    const h = harness({ recipients: { h1: 10 } });

    await runBroadcast(input({ hookIds: ['h1'], repeating: true }), h.ports);

    expect(h.releases[0]?.update.$set).toEqual({ status: 'scheduled' });
  });

  it('counts a 409 as delivered, so a resumed run does not rest at `failed`', async () => {
    // LINE answering 409 means an earlier attempt with the same key landed.
    const sink = scriptedSink(() => ({ ok: false, status: 409, sent: 0 }));
    const h = harness({ recipients: { h1: 600 }, sink });

    const report = await runBroadcast(input({ hookIds: ['h1'] }), h.ports);

    expect(report.result?.summary.status).toBe('success');
    expect(h.releases[0]?.update.$set).toEqual({ status: 'sent' });
  });
});
