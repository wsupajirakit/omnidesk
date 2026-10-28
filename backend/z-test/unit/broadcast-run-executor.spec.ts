/**
 * [FEAT-20260822-BCASTEXEC] The runner, driven through a whole campaign.
 * ===========================================================================
 * Every seam is injected, so a full run — pages, chunks, retries, deadlines,
 * 429s, resume — happens in memory with no Mongo and no LINE. That is the
 * point of the design: if these cases needed a database, nobody would write
 * the ugly ones, and the ugly ones are where campaigns break.
 */
import {
  audienceFingerprint,
  executeOa,
  executeRun,
  perRequestSize,
  MAX_REFILL_PAGES_PER_CHUNK,
  DryRunChunkSink,
  planRun,
  SEND_MATRIX,
  EMPTY_COUNTERS,
  FRESH_RESUME,
  LINE_MULTICAST_MAX_TO,
  HARD_DEADLINE_MS,
  MAX_CONSECUTIVE_FAILURES,
  type BroadcastChunkSink,
  type ChunkResult,
  type ChunkSendRequest,
  type Clock,
  type RecipientPage,
  type RecipientPager,
} from '@/modules/content';

/** A pager over a plain array, keyed by position — the same shape Mongo gives. */
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

function fixedClock(t = 0): Clock & { set(v: number): void } {
  let now = t;
  return { now: () => now, set: (v) => (now = v) };
}

/** A sink whose answer per chunk index the test dictates. */
function scriptedSink(
  answer: (req: ChunkSendRequest, n: number) => ChunkResult | Error,
): BroadcastChunkSink & { calls: ChunkSendRequest[] } {
  const calls: ChunkSendRequest[] = [];
  return {
    calls,
    send(req) {
      calls.push(req);
      const a = answer(req, calls.length);
      if (a instanceof Error) return Promise.reject(a);
      return Promise.resolve(a);
    },
  };
}

const OK: ChunkResult = { ok: true, sent: 0 };
const ids = (n: number, p = 'U') =>
  Array.from({ length: n }, (_, i) => `${p}${i}`);

const oaPlan = (recipients: number, requests: number) => ({
  index: 0,
  recipients,
  requests,
  sendable: true,
});

const base = (over: Partial<Parameters<typeof executeOa>[0]> = {}) => ({
  runId: 'run1',
  hookId: 'h1',
  cell: SEND_MATRIX['multicast:plain'],
  plan: oaPlan(1200, 3),
  pager: arrayPager({ h1: ids(1200) }),
  sink: new DryRunChunkSink(),
  clock: fixedClock(),
  startedAt: 0,
  requestsMadeBefore: 0,
  counters: { ...EMPTY_COUNTERS, targeted: 1200, unsent: 1200 },
  ...over,
});

describe('executeOa — one OA, walked to the end', () => {
  it('chunks 1,200 recipients into 500/500/200 and sends each once', async () => {
    const sink = new DryRunChunkSink();
    const r = await executeOa(base({ sink }));

    expect(sink.log.map((e) => e.recipients)).toEqual([500, 500, 200]);
    expect(sink.recipients).toBe(1200);
    expect(r.counters.sent).toBe(1200);
    expect(r.counters.unsent).toBe(0);
    expect(r.stoppedBy).toBeUndefined();
  });

  it('never exceeds LINE’s per-request cap, whatever page size it is given', async () => {
    const sink = new DryRunChunkSink();
    await executeOa(base({ sink, chunkSize: 5000 }));
    for (const e of sink.log) {
      expect(e.recipients).toBeLessThanOrEqual(LINE_MULTICAST_MAX_TO);
    }
  });

  it('gives every chunk a DIFFERENT reproducible retry key', async () => {
    const sink = new DryRunChunkSink();
    await executeOa(base({ sink }));
    const keys = sink.log.map((e) => e.retryKey);
    expect(new Set(keys).size).toBe(keys.length);

    const again = new DryRunChunkSink();
    await executeOa(base({ sink: again }));
    expect(again.log.map((e) => e.retryKey)).toEqual(keys);
  });

  it('drops duplicates, so nobody is sent the same card twice', async () => {
    const sink = new DryRunChunkSink();
    const dupes = [...ids(300), ...ids(300)];
    await executeOa(
      base({
        sink,
        pager: arrayPager({ h1: dupes }),
        counters: { ...EMPTY_COUNTERS, targeted: 600, unsent: 600 },
      }),
    );
    expect(sink.recipients).toBe(300);
  });

  it('counts a 409 as delivered — an earlier attempt already landed', async () => {
    const sink = scriptedSink(() => ({ ok: false, status: 409, sent: 0 }));
    const r = await executeOa(base({ sink }));
    expect(r.counters.sent).toBe(1200);
    expect(r.counters.failed).toBe(0);
  });

  it('survives a sink that throws — one bad chunk is not a dead campaign', async () => {
    const sink = scriptedSink((_r, n) =>
      n === 2 ? new Error('socket died') : OK,
    );
    const r = await executeOa(base({ sink }));
    expect(r.counters.failed).toBe(500);
    expect(r.counters.sent).toBe(700);
    expect(sink.calls).toHaveLength(3);
  });
});

describe('executeOa — the CELL decides the shape of the run', () => {
  it('🔴 a personal card is ONE recipient per request — never a batch', async () => {
    /* If this ever goes green with a batch, 500 people receive one stranger's
       card: their name, their balance, their history. It is a data-leak bug
       wearing a rate-limit costume. การ์ดรายคน = หนึ่งคนต่อหนึ่ง request. */
    const sink = new DryRunChunkSink();
    await executeOa(
      base({
        sink,
        cell: SEND_MATRIX['multicast:personal'],
        pager: arrayPager({ h1: ids(7) }),
        plan: oaPlan(7, 7),
        counters: { ...EMPTY_COUNTERS, targeted: 7, unsent: 7 },
      }),
    );
    expect(sink.log.map((e) => e.recipients)).toEqual([1, 1, 1, 1, 1, 1, 1]);
  });

  it('a plain card batches up to LINE’s cap, because everyone gets the same one', async () => {
    const sink = new DryRunChunkSink();
    await executeOa(base({ sink, cell: SEND_MATRIX['multicast:plain'] }));
    expect(sink.log.map((e) => e.recipients)).toEqual([500, 500, 200]);
  });

  it('🔴 the broadcast pipe sends ONE request per OA and never reads the audience', async () => {
    /* `/message/broadcast` takes no recipient list — LINE fans out. Paging an
       audience the request never uses would be work whose result is discarded,
       and would invent a resume point that means nothing. */
    let pageCalls = 0;
    const pager: RecipientPager = {
      next: () => {
        pageCalls += 1;
        return Promise.resolve({ ids: ids(500), lastId: '499' });
      },
    };
    const sink = new DryRunChunkSink();
    const r = await executeOa(
      base({
        sink,
        pager,
        cell: SEND_MATRIX['broadcast:plain'],
        plan: oaPlan(9000, 1),
        counters: { ...EMPTY_COUNTERS, targeted: 9000, unsent: 9000 },
      }),
    );

    expect(pageCalls).toBe(0);
    expect(sink.requests).toBe(1);
    expect(sink.log[0]?.recipients).toBe(0);
    // Counted from the PLAN, since LINE reports no per-person outcome here.
    expect(r.counters.sent).toBe(9000);
  });

  it('the broadcast pipe still obeys the run guard', async () => {
    const sink = new DryRunChunkSink();
    const r = await executeOa(
      base({
        sink,
        clock: fixedClock(HARD_DEADLINE_MS + 1),
        cell: SEND_MATRIX['broadcast:plain'],
        plan: oaPlan(9000, 1),
      }),
    );
    expect(sink.requests).toBe(0);
    expect(r.stoppedBy).toBe('deadline');
  });

  it('a cell that does not address recipients cannot silently become a batch', () => {
    expect(perRequestSize(SEND_MATRIX['multicast:personal'])).toBe(1);
    expect(perRequestSize(SEND_MATRIX['multicast:plain'])).toBe(
      LINE_MULTICAST_MAX_TO,
    );
  });
});

describe('executeOa — the ceilings it must obey', () => {
  it('stops after too many failures in a row, instead of hammering LINE', async () => {
    const sink = scriptedSink(() => ({ ok: false, sent: 0 }));
    const r = await executeOa(
      base({
        sink,
        pager: arrayPager({ h1: ids(10_000) }),
        plan: oaPlan(10_000, 20),
        counters: { ...EMPTY_COUNTERS, targeted: 10_000, unsent: 10_000 },
      }),
    );
    expect(r.stoppedBy).toBe('consecutive-failures');
    expect(sink.calls.length).toBe(MAX_CONSECUTIVE_FAILURES);
  });

  it('stops on a 429 — the channel said slow down, so this OA is done', async () => {
    const sink = scriptedSink((_r, n) =>
      n === 1 ? { ok: false, status: 429, sent: 0 } : OK,
    );
    const r = await executeOa(base({ sink }));
    expect(r.stoppedBy).toBe('rate-limited');
    expect(sink.calls).toHaveLength(1);
  });

  it('stops at the deadline, mid-list, without sending one more request', async () => {
    const clock = fixedClock();
    const sink = scriptedSink(() => {
      clock.set(HARD_DEADLINE_MS + 1);
      return OK;
    });
    const r = await executeOa(
      base({
        sink,
        clock,
        pager: arrayPager({ h1: ids(10_000) }),
        plan: oaPlan(10_000, 20),
        counters: { ...EMPTY_COUNTERS, targeted: 10_000, unsent: 10_000 },
      }),
    );
    expect(r.stoppedBy).toBe('deadline');
    expect(sink.calls).toHaveLength(1);
  });

  it('asks the guard BEFORE the request, not after it', async () => {
    // The deadline is already blown when the run starts, so a runner that
    // checks afterwards would still have made one call. ถามก่อนยิง.
    const clock = fixedClock(HARD_DEADLINE_MS + 1);
    const sink = scriptedSink(() => OK);
    const r = await executeOa(base({ sink, clock }));
    expect(sink.calls).toHaveLength(0);
    expect(r.stoppedBy).toBe('deadline');
  });

  it('sends nothing at all for an OA the plan refused', async () => {
    const sink = new DryRunChunkSink();
    const r = await executeOa(
      base({ sink, plan: { ...oaPlan(1200, 3), sendable: false } }),
    );
    expect(sink.requests).toBe(0);
    expect(r.stoppedBy).toBe('disabled');
  });

  it('refuses to send a chunk it cannot build a retry key for', async () => {
    // A run id with a character the key rejects — the chunk cannot be made
    // idempotent, so resending it later could double-send the whole chunk.
    const sink = new DryRunChunkSink();
    const r = await executeOa(base({ sink, runId: 'run 1/bad' }));
    expect(sink.requests).toBe(0);
    expect(r.stoppedBy).toBe('no-retry-key');
  });
});

describe('executeOa — what the render measured reaches the counters', () => {
  it('🔴 D5 — a broken picture is COUNTED, not silently swallowed', async () => {
    /* `images_replaced` used to be 0 in every row because the card builder
       measured it and the messages-only return type threw it away — so the
       number meant "never counted" while reading as "every picture was fine".
       ตัวเลขที่แปลว่า "ไม่เคยนับ" แต่หน้าตาเหมือน "ไม่มีปัญหา" = โกหก. */
    const sink = scriptedSink(() => ({ ok: true, sent: 0, imagesReplaced: 1 }));
    const r = await executeOa(base({ sink }));
    expect(r.counters.imagesReplaced).toBe(3); // 3 chunks × 1
  });

  it('🔴 a sink that measured nothing says so — 0 is not the same answer', async () => {
    /* The dry-run sink renders nothing, so it looked at no pictures. The
       counter cannot express that (a number has no "unknown"), so the run
       reports `imagesMeasured: false` and the history row omits the field.
       ไม่ได้วัด ≠ วัดแล้วเป็นศูนย์ — ต้องตอบต่างกัน. */
    const r = await executeOa(base({ sink: new DryRunChunkSink() }));
    expect(r.imagesMeasured).toBe(false);
    expect(r.counters.imagesReplaced).toBe(0);
  });

  it('a sink that DID look reports measured, even when it found nothing', async () => {
    const sink = scriptedSink(() => ({ ok: true, sent: 0, imagesReplaced: 0 }));
    const r = await executeOa(base({ sink }));
    expect(r.imagesMeasured).toBe(true);
    expect(r.counters.imagesReplaced).toBe(0);
  });

  it('collects the tags nothing knew about, so a run can report them', async () => {
    const sink = scriptedSink((_r, n) => ({
      ok: true,
      sent: 0,
      unknownTags: n === 1 ? ['profile.a', 'member.b'] : ['profile.a'],
    }));
    const r = await executeOa(base({ sink }));
    expect([...r.unknownTags].sort()).toEqual(['member.b', 'profile.a']);
  });
});

describe('executeOa — the two stops nothing was testing', () => {
  /* Both were surviving mutants an independent reviewer found: deleting the
     line left the whole suite green, so the promise in the comment above each
     one was enforced by nothing. */

  it('🔴 M8 — an overflowed dedupe tracker STOPS the OA', async () => {
    /* The accumulator refuses ids beyond `maxTracked` rather than forgetting
       them, so past that point it can no longer promise "nobody twice". A run
       that carried on would be sending duplicates it cannot see.
       ตัวนับ dedupe ล้น = รับประกันไม่ซ้ำไม่ได้แล้ว ⇒ ต้องหยุด. */
    const sink = new DryRunChunkSink();
    // maxTracked of 3 with 10 distinct recipients: overflow is unavoidable.
    const r = await executeOa(
      base({
        sink,
        chunkSize: 2,
        maxTracked: 3,
        pager: arrayPager({ h1: ids(10) }),
        plan: oaPlan(10, 5),
        counters: { ...EMPTY_COUNTERS, targeted: 10, unsent: 10 },
      }),
    );
    expect(r.stoppedBy).toBe('overflow');
  });

  it('🔴 M15 — the BROADCAST path heartbeats too, or it holds a stale claim', async () => {
    /* The multicast path was covered; the broadcast path was not. A run that
       loses its heartbeat keeps its claim until the lease expires, and the
       next scheduler round can pick the job up alongside it. */
    const beats: number[] = [];
    await executeOa(
      base({
        cell: SEND_MATRIX['broadcast:plain'],
        plan: oaPlan(9000, 1),
        heartbeat: (p) => void beats.push(p.nextChunkIndex),
      }),
    );
    expect(beats).toEqual([1]);
  });
});

describe('executeOa — a pager that misbehaves must not hang the worker', () => {
  it('🔴 stops when the cursor stops moving, instead of spinning forever', async () => {
    /* Found by a mutation that HUNG the suite rather than failing it: every
       other guard sits on the send path, so a pager that never completes a
       chunk never reaches one. Here every page repeats ids the accumulator
       already dropped, so no chunk is ever ready. */
    let calls = 0;
    const stuck: RecipientPager = {
      next: () => {
        calls += 1;
        return Promise.resolve({ ids: ids(10), lastId: '9' });
      },
    };
    const sink = new DryRunChunkSink();
    const r = await executeOa(base({ sink, pager: stuck }));

    expect(r.stoppedBy).toBe('stalled-pager');
    expect(calls).toBeLessThan(5);
    expect(sink.requests).toBe(0);
  });

  it('🔴 honours the deadline even while it is still only READING', async () => {
    const clock = fixedClock();
    const slow: RecipientPager = {
      next: () => {
        clock.set(HARD_DEADLINE_MS + 1);
        return Promise.resolve({ ids: ids(10), lastId: '9' });
      },
    };
    const r = await executeOa(base({ clock, pager: slow }));
    expect(r.stoppedBy).toBe('deadline');
  });

  it('🔴 an EMPTY page does not end the list — the cursor says when it ends', async () => {
    /* The pager reads members and returns the LINE ids that belong to THIS OA,
       so a page of 500 members from another channel yields zero ids while the
       list carries on. Ending there would report success having reached a
       fraction of the audience. */
    let page = 0;
    const gappy: RecipientPager = {
      next: () => {
        page += 1;
        if (page === 1) return Promise.resolve({ ids: [], lastId: '499' });
        if (page === 2)
          return Promise.resolve({ ids: ids(500, 'B'), lastId: '999' });
        return Promise.resolve({ ids: [], lastId: null });
      },
    };
    const sink = new DryRunChunkSink();
    const r = await executeOa(base({ sink, pager: gappy }));

    expect(sink.recipients).toBe(500);
    expect(r.stoppedBy).toBeUndefined();
  });

  it('🔴 the page cap catches a pager that advances but never fills a chunk', async () => {
    /* The second, independent bound. The cursor check above is the smart one;
       this one cannot be reasoned wrong, and it is what turned the hang into a
       readable failure. A pager asked for 500 rows that keeps answering with 1
       is broken, however honestly its cursor moves. */
    let n = 0;
    const dribble: RecipientPager = {
      next: () => Promise.resolve({ ids: [`U${n++}`], lastId: String(n) }),
    };
    const r = await executeOa(base({ pager: dribble }));
    expect(r.stoppedBy).toBe('pager-not-advancing');
    expect(n).toBeLessThanOrEqual(MAX_REFILL_PAGES_PER_CHUNK + 1);
  });

  it('a pager whose cursor DOES move is not mistaken for a stalled one', async () => {
    const sink = new DryRunChunkSink();
    const r = await executeOa(base({ sink }));
    expect(r.stoppedBy).toBeUndefined();
    expect(sink.recipients).toBe(1200);
  });
});

describe('executeOa — resume must not lose or double-count people', () => {
  /* Both cases below were MEASURED by an independent reviewer against the old
     code, not imagined. They are the two worst failures this feature can have:
     one silently skips recipients, the other reports them as delivered. */

  it('🔴 D1 — a stop before the first send must NOT move the cursor', async () => {
    /* Old behaviour, measured: 1,200 recipients · deadline trips before the
       first send · reports sent:0 · resume.afterId already at 499 ⇒ the
       resumed run starts at 500 and U0-U499 are never messaged by anyone,
       with no counter or row saying so. */
    const clock = fixedClock();
    const sink = scriptedSink(() => {
      clock.set(HARD_DEADLINE_MS + 1);
      return OK;
    });
    // The deadline is already blown, so nothing is sent at all.
    const blown = fixedClock(HARD_DEADLINE_MS + 1);
    const r = await executeOa(base({ sink, clock: blown }));

    expect(r.counters.sent).toBe(0);
    expect(r.stoppedBy).toBe('deadline');
    expect(r.resume.afterId).toBeNull();
    expect(r.resume.nextChunkIndex).toBe(0);
    void clock;
  });

  it('🔴 D1 — the cursor stops exactly where the last ACCEPTED chunk ended', async () => {
    // 1,200 people, 500 per request. The second chunk fails, so the run may
    // only promise the first 500.
    const sink = scriptedSink((_r, n) =>
      n === 1 ? OK : { ok: false, status: 500, sent: 0 },
    );
    const r = await executeOa(base({ sink, chunkSize: 500 }));

    expect(r.counters.sent).toBe(500);
    // page size is 500 member rows ⇒ the first page ends at index 499
    expect(r.resume.afterId).toBe('499');
    expect(r.resume.nextChunkIndex).toBe(1);
  });

  it('🔴 D2 — one retry key never covers two DIFFERENT sets of people', async () => {
    /* Measured on the old code: run 1 sent `run1:h1:0` carrying U0-U499 and
       stopped; the resumed run restarted numbering and sent `run1:h1:0`
       carrying U500-U999. LINE recognises a key it already recorded, answers
       409, and 409 counts as delivered — so 500 people were marked sent having
       received nothing.

       ⚠️ The invariant is NOT "a key is never reused". Re-sending the SAME
       people under the SAME key is exactly what the key is for — that is an
       idempotent retry. What must never happen is one key covering two
       different groups. คีย์เดิมกับคนกลุ่มเดิม = ถูกต้อง · คีย์เดิมกับคนละกลุ่ม = หายนะ. */
    const byKey = new Map<string, string>();
    const record = (key: string, to: readonly string[]) => {
      const people = [...to].sort().join(',');
      const seen = byKey.get(key);
      if (seen !== undefined) expect(people).toBe(seen);
      byKey.set(key, people);
    };

    const first = scriptedSink((req, n) => {
      record(req.retryKey, req.chunk.to);
      return n === 1 ? OK : { ok: false, status: 429, sent: 0 };
    });
    const r1 = await executeOa(base({ sink: first, chunkSize: 500 }));
    expect(r1.stoppedBy).toBe('rate-limited');

    const second = scriptedSink((req) => {
      record(req.retryKey, req.chunk.to);
      return OK;
    });
    await executeOa(
      base({
        sink: second,
        chunkSize: 500,
        resume: r1.resume,
        pager: arrayPager({ h1: ids(1200) }),
      }),
    );

    // ทุกคนใน 1,200 ต้องถูกครอบคลุมครบ และไม่มีคีย์ไหนถือคนละกลุ่ม
    const everyone = new Set<string>();
    for (const people of byKey.values()) {
      for (const p of people.split(',')) everyone.add(p);
    }
    expect(everyone.size).toBe(1200);
    /* ⚠️ This used to read `byKey.get('run1:h1:0')`. The key is no longer
       `run:hook:<index>` but `run:hook:<who is in it>` (`audienceFingerprint`),
       because an index is stable and MEMBERSHIP is not — see the D4 case below.
       The two things this case must still prove are unchanged: more than one
       key was used, and no key names two groups. The `record()` guard above
       enforces the second on every single call, which is stronger than the
       literal it replaces. */
    expect(byKey.size).toBeGreaterThan(1);
    const firstGroup = [...byKey.entries()].find(([, who]) =>
      who.startsWith('U0,'),
    );
    /* ⚠️ WAS `/^run1:h1:\d+$/` — the readable form LINE REJECTS. A real send
       came back `HTTP 400 - The value for the 'X-Line-Retry-Key' parameter is
       invalid`, so the key is now a deterministic UUID built from those same
       parts. รูปแบบที่อ่านง่าย ไม่สำคัญเท่ารูปแบบที่ LINE รับ. */
    expect(firstGroup?.[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('🔴 D1+D2 — every recipient is covered exactly once across a restart', async () => {
    const delivered: string[] = [];
    const firstRun = scriptedSink((req, n) => {
      if (n === 1) {
        delivered.push(...req.chunk.to);
        return OK;
      }
      return { ok: false, status: 429, sent: 0 };
    });
    const r1 = await executeOa(base({ sink: firstRun, chunkSize: 500 }));

    const rest = scriptedSink((req) => {
      delivered.push(...req.chunk.to);
      return OK;
    });
    await executeOa(
      base({
        sink: rest,
        chunkSize: 500,
        resume: r1.resume,
        pager: arrayPager({ h1: ids(1200) }),
      }),
    );

    expect(new Set(delivered).size).toBe(1200); // ครบทุกคน
    expect(delivered).toHaveLength(1200); // และไม่มีใครได้ซ้ำ
  });

  it('a run that finishes cleanly still reports where it ended', async () => {
    const sink = new DryRunChunkSink();
    const r = await executeOa(base({ sink }));
    expect(r.counters.sent).toBe(1200);
    expect(r.stoppedBy).toBeUndefined();
    expect(r.resume.nextChunkIndex).toBe(3);
    /* 🔴 The TAIL cursor, which nothing pinned: the last page ends at row
       1199 and the end-of-list page (`lastId: null`) adds no cursor of its
       own. A tail that committed anything else — a stale cursor, or the read
       point instead of the committed one — would re-send or skip the last
       200 people on a resume. หางลิสต์ต้องคอมมิตที่แถวสุดท้ายจริง ๆ. */
    expect(r.resume.afterId).toBe('1199');
  });
});
/**
 * A LINE THAT REMEMBERS ITS RETRY KEYS — the only fake that can see D3/D4.
 * ===========================================================================
 * `scriptedSink` answers per call and forgets, so a key reused for a DIFFERENT
 * group of people looks exactly like a healthy retry. This one keeps LINE's
 * side of the bargain instead:
 *   · a key it has already recorded answers 409 (what LINE really does), and
 *     if that repeat carries different people it is written to `violations`
 *   · `received` counts who actually got a message, so "counted as sent" and
 *     "was sent" can be told apart — the whole point of both defects
 * แกล้งเป็น LINE ที่จำ retryKey ได้ ไม่งั้นบั๊กสองตัวนี้มองไม่เห็น.
 */
interface KeyMemorySink extends BroadcastChunkSink {
  readonly calls: ChunkSendRequest[];
  /** key → the exact people it was first recorded with. */
  readonly recorded: Map<string, string>;
  /** One entry per time a key came back carrying a DIFFERENT set of people. */
  readonly violations: string[];
  /** LINE user id → how many messages that person actually received. */
  readonly received: Map<string, number>;
}

function lineWithKeyMemory(
  opts: {
    /** Which call numbers LINE refuses. 1-based, across every run sharing it. */
    readonly failsOnCall?: readonly number[];
    /**
     * ⚠️ Did LINE RECORD the key of a call it failed? Both answers happen: a
     * 400 never reaches the ledger, while a timeout after LINE stored the key
     * does. The second is the case D4 was measured on. คีย์ถูกจดแม้เราเห็น error.
     */
    readonly recordOnFailure?: boolean;
  } = {},
): KeyMemorySink {
  const calls: ChunkSendRequest[] = [];
  const recorded = new Map<string, string>();
  const violations: string[] = [];
  const received = new Map<string, number>();

  return {
    calls,
    recorded,
    violations,
    received,
    send(req) {
      calls.push(req);
      const people = [...req.chunk.to].sort().join(',');
      const seen = recorded.get(req.retryKey);
      if (seen !== undefined) {
        if (seen !== people) {
          violations.push(`${req.retryKey}: [${seen}] then [${people}]`);
        }
        return Promise.resolve({ ok: false, status: 409, sent: 0 });
      }
      if (opts.failsOnCall?.includes(calls.length) === true) {
        if (opts.recordOnFailure === true) recorded.set(req.retryKey, people);
        return Promise.resolve({ ok: false, status: 500, sent: 0 });
      }
      recorded.set(req.retryKey, people);
      for (const u of req.chunk.to) received.set(u, (received.get(u) ?? 0) + 1);
      return Promise.resolve({ ok: true, sent: req.chunk.to.length });
    },
  };
}

/** Six people, two per chunk, two per page — the shape both audits measured. */
const six = (over: Partial<Parameters<typeof executeOa>[0]> = {}) =>
  base({
    chunkSize: 2,
    pageSize: 2,
    pager: arrayPager({ h1: ids(6) }),
    plan: oaPlan(6, 3),
    counters: { ...EMPTY_COUNTERS, targeted: 6, unsent: 6 },
    ...over,
  });

describe('executeOa — the cursor may never step over an unsent chunk', () => {
  it('🔴 D3 — a later SUCCESS must not consume the FAILED chunk’s people', async () => {
    /* MEASURED on the old code: U0-U5, chunks of 2, pages of 2, chunk 1 fails
       while 0 and 2 succeed ⇒ resume `{afterId:'3', nextChunkIndex:3}`. '3' is
       U2/U3's page cursor and LINE never accepted U2/U3, so the resumed run
       asks for `_id > '3'` and those two are skipped FOREVER, while U4/U5 are
       read and sent a second time. The failed chunk was already shifted off the
       ready queue, but its people were still at the FRONT of the segment queue,
       so the next accepted chunk spent them. `MAX_CONSECUTIVE_FAILURES` is 5,
       so chunks after a failure really are attempted — this is not a rare path.
       ก้อนที่ล้มยังนั่งอยู่หัวคิว ก้อนถัดไปที่สำเร็จเลยกินคนของมันไป. */
    const line = lineWithKeyMemory({ failsOnCall: [2] });
    const r = await executeOa(six({ sink: line }));

    expect(r.counters.sent).toBe(4);
    expect(r.counters.failed).toBe(2);
    // The promise may not reach past the last chunk LINE actually accepted.
    expect(r.resume.afterId).toBe('1');
    expect(r.resume.nextChunkIndex).toBe(1);
  });

  it('🔴 D3 — nobody is lost, and nobody is messaged twice, across the restart', async () => {
    /* The same LINE serves both runs, so its retry-key ledger is the real one.
       Under the old cursor the resumed run began at U4: U2/U3 were never sent
       to by anybody, and U4/U5 received the card a second time under a fresh
       key. คนหายสองคน คนได้ซ้ำสองคน จากบั๊กเดียว. */
    const line = lineWithKeyMemory({ failsOnCall: [2] });
    const r1 = await executeOa(six({ sink: line }));
    await executeOa(six({ sink: line, resume: r1.resume }));

    expect(line.violations).toEqual([]);
    for (const u of ids(6)) {
      expect([u, line.received.get(u) ?? 0]).toEqual([u, 1]);
    }
  });

  it('🔴 D4 — a key recorded for one group is never reused for another', async () => {
    /* MEASURED: U0-U5 in ONE page, chunks of 2. Chunk 0 lands; chunks 1 and 2
       fail AFTER LINE recorded their keys. The page is not spent, so the run
       resumes at `{afterId:null, nextChunkIndex:1}`. U2 then unfollows — which
       `resume.ts` documents as EXPECTED, the audience is live — so the resumed
       run re-forms its chunks over five people: index 1 now carries U0/U1 and
       index 2 carries U3/U4, under keys LINE already holds for other groups.
       Both answer 409, `accepted()` counts 409 as delivered, and U3/U4 are
       recorded as sent having received nothing. คีย์เดิม คนละกลุ่ม = คนหาย. */
    const line = lineWithKeyMemory({
      failsOnCall: [2, 3],
      recordOnFailure: true,
    });
    const r1 = await executeOa(
      six({ sink: line, pageSize: 6, pager: arrayPager({ h1: ids(6) }) }),
    );
    expect(r1.resume).toEqual({
      hookId: 'h1',
      afterId: null,
      nextChunkIndex: 1,
    });

    const stillHere = ['U0', 'U1', 'U3', 'U4', 'U5']; // U2 unfollowed
    await executeOa(
      six({
        sink: line,
        pageSize: 6,
        resume: r1.resume,
        pager: arrayPager({ h1: stillHere }),
        plan: oaPlan(5, 3),
        counters: { ...EMPTY_COUNTERS, targeted: 5, unsent: 5 },
      }),
    );

    expect(line.violations).toEqual([]);
    // Everyone still in the audience got it exactly once — U0/U1 in run 1,
    // U3/U4/U5 in run 2. The one who left got nothing more, which is correct.
    for (const u of stillHere) {
      expect([u, line.received.get(u) ?? 0]).toEqual([u, 1]);
    }
  });

  it('🔴 the key names the SET of people — order cannot defeat a retry', () => {
    /* A retry that re-formed the same people in another order must still be
       recognised by LINE, or the whole chunk is delivered twice; and one
       different member must produce a different key, or the 409 covers people
       who never received anything. คีย์ = "กลุ่มคนนี้" ไม่ใช่ "ลำดับนี้". */
    const abc = audienceFingerprint(['U1', 'U2', 'U3']);
    expect(audienceFingerprint(['U3', 'U1', 'U2'])).toBe(abc);
    expect(audienceFingerprint(['U1', 'U2', 'U9'])).not.toBe(abc);
    expect(audienceFingerprint(['U1', 'U2'])).not.toBe(abc);
    expect(audienceFingerprint(['U1'])).not.toBe(audienceFingerprint(['U2']));
    /* And the separator cannot be forged: one id that CONTAINS the separator
       must not look like the two ids it joins. LINE ids never do, but a key
       that trusts its input is one bad row away from handing two groups the
       same key — and this one is bought with a single number. */
    expect(audienceFingerprint(['U1\u0000U2'])).not.toBe(
      audienceFingerprint(['U1', 'U2']),
    );
  });

  it('🔴 the key spends all 52 bits, not just the top 32', () => {
    /* WIDTH IS A SAFETY PROPERTY HERE, not a style one: a collision means two
       different groups share one key, LINE answers 409 to the second, and that
       group is recorded as delivered having received nothing — the exact
       failure this key exists to prevent. Narrowing it to one 32-bit seed
       survived every behavioural case (no honest test corpus is large enough
       to collide 32 bits), so it is pinned directly: with a single seed every
       value would be a multiple of 2^20. ความกว้างของ hash คือความปลอดภัย. */
    const low = ids(64).map((u) => audienceFingerprint([u]) % 0x100000);
    expect(low.some((n) => n !== 0)).toBe(true);
    // …and it must still be a safe integer, or `buildChunkRetryKey` refuses it
    // and the OA stops with `no-retry-key` instead of sending.
    for (const u of ids(8)) {
      expect(Number.isSafeInteger(audienceFingerprint([u]))).toBe(true);
    }
  });
});

describe('executeOa — resume', () => {
  it('reports where it stopped, so the next round starts there', async () => {
    const sink = scriptedSink((_r, n) =>
      n === 2 ? { ok: false, status: 429, sent: 0 } : OK,
    );
    const r = await executeOa(base({ sink }));
    expect(r.resume.nextChunkIndex).toBeGreaterThan(0);
    expect(r.resume.afterId).not.toBeNull();
  });

  it('a fresh point starts at the beginning', () => {
    expect(FRESH_RESUME('h1')).toEqual({
      hookId: 'h1',
      afterId: null,
      nextChunkIndex: 0,
    });
  });

  it('heartbeats after every chunk, so a long run keeps its claim', async () => {
    const beats: number[] = [];
    await executeOa(
      base({ heartbeat: (p) => void beats.push(p.nextChunkIndex) }),
    );
    expect(beats).toEqual([1, 2, 3]);
  });
});

describe('executeRun — every OA, one after another', () => {
  const cell = SEND_MATRIX['multicast:plain'];

  it('walks two OAs in sequence and totals them', async () => {
    const plan = planRun({ cell, recipientsByOa: [600, 600] });
    const sink = new DryRunChunkSink();
    const r = await executeRun({
      runId: 'run1',
      cell,
      hookIds: ['h1', 'h2'],
      plan,
      pager: arrayPager({ h1: ids(600, 'A'), h2: ids(600, 'B') }),
      sink,
      clock: fixedClock(),
      matched: 1200,
      targeted: 1200,
    });

    expect(r.counters.sent).toBe(1200);
    expect(r.summary.status).toBe('success');
    expect(new Set(sink.log.map((e) => e.hookId))).toEqual(
      new Set(['h1', 'h2']),
    );
  });

  it('keeps a separate retry key per OA — same index, different channel', async () => {
    const plan = planRun({ cell, recipientsByOa: [100, 100] });
    const sink = new DryRunChunkSink();
    await executeRun({
      runId: 'run1',
      cell,
      hookIds: ['h1', 'h2'],
      plan,
      pager: arrayPager({ h1: ids(100, 'A'), h2: ids(100, 'B') }),
      sink,
      clock: fixedClock(),
      matched: 200,
      targeted: 200,
    });
    const keys = sink.log.map((e) => e.retryKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('🔴 reports each OA’s OWN numbers — one history row is made from each', async () => {
    /* A single accumulator threaded through every OA makes the run total right
       and every per-OA row wrong. `broadcasts_histories` keeps one row per OA,
       so "how did OA #2 do?" must be answerable. */
    const plan = planRun({ cell, recipientsByOa: [600, 200] });
    const sink = scriptedSink((req) =>
      req.hookId === 'h2' ? { ok: false, sent: 0 } : OK,
    );
    const r = await executeRun({
      runId: 'run1',
      cell,
      hookIds: ['h1', 'h2'],
      plan,
      pager: arrayPager({ h1: ids(600, 'A'), h2: ids(200, 'B') }),
      sink,
      clock: fixedClock(),
      matched: 800,
      targeted: 800,
    });

    expect(r.perOa.map((o) => o.hookId)).toEqual(['h1', 'h2']);
    expect(r.perOa[0]?.counters).toMatchObject({
      sent: 600,
      failed: 0,
      targeted: 600,
    });
    expect(r.perOa[1]?.counters).toMatchObject({
      sent: 0,
      failed: 200,
      targeted: 200,
    });
    // และยอดรวมยังต้องถูกด้วย
    expect(r.counters.sent).toBe(600);
    expect(r.counters.failed).toBe(200);
    expect(r.counters.targeted).toBe(800);
    expect(r.summary.status).toBe('partial');
  });

  it('sends nothing when the plan refused the run', async () => {
    const plan = planRun({ cell, recipientsByOa: [Number.NaN] });
    const sink = new DryRunChunkSink();
    const r = await executeRun({
      runId: 'run1',
      cell,
      hookIds: ['h1'],
      plan,
      pager: arrayPager({ h1: ids(10) }),
      sink,
      clock: fixedClock(),
      matched: 0,
      targeted: 0,
    });
    expect(sink.requests).toBe(0);
    expect(r.summary.status).toBe('refused');
  });

  it('carries on past an OA the plan skipped, and names it', async () => {
    const plan = planRun({ cell, recipientsByOa: [0, 500] });
    const sink = new DryRunChunkSink();
    const r = await executeRun({
      runId: 'run1',
      cell,
      hookIds: ['h1', 'h2'],
      plan,
      pager: arrayPager({ h1: [], h2: ids(500, 'B') }),
      sink,
      clock: fixedClock(),
      matched: 500,
      targeted: 500,
    });
    expect(r.skippedOa).toContain(0);
    expect(sink.log.every((e) => e.hookId === 'h2')).toBe(true);
    expect(r.counters.sent).toBe(500);
  });

  it('one channel’s 429 does NOT cost the other channel its send', async () => {
    /* 🔴 The mutation that exposed this: deleting the `break` in executeRun left
       every test green, because the only stop exercised was the deadline —
       which stops the next OA by itself. LINE's limits are per channel, so h2
       must still go. 429 ของ h1 ห้ามกิน h2. */
    const clock = fixedClock();
    const plan = planRun({ cell, recipientsByOa: [600, 600] });
    const sink = scriptedSink((req) =>
      req.hookId === 'h1' ? { ok: false, status: 429, sent: 0 } : OK,
    );
    const r = await executeRun({
      runId: 'run1',
      cell,
      hookIds: ['h1', 'h2'],
      plan,
      pager: arrayPager({ h1: ids(600, 'A'), h2: ids(600, 'B') }),
      sink,
      clock,
      matched: 1200,
      targeted: 1200,
    });

    expect(sink.calls.filter((c) => c.hookId === 'h1')).toHaveLength(1);
    expect(sink.calls.filter((c) => c.hookId === 'h2')).toHaveLength(2);
    /* ⚠️ Names the OA and the reason now, not just a position. "OA #2 stopped"
       is not something an operator can act on. บอกว่าตัวไหน และเพราะอะไร. */
    expect(r.stoppedOa).toEqual([
      { index: 0, hookId: 'h1', reason: 'rate-limited', othersContinued: true },
    ]);
    expect(r.counters.sent).toBe(600);
  });

  it('a run-wide stop ends the run — later OAs are not started', async () => {
    const clock = fixedClock();
    const plan = planRun({ cell, recipientsByOa: [600, 600] });
    const sink = scriptedSink(() => {
      clock.set(HARD_DEADLINE_MS + 1);
      return OK;
    });
    const r = await executeRun({
      runId: 'run1',
      cell,
      hookIds: ['h1', 'h2'],
      plan,
      pager: arrayPager({ h1: ids(600, 'A'), h2: ids(600, 'B') }),
      sink,
      clock,
      matched: 1200,
      targeted: 1200,
    });
    expect(r.stoppedBy).toBe('deadline');
    expect(sink.calls.every((c) => c.hookId === 'h1')).toBe(true);
    expect(r.summary.status).not.toBe('success');
    /* 🔴 The run ENDED; h2 was never started. `stoppedOa` names the OA that
       ended it and says the others did NOT carry on — the earlier version
       recorded nothing at all for a run-wide stop, so the one OA that mattered
       was the one thing the report never named.
       หยุดทั้ง run เพราะ OA ไหน ก็ต้องบอกเหมือนกัน. */
    expect(r.stoppedOa).toEqual([
      { index: 0, hookId: 'h1', reason: 'deadline', othersContinued: false },
    ]);
    expect(r.stoppedOa.map((s) => s.hookId)).not.toContain('h2');
  });
});

describe('a stop names the OA, and the others carry on', () => {
  const cell = SEND_MATRIX['multicast:plain'];

  it('🔴 quota exhausted on one OA skips ONLY that OA', async () => {
    /* LINE's limits are per channel, so h1 running out says nothing about h2's
       quota. โควตาหมดของ OA หนึ่ง ไม่ใช่โควตาหมดของทุก OA. */
    const clock = fixedClock();
    const plan = planRun({ cell, recipientsByOa: [600, 600, 600] });
    const sink = scriptedSink((req) =>
      req.hookId === 'h2' ? { ok: false, status: 429, sent: 0 } : OK,
    );
    const stops: unknown[] = [];
    const r = await executeRun({
      runId: 'run1',
      cell,
      hookIds: ['h1', 'h2', 'h3'],
      plan,
      pager: arrayPager({
        h1: ids(600, 'A'),
        h2: ids(600, 'B'),
        h3: ids(600, 'C'),
      }),
      sink,
      clock,
      matched: 1800,
      targeted: 1800,
      onOaStopped: (s) => void stops.push(s),
    });

    // h1 finished, h3 still ran — only h2 stopped
    expect(sink.calls.filter((c) => c.hookId === 'h1').length).toBeGreaterThan(
      0,
    );
    expect(sink.calls.filter((c) => c.hookId === 'h3').length).toBeGreaterThan(
      0,
    );
    expect(r.stoppedOa).toEqual([
      { index: 1, hookId: 'h2', reason: 'rate-limited', othersContinued: true },
    ]);
  });

  it('🔴 tells the caller the moment it happens, not only at the end', () => {
    /* The returned object is read after everything is over. An operator wants
       to know WHICH OA stopped WHILE the run is still going. */
    const clock = fixedClock();
    /* ⚠️ 600 each, not 100. With 100 the OA has exactly ONE chunk, so a 429 on
       it is followed by an empty list — the guard is asked BEFORE a send, and
       there is no next send to ask about. The OA finishes rather than stops,
       which is correct and made my first version of this test fail for the
       wrong reason. รายชื่อหมดพอดี ≠ ถูกหยุด. */
    const plan = planRun({ cell, recipientsByOa: [600, 600] });
    const sink = scriptedSink((req) =>
      req.hookId === 'h1' ? { ok: false, status: 429, sent: 0 } : OK,
    );
    const seen: string[] = [];
    return executeRun({
      runId: 'run1',
      cell,
      hookIds: ['h1', 'h2'],
      plan,
      pager: arrayPager({ h1: ids(600, 'A'), h2: ids(600, 'B') }),
      sink,
      clock,
      matched: 1200,
      targeted: 1200,
      onOaStopped: (s) => void seen.push(`${s.hookId}:${s.reason}`),
    }).then(() => {
      expect(seen).toEqual(['h1:rate-limited']);
    });
  });

  it('every reason it can report is a distinct, actionable word', () => {
    // `failed` alone cannot tell a quota apart from a broken pager.
    const reasons = [
      'rate-limited',
      'oa-max-requests',
      'oa-max-recipients',
      'run-max-requests',
      'deadline',
      'consecutive-failures',
      'no-retry-key',
      'overflow',
      'stalled-pager',
      'pager-not-advancing',
      'disabled',
    ];
    expect(new Set(reasons).size).toBe(reasons.length);
  });
});

describe('DryRunChunkSink — the preview walks the same code as the send', () => {
  it('reports the request and recipient count without sending', async () => {
    const sink = new DryRunChunkSink();
    await executeOa(base({ sink }));
    expect(sink.requests).toBe(3);
    expect(sink.recipients).toBe(1200);
  });

  it('never rejects, whatever it is handed', async () => {
    const sink = new DryRunChunkSink();
    await expect(
      sink.send({
        chunk: { index: 0, to: [] },
        retryKey: 'k',
        hookId: 'h',
        runId: 'r',
      }),
    ).resolves.toEqual({ ok: true, sent: 0 });
  });
});
