/**
 * [FEAT-20260824-BCASTWHYFAILED] The reason LINE gave has to reach the log.
 * ===========================================================================
 * Owner, 24/08: *"webhook_logs ไม่เก็บ HTTP status / body ที่ LINE ตอบ … 'quota หมด'
 * กับ 'token เสีย' กับ 'payload ผิด' หน้าตาเหมือนกันหมด"* · *"แก้ได้ไหม ห้ามกระทบ"*.
 *
 * The bug these cover is not a crash — it is three DIFFERENT failures writing
 * one IDENTICAL row. So every test here asserts that two unlike causes read
 * unlike, and the "ห้ามกระทบ" half asserts that a run which did not fail is
 * byte-for-byte what it was before. เทสนี้วัด "แยกออกจากกันไหม" ไม่ใช่ "พังไหม".
 */
import {
  describeChunkFailure,
  executeOa,
  failureSentence,
  outcomesFrom,
  buildHistoryRow,
  EMPTY_COUNTERS,
  FRESH_RESUME,
  MAX_FAILURE_REASON,
  SEND_MATRIX,
  type BroadcastChunkSink,
  type ChunkResult,
  type ChunkSendRequest,
  type Clock,
  type OaOutcome,
  type RecipientPage,
  type RecipientPager,
} from '@/modules/content';

/* ── the same seams the executor spec uses, kept local so neither file owns
      the other's setup ─────────────────────────────────────────────────────── */

function arrayPager(idsByHook: Record<string, string[]>): RecipientPager {
  return {
    next(hookId, point, pageSize): Promise<RecipientPage> {
      const all = idsByHook[hookId] ?? [];
      const from = point.afterId === null ? 0 : Number(point.afterId) + 1;
      const ids = all.slice(from, from + pageSize);
      const lastId = ids.length ? String(from + ids.length - 1) : null;
      return Promise.resolve({ ids, lastId });
    },
  };
}

const fixedClock = (): Clock => ({ now: () => 0 });

function scriptedSink(
  answer: (req: ChunkSendRequest, n: number) => ChunkResult,
): BroadcastChunkSink {
  let calls = 0;
  return {
    send(req) {
      calls += 1;
      return Promise.resolve(answer(req, calls));
    },
  };
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => `U${i}`);

const oaInput = (over: Record<string, unknown> = {}) => ({
  runId: 'run1',
  hookId: 'h1',
  cell: SEND_MATRIX['multicast:plain'],
  plan: { index: 0, recipients: 1200, requests: 3, sendable: true },
  pager: arrayPager({ h1: ids(1200) }),
  sink: scriptedSink(() => ({ ok: true, sent: 500 })),
  clock: fixedClock(),
  startedAt: 0,
  requestsMadeBefore: 0,
  counters: { ...EMPTY_COUNTERS, targeted: 1200, unsent: 1200 },
  ...over,
});

/** The real sentence LINE answered on 24/08 when the OA sat at 299 of 300. */
const QUOTA =
  'HTTP 429 - You have reached your monthly limit. [reqId: abc-123]';
const BAD_TOKEN =
  'HTTP 401 - Authentication failed. Confirm that the access token in the authorization header is valid.';

describe('describeChunkFailure — absent, known, and capped', () => {
  it('returns undefined when NEITHER status nor reason is known', () => {
    /* Not `{}` — an empty descriptor would claim someone looked. */
    expect(describeChunkFailure({})).toBeUndefined();
    expect(describeChunkFailure({ error: '   ' })).toBeUndefined();
  });

  it('keeps status 0 — push core’s word for "no HTTP happened"', () => {
    /* 🔴 The falsy trap: `status && {status}` would drop a transport failure,
       which is a real, distinguishable cause. absent ≠ 0. */
    expect(
      describeChunkFailure({ status: 0, error: 'socket hang up' }),
    ).toEqual({ status: 0, reason: 'socket hang up' });
  });

  it('caps a runaway body instead of storing it whole', () => {
    const huge = 'x'.repeat(MAX_FAILURE_REASON + 500);
    const out = describeChunkFailure({ status: 400, error: huge });
    expect(out?.reason?.length).toBe(MAX_FAILURE_REASON + 1); // + the ellipsis
    expect(out?.reason?.endsWith('…')).toBe(true);
  });

  it('keeps a reason that is exactly at the cap unchanged', () => {
    const exact = 'y'.repeat(MAX_FAILURE_REASON);
    expect(describeChunkFailure({ error: exact })?.reason).toBe(exact);
  });
});

describe('failureSentence — the verdict is never replaced by the evidence', () => {
  it('appends LINE’s answer after our own verdict', () => {
    expect(
      failureSentence('stopped: rate-limited', { status: 429, reason: QUOTA }),
    ).toBe(`stopped: rate-limited — ${QUOTA}`);
  });

  it('falls back to the bare verdict when nothing was recorded', () => {
    expect(failureSentence('run status: error', undefined)).toBe(
      'run status: error',
    );
  });

  it('still says the HTTP code when only the code is known', () => {
    expect(failureSentence('run status: error', { status: 500 })).toBe(
      'run status: error — LINE HTTP 500',
    );
  });
});

describe('executeOa — the first failure is kept, later ones do not overwrite it', () => {
  it('records nothing when every chunk is accepted', async () => {
    const r = await executeOa(oaInput());
    /* ห้ามกระทบ: a healthy run must carry NO new key at all. */
    expect(r.firstFailure).toBeUndefined();
    expect(r.counters.failed).toBe(0);
  });

  /**
   * 🔴 THE FIRST DRAFT OF THIS TEST WAS DECORATION, and the mutation run is what
   *    exposed it. It scripted chunk 2 as a 429 and chunk 3 as something else —
   *    but `run-guard.ts:144` stops an OA the moment it SEES a 429, so chunk 3
   *    never ran and there was no later failure to be overwritten by. Changing
   *    `??=` to `=` left all 19 tests green.
   *    Two NON-rate-limit failures let the loop keep going
   *    (`MAX_CONSECUTIVE_FAILURES` is 5), so first-vs-last is now observable.
   *    เทสเดิมผ่านทั้งที่โค้ดผิด เพราะ 429 หยุด OA ไปก่อน — ต้องใช้ error ที่ไม่หยุด.
   */
  it('keeps the CAUSE, not the latest symptom', async () => {
    const sink = scriptedSink((_req, n) =>
      n === 1
        ? { ok: false, status: 500, sent: 0, error: 'HTTP 500 - the cause' }
        : { ok: false, status: 400, sent: 0, error: 'HTTP 400 - later noise' },
    );
    const r = await executeOa(oaInput({ sink }));

    expect(r.counters.failed).toBeGreaterThan(0);
    expect(r.firstFailure).toEqual({
      status: 500,
      reason: 'HTTP 500 - the cause',
    });
    expect(r.firstFailure?.reason).not.toContain('later noise');
  });

  it('does not treat a 409 as a failure — an earlier attempt already landed', async () => {
    const sink = scriptedSink(() => ({
      ok: false,
      status: 409,
      sent: 0,
      error: 'HTTP 409 - duplicate retry key',
    }));
    const r = await executeOa(oaInput({ sink }));

    /* 409 counts as delivered everywhere else; recording it as the reason a
       campaign failed would invent a failure that did not happen. */
    expect(r.counters.failed).toBe(0);
    expect(r.firstFailure).toBeUndefined();
  });
});

describe('outcomesFrom — the log row can tell the three causes apart', () => {
  const reportWith = (failure?: { status?: number; reason?: string }) => ({
    runId: 'run1',
    outcome: 'ran' as const,
    result: {
      perOa: [
        {
          index: 0,
          hookId: 'h1',
          counters: {
            ...EMPTY_COUNTERS,
            targeted: 3,
            failed: 3,
            requestsMade: 1,
          },
          unknownTags: [],
          imagesMeasured: true,
          resume: FRESH_RESUME('h1'),
          ...(failure ? { firstFailure: failure } : {}),
        },
      ],
    },
  });

  it('🔴 quota exhausted and a dead token no longer read the same', () => {
    const quota = outcomesFrom(
      ['h1'],
      reportWith({ status: 429, reason: QUOTA }) as never,
    )[0];
    const token = outcomesFrom(
      ['h1'],
      reportWith({ status: 401, reason: BAD_TOKEN }) as never,
    )[0];

    /* This is the whole bug in one assertion: before the fix both were the
       string "run status: error". */
    expect(quota?.error).not.toBe(token?.error);
    expect(quota?.error).toContain('monthly limit');
    expect(token?.error).toContain('access token');

    expect(quota?.response['line_status']).toBe(429);
    expect(token?.response['line_status']).toBe(401);
  });

  it('keeps the old verdict inside the new sentence', () => {
    const out = outcomesFrom(
      ['h1'],
      reportWith({ status: 429, reason: QUOTA }) as never,
    )[0];
    /* Nothing a reader relied on was taken away — the row only got longer. */
    expect(out?.error).toContain('run status: error');
  });

  it('ห้ามกระทบ: a successful OA gains no line_* keys', () => {
    const ok = outcomesFrom(['h1'], {
      runId: 'run1',
      outcome: 'ran',
      result: {
        perOa: [
          {
            index: 0,
            hookId: 'h1',
            counters: {
              ...EMPTY_COUNTERS,
              targeted: 3,
              sent: 3,
              requestsMade: 1,
            },
            unknownTags: [],
            imagesMeasured: true,
            resume: FRESH_RESUME('h1'),
          },
        ],
      },
    } as never)[0];

    expect(ok?.ok).toBe(true);
    expect(ok?.error).toBeUndefined();
    expect(Object.keys(ok?.response ?? {})).not.toContain('line_status');
    expect(Object.keys(ok?.response ?? {})).not.toContain('line_reason');
  });

  it('falls back to the old wording when the OA recorded no failure', () => {
    const out = outcomesFrom(['h1'], reportWith() as never)[0];
    expect(out?.error).toBe('run status: error');
    expect(Object.keys(out?.response ?? {})).not.toContain('line_reason');
  });
});

describe('buildHistoryRow — every row explains ITSELF', () => {
  const rowInput = {
    broadcastId: 'b1',
    runId: 'run1',
    cell: SEND_MATRIX['multicast:plain'],
    triggeredBy: 'scheduler' as const,
    startedAt: new Date(0),
    finishedAt: new Date(1),
    recipientsCaptured: {},
  };

  const oa = (over: Partial<OaOutcome> = {}): OaOutcome => ({
    index: 0,
    hookId: 'h1',
    counters: { ...EMPTY_COUNTERS, targeted: 3, failed: 3, requestsMade: 1 },
    unknownTags: [],
    imagesMeasured: true,
    resume: FRESH_RESUME('h1'),
    ...over,
  });

  it('writes error_message where nothing ever wrote it before', () => {
    const row = buildHistoryRow(
      rowInput,
      oa({ firstFailure: { status: 429, reason: QUOTA } }),
    );
    expect(String(row['error_message'])).toContain('monthly limit');
  });

  it('🔴 the OA’s own reason beats the run-level message', () => {
    /* Two OAs, one run: a shared sentence would stamp the quota wall onto the
       OA that was merely skipped. เหตุผลของตัวเองต้องชนะ. */
    const row = buildHistoryRow(
      { ...rowInput, errorMessage: 'card could not be read' },
      oa({ firstFailure: { status: 401, reason: BAD_TOKEN } }),
    );
    expect(String(row['error_message'])).toContain('access token');
    expect(String(row['error_message'])).not.toContain(
      'card could not be read',
    );
  });

  it('keeps the run-level message for an OA with no reason of its own', () => {
    const row = buildHistoryRow(
      { ...rowInput, errorMessage: 'card could not be read' },
      oa(),
    );
    expect(row['error_message']).toBe('card could not be read');
  });

  it('ห้ามกระทบ: a successful row still carries no error_message', () => {
    const row = buildHistoryRow(
      rowInput,
      oa({
        counters: { ...EMPTY_COUNTERS, targeted: 3, sent: 3, requestsMade: 1 },
      }),
    );
    expect(Object.keys(row)).not.toContain('error_message');
  });

  it('names the stop reason and the LINE answer together', () => {
    const row = buildHistoryRow(
      rowInput,
      oa({
        stoppedBy: 'rate-limited',
        firstFailure: { status: 429, reason: QUOTA },
      }),
    );
    expect(row['stop_reason']).toBe('rate-limited');
    expect(String(row['error_message'])).toContain('stopped: rate-limited');
    expect(String(row['error_message'])).toContain('monthly limit');
  });
});
