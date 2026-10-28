import {
  DEFAULT_SUSPEND_AT,
  DEFAULT_SUSPEND_WINDOW_HOURS,
  buildSuspendedPipeline,
  suspendWindowStart,
  shouldSuspend,
} from '@/modules/strike/strike-suspend.helper';

/**
 * [FEAT-20260826-STRIKESUSPEND] "ติดครบ N ครั้งใน H ชั่วโมง = เงียบ"
 * ===========================================================================
 * 📖 แผนเต็ม: `todo/task/26082026/todo10_26082026_strike-suspend.md`
 *
 * WHY THE DECISION IS A PURE FUNCTION. Counting rows is the easy half; deciding
 * WHEN the count means "lock this customer out" is where it goes wrong, and the
 * ways it goes wrong are invisible to a type checker — an off-by-one on the
 * threshold, a window that silently counts everything, a missing session read as
 * zero from the wrong side. A function returns a verdict a test can read without
 * a database, a fake, or a promise.
 */
describe('shouldSuspend — the threshold', () => {
  it('does not lock below the threshold', () => {
    expect(shouldSuspend(4, 5)).toBe(false);
  });

  it('locks exactly ON the threshold, not one past it', () => {
    // `>` instead of `>=` would let everyone sit one strike under the cap for ever
    expect(shouldSuspend(5, 5)).toBe(true);
  });

  it('locks above the threshold', () => {
    expect(shouldSuspend(9, 5)).toBe(true);
  });

  it('never locks on zero strikes, whatever the threshold', () => {
    expect(shouldSuspend(0, 1)).toBe(false);
  });

  it('🔴 never locks on zero strikes even if the threshold is zero', () => {
    /* This case exists because a mutation exposed it: deleting the
       `strikesInWindow > 0` guard left every other case green, and with a
       threshold of 0 the bare `>=` would lock EVERY customer on their first
       message — including customers who have never been rate-limited at all.
       `env.schema.ts` floors the threshold at 1, so this is the second belt;
       the first one living somewhere else is not a reason to leave this one
       untested. เพดาน 0 ต้องไม่ล็อกใคร ไม่ใช่ล็อกทุกคน */
    expect(shouldSuspend(0, 0)).toBe(false);
  });
});

describe('suspendWindowStart — how far back to count', () => {
  const NOW = new Date('2026-08-26T12:00:00.000Z');

  it('24 hours back by default', () => {
    expect(suspendWindowStart(NOW, 24).toISOString()).toBe(
      '2026-08-25T12:00:00.000Z',
    );
  });

  it('honours a short window', () => {
    // owner: "จะตั้ง 1 หรือ 72 ก็ได้"
    expect(suspendWindowStart(NOW, 1).toISOString()).toBe(
      '2026-08-26T11:00:00.000Z',
    );
  });

  it('honours a long window', () => {
    expect(suspendWindowStart(NOW, 72).toISOString()).toBe(
      '2026-08-23T12:00:00.000Z',
    );
  });

  it('never returns a start in the future', () => {
    // a non-positive window would make the start >= now, so nothing could ever
    // be counted and the feature would be silently off — the env floor is 1,
    // and this is the second belt.
    expect(suspendWindowStart(NOW, 0).getTime()).toBeLessThan(NOW.getTime());
  });
});

describe('the defaults are the ones the plan promised', () => {
  it('5 strikes', () => {
    expect(DEFAULT_SUSPEND_AT).toBe(5);
  });

  it('24 hours — HOURS, never days', () => {
    /* the unit lives in the NAME. `strikeResetHours` next door is in hours too,
       and two counters that work as a pair must read in the same unit. */
    expect(DEFAULT_SUSPEND_WINDOW_HOURS).toBe(24);
  });
});

describe('buildSuspendedPipeline — the tray read, as a shape', () => {
  const stages = (limit: number) =>
    buildSuspendedPipeline(limit).map((s) => Object.keys(s)[0]);

  it('reads only the locked rows, and reads them newest first', () => {
    const p = buildSuspendedPipeline(50);
    /* [FIX-20260827-TRAYGHOST] `status: 'open'` is load-bearing. A cleared
       session KEEPS its `suspended_at` for ever (history), so matching on
       existence alone kept every RELEASED customer in the tray — seen live on
       27/08 the first time a real block/clear cycle ran: the row survived the
       clear, and its own Clear button could only answer 409. The tray's
       question is "who is the bot ignoring NOW", and only open sessions can
       answer it. เคลียร์แล้วต้องหายจาก tray — แถวปิดคือประวัติ ไม่ใช่สถานะ */
    expect(p[0]).toEqual({
      $match: { status: 'open', suspended_at: { $exists: true } },
    });
    expect(p[1]).toEqual({ $sort: { suspended_at: -1 } });
  });

  it('🔴 limits BEFORE it joins, never after', () => {
    /* The order is the performance. Joining first would pull the member row and
       the latest strike for every locked customer in the database and then throw
       almost all of them away; limiting first means both joins are bounded by
       what the tray can show. ตัดก่อนค่อย join ไม่ใช่ join แล้วค่อยตัด */
    const s = stages(50);
    expect(s.indexOf('$limit')).toBeLessThan(s.indexOf('$lookup'));
  });

  it('clamps the limit so one caller cannot ask for the whole collection', () => {
    expect(buildSuspendedPipeline(50)).toContainEqual({ $limit: 50 });
    expect(buildSuspendedPipeline(9999)).toContainEqual({ $limit: 200 });
  });

  it('🔴 survives a limit that is not a number', () => {
    /* Found by clicking, not by a test: the route reads `Number(req.query.limit)`,
       and a request with no `?limit=` makes that `NaN` — which is NOT `undefined`,
       so a default parameter never fires. `Math.max(NaN, 1)` is `NaN`, so the
       stage became `{ $limit: NaN }` and the tray came back empty while the
       database plainly had a locked customer in it. No type would have caught it:
       `NaN` is a number. NaN ผ่าน type แต่พังเงียบ ต้องกันด้วยค่า ไม่ใช่ด้วยชนิด */
    expect(buildSuspendedPipeline(Number.NaN)).toContainEqual({ $limit: 50 });
    expect(
      buildSuspendedPipeline(undefined as unknown as number),
    ).toContainEqual({ $limit: 50 });
    expect(buildSuspendedPipeline(0)).toContainEqual({ $limit: 1 });
    expect(buildSuspendedPipeline(-5)).toContainEqual({ $limit: 1 });
  });

  /* One narrow shape for the stages under test. Named rather than cast inline
     so each assertion reads as the rule it is checking, not as a pile of `as`. */
  interface LookupStage {
    $lookup: {
      from: string;
      localField?: string;
      foreignField?: string;
      pipeline?: Record<string, unknown>[];
    };
  }

  const lookupFrom = (from: string): LookupStage['$lookup'] => {
    const stage = buildSuspendedPipeline(50).find(
      (s) => (s as Partial<LookupStage>).$lookup?.from === from,
    ) as LookupStage | undefined;
    if (!stage) throw new Error(`no $lookup on ${from} in the pipeline`);
    return stage.$lookup;
  };

  it('joins the member by line_user_id — the unique key, not member_id', () => {
    /* Sessions do NOT carry `member_id` in practice (checked against real rows,
       26/08) — it is filled only when a caller happened to know it. Joining on
       it would silently return nothing. `members.line_user_id` is unique. */
    const join = lookupFrom('members');
    expect(join.localField).toBe('line_user_id');
    expect(join.foreignField).toBe('line_user_id');
  });

  it('takes the OA from the LATEST strike of that session', () => {
    const join = lookupFrom('member_strike_events');
    expect(join.pipeline).toContainEqual({ $sort: { occurred_at: -1 } });
    expect(join.pipeline).toContainEqual({ $limit: 1 });
  });

  it('⭐⭐ [OAFALLBACK] session ที่ไม่มี event (Block แอดมิน) → OA มาจากห้องล่าสุดของลูกค้า', () => {
    /* บั๊กจริง 27/08 (ภาพเจ้าของ): ทุก session ที่โดน suspend ใน DB มี event = 0
       — ใบ Block แอดมินไม่เคยมี strike ⇒ ทางเดิม (event ล่าสุด) ว่างเสมอ
       fallback: ห้องล่าสุดของลูกค้า (updated_at) → hooks.alias — namespace
       เดียวกับที่ event เก็บ (alias จาก URL webhook) · event ยังชนะเสมอเมื่อมี */
    const rooms = lookupFrom('chat_rooms');
    expect(rooms.pipeline).toContainEqual({ $sort: { updated_at: -1 } });
    expect(rooms.pipeline).toContainEqual({ $limit: 1 });
    const hooks = lookupFrom('hooks');
    expect(JSON.stringify(hooks.pipeline)).toContain('alias');

    const stage = buildSuspendedPipeline(50).find((s) => '$project' in s) as
      { $project: Record<string, unknown> } | undefined;
    if (!stage) throw new Error('the pipeline has no $project');
    expect(JSON.stringify(stage.$project['hook_alias'])).toContain('$ifNull');
    // ทางหลัก (event) ต้องมาก่อน fallback ใน $ifNull — ของเดิมชนะเสมอ
    const j = JSON.stringify(stage.$project['hook_alias']);
    expect(j.indexOf('$latest.hook_alias')).toBeGreaterThan(-1);
    expect(j.indexOf('$latest.hook_alias')).toBeLessThan(
      j.indexOf('room_hook'),
    );
  });

  it('projects exactly the fields the tray shows, and no more', () => {
    // a widening projection is how a phone number ends up somewhere nobody meant
    const stage = buildSuspendedPipeline(50).find((s) => '$project' in s) as
      { $project: Record<string, unknown> } | undefined;
    if (!stage) throw new Error('the pipeline has no $project');
    /* [FEAT-20260830-TRAYWHOBLOCKED] `suspended_by` joins the list DELIBERATELY.
       The tray labels an admin block differently from a ceiling block, and the
       only honest source is the field itself — inferring it from
       `strike_total === 0` mislabels a ceiling lock whose events aged out. */
    expect(Object.keys(stage.$project).sort()).toEqual([
      'display_name',
      'full_name',
      'hook_alias',
      'line_user_id',
      'opened_at',
      'phone_number',
      'seq',
      'strike_total',
      'suspended_at',
      'suspended_by',
    ]);
  });
});

/* [FEAT-20260830-TRAYWHOBLOCKED] the tray must be able to say WHO blocked. */
describe('the tray row carries the block attribution', () => {
  it('the $project ships suspended_by', () => {
    const stage = buildSuspendedPipeline(50).find((s) => '$project' in s) as
      { $project: Record<string, unknown> } | undefined;
    if (!stage) throw new Error('the pipeline has no $project');
    expect(stage.$project['suspended_by']).toBe(1);
  });

  it('🔴 it is projected, not derived — the screen must never infer it from strike_total', () => {
    /* a ceiling lock whose events aged out of the window can sit at
       strike_total 0; guessing "admin" from that number would label it wrongly.
       The field is the only honest source. */
    const stage = buildSuspendedPipeline(50).find((s) => '$project' in s) as {
      $project: Record<string, unknown>;
    };
    expect(stage.$project['strike_total']).toBe(1);
    expect(JSON.stringify(stage.$project['suspended_by'])).not.toContain(
      '$cond',
    );
  });
});
