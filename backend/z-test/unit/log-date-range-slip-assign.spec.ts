import { MAX_RANGE_DAYS } from '@/common/utils/date-range';
import { AssignHistoriesService } from '@/modules/tickets';
import { SlipVerificationService } from '@/modules/slip';

/**
 * ==== [FEAT-20260817-SLIPDATERANGE / ASSIGNDATERANGE] the 3-day window reaches
 * ==== the two listings that never had one
 *
 * Owner, 17/08: "/slip-verify และ assign-history เพิ่ม filter วันที่ range ได้แค่สาม
 * วัน (default วันนี้) เหมือน webhooklog" — and the field for slip is
 * `transaction_date` (the day the money moved), his decision, not `created_at`.
 *
 * WHAT THESE TESTS RUN: the real `buildFilters` / `listAssignHistories` against
 * jest model stubs, asserting the MONGO FILTER that leaves the service. Two
 * properties matter and neither is visible from a green compile:
 *
 *   1. THE CAP IS SERVER-SIDE. The dashboard control refuses >3 days, but a
 *      client cap can be bypassed with curl; the shared `resolveLogDateRange`
 *      has to be the one enforcing it. Asked for 10 days ⇒ the filter must span
 *      3, keeping the LATEST days (the direction the helper documents).
 *   2. BANGKOK DAYS. A bare `YYYY-MM-DD` must become 17:00Z the previous day
 *      (00:00 Bangkok) — parsing it as UTC midnight would silently drop every
 *      row between 00:00 and 06:59 local, which looks like a working filter.
 *
 * And the seam that must NOT move: no bounds ⇒ no date key in the filter at all,
 * so both listings behave exactly as they did before today.
 * ไม่ส่งวันที่ = เหมือนเดิมเป๊ะ · ส่งเกิน 3 วัน = ถูกหั่นที่ backend ไม่ใช่ที่หน้าจอ.
 */

/** 00:00 Bangkok on `date`, expressed as the UTC instant Mongo stores. */
const bangkokDayStart = (date: string): number =>
  Date.parse(`${date}T00:00:00.000Z`) - 7 * 60 * 60 * 1000;

describe('[SLIPDATERANGE] slip list filters transaction_date, capped', () => {
  /** The service only needs its model for `list`; `buildFilters` is private, so
   *  the filter is observed where it is actually used — the two model calls. */
  const buildService = () => {
    const captured: Array<Record<string, unknown>> = [];
    const query = {
      sort: () => query,
      skip: () => query,
      limit: () => query,
      populate: () => query,
      lean: () => query,
      exec: () => Promise.resolve([]),
    } as unknown as Record<string, unknown>;
    const slipModel = {
      countDocuments: jest.fn((filter: Record<string, unknown>) => {
        captured.push(filter);
        return { exec: () => Promise.resolve(0) };
      }),
      find: jest.fn((filter: Record<string, unknown>) => {
        captured.push(filter);
        return query;
      }),
    };
    const service = new SlipVerificationService(
      slipModel as never,
      {} as never,
      {} as never,
      // [FIX-20260818-SLIPSCOPE · plan §8] the OA-scope resolver's Hook model.
      // Returns nothing, so a non-super caller scopes to [] — these cases build
      // no auth at all, which is the unprivileged path either way.
      {
        find: () => ({ select: () => ({ lean: () => Promise.resolve([]) }) }),
      } as never,
      // [FEAT-20260823-SLIPPHONE] member model — unused, no phone search here.
      {} as never,
    );
    return { service, captured };
  };

  const filterFor = async (
    q: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const { service, captured } = buildService();
    await service.list(q);
    return captured[0] as Record<string, unknown>;
  };

  it('⭐ a one-day window becomes a transaction_date range on BANGKOK bounds', async () => {
    const filter = await filterFor({
      start_date: '2026-08-17',
      end_date: '2026-08-17',
    });
    const range = filter['transaction_date'] as { $gte: Date; $lte: Date };
    expect(range.$gte.getTime()).toBe(bangkokDayStart('2026-08-17'));
    // inclusive end = the last millisecond of the Bangkok day
    expect(range.$lte.getTime()).toBe(bangkokDayStart('2026-08-18') - 1);
    // and never created_at — that is the other pages' field
    expect(filter['created_at']).toBeUndefined();
  });

  it('⭐ asking for 10 days is CAPPED to 3 by the server, keeping the latest', async () => {
    const filter = await filterFor({
      start_date: '2026-08-08',
      end_date: '2026-08-17',
    });
    const range = filter['transaction_date'] as { $gte: Date; $lte: Date };
    const spanDays =
      (range.$lte.getTime() - range.$gte.getTime() + 1) / 86_400_000;
    expect(Math.round(spanDays)).toBe(MAX_RANGE_DAYS);
    /**
     * Clamped FORWARD: the newest day survives and the old end is dropped.
     *
     * ⚠️ The bound lands ONE MILLISECOND before Bangkok midnight of the third-newest
     * day, not on it: `date-range.ts:120` computes `to − 3×24h` and `to` is the last
     * millisecond of its day (`dayStart + 86_399_999`). So the window is 3 days plus
     * that single millisecond, and a row stamped exactly 23:59:59.999 on the day
     * before would be included. Pre-existing in the SHARED helper — every log page
     * that uses it has behaved this way since 09/08 — so it is asserted here as-is
     * rather than quietly "fixed" under two other pages' feet. Reported to the owner;
     * the fix, if wanted, is `+ 1` on that line and belongs to its own change.
     * ผลกระทบจริง = 1 มิลลิวินาที ไม่ได้แก้ในงานนี้ แต่จดไว้ไม่ให้หาย.
     */
    expect(range.$gte.getTime()).toBe(bangkokDayStart('2026-08-15') - 1);
  });

  it('no bounds ⇒ no date key at all (the pre-fix behaviour, untouched)', async () => {
    const filter = await filterFor({ api_status: 'success' });
    expect(filter['transaction_date']).toBeUndefined();
    expect(filter['api_status']).toBe('success');
  });

  it('a full ISO instant is used as given, not shifted a second time', async () => {
    const filter = await filterFor({ start_date: '2026-08-17T05:30:00.000Z' });
    const range = filter['transaction_date'] as { $gte: Date };
    expect(range.$gte.toISOString()).toBe('2026-08-17T05:30:00.000Z');
  });
});

describe('[ASSIGNDATERANGE] assign-history list filters created_at, capped', () => {
  const buildService = () => {
    const captured: Array<Record<string, unknown>> = [];
    const chain = {
      populate: () => chain,
      sort: () => chain,
      skip: () => chain,
      limit: () => chain,
      lean: () => Promise.resolve([]),
    } as unknown as Record<string, unknown>;
    const assignHistoryModel = {
      countDocuments: jest.fn((filter: Record<string, unknown>) => {
        captured.push(filter);
        return Promise.resolve(0);
      }),
      find: jest.fn(() => chain),
    };
    // 3 models: assignHistory · hook · chatRoom (assign-histories.service.ts:29-36)
    const service = new AssignHistoriesService(
      assignHistoryModel as never,
      {} as never,
      {} as never,
    );
    return { service, captured };
  };

  const filterFor = async (
    q: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const { service, captured } = buildService();
    // superadmin: skips the group-scoping branch, which needs more models and is
    // not what this spec is about.
    await service.listAssignHistories(q, {
      roleName: 'superadmin',
    } as never);
    return captured[0] as Record<string, unknown>;
  };

  it('⭐ from/to become a created_at range on Bangkok bounds', async () => {
    const filter = await filterFor({ from: '2026-08-17', to: '2026-08-17' });
    const range = filter['created_at'] as { $gte: Date; $lte: Date };
    expect(range.$gte.getTime()).toBe(bangkokDayStart('2026-08-17'));
    expect(range.$lte.getTime()).toBe(bangkokDayStart('2026-08-18') - 1);
  });

  it('⭐ a wider window is capped to 3 days server-side', async () => {
    const filter = await filterFor({ from: '2026-08-01', to: '2026-08-17' });
    const range = filter['created_at'] as { $gte: Date; $lte: Date };
    const spanDays =
      (range.$lte.getTime() - range.$gte.getTime() + 1) / 86_400_000;
    expect(Math.round(spanDays)).toBe(MAX_RANGE_DAYS);
  });

  it('no bounds ⇒ no created_at key (older clients keep working)', async () => {
    const filter = await filterFor({ action: 'accept' });
    expect(filter['created_at']).toBeUndefined();
    expect(filter['action']).toBe('accept');
  });
});

/**
 * ==== [FEAT-20260817-SLIPSEARCHID] one search box, three kinds of term ====
 *
 * Owner, 17/08: the slip page must find a row by its Mongo `_id` and by the
 * member's LINE user id. Before this, the box fed `$text`, whose index covers
 * only `trans_ref` + the two account names — so both searches returned an empty
 * page with no error, which is the worst kind of broken.
 *
 * The fourth case is the one a user would hit first and nobody would have
 * written down: an exact id must IGNORE the date window, because the control
 * defaults to today and would otherwise answer "not found" for a row that
 * exists. A text search keeps the window.
 */
describe('[SLIPSEARCHID] the search box resolves ids to indexed fields', () => {
  const buildService = () => {
    const captured: Array<Record<string, unknown>> = [];
    const query = {
      sort: () => query,
      skip: () => query,
      limit: () => query,
      populate: () => query,
      lean: () => query,
      exec: () => Promise.resolve([]),
    } as unknown as Record<string, unknown>;
    const slipModel = {
      countDocuments: jest.fn((filter: Record<string, unknown>) => {
        captured.push(filter);
        return { exec: () => Promise.resolve(0) };
      }),
      find: jest.fn(() => query),
    };
    return {
      service: new SlipVerificationService(
        slipModel as never,
        {} as never,
        {} as never,
        // [FIX-20260818-SLIPSCOPE · plan §8] the OA-scope resolver's Hook model.
        // Returns nothing, so a non-super caller scopes to [] — these cases build
        // no auth at all, which is the unprivileged path either way.
        {
          find: () => ({ select: () => ({ lean: () => Promise.resolve([]) }) }),
        } as never,
        // [FEAT-20260823-SLIPPHONE] member model — unused here, these cases
        // never search by phone; the service only reads it on that one branch.
        {} as never,
      ),
      captured,
    };
  };

  const filterFor = async (
    q: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const { service, captured } = buildService();
    await service.list(q);
    return captured[0] as Record<string, unknown>;
  };

  const SLIP_ID = 'a0d000000000000000000068';
  const LINE_ID = 'Ubad099ef9766d47be58cc2fd4c16244e';

  it('⭐ a 24-hex term becomes an _id lookup, never $text', async () => {
    const filter = await filterFor({ search: SLIP_ID });
    expect(String(filter['_id'])).toBe(SLIP_ID);
    expect(filter['$text']).toBeUndefined();
  });

  it('⭐ a LINE id matches BOTH names the row dual-writes', async () => {
    const filter = await filterFor({ search: LINE_ID });
    expect(filter['$or']).toEqual([
      { sender_line_user_id: LINE_ID },
      { sender_member_user_id: LINE_ID },
    ]);
    expect(filter['$text']).toBeUndefined();
  });

  it('⭐ an exact id IGNORES the date window (today would hide an older row)', async () => {
    const filter = await filterFor({
      search: SLIP_ID,
      start_date: '2026-08-17',
      end_date: '2026-08-17',
    });
    expect(filter['transaction_date']).toBeUndefined();
    expect(String(filter['_id'])).toBe(SLIP_ID);
  });

  it('a TEXT search keeps both the window and the old $text behaviour', async () => {
    const filter = await filterFor({
      search: 'ERR_1785173222068',
      start_date: '2026-08-17',
      end_date: '2026-08-17',
    });
    expect(filter['$text']).toEqual({ $search: 'ERR_1785173222068' });
    expect(filter['transaction_date']).toBeDefined();
  });

  it('whitespace is trimmed, and a blank box filters nothing', async () => {
    expect(String((await filterFor({ search: `  ${SLIP_ID}  ` }))['_id'])).toBe(
      SLIP_ID,
    );
    const blank = await filterFor({ search: '   ' });
    expect(blank['$text']).toBeUndefined();
    expect(blank['_id']).toBeUndefined();
  });

  it('a near-miss is still a text search — 23 hex chars is not an id', async () => {
    const filter = await filterFor({ search: SLIP_ID.slice(0, 23) });
    expect(filter['$text']).toBeDefined();
    expect(filter['_id']).toBeUndefined();
  });
});

/**
 * [FIX-20260818-SLIPSCOPE · plan §8 = T3-3, closes audit C2.2]
 *
 * `list()` had no caller in its signature, so one page showed the finance rows of
 * every tenant — and because the list denormalises customer name, phone and
 * contract code for speed, that page carried other tenants' customer PII too.
 * All 87 rows in the live database carry `hook_id`, so the boundary is a filter.
 *
 * These cases assert on the FILTER handed to the model, which is where the scope
 * now lives.
 */
describe('[SLIPSCOPE] the slip listing is scoped to the caller’s OAs', () => {
  const OA = 'a0d000000000000000000043';

  const buildScopedService = (allowedHooks: string[] | null) => {
    const seen: { filters?: Record<string, unknown> } = {};
    const slipModel = {
      countDocuments: (f: Record<string, unknown>) => {
        seen.filters = f;
        return { exec: () => Promise.resolve(0) };
      },
      find: () => ({
        sort: () => ({
          skip: () => ({
            limit: () => ({
              populate: () => ({
                populate: () => ({
                  lean: () => ({ exec: () => Promise.resolve([]) }),
                }),
              }),
            }),
          }),
        }),
      }),
    };
    const hookModel = {
      find: () => ({ select: () => ({ lean: () => Promise.resolve([]) }) }),
    };
    const service = new SlipVerificationService(
      slipModel as never,
      {} as never,
      { write: () => undefined } as never,
      hookModel as never,
      // [FEAT-20260823-SLIPPHONE] member model — unused, no phone search here.
      {} as never,
    );
    return { service, seen, allowedHooks };
  };

  it('⭐ a whitelisted operator only sees their own OAs', async () => {
    const { service, seen } = buildScopedService([OA]);
    await service.list({}, {
      roleName: 'operator',
      groups: [],
      allowedHooks: [OA],
    } as never);
    expect(seen.filters).toMatchObject({ hook_id: { $in: [OA] } });
  });

  it('a super user is unfiltered — no hook_id in the query at all', async () => {
    const { service, seen } = buildScopedService(null);
    await service.list({}, { roleName: 'superadmin' } as never);
    expect(seen.filters).not.toHaveProperty('hook_id');
  });

  it('no caller ⇒ scoped to nothing, never to everything', async () => {
    const { service, seen } = buildScopedService([]);
    await service.list({});
    expect(seen.filters).toMatchObject({ hook_id: { $in: [] } });
  });
});
