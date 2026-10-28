/**
 * [FEAT-20260822-BCASTLIMITS] The contracts phase 1 must ship so phase 4 is a
 * swap and not a rewrite — pinned here, red-first.
 *
 * Nothing under test touches Mongo, HTTP or the clock, so this suite needs no
 * fixture and no module graph.
 */
import {
  BROADCAST_FALLBACK_IMAGE_URL,
  BROADCAST_VAR_EMPTY,
  checkProfileMatch,
  isUsableImageUrl,
  needsPerRecipient,
  normalizeEmpties,
  normalizeEmptyValue,
  perRecipientTags,
  safeImageUrl,
} from '@/modules/content';
import {
  EMPTY_OA_GUARD_STATE,
  EMPTY_RUN_GUARD_STATE,
  HARD_DEADLINE_MS,
  HARD_MAX_RECIPIENTS_PER_OA,
  HARD_MAX_REQUESTS_PER_OA,
  HARD_MAX_REQUESTS_PER_RUN,
  PER_RECIPIENT_PREFIXES,
  RUN_TIME_ALLOWANCE_SEC,
  SERVER_RESERVE,
  cellKey,
  checkOaGuard,
  collectTags,
  computeLeaseMs,
  isEmptyForBroadcast,
  listSelectableProfiles,
  manualTrigger,
  mustRecheckCeiling,
  schedulerTrigger,
  CATCH_UP_MISSED_ROUNDS,
  CHECKS,
  MAX_CONCURRENT_RUNS_GLOBAL,
  MAX_RUNS_PER_JOB_PER_HOUR,
  MAX_RUNS_PER_USER_PER_HOUR,
  MIN_SECONDS_BETWEEN_RUNS,
  checkAbuse,
  checkJobCreationFlood,
  MAX_JOBS_CREATED_PER_USER_PER_HOUR,
  MAX_CONSECUTIVE_FAILURES,
  checkRunGuard,
  SEND_MATRIX,
  cellFitsBudget,
  listSendCells,
  requestsPerOaFor,
  resolveSendCell,
  MAX_PARALLEL_OA,
  MAX_PARALLEL_PER_OA,
  MONGO_MAX_POOL_MIRROR,
  canRun,
  planRun,
  poolBudget,
  ChunkAccumulator,
  LINE_MULTICAST_MAX_TO,
  MAX_REQUESTS_PER_RUN,
  P99_MS,
  SEND_PROFILES,
  buildChunkRetryKey,
  chunkRecipients,
  computeMaxRequests,
  getSendProfile,
  projectedRunMs,
  requestsFor,
} from '@/modules/content';

describe('limits — the budget must stay inside its own formula', () => {
  it('the pinned budget never exceeds what the formula allows', () => {
    // ⚠️ This is the guard that catches "someone updated P99_MS from stg and
    //    forgot the budget". Red here means recompute, not bump the number.
    expect(MAX_REQUESTS_PER_RUN).toBeLessThanOrEqual(computeMaxRequests());
  });

  it('keeps at least the 30% reserve the owner asked for', () => {
    const worstMs = projectedRunMs(MAX_REQUESTS_PER_RUN);
    const allowanceMs = 600 * 1000;
    expect(worstMs / allowanceMs).toBeLessThanOrEqual(0.7);
  });

  it('refuses to answer on nonsense input instead of throwing', () => {
    expect(computeMaxRequests(0)).toBe(0);
    expect(computeMaxRequests(P99_MS, 600, 1)).toBe(0);
  });

  it('the lease outlives the worst-case run — otherwise recovery re-sends', () => {
    expect(computeLeaseMs()).toBeGreaterThan(
      projectedRunMs(MAX_REQUESTS_PER_RUN),
    );
    expect(computeLeaseMs()).toBeGreaterThanOrEqual(20 * 60 * 1000);
  });
});

describe('send profiles — the ticked type carries its own ceiling', () => {
  it('plain spends one request per 500 people, personal one per person', () => {
    expect(requestsFor(SEND_PROFILES.plain, 10_000)).toBe(20);
    expect(requestsFor(SEND_PROFILES.personal, 300)).toBe(300);
    expect(requestsFor(SEND_PROFILES.plain, 0)).toBe(0);
  });

  it('a personalised run cannot outlive the request budget', () => {
    /* ⚠️ REWRITTEN — the old version could not fail. `send-profile.registry.ts`
       defines `personal.max_recipients` AS `MAX_REQUESTS_PER_RUN`, so
       `expect(a).toBe(a)`; and `requestsFor(personal, N)` returns `N`, so the
       second half reduced to `x <= x`. Changing the budget to 1 or to a
       million left it green. An independent reviewer caught it.
       เอาค่าเดียวกันมาเทียบกับตัวเอง = เทสที่ไม่มีวันแดง.

       The real promise is about ARITHMETIC, not identity: one personalised
       recipient costs one request, so the headcount ceiling and the request
       budget must be the same number — and a ceiling ABOVE the budget would
       plan a run that cannot finish inside its allowance. */
    const budget = computeMaxRequests(
      P99_MS,
      RUN_TIME_ALLOWANCE_SEC,
      SERVER_RESERVE,
    );
    expect(requestsFor(SEND_PROFILES.personal, 7)).toBe(7);
    expect(requestsFor(SEND_PROFILES.personal, 300)).toBe(300);
    expect(SEND_PROFILES.personal.max_recipients).toBeLessThanOrEqual(budget);

    /* ⚠️ The floor is LOOSE on purpose. `MAX_REQUESTS_PER_RUN` is 300, a policy
       number rounded well below the measured budget (343 at p99 = 1,223 ms) —
       that headroom is deliberate, so a tight floor would fail every time
       somebody sensibly rounds down. Half the budget only catches a ceiling
       set to something absurd like 1. เพดานต่ำกว่าที่วัดได้ = ตั้งใจ ไม่ใช่บั๊ก. */
    expect(SEND_PROFILES.personal.max_recipients).toBeGreaterThan(budget * 0.5);
  });

  it('plain at its ceiling leaves most of the budget unused', () => {
    const used = requestsFor(
      SEND_PROFILES.plain,
      SEND_PROFILES.plain.max_recipients,
    );
    expect(used / MAX_REQUESTS_PER_RUN).toBeLessThan(0.1);
  });

  it('only the personalised profile may carry per-recipient tags', () => {
    expect(SEND_PROFILES.plain.allows_tags).not.toContain('member.*');
    expect(SEND_PROFILES.personal.allows_tags).toContain('member.*');
    expect(SEND_PROFILES.personal.allows_tags).toContain('profile.*');
  });

  it('an unknown type is null, never a silent default', () => {
    expect(getSendProfile('nope')).toBeNull();
    expect(getSendProfile(undefined)).toBeNull();
    expect(getSendProfile('plain')).not.toBeNull();
  });
});

describe('chunking — the unit a queue will later consume', () => {
  const ids = (n: number, p = 'U') =>
    Array.from({ length: n }, (_, i) => p + String(i).padStart(4, '0'));

  it("fills to LINE's limit and numbers chunks from zero", () => {
    const out = chunkRecipients(ids(1200));
    expect(out.map((c) => c.to.length)).toEqual([500, 500, 200]);
    expect(out.map((c) => c.index)).toEqual([0, 1, 2]);
  });

  it('drops duplicates — LINE refuses a repeated id in one request', () => {
    const out = chunkRecipients(['U1', 'U1', 'U2']);
    expect(out[0]?.to).toEqual(['U1', 'U2']);
  });

  it('drops blanks and non-strings without throwing', () => {
    const out = chunkRecipients(['U1', '', '   ', null, 7, undefined, 'U2']);
    expect(out[0]?.to).toEqual(['U1', 'U2']);
  });

  it('streams: one chunk in memory at a time, counted not measured', () => {
    const acc = new ChunkAccumulator(2);
    const emitted = [] as number[];
    for (const id of ids(5)) {
      const c = acc.push(id);
      if (c) emitted.push(c.to.length);
    }
    const tail = acc.flush();
    expect(emitted).toEqual([2, 2]);
    expect(tail?.to.length).toBe(1);
    expect(acc.chunkCount).toBe(3);
    expect(acc.acceptedCount).toBe(5);
  });

  it('an empty stream produces no chunk at all', () => {
    expect(chunkRecipients([])).toEqual([]);
    expect(new ChunkAccumulator().flush()).toBeNull();
  });

  it("the default size is LINE's documented cap", () => {
    expect(LINE_MULTICAST_MAX_TO).toBe(500);
  });
});

describe('retry key — the same chunk always gets the same key', () => {
  it('is reproducible for the same run, OA and chunk', () => {
    /* ⚠️ WAS `toBe('run1:hookA:7')` — readable, stable, and REJECTED BY LINE.
       The first real send came back four times with
       `HTTP 400 - The value for the 'X-Line-Retry-Key' parameter is invalid`.
       The key must be a UUID; it is now a v5-shaped hash of that same logical
       string, so it stays deterministic. รูปแบบอ่านง่ายไม่สำคัญเท่ารูปแบบที่ LINE รับ. */
    const UUID =
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(buildChunkRetryKey('run1', 'hookA', 7)).toMatch(UUID);
    expect(buildChunkRetryKey('run1', 'hookA', 7)).toBe(
      buildChunkRetryKey('run1', 'hookA', 7),
    );
  });

  it('changes when any part changes', () => {
    const base = buildChunkRetryKey('run1', 'hookA', 7);
    expect(buildChunkRetryKey('run2', 'hookA', 7)).not.toBe(base);
    expect(buildChunkRetryKey('run1', 'hookB', 7)).not.toBe(base);
    expect(buildChunkRetryKey('run1', 'hookA', 8)).not.toBe(base);
  });

  it('refuses an object id instead of stringifying it to [object Object]', () => {
    // Two different runs would otherwise collide on one key and LINE would
    // silently drop the second as a duplicate.
    expect(buildChunkRetryKey({}, 'hookA', 0)).toBeNull();
    expect(buildChunkRetryKey('run1', { id: 1 }, 0)).toBeNull();
    // A number is fine — it names something unambiguously.
    // numbers are accepted as ids; the key is a UUID either way
    expect(buildChunkRetryKey(12, 34, 0)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('returns null rather than a half-formed key', () => {
    expect(buildChunkRetryKey('', 'hookA', 0)).toBeNull();
    expect(buildChunkRetryKey('run1', '', 0)).toBeNull();
    expect(buildChunkRetryKey('run1', 'hookA', -1)).toBeNull();
    expect(buildChunkRetryKey('run1', 'hookA', 1.5)).toBeNull();
    expect(buildChunkRetryKey('run1', 'hookA', '3')).toBeNull();
  });
});

describe('empty values — LINE cannot send an empty string', () => {
  it('turns every empty marker into N/A', () => {
    expect(BROADCAST_VAR_EMPTY).toBe('N/A');
    for (const v of ['', '   ', '-', null, undefined]) {
      expect(normalizeEmptyValue(v)).toBe('N/A');
    }
  });

  it('leaves a real value alone', () => {
    expect(normalizeEmptyValue('Bangkok Bank')).toBe('Bangkok Bank');
    expect(normalizeEmptyValue(0)).toBe('0');
  });

  it('normalises a whole map and never emits an empty string', () => {
    const out = normalizeEmpties({
      'profile.bank_code': '',
      hook_domain: '',
      content: '-',
      'member.display_name': 'judy',
    });
    expect(out).toEqual({
      'profile.bank_code': 'N/A',
      hook_domain: 'N/A',
      content: 'N/A',
      'member.display_name': 'judy',
    });
    expect(Object.values(out).some((v) => v === '')).toBe(false);
  });
});

describe('image url shape — the failure that costs the whole card', () => {
  it('accepts a real https image url', () => {
    expect(isUsableImageUrl('https://cdn.example.com/a.png')).toBe(true);
  });

  it('rejects every shape LINE answers 400 for', () => {
    for (const bad of [
      '',
      '   ',
      '-',
      'http://cdn.example.com/a.png',
      'https://{{promo_img}}',
      'cdn.example.com/a.png',
      'https://',
      'https://nodot/a.png',
      null,
      42,
      'https://x.co/' + 'a'.repeat(2100),
    ]) {
      expect(isUsableImageUrl(bad as never)).toBe(false);
    }
  });

  it('always hands back something sendable', () => {
    expect(safeImageUrl('')).toBe(BROADCAST_FALLBACK_IMAGE_URL);
    expect(safeImageUrl('https://cdn.example.com/a.png')).toBe(
      'https://cdn.example.com/a.png',
    );
  });

  it('the fallback picture itself passes the check', () => {
    // A fallback that fails our own rule would break exactly what it guards.
    expect(isUsableImageUrl(BROADCAST_FALLBACK_IMAGE_URL)).toBe(true);
  });
});

describe('profile match — the tick decides, this catches the silent mistake', () => {
  const plainCard = { type: 'text', text: 'เข้าเว็บ {{hook_domain}} ได้เลย' };
  const personalCard = {
    type: 'text',
    text: 'สวัสดีคุณ {{member.display_name}}',
  };

  it('finds the tags that differ per person', () => {
    expect(needsPerRecipient(plainCard)).toBe(false);
    expect(needsPerRecipient(personalCard)).toBe(true);
    expect(perRecipientTags({ a: '{{profile.bank_code}}' })).toEqual([
      'profile.bank_code',
    ]);
  });

  it('refuses plain + per-recipient card, and names the tags', () => {
    const v = checkProfileMatch(personalCard, false);
    expect(v.kind).toBe('refuse');
    expect(v.kind === 'refuse' && v.tags).toEqual(['member.display_name']);
  });

  it('flags a personalised send that buys nothing', () => {
    expect(checkProfileMatch(plainCard, true).kind).toBe('wasteful');
  });

  it('passes when the tick matches the card', () => {
    expect(checkProfileMatch(plainCard, false).kind).toBe('ok');
    expect(checkProfileMatch(personalCard, true).kind).toBe('ok');
  });

  it('survives a card it cannot read', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => needsPerRecipient(circular)).not.toThrow();
    expect(needsPerRecipient(circular)).toBe(false);
  });
});

describe('parallel across OAs — LINE allows it, the server must survive it', () => {
  it('🔴 the WORST CASE multiplies runs x OAs — not one run in isolation', () => {
    // Review caught this: 3 concurrent runs x 5 OAs was 15 of 40 connections
    // (37.5%), nearly double the owner's 20%. The product is what must fit.
    const worstCase =
      MAX_CONCURRENT_RUNS_GLOBAL * MAX_PARALLEL_OA * MAX_PARALLEL_PER_OA;
    expect(worstCase).toBeLessThanOrEqual(poolBudget());
    expect(worstCase / MONGO_MAX_POOL_MIRROR).toBeLessThanOrEqual(0.2);
  });

  it('stays at one request at a time within a single OA (one channel)', () => {
    expect(MAX_PARALLEL_PER_OA).toBe(1);
  });
});

describe('run plan — a ceiling per OA, and a ceiling for the run', () => {
  const plainCell = SEND_MATRIX['multicast:plain'];
  const personalCell = SEND_MATRIX['multicast:personal'];
  const bcastCell = SEND_MATRIX['broadcast:plain'];

  it('5 plain OAs: 100 requests sent, 60 deep — depth is what costs time', () => {
    const p = planRun({
      cell: plainCell,
      recipientsByOa: Array(5).fill(10_000),
    });
    expect(p.requestsPerOa).toBe(20);
    expect(p.totalRequests).toBe(100);
    expect(p.waves).toBe(3); // MAX_PARALLEL_OA is 2
    expect(p.depth).toBe(60);
    expect(canRun(p)).toBe(true);
  });

  it('2 personalised OAs fit in one wave and use the whole budget', () => {
    const p = planRun({ cell: personalCell, recipientsByOa: [300, 300] });
    expect(p.waves).toBe(1);
    expect(p.depth).toBe(300);
    expect(p.totalRequests).toBe(600);
    expect(canRun(p)).toBe(true);
  });

  it('🔴 ONE oversized OA is skipped — the others keep their campaign', () => {
    // This is the rule the first version broke: it judged the whole run on its
    // largest OA and refused everything.
    const p = planRun({ cell: personalCell, recipientsByOa: [400, 200] });
    expect(p.perOa[0]?.sendable).toBe(false);
    expect(p.perOa[0]?.skipReason).toBe('too-many-recipients');
    expect(p.perOa[1]?.sendable).toBe(true);
    expect(p.sendableOaCount).toBe(1);
    expect(p.skippedOaCount).toBe(1);
    expect(canRun(p)).toBe(true);
  });

  it('an OA with nobody in it is skipped, not an error', () => {
    const p = planRun({ cell: plainCell, recipientsByOa: [0, 1000] });
    expect(p.perOa[0]?.skipReason).toBe('empty');
    expect(p.sendableOaCount).toBe(1);
    expect(canRun(p)).toBe(true);
  });

  it('every OA skipped means there is nothing to send', () => {
    const p = planRun({ cell: personalCell, recipientsByOa: [400, 500] });
    expect(p.sendableOaCount).toBe(0);
    expect(p.verdict.kind).toBe('nothing-to-send');
    expect(canRun(p)).toBe(false);
  });

  it('🔴 too many OAs is FATAL — silently dropping ticked OAs is not allowed', () => {
    const p = planRun({ cell: personalCell, recipientsByOa: [10, 10, 10] });
    expect(p.verdict.kind).toBe('too-many-hooks');
    expect(p.verdict.kind === 'too-many-hooks' && p.verdict.limit).toBe(2);
    expect(canRun(p)).toBe(false);
  });

  it('🔴 the matrix is now enforced: broadcast + per-person is refused', () => {
    const p = planRun({
      cell: SEND_MATRIX['broadcast:personal'],
      recipientsByOa: [100],
    });
    expect(p.verdict.kind).toBe('not-allowed');
    expect(p.verdict.kind === 'not-allowed' && p.verdict.reason).toContain(
      'multicast',
    );
    expect(canRun(p)).toBe(false);
  });

  it('broadcast costs one request per OA whatever the headcount', () => {
    const p = planRun({ cell: bcastCell, recipientsByOa: [1_000_000, 5] });
    expect(p.requestsPerOa).toBe(1);
    expect(p.totalRequests).toBe(2);
    expect(canRun(p)).toBe(true);
  });

  it('warns near the limit but still lets the run go', () => {
    const p = planRun({ cell: personalCell, recipientsByOa: [250] });
    expect(p.verdict.kind).toBe('near-limit');
    expect(canRun(p)).toBe(true);
  });

  it('an empty run costs nothing and is not an error', () => {
    const p = planRun({ cell: plainCell, recipientsByOa: [] });
    expect(p.depth).toBe(0);
    expect(p.verdict.kind).toBe('nothing-to-send');
  });

  it('🔴 refuses unreadable input instead of answering ok', () => {
    const bad = planRun({ cell: plainCell, recipientsByOa: [Number.NaN, 100] });
    expect(bad.perOa[0]?.skipReason).toBe('unreadable');
    expect(bad.sendableOaCount).toBe(1);
    const worse = planRun({
      cell: plainCell,
      recipientsByOa: 5 as unknown as number[],
    });
    expect(worse.verdict.kind).toBe('unreadable');
    expect(canRun(worse)).toBe(false);
  });
});

describe('send matrix — every type x sub-type says how it sends', () => {
  it('broadcast costs one request per OA no matter how many friends', () => {
    const cell = resolveSendCell('broadcast', 'plain');
    expect(cell?.allowed).toBe(true);
    expect(requestsPerOaFor(cell!, 1_000_000)).toBe(1);
    expect(cell?.maxRecipientsPerOa).toBeNull();
  });

  it('multicast plain packs 500 recipients per request', () => {
    const cell = resolveSendCell('multicast', 'plain')!;
    expect(requestsPerOaFor(cell, 10_000)).toBe(20);
    expect(cell.maxRecipientsPerOa).toBe(10_000);
  });

  it('multicast personal costs one request per recipient', () => {
    const cell = resolveSendCell('multicast', 'personal')!;
    expect(requestsPerOaFor(cell, 300)).toBe(300);
    expect(cell.maxRecipientsPerOa).toBe(300);
    // Deliberately narrower: each OA here spends a whole budget of depth.
    expect(cell.maxHooks).toBeLessThan(SEND_MATRIX['multicast:plain'].maxHooks);
    expect(cell.maxHooks).toBe(2); // arithmetic: ceil(2/2) x 300 = 300 = budget
  });

  it('broadcast + personal is IMPOSSIBLE and says why', () => {
    const cell = resolveSendCell('broadcast', 'personal')!;
    expect(cell.allowed).toBe(false);
    expect(cell.reason).toContain('multicast');
    expect(cell.maxHooks).toBe(0);
  });

  it('only the personalised cells may carry per-recipient tags', () => {
    expect(SEND_MATRIX['multicast:personal'].allowsTags).toContain('member.*');
    expect(SEND_MATRIX['multicast:plain'].allowsTags).not.toContain('member.*');
    expect(SEND_MATRIX['broadcast:plain'].allowsTags).not.toContain(
      'profile.*',
    );
  });

  it('an unknown combination is null, never a silent default', () => {
    expect(resolveSendCell('narrowcast', 'plain')).toBeNull();
    expect(resolveSendCell('multicast', 'nope')).toBeNull();
    expect(resolveSendCell(undefined, undefined)).toBeNull();
  });

  it('NO cell can promise more work than the budget allows', () => {
    // The guard that catches "someone raised maxHooks and forgot the depth".
    for (const cell of listSendCells()) {
      expect(cellFitsBudget(cell)).toBe(true);
    }
  });

  it('every allowed cell keeps OA parallelism inside the pool share', () => {
    for (const cell of listSendCells()) {
      expect(cell.maxParallelOa * MAX_PARALLEL_PER_OA).toBeLessThanOrEqual(
        poolBudget(),
      );
    }
  });
});

describe('safety net · per-OA — one channel, one set of limits', () => {
  const oa = (over: Partial<typeof EMPTY_OA_GUARD_STATE>) => ({
    ...EMPTY_OA_GUARD_STATE,
    ...over,
  });

  it('lets a healthy OA continue', () => {
    expect(checkOaGuard(oa({ requestsMade: 10 })).stop).toBe(false);
  });

  it('stops the moment LINE says 429 — core never retries those', () => {
    const v = checkOaGuard(oa({ sawRateLimit: true }));
    expect(v.stop && v.reason).toBe('rate-limited');
  });

  it('stops after enough chunks fail back to back', () => {
    expect(
      checkOaGuard(oa({ consecutiveFailures: MAX_CONSECUTIVE_FAILURES })).stop,
    ).toBe(true);
    expect(
      checkOaGuard(oa({ consecutiveFailures: MAX_CONSECUTIVE_FAILURES - 1 }))
        .stop,
    ).toBe(false);
  });

  it('stops an OA that blew past twice its planned request budget', () => {
    const v = checkOaGuard(oa({ requestsMade: HARD_MAX_REQUESTS_PER_OA }));
    expect(v.stop && v.reason).toBe('oa-max-requests');
  });

  it('stops an OA that reached twice the widest recipient ceiling', () => {
    const v = checkOaGuard(
      oa({ recipientsAttempted: HARD_MAX_RECIPIENTS_PER_OA }),
    );
    expect(v.stop && v.reason).toBe('oa-max-recipients');
  });

  it('🔴 does NOT stop a legal multi-OA run — the scope bug found in review', () => {
    // planRun blesses 5 OAs x 10,000 = 50,000 recipients. The per-OA guard must
    // see 10,000 per OA, not 50,000, or 30,000 customers vanish silently.
    const plan = planRun({
      cell: SEND_MATRIX['multicast:plain'],
      recipientsByOa: Array<number>(5).fill(10_000),
    });
    expect(canRun(plan)).toBe(true);
    expect(
      checkOaGuard(oa({ recipientsAttempted: 10_000, requestsMade: 20 })).stop,
    ).toBe(false);
  });

  it('🔴 fails CLOSED on a counter it cannot read', () => {
    // NaN >= anything is false, so an unhardened guard waves it through.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(checkOaGuard(oa({ requestsMade: bad })).stop).toBe(true);
      expect(checkOaGuard(oa({ recipientsAttempted: bad })).stop).toBe(true);
      expect(checkOaGuard(oa({ consecutiveFailures: bad })).stop).toBe(true);
    }
  });
});

describe('safety net · run-wide — the whole job, across every OA', () => {
  const run = (over: Partial<typeof EMPTY_RUN_GUARD_STATE>) => ({
    ...EMPTY_RUN_GUARD_STATE,
    ...over,
  });

  it('allows a run that is inside both its clock and its total', () => {
    expect(
      checkRunGuard(run({ elapsedMs: 1000, totalRequestsMade: 50 })).stop,
    ).toBe(false);
  });

  it('stops on wall clock even when the counts look fine', () => {
    const v = checkRunGuard(
      run({ totalRequestsMade: 3, elapsedMs: HARD_DEADLINE_MS }),
    );
    expect(v.stop && v.reason).toBe('deadline');
  });

  it('stops a run whose total across all OAs ran away', () => {
    const v = checkRunGuard(
      run({ totalRequestsMade: HARD_MAX_REQUESTS_PER_RUN }),
    );
    expect(v.stop && v.reason).toBe('run-max-requests');
  });

  it('lets a legal 2-OA personalised run through on totals', () => {
    // 2 OAs x 300 = 600 requests: legal, below the run-wide hard ceiling.
    expect(checkRunGuard(run({ totalRequestsMade: 600 })).stop).toBe(false);
  });

  it('🔴 trips BEFORE the lease expires, or two workers send the same chunks', () => {
    expect(HARD_DEADLINE_MS).toBeLessThan(computeLeaseMs());
  });

  it('🔴 and never outlives the allowance every ceiling was derived from', () => {
    // Review caught this: 70% of the lease is 14.1 min, but the budget of 300
    // comes from a 10-minute allowance, and a longer run starves other jobs.
    expect(HARD_DEADLINE_MS).toBeLessThanOrEqual(RUN_TIME_ALLOWANCE_SEC * 1000);
  });

  it('fails CLOSED on unreadable state', () => {
    expect(checkRunGuard(run({ elapsedMs: Number.NaN })).stop).toBe(true);
    expect(checkRunGuard(run({ totalRequestsMade: Number.NaN })).stop).toBe(
      true,
    );
  });

  it('always says why it stopped', () => {
    const v = checkRunGuard(run({ elapsedMs: HARD_DEADLINE_MS }));
    expect(v.stop && v.detail.length).toBeGreaterThan(0);
  });
});

describe('flood protection — an allowed account sending far too much', () => {
  const NOW = 1_800_000_000_000;
  const ok = {
    nowMs: NOW,
    jobIsRunning: false,
    lastRunFinishedAtMs: null,
    runsOfThisJobLastHour: 0,
    runsByThisUserLastHour: 0,
    runsInFlightGlobal: 0,
  };

  it('lets a normal first run through', () => {
    expect(checkAbuse(ok).allow).toBe(true);
  });

  it('🔴 refuses to start a job that is already sending', () => {
    // retryKey cannot save us: a second run has a second runId, so LINE accepts
    // both and the customer is messaged twice.
    const v = checkAbuse({ ...ok, jobIsRunning: true });
    expect(!v.allow && v.reason).toBe('already-running');
  });

  it('holds a cooldown and says how many seconds are left', () => {
    const v = checkAbuse({ ...ok, lastRunFinishedAtMs: NOW - 10_000 });
    expect(!v.allow && v.reason).toBe('cooldown');
    expect(!v.allow && v.retryAfterSec).toBe(MIN_SECONDS_BETWEEN_RUNS - 10);
  });

  it('allows again once the cooldown has passed', () => {
    const past = NOW - (MIN_SECONDS_BETWEEN_RUNS + 1) * 1000;
    expect(checkAbuse({ ...ok, lastRunFinishedAtMs: past }).allow).toBe(true);
  });

  it('caps runs per job and per user, and has a system-wide backstop', () => {
    expect(
      checkAbuse({ ...ok, runsOfThisJobLastHour: MAX_RUNS_PER_JOB_PER_HOUR })
        .allow,
    ).toBe(false);
    expect(
      checkAbuse({ ...ok, runsByThisUserLastHour: MAX_RUNS_PER_USER_PER_HOUR })
        .allow,
    ).toBe(false);
    expect(
      checkAbuse({ ...ok, runsInFlightGlobal: MAX_CONCURRENT_RUNS_GLOBAL })
        .allow,
    ).toBe(false);
  });

  it('names the most specific reason, not a generic one', () => {
    const v = checkAbuse({
      ...ok,
      jobIsRunning: true,
      runsInFlightGlobal: 99,
      runsByThisUserLastHour: 999,
    });
    expect(!v.allow && v.reason).toBe('already-running');
  });

  it('🔴 fails CLOSED when a counter cannot be read', () => {
    // One `new Date(undefined).getTime()` in a half-written row used to switch
    // every limit off at once and answer `allow`.
    const bad = [
      { ...ok, lastRunFinishedAtMs: Number.NaN },
      { ...ok, runsOfThisJobLastHour: Number.NaN },
      { ...ok, runsByThisUserLastHour: Number.NaN },
      { ...ok, runsInFlightGlobal: Number.NaN },
      { ...ok, nowMs: Number.NaN },
    ];
    for (const input of bad) {
      const v = checkAbuse(input);
      expect(v.allow).toBe(false);
      expect(!v.allow && v.reason).toBe('unreadable-state');
    }
  });

  it('names a future finish time for what it is, not a negative cooldown', () => {
    const v = checkAbuse({ ...ok, lastRunFinishedAtMs: NOW + 3_600_000 });
    expect(!v.allow && v.reason).toBe('unreadable-state');
    expect(!v.allow && v.detail).toContain('clock');
  });

  it('stops a job-creation flood with its OWN reason', () => {
    expect(checkJobCreationFlood(0).allow).toBe(true);
    const v = checkJobCreationFlood(MAX_JOBS_CREATED_PER_USER_PER_HOUR);
    expect(!v.allow && v.reason).toBe('job-creation-limit');
    expect(checkJobCreationFlood(Number.NaN).allow).toBe(false);
  });
});

describe('run trigger — who started it, and what that implies', () => {
  it('builds a manual trigger with the presser attached', () => {
    const t = manualTrigger('run1', 'u1', 'judy');
    expect(t.source).toBe('manual');
    expect(t.runId).toBe('run1');
    expect(t.userName).toBe('judy');
  });

  it('a scheduled trigger has nobody to attribute it to', () => {
    const t = schedulerTrigger('run2');
    expect(t.source).toBe('scheduler');
    expect(t.userId).toBeUndefined();
  });

  it('🔴 EVERY run re-checks its ceiling, whoever started it', () => {
    // The audience is live, and the runner can be reached without the form.
    // One count against an index we already query is cheaper than messaging
    // people a refused run should never have reached.
    expect(mustRecheckCeiling(manualTrigger('r'))).toBe(true);
    expect(mustRecheckCeiling(schedulerTrigger('r'))).toBe(true);
  });

  it('catch-up is deliberately off — a restart must not burst customers', () => {
    expect(CATCH_UP_MISSED_ROUNDS).toBe(false);
  });
});

describe('gaps review found untested', () => {
  it('the accumulator refuses beyond its cap instead of forgetting', () => {
    // Forgetting would let a duplicate through = a customer messaged twice.
    const acc = new ChunkAccumulator(500, 3);
    for (const id of ['a', 'b', 'c', 'd', 'e']) acc.push(id);
    expect(acc.acceptedCount).toBe(3);
    expect(acc.didOverflow).toBe(true);
    expect(new ChunkAccumulator(500, 3).didOverflow).toBe(false);
  });

  it("🔴 a chunk can never exceed LINE's 500, however it is constructed", () => {
    // A 1000-recipient chunk is rejected wholesale by LINE: 1000 people skipped.
    expect(
      chunkRecipients(
        Array.from({ length: 900 }, (_, i) => `U${i}`),
        1000,
      ).every((c) => c.to.length <= LINE_MULTICAST_MAX_TO),
    ).toBe(true);
    expect(
      chunkRecipients(['a', 'b', 'c', 'd', 'e'], 2.5).map((c) => c.to.length),
    ).toEqual([2, 2, 1]);
  });

  it('🔴 retry key REFUSES ambiguous ids instead of sanitising them', () => {
    // Stripping made 1.5 and 15 collide, and any base64 id lose + / =.
    expect(buildChunkRetryKey(1.5, 'h', 0)).toBeNull();
    expect(buildChunkRetryKey(Number.NaN, 'h', 0)).toBeNull();
    expect(buildChunkRetryKey(Number.POSITIVE_INFINITY, 'h', 0)).toBeNull();
    expect(buildChunkRetryKey('a.1', 'h', 0)).toBeNull();
    expect(buildChunkRetryKey('a+b/c==', 'h', 0)).toBeNull();
    expect(buildChunkRetryKey('a', 'b:c', 0)).toBeNull();
    expect(buildChunkRetryKey(-1, 'h', 0)).toBeNull();
    // and a clean id still works
    // legal characters are accepted; ambiguous ones are still refused below
    expect(buildChunkRetryKey('run_1', 'hook-A', 7)).not.toBeNull();
    // and two ids that only a sanitiser would confuse stay distinct
    expect(buildChunkRetryKey('run_1', 'hook-A', 7)).not.toBe(
      buildChunkRetryKey('run', '1hook-A', 7),
    );
  });

  it('🔴 NaN / Infinity / raw floats never reach a card', () => {
    expect(normalizeEmptyValue(Number.NaN)).toBe('N/A');
    expect(normalizeEmptyValue(Number.POSITIVE_INFINITY)).toBe('N/A');
    expect(normalizeEmptyValue(0.1 + 0.2)).toBe('0.3');
    expect(normalizeEmptyValue(1e21)).not.toContain('e+');
    expect(normalizeEmptyValue(1234)).toBe('1234');
  });

  it('isEmptyForBroadcast knows what counts as nothing', () => {
    expect(isEmptyForBroadcast('')).toBe(true);
    expect(isEmptyForBroadcast('  -  ')).toBe(true);
    expect(isEmptyForBroadcast(null)).toBe(true);
    expect(isEmptyForBroadcast('judy')).toBe(false);
    expect(isEmptyForBroadcast(0)).toBe(false);
  });

  it('cellKey refuses non-strings rather than making [object Object]', () => {
    expect(cellKey('multicast', 'plain')).toBe('multicast:plain');
    expect(cellKey({}, {})).toBeNull();
  });

  it('collectTags finds every distinct tag, once, in order', () => {
    expect(collectTags('{{a}} {{b}} {{a}}')).toEqual(['a', 'b']);
    expect(collectTags('{{ member.display_name }}')).toEqual([
      'member.display_name',
    ]);
    expect(collectTags(null)).toEqual([]);
  });

  it('🔴 the two lists of per-recipient tag families stay in step', () => {
    // One list is prefixes, the other globs. Adding a family to one and not the
    // other reintroduces the silent-N/A bug.
    const globs = SEND_PROFILES.personal.allows_tags.filter((t) =>
      t.endsWith('.*'),
    );
    for (const prefix of PER_RECIPIENT_PREFIXES) {
      expect(globs).toContain(`${prefix}*`);
    }
    const plainTags = SEND_PROFILES.plain.allows_tags as readonly string[];
    expect(globs.filter((g) => !plainTags.includes(g))).toHaveLength(
      PER_RECIPIENT_PREFIXES.length,
    );
  });

  it('lists only selectable profiles, and every checker is on', () => {
    expect(
      listSelectableProfiles()
        .map((p) => p.key)
        .sort(),
    ).toEqual(['personal', 'plain']);
    expect(CHECKS.emptyValue).toBe(true);
    expect(CHECKS.imageShape).toBe(true);
    expect(CHECKS.profileMatch).toBe(true);
  });

  it('🔴 an unreadable OA is skipped, not counted as sendable', () => {
    const p = planRun({
      cell: SEND_MATRIX['multicast:plain'],
      recipientsByOa: [Number.NaN],
    });
    expect(p.sendableOaCount).toBe(0);
    expect(canRun(p)).toBe(false);
  });
});
