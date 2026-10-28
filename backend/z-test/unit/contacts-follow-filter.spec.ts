/**
 * [FEAT-20260823-CONTACTFOLLOW] The contacts listing filters by the follow-up
 * stamps a customer carries.
 *
 * WHAT THESE RUN: the real `ChatService.listContacts`, so the filter is observed
 * where Mongo would receive it — the `$match` that leads the aggregation and the
 * `countDocuments` beside it. The filter is built inline in that method, so
 * reaching past the public call would test nothing that ships.
 *
 * ⚠️ The service takes twenty constructor arguments, so these build it the way
 * the other chat specs do — `Object.create(prototype)` plus only the models this
 * one path touches. Same pattern as `chat-oa-scope-write.spec.ts:73`.
 */
import { ChatService } from '@/modules/chat';

const DEP = 'config.follow_up.line.notice_deposit_at';
const WIT = 'config.follow_up.line.notice_withdraw_at';
const HAS = { $exists: true, $ne: null };

const id = (n: string): Record<string, unknown> => ({
  _id: n,
  toString: () => n,
});

interface Seen {
  /** every filter the MEMBER collection was queried with */
  memberFilters: Record<string, unknown>[];
  /** the `$match` the aggregation led with */
  match: Record<string, unknown> | null;
  /** the filter `countDocuments` received */
  counted: Record<string, unknown>[];
}

const build = (
  members: Record<string, unknown>[],
  tagMemberIds: string[] | null = null,
): { svc: ChatService; seen: Seen } => {
  const seen: Seen = { memberFilters: [], match: null, counted: [] };

  const memberModel = {
    /* the $lookup stage reads this — see chat.service.ts `from:` */
    collection: { name: 'members' },
    find: (filter: Record<string, unknown>) => {
      seen.memberFilters.push(filter);
      return { select: () => ({ lean: () => Promise.resolve(members) }) };
    },
  };
  const chatRoomModel = {
    countDocuments: (f: Record<string, unknown>) => {
      seen.counted.push(f);
      return Promise.resolve(0);
    },
    aggregate: (pipeline: Record<string, unknown>[]) => {
      seen.match = (pipeline[0] as { $match: Record<string, unknown> }).$match;
      return {
        allowDiskUse: () => Promise.resolve([{ rows: [], counted: [] }]),
      };
    },
  };
  const customerTagModel = {
    find: () => ({
      select: () => ({
        lean: () =>
          Promise.resolve((tagMemberIds ?? []).map((m) => ({ member_id: m }))),
      }),
    }),
  };
  /* a super caller: getAllowedHookIds resolves to "everything", so no hook scope
     lands in the match and the follow filter is the only thing under test */
  const svc = Object.create(ChatService.prototype) as Record<string, unknown>;
  svc['memberModel'] = memberModel;
  svc['chatRoomModel'] = chatRoomModel;
  svc['customerTagModel'] = customerTagModel;
  svc['hookModel'] = {
    find: () => ({ select: () => ({ lean: () => Promise.resolve([]) }) }),
  };
  return { svc: svc as unknown as ChatService, seen };
};

const run = async (
  dto: Record<string, unknown>,
  members: Record<string, unknown>[] = [],
  tagMemberIds: string[] | null = null,
): Promise<Seen> => {
  const { svc, seen } = build(members, tagMemberIds);
  /* ⚠️ `roleName`, not `role` — that is what `isSuperUser` reads
     (common/auth/super-role.ts:38). With the wrong key the resolver returns an
     EMPTY allow-list, listContacts short-circuits before the filter is built,
     and every case here passes vacuously. Caught by these tests failing first. */
  await svc.listContacts(dto, { roleName: 'superadmin' } as never);
  return seen;
};

describe('[FEAT-20260823-CONTACTFOLLOW] the four follow modes', () => {
  it('⭐ deposit asks the members collection for the DEPOSIT stamp only', async () => {
    const seen = await run({ follow: 'deposit' }, [id('m1')]);
    expect(seen.memberFilters).toEqual([{ [DEP]: HAS }]);
    expect(seen.match?.['user_id']).toEqual({ $in: [expect.anything()] });
  });

  it('⭐ withdraw asks for the WITHDRAW stamp only', async () => {
    const seen = await run({ follow: 'withdraw' }, [id('m1')]);
    expect(seen.memberFilters).toEqual([{ [WIT]: HAS }]);
  });

  it('⭐ both demands the two together, not either', async () => {
    const seen = await run({ follow: 'both' }, [id('m1')]);
    expect(seen.memberFilters).toEqual([{ [DEP]: HAS, [WIT]: HAS }]);
    expect(JSON.stringify(seen.memberFilters)).not.toContain('$or');
  });

  it('⭐ none is $nin of the STAMPED ids — never $in of everyone else', async () => {
    /* The stamped set is the small one. Listing the unstamped members would be
       "almost every member" and would grow without bound. */
    const seen = await run({ follow: 'none' }, [id('m1')]);
    expect(seen.memberFilters).toEqual([
      { $or: [{ [DEP]: HAS }, { [WIT]: HAS }] },
    ]);
    const uid = seen.match?.['user_id'] as Record<string, unknown>;
    expect(uid['$nin']).toBeDefined();
    expect(uid['$in']).toBeUndefined();
  });
});

describe('[FEAT-20260823-CONTACTFOLLOW] ⭐ it changes NOTHING when not asked for', () => {
  it.each([
    ['absent', {}],
    ['empty string', { follow: '' }],
    ['the FE "all" sentinel', { follow: 'all' }],
    ['a typo', { follow: 'depsoit' }],
    ['junk', { follow: '{"$ne":null}' }],
  ])('%s leaves the member collection untouched', async (_l, dto) => {
    const seen = await run(dto);
    expect(seen.memberFilters).toEqual([]);
    expect(seen.match?.['user_id']).toBeUndefined();
  });

  it('⭐ and the filter is byte-identical to the one without the feature', async () => {
    const withOut = await run({});
    const withJunk = await run({ follow: 'nope' });
    expect(JSON.stringify(withJunk.match)).toBe(JSON.stringify(withOut.match));
  });
});

describe('[FEAT-20260823-CONTACTFOLLOW] ⭐ it composes with the tag filter', () => {
  it('⭐ INTERSECTS with tag rather than overwriting it', async () => {
    /* Overwriting would silently WIDEN a tag filter — the operator asked for
       "tag X and followed", and would get "followed", tag ignored. */
    const seen = await run(
      { follow: 'deposit', tag: 'a0d00000000000000000000a' },
      [id('m1'), id('m2')],
      ['m2', 'm3'],
    );
    const ids = (seen.match?.['user_id'] as { $in: unknown[] }).$in.map(String);
    expect(ids).toEqual(['m2']); // only the member in BOTH sets
  });

  it('⭐ an empty intersection returns nothing, not everything', async () => {
    const seen = await run(
      { follow: 'deposit', tag: 'a0d00000000000000000000a' },
      [id('m1')],
      ['m9'],
    );
    expect(seen.match).toBeNull(); // short-circuited before the aggregation
  });

  it('⭐ none keeps the tag $in and adds $nin beside it', async () => {
    const seen = await run(
      { follow: 'none', tag: 'a0d00000000000000000000a' },
      [id('m1')],
      ['m2'],
    );
    const uid = seen.match?.['user_id'] as Record<string, unknown>;
    expect(uid['$in']).toBeDefined();
    expect(uid['$nin']).toBeDefined();
  });
});

describe('[FEAT-20260823-CONTACTFOLLOW] the empty cases', () => {
  it('⭐ a positive mode matching nobody returns an empty page, not every room', async () => {
    const seen = await run({ follow: 'deposit' }, []);
    expect(seen.match).toBeNull();
    expect(seen.counted).toEqual([]);
  });

  it('none matching nobody still lists everyone — $nin of an empty list', async () => {
    const seen = await run({ follow: 'none' }, []);
    expect(seen.match?.['user_id']).toEqual({ $nin: [] });
  });
});
