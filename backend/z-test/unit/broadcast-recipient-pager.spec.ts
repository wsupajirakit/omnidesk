/**
 * [FEAT-20260822-BCASTPAGER] Every page goes through chat_rooms. No exceptions.
 * ===========================================================================
 * `members` has no `hook_id`, so a page that skips step 2 sends a campaign to
 * ids that mean nothing on the channel it is talking to.
 */
import {
  MongoRecipientPager,
  withCursor,
  FRESH_RESUME,
  type MemberPageRow,
  type OaScopeQuery,
} from '@/modules/content';

const rows = (...ids: string[]): MemberPageRow[] => ids.map((_id) => ({ _id }));

function deps(
  pages: MemberPageRow[][],
  lineIds: Record<string, string[]> = {},
) {
  const filters: Record<string, unknown>[] = [];
  const queries: OaScopeQuery[] = [];
  let call = 0;
  return {
    filters,
    queries,
    findMemberPage: (filter: Record<string, unknown>) => {
      filters.push(filter);
      return Promise.resolve(pages[call++] ?? []);
    },
    /* A spec's ids are plain strings, so identity is the honest conversion
       here. Production hands in `new Types.ObjectId(id)` — and the difference
       is exactly why the seam exists: with the conversion missing, a string
       cursor compared against ObjectId matches everything and the cursor never
       moves, which a numeric-string fake would never reveal. */
    toCursor: (id: string) => id,
    findLineIds: (q: OaScopeQuery) => {
      queries.push(q);
      const key = String(q.filter.hook_id);
      return Promise.resolve(lineIds[key] ?? []);
    },
  };
}

describe('MongoRecipientPager — members are never the last word', () => {
  it('🔴 asks chat_rooms for THIS OA, and returns its line ids', async () => {
    const d = deps([rows('m1', 'm2')], { h1: ['U1', 'U2'] });
    const p = new MongoRecipientPager(d, { status: 'active' });
    const page = await p.next('h1', FRESH_RESUME('h1'), 500);

    expect(page.ids).toEqual(['U1', 'U2']);
    expect(d.queries).toHaveLength(1);
    expect(d.queries[0]?.collection).toBe('chat_rooms');
    expect(d.queries[0]?.filter.hook_id).toBe('h1');
    expect(d.queries[0]?.filter.user_id).toEqual({ $in: ['m1', 'm2'] });
  });

  it('keeps the audience filter and only ADDS the cursor', async () => {
    const d = deps([rows('m1')], { h1: ['U1'] });
    const p = new MongoRecipientPager(d, { status: 'active' });
    await p.next('h1', { hookId: 'h1', afterId: 'm0', nextChunkIndex: 0 }, 500);

    expect(d.filters[0]).toEqual({ status: 'active', _id: { $gt: 'm0' } });
  });

  it('reports the last member id as the cursor, not the last LINE id', async () => {
    const d = deps([rows('m1', 'm2', 'm9')], { h1: ['U1'] });
    const p = new MongoRecipientPager(d, {});
    const page = await p.next('h1', FRESH_RESUME('h1'), 500);
    expect(page.lastId).toBe('m9');
  });

  it('🔴 a page where nobody belongs to this OA is EMPTY, not the end', async () => {
    /* 500 members in a row who all belong to another channel. Answering "end
       of list" here would report a campaign complete having reached nobody. */
    const d = deps([rows('m1', 'm2')], { h2: ['U1'] });
    const p = new MongoRecipientPager(d, {});
    const page = await p.next('h1', FRESH_RESUME('h1'), 500);

    expect(page.ids).toEqual([]);
    expect(page.lastId).toBe('m2');
  });

  it('the end of the list is an empty member page', async () => {
    const d = deps([[]]);
    const p = new MongoRecipientPager(d, {});
    expect(await p.next('h1', FRESH_RESUME('h1'), 500)).toEqual({
      ids: [],
      lastId: null,
    });
  });

  it('🔴 fails CLOSED when the OA cannot be scoped', async () => {
    /* A missing hook id would build a chat_rooms query with no `hook_id`, which
       matches every OA — the exact mixing this file prevents. */
    const d = deps([rows('m1')], { h1: ['U1'] });
    const p = new MongoRecipientPager(d, {});
    const page = await p.next('', FRESH_RESUME(''), 500);

    expect(page).toEqual({ ids: [], lastId: null });
    expect(d.queries).toHaveLength(0);
  });

  it('drops blank ids rather than sending to them', async () => {
    const d = deps([rows('m1')], { h1: ['U1', '', 'U2'] });
    const p = new MongoRecipientPager(d, {});
    expect((await p.next('h1', FRESH_RESUME('h1'), 500)).ids).toEqual([
      'U1',
      'U2',
    ]);
  });

  it('batches the chat_rooms lookup for a big page', async () => {
    const many = rows(...Array.from({ length: 2500 }, (_, i) => `m${i}`));
    const d = deps([many], { h1: ['U1'] });
    const p = new MongoRecipientPager(d, {});
    await p.next('h1', FRESH_RESUME('h1'), 2500);
    // OA_SCOPE_BATCH is 1,000 ⇒ 2,500 members is three lookups.
    expect(d.queries).toHaveLength(3);
  });
});

describe('withCursor — the keyset clause', () => {
  it('🔴 converts the stored cursor before comparing — a string never matches an ObjectId', () => {
    /* BSON sorts every ObjectId above every string, so `$gt: "<hex>"` against
       an ObjectId column matches the WHOLE collection: page 2 returns page 1,
       the cursor stalls, and every OA bigger than one page sends its first
       chunk and quits. Measured by an independent review. */
    const asObject = (id: string) => ({ __oid: id });
    const f = withCursor(
      {},
      { hookId: 'h1', afterId: 'm5', nextChunkIndex: 0 },
      asObject,
    );
    expect(f).toEqual({ _id: { $gt: { __oid: 'm5' } } });
  });

  it('a cursor that cannot be converted restarts the OA rather than matching everything', async () => {
    const d = {
      ...deps([rows('m1')], { h1: ['U1'] }),
      toCursor: () => {
        throw new Error('not an ObjectId');
      },
    };
    const p = new MongoRecipientPager(d, {});
    await p.next(
      'h1',
      { hookId: 'h1', afterId: 'bad', nextChunkIndex: 0 },
      500,
    );
    expect(d.filters[0]).toEqual({ _id: { $gt: null } });
  });

  it('adds nothing on the first page', () => {
    expect(withCursor({ a: 1 }, FRESH_RESUME('h1'))).toEqual({ a: 1 });
  });

  it('🔴 uses $gt, not $gte — $gte re-reads the cursor row forever', () => {
    const f = withCursor(
      {},
      { hookId: 'h1', afterId: 'm5', nextChunkIndex: 0 },
    );
    expect(f).toEqual({ _id: { $gt: 'm5' } });
  });

  it('does not mutate the filter it was handed', () => {
    const base = { a: 1 };
    withCursor(base, { hookId: 'h1', afterId: 'm5', nextChunkIndex: 0 });
    expect(base).toEqual({ a: 1 });
  });
});
