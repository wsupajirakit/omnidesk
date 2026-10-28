/**
 * [FEAT-20260823-SLIPPHONE] + [FIX-20260823-SLIPIDCASE]
 *
 * The slip search box gains a fourth shape — a full phone number — and loses a
 * bug that made a pasted lowercase LINE id return an empty page in silence.
 *
 * WHAT THESE TESTS RUN: the real `SlipVerificationService.list`, so the term
 * travels the whole way an operator's keystrokes do — `list` → `buildFilters` →
 * `searchFilter` — and the filter is observed where Mongo would receive it. The
 * two private methods are never called directly; a test that reached past the
 * public path could pass while the wiring was broken.
 *
 * ⚠️ The COST claims are asserted, not described: the member collection must be
 * left untouched by every search that is not a phone. That is the whole basis
 * for saying this feature adds nothing to the common path.
 */
import { SlipVerificationService } from '@/modules/slip';

/** A real id shape from the collection: `U` + 32 lowercase hex. */
const LINE_ID = 'U2e2f0a1b3c4d5e6f7a8b9c0d1e2f3a4b';
const PHONE = '0875550016';
const MEMBER_A = 'Ubd1234567890abcdef1234567890abcd';
const MEMBER_B = 'Ucb1234567890abcdef1234567890abcd';

interface Harness {
  service: SlipVerificationService;
  /** Filters Mongo would have received, in call order. */
  captured: Array<Record<string, unknown>>;
  /** Every filter the MEMBER collection was queried with — empty means untouched. */
  memberQueries: Array<Record<string, unknown>>;
  /** Options observed on the member lookup, so the cap can be asserted. */
  memberLimits: number[];
}

const buildHarness = (members: Array<{ member_user_id?: string }>): Harness => {
  const captured: Array<Record<string, unknown>> = [];
  const memberQueries: Array<Record<string, unknown>> = [];
  const memberLimits: number[] = [];

  const chain = {
    sort: () => chain,
    skip: () => chain,
    limit: () => chain,
    populate: () => chain,
    lean: () => chain,
    exec: () => Promise.resolve([]),
  } as unknown as Record<string, unknown>;

  const slipModel = {
    countDocuments: (filter: Record<string, unknown>) => {
      captured.push(filter);
      return { exec: () => Promise.resolve(0) };
    },
    find: (filter: Record<string, unknown>) => {
      captured.push(filter);
      return chain;
    },
  };

  const memberChain = {
    select: () => memberChain,
    limit: (n: number) => {
      memberLimits.push(n);
      return memberChain;
    },
    lean: () => memberChain,
    exec: () => Promise.resolve(members),
  } as unknown as Record<string, unknown>;

  const memberModel = {
    find: (filter: Record<string, unknown>) => {
      memberQueries.push(filter);
      return memberChain;
    },
  };

  const service = new SlipVerificationService(
    slipModel as never,
    {} as never,
    {} as never,
    // the OA-scope resolver's Hook model — no auth is built here, so scope is []
    {
      find: () => ({ select: () => ({ lean: () => Promise.resolve([]) }) }),
    } as never,
    memberModel as never,
  );
  return { service, captured, memberQueries, memberLimits };
};

/**
 * ⚠️ The window is only ever present when the caller asks for one —
 * `resolveLogDateRange` returns null for "no usable bound" (`date-range.ts:48`).
 * The dashboard always sends a window, so the cases that care about it send one
 * too; passing none is what proves the term alone changes nothing.
 */
const WINDOW = { start_date: '2026-08-21', end_date: '2026-08-23' };

const filterFor = async (
  term: string,
  members: Array<{ member_user_id?: string }> = [],
  extra: Record<string, unknown> = {},
): Promise<Harness & { filter: Record<string, unknown> }> => {
  const h = buildHarness(members);
  await h.service.list({ search: term, ...extra });
  return { ...h, filter: h.captured[0] as Record<string, unknown> };
};

describe('[FEAT-20260823-SLIPPHONE] a full phone number finds that member’s slips', () => {
  it('⭐ resolves the phone to member ids and looks slips up by owner', async () => {
    const { filter, memberQueries } = await filterFor(PHONE, [
      { member_user_id: MEMBER_A },
    ]);

    // the member collection was asked for exactly that number…
    expect(memberQueries).toEqual([{ phone_number: PHONE }]);
    // …and the slip query is an indexed owner lookup, not a text match
    expect(filter['sender_member_user_id']).toEqual({ $in: [MEMBER_A] });
    expect(filter['$text']).toBeUndefined();
  });

  it('⭐ two members on one number both reach the slip query', async () => {
    const { filter } = await filterFor(PHONE, [
      { member_user_id: MEMBER_A },
      { member_user_id: MEMBER_B },
    ]);
    expect(filter['sender_member_user_id']).toEqual({
      $in: [MEMBER_A, MEMBER_B],
    });
  });

  it('⭐ a phone nobody owns returns NOTHING — it must not fall through to $text', async () => {
    const { filter } = await filterFor(PHONE, []);
    /* The whole point: answering a phone search with rows that merely share a
       text token would read as "here are their slips" and be worse than empty. */
    expect(filter['sender_member_user_id']).toEqual({ $in: [] });
    expect(filter['$text']).toBeUndefined();
  });

  it('⭐ a member row without an id is dropped rather than becoming undefined', async () => {
    const { filter } = await filterFor(PHONE, [
      {},
      { member_user_id: MEMBER_A },
    ]);
    expect(filter['sender_member_user_id']).toEqual({ $in: [MEMBER_A] });
  });

  it('caps the member lookup so one number cannot build an unbounded $in', async () => {
    const { memberLimits } = await filterFor(PHONE, [
      { member_user_id: MEMBER_A },
    ]);
    expect(memberLimits).toEqual([200]);
  });

  it.each([
    ['087-555-0016', PHONE],
    ['087 555 0016', PHONE],
    ['+66875550016', PHONE],
    ['66875550016', PHONE],
    ['(087) 555-0016', PHONE],
  ])(
    'normalises %s to the ten digits the rows store',
    async (typed, stored) => {
      const { memberQueries } = await filterFor(typed, [
        { member_user_id: MEMBER_A },
      ]);
      expect(memberQueries).toEqual([{ phone_number: stored }]);
    },
  );

  /**
   * ⭐ FOUND BY MUTATION, not by design. Removing the SHAPE test in
   * `normalizePhoneTerm` left every case green, because the final `^0\d{9}$`
   * guard caught almost everything on its own — almost. These two shapes are
   * the gap: strip the country code off `+66` + a FULL local number and what is
   * left looks like a valid phone, so a malformed 13-digit term would quietly
   * become someone else's number and return their slips.
   * เลขที่พิมพ์ผิด ต้องไม่กลายเป็นเบอร์ของคนอื่น.
   */
  it.each([
    ['+66 with a full local number (13 digits)', '+660875550016'],
    ['66 with a full local number (12 digits)', '660875550016'],
  ])('⭐ %s is refused, not silently rewritten', async (_label, typed) => {
    const { memberQueries, filter } = await filterFor(typed);
    expect(memberQueries).toEqual([]);
    expect(filter['sender_member_user_id']).toBeUndefined();
  });

  it('⭐ a phone search ignores the date window, like every other exact lookup', async () => {
    /* The window defaults to "today" in the UI, so keeping it would answer
       "not found" for last week's slip of a customer who plainly has one. */
    const { filter } = await filterFor(
      PHONE,
      [{ member_user_id: MEMBER_A }],
      WINDOW,
    );
    expect(filter['transaction_date']).toBeUndefined();
  });
});

describe('[FEAT-20260823-SLIPPHONE] ⭐ the common path pays NOTHING', () => {
  it.each([
    ['a reference number', 'ERR_1785173222068'],
    ['an account name', 'สมชาย ใจดี'],
    ['a slip id', 'a0d00000000000000000000a'],
    ['a LINE id', LINE_ID],
    ['too few digits to be a phone', '0016'],
    ['too many digits to be a phone', '08755500160000'],
    ['a number that is not a Thai mobile', '1879412251'],
  ])('%s never touches the members collection', async (_label, term) => {
    const { memberQueries } = await filterFor(term);
    expect(memberQueries).toEqual([]);
  });

  it('⭐ a text search builds the SAME filter it built before this feature', async () => {
    const { filter } = await filterFor('ERR_1785173222068', [], WINDOW);
    expect(filter['$text']).toEqual({ $search: 'ERR_1785173222068' });
    expect(filter['sender_member_user_id']).toBeUndefined();
    /* ⭐ the window STILL applies to a text search — the one search that can
       match many rows is the one the cap earns its keep on. Unchanged. */
    expect(filter['transaction_date']).toBeDefined();
  });

  it('⭐ an empty box queries neither collection by term', async () => {
    const { filter, memberQueries } = await filterFor('   ');
    expect(memberQueries).toEqual([]);
    expect(filter['$text']).toBeUndefined();
    expect(filter['sender_member_user_id']).toBeUndefined();
  });
});

describe('[FIX-20260823-SLIPIDCASE] a pasted LINE id finds slips whatever its case', () => {
  const expected = {
    $or: [{ sender_line_user_id: LINE_ID }, { sender_member_user_id: LINE_ID }],
  };

  it('⭐ lowercase — the shape that used to return an empty page in silence', async () => {
    const { filter } = await filterFor(LINE_ID.toLowerCase());
    expect(filter['$or']).toEqual(expected.$or);
  });

  it('⭐ upper-case hex, as some logs print it', async () => {
    const { filter } = await filterFor(`U${LINE_ID.slice(1).toUpperCase()}`);
    expect(filter['$or']).toEqual(expected.$or);
  });

  it('as stored — unchanged from before the fix', async () => {
    const { filter } = await filterFor(LINE_ID);
    expect(filter['$or']).toEqual(expected.$or);
  });

  it('⭐ every spelling produces the SAME filter', async () => {
    const a = await filterFor(LINE_ID);
    const b = await filterFor(LINE_ID.toLowerCase());
    const c = await filterFor(`U${LINE_ID.slice(1).toUpperCase()}`);
    expect(JSON.stringify(b.filter)).toBe(JSON.stringify(a.filter));
    expect(JSON.stringify(c.filter)).toBe(JSON.stringify(a.filter));
  });

  it('a LINE id still skips the date window', async () => {
    const { filter } = await filterFor(LINE_ID.toLowerCase(), [], WINDOW);
    expect(filter['transaction_date']).toBeUndefined();
  });
});
