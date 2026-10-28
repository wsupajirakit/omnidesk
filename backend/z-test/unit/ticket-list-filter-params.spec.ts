/**
 * [FEAT-20260826-TKTFILTERPARAMS] 📖 docs/bottleneck_26_aug.md (S5 · layer 3 · 3a)
 * `oa` / `tag` / `tier` become server params — and ABSENT params walk the
 * byte-identical legacy path.
 * ============================================================================
 * Layer 3 cannot page the open tab while these three filters live only in the
 * browser (fe_todo73 §1.3: a filtered page would silently lose cases). This
 * lands the BE half, opt-in per request, mirroring the SCREEN's predicates:
 *   oa   → `tk.line_oa_hook_id !== filterOa` (TicketChat.tsx:1848/:2031)
 *   tag  → `customer_tags.some(cg => cg.tag_id === filterTag)` (:1852/:2037)
 *   tier → `tierKeyOf(tierOfMember(line_user_data)) === filterTier` (:1853/:2038)
 * Multiple member-narrowing constraints (search / line_user_id / tag / tier)
 * intersect as id-sets — AND, exactly like the screen applies them.
 *
 * Harness style: ticket-list-cursor.spec.ts (real service, stubbed models).
 */
import { Types } from 'mongoose';

import { TicketsService } from '@/modules/tickets';
import {
  memberTierKey,
  tierKeyOfBE,
  tierOfMemberBE,
  TIER_KEY_PROJECTION,
} from '@/modules/tickets/member-tier-key.util';

const H1 = new Types.ObjectId('a0d000000000000000000017');
const H2 = new Types.ObjectId('a0d000000000000000000018');
const U = (hex: string) => new Types.ObjectId(hex.padEnd(24, '0'));

function stub(opts: {
  scope?: Types.ObjectId[];
  searchMembers?: Array<{ _id: Types.ObjectId }>;
  tagMembers?: Types.ObjectId[];
  ticketUsers?: Types.ObjectId[]; // distinct chat_user_id of the scope
  tierDocs?: Array<Record<string, unknown>>;
  /* PART 3 — override the ACTIVE provider's tier paths for one case. */
  tierPaths?: readonly string[];
}) {
  const calls = {
    find: [] as unknown[],
    count: [] as unknown[],
    distinct: [] as Array<[string, unknown]>,
    tagDistinct: [] as unknown[],
    memberFinds: [] as Array<{ filter: unknown; projection: unknown }>,
  };
  const q: Record<string, unknown> = {};
  for (const m of ['populate', 'select', 'sort', 'skip', 'limit', 'lean'])
    q[m] = jest.fn(() => (m === 'lean' ? Promise.resolve([]) : q));
  const ticketModel = {
    find: jest.fn((f: unknown) => {
      calls.find.push(f);
      return q;
    }),
    countDocuments: jest.fn((f: unknown) => {
      calls.count.push(f);
      return Promise.resolve(0);
    }),
    distinct: jest.fn((field: string, f: unknown) => {
      calls.distinct.push([field, f]);
      return Promise.resolve(opts.ticketUsers ?? []);
    }),
  };
  const memberModel = {
    find: jest.fn((filter: unknown, projection: unknown) => {
      calls.memberFinds.push({ filter, projection });
      // search path passes '_id' string projection; tier path passes the object
      const rows =
        projection === '_id'
          ? (opts.searchMembers ?? [])
          : (opts.tierDocs ?? []);
      const chain = {
        limit: () => chain,
        lean: () => Promise.resolve(rows),
      };
      return chain;
    }),
  };
  const customerTagModel = {
    /* [FIX-20260827-TSCINDEX] `_field` — this mock mirrors Mongoose's
       `distinct(field, filter)` arity, but only the FILTER is asserted here
       (the sibling mock at :57 DOES read the field, so it keeps the plain
       name). `noUnusedParameters: true` (tsconfig.json:31) rejects an unused
       one; the `_` prefix is this repo's existing way of keeping the shape. */
    distinct: jest.fn((_field: string, f: unknown) => {
      calls.tagDistinct.push(f);
      return Promise.resolve(opts.tagMembers ?? []);
    }),
  };
  const service = new TicketsService(
    ticketModel as never,
    {} as never,
    {} as never,
    {} as never,
    memberModel as never,
    customerTagModel as never,
    {} as never,
    {} as never,
    {} as never,
    /* [FEAT-20260905-CUSTPROV PART 3] the ACTIVE provider decides both the tier
       paths and the Mongo projection that fetches them. Overridable here so a
       case can prove a vendor's paths reach the QUERY, not only the reader —
       the hole that existed while the projection was hardcoded. */
    {
      resolve: () => ({
        tierPaths: opts.tierPaths ?? [
          'data.profile.tier',
          'profile.tier',
          'tier',
        ],
      }),
    } as never,
  );
  jest
    .spyOn(service as never, 'resolveScopeHookIds')
    .mockResolvedValue((opts.scope ?? [H1, H2]) as never);
  jest
    .spyOn(service as never, 'enrichTicketRows')
    .mockResolvedValue([] as never);
  return { service, calls };
}

describe('⭐ absent params: the legacy path, byte for byte', () => {
  it('no oa/tag/tier → same filter shape, no distinct, no tag lookup, no member read', async () => {
    const { service, calls } = stub({});
    await service.listTickets({ job_status: '2', limit: 'all' }, String(H1));
    expect(calls.find[0]).toEqual({
      hook_id: { $in: [H1, H2] },
      job_status: 2,
    });
    expect(calls.distinct).toHaveLength(0);
    expect(calls.tagDistinct).toHaveLength(0);
    expect(calls.memberFinds).toHaveLength(0);
  });
});

describe('⭐ oa narrows the resolved scope', () => {
  it('an in-scope oa reduces the filter to that single hook', async () => {
    const { service, calls } = stub({});
    await service.listTickets(
      { job_status: '2', limit: 'all', oa: String(H2) },
      String(H1),
    );
    expect(calls.find[0]).toEqual({ hook_id: H2, job_status: 2 });
  });

  it('⭐ an out-of-scope oa answers the EMPTY shape without touching tickets', async () => {
    const { service, calls } = stub({});
    const res = await service.listTickets(
      { job_status: '2', limit: 'all', oa: 'a0d000000000000000000019' },
      String(H1),
    );
    expect(calls.find).toHaveLength(0);
    expect(res['data']).toEqual([]);
    expect((res['pagination'] as Record<string, unknown>)['total']).toBe(0);
  });
});

describe('⭐ tag = the member set carrying that tag_id', () => {
  it('tag alone → distinct(member_id, {tag_id}) ANDed into chat_user_id', async () => {
    const m2 = U('2');
    const { service, calls } = stub({ tagMembers: [m2] });
    await service.listTickets({ limit: 'all', tag: 'tag-1' }, String(H1));
    expect(calls.tagDistinct[0]).toEqual({ tag_id: 'tag-1' });
    expect((calls.find[0] as Record<string, unknown>)['chat_user_id']).toEqual({
      $in: [m2],
    });
  });

  it('⭐ tag ∩ search — both constraints hold, like the screen', async () => {
    const m1 = U('1');
    const m2 = U('2');
    const m3 = U('3');
    const { service, calls } = stub({
      searchMembers: [{ _id: m1 }, { _id: m2 }],
      tagMembers: [m2, m3],
    });
    await service.listTickets(
      { limit: 'all', search: 'Som', tag: 'tag-1' },
      String(H1),
    );
    const cu = (calls.find[0] as Record<string, unknown>)['chat_user_id'] as {
      $in: unknown[];
    };
    expect(cu.$in.map(String)).toEqual([String(m2)]);
  });
});

describe('⭐ tier = the screen key, computed in Node over the scope members', () => {
  const u1 = U('1');
  const u2 = U('2');
  const u3 = U('3');
  const tierDocs = [
    // '' at every raw level + level 0 → key '0' (the Normal-0 edge)
    {
      _id: u1,
      raw_profile_data: {
        data: { profile: { tier: { code: '', name: '', level: 0 } } },
      },
    },
    // raw tier '' is TRUTHY-gated out → member.tier 'VIP' wins → 'vip'
    {
      _id: u2,
      raw_profile_data: { data: { profile: { tier: '' } } },
      tier: 'VIP',
    },
    { _id: u3 }, // no tier anywhere → ''
  ];

  it('members are pooled from the scope tickets and read with the narrow projection', async () => {
    const { service, calls } = stub({ ticketUsers: [u1, u2, u3], tierDocs });
    await service.listTickets(
      { job_status: '0,1', limit: 'all', tier: '0' },
      String(H1),
    );
    expect(calls.distinct[0]![0]).toBe('chat_user_id');
    expect(calls.memberFinds[0]!.projection).toEqual(TIER_KEY_PROJECTION);
    expect((calls.find[0] as Record<string, unknown>)['chat_user_id']).toEqual({
      $in: [u1],
    });
  });

  it("tier 'vip' picks the truthy-gate fallback member", async () => {
    const { service, calls } = stub({ ticketUsers: [u1, u2, u3], tierDocs });
    await service.listTickets({ limit: 'all', tier: 'vip' }, String(H1));
    expect((calls.find[0] as Record<string, unknown>)['chat_user_id']).toEqual({
      $in: [u2],
    });
  });
});

describe('⭐ the ported tier pair matches the FE vectors', () => {
  it('tierKeyOf edges: level 0 kept, empty strings skipped, primitives lowered', () => {
    expect(tierKeyOfBE({ code: '', name: '', level: 0 })).toBe('0');
    expect(tierKeyOfBE({ code: null, name: 'Gold', level: 2 })).toBe('gold');
    expect(tierKeyOfBE({ code: 'VIP9' })).toBe('vip9');
    expect(tierKeyOfBE('VIP')).toBe('vip');
    expect(tierKeyOfBE(3)).toBe('3');
    expect(tierKeyOfBE('')).toBe('');
    expect(tierKeyOfBE(null)).toBe('');
    expect(tierKeyOfBE({ code: '', name: '' })).toBe('');
  });

  it('tierOfMember edges: ?? per level but truthy-gated overall', () => {
    expect(
      tierOfMemberBE({
        raw_profile_data: { data: { profile: { tier: 'X' } } },
      }),
    ).toBe('X');
    // '' survives the ?? chain but fails the truthy gate → member.tier wins
    expect(
      tierOfMemberBE({
        raw_profile_data: { data: { profile: { tier: '' } } },
        tier: 'Y',
      }),
    ).toBe('Y');
    expect(
      tierOfMemberBE({ raw_profile_data: { profile: { tier: 'Z' } } }),
    ).toBe('Z');
    expect(tierOfMemberBE({ raw_profile_data: { tier: 'W' } })).toBe('W');
    expect(tierOfMemberBE({ tier: 'T' })).toBe('T');
    expect(tierOfMemberBE({})).toBeNull();
    expect(memberTierKey({ tier: { name: 'Silver', level: 1 } })).toBe(
      'silver',
    );
  });
});

/**
 * [FIX-20260827-TKTMEMBERPARAM] 📖 todo/task/27082026/todo1_27082026_tickets-line-user-id-fix.md
 * `line_user_id` — ชื่อลวงที่รับ member ObjectId · guard เงียบกลายเป็น 400 ที่ดัง
 * ============================================================================
 * บั๊กเดิม (ชั้น 1a ของแผน): `if (line_user_id && isValidObjectId(line_user_id))`
 * — ส่ง LINE id ("Uxxx…") มา เงื่อนไขเป็น false ⇒ **ตัดตัวกรองทิ้งเงียบ ๆ** ⇒ ได้
 * ตั๋วทุกใบใน scope แทนของลูกค้าคนเดียว และ FE เรียกด้วย `limit:'all'` โดยพึ่ง
 * ตัวกรองนี้เป็นตัวจำกัด (TicketChat.tsx:1734-1736) ⇒ หลุด = ดึงไม่จำกัด
 * เหยื่อชื่อนี้มาแล้ว 4 ราย — divider / catupgrade / payment / close-case
 */
describe('[FIX-20260827-TKTMEMBERPARAM] line_user_id/member_id — ดังเมื่อผิด เงียบเมื่อว่าง', () => {
  const MID = 'a0d000000000000000000019';
  const LINE_ID = 'Ubad099ef9766d47be58cc2fd4c16244e';

  it('🔴 ส่ง LINE id ⇒ 400 ไม่ใช่คืนทุกใบเงียบ ๆ', async () => {
    const { service, calls } = stub({});
    await expect(
      service.listTickets(
        { job_status: '0,1', line_user_id: LINE_ID, limit: 'all' },
        String(H1),
      ),
    ).rejects.toMatchObject({ status: 400 });
    // และต้องพังก่อนแตะ collection — ไม่ใช่คิวรี่ไปแล้วค่อยล้ม
    expect(calls.find.length).toBe(0);
  });

  it('ObjectId ถูกต้อง ⇒ กรองลง chat_user_id เหมือนเดิม (ปักพฤติกรรมเดิม)', async () => {
    const { service, calls } = stub({});
    await service.listTickets(
      { job_status: '2', line_user_id: MID, limit: '10' },
      String(H1),
    );
    const f = calls.count[0] as Record<string, unknown>;
    expect(String(f['chat_user_id'])).toBe(MID);
  });

  it('ไม่ส่ง / ส่งค่าว่าง ⇒ ไม่กรอง ไม่ throw (เหมือนเดิมทุกไบต์)', async () => {
    const { service, calls } = stub({});
    await service.listTickets({ job_status: '2', limit: '10' }, String(H1));
    await service.listTickets(
      { job_status: '2', line_user_id: '', limit: '10' },
      String(H1),
    );
    for (const f of calls.count as Array<Record<string, unknown>>) {
      expect('chat_user_id' in f).toBe(false);
    }
  });

  it('member_id (ชื่อที่ตรงความหมาย) ใช้แทนได้ ผลเท่ากันเป๊ะ', async () => {
    const { service, calls } = stub({});
    await service.listTickets(
      { job_status: '2', member_id: MID, limit: '10' },
      String(H1),
    );
    const f = calls.count[0] as Record<string, unknown>;
    expect(String(f['chat_user_id'])).toBe(MID);
  });

  it('🔴 member_id ก็ต้องเป็น ObjectId — LINE id ⇒ 400 เท่ากัน', async () => {
    const { service } = stub({});
    await expect(
      service.listTickets({ member_id: LINE_ID, limit: '10' }, String(H1)),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('🔴 ส่งทั้งสองชื่อแล้วค่าขัดกัน ⇒ 400 — ความกำกวมต้องดัง ไม่เลือกเงียบ ๆ', async () => {
    const { service } = stub({});
    await expect(
      service.listTickets(
        {
          member_id: MID,
          line_user_id: 'a0d000000000000000000039',
          limit: '10',
        },
        String(H1),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('ส่งทั้งสองชื่อค่าตรงกัน ⇒ ผ่าน กรองปกติ (คนย้ายชื่อกลางทางไม่โดนลงโทษ)', async () => {
    const { service, calls } = stub({});
    await service.listTickets(
      { member_id: MID, line_user_id: MID, limit: '10' },
      String(H1),
    );
    const f = calls.count[0] as Record<string, unknown>;
    expect(String(f['chat_user_id'])).toBe(MID);
  });
});

/**
 * [FIX-20260827-CHANNELUSERPARAM] 📖 todo/task/27082026/todo5_27082026_floatup-identity-contexts.md
 * `channel_user_id` — the neutral EXTERNAL id, resolved to a member before filtering.
 * ============================================================================
 * Proven by firing the real flow (not guessed): the float-up's WS leg sends the
 * customer's EXTERNAL id (`Uxxx…`, from `message:new` whose publisher explicitly
 * carries `room.line_user_id` — chat-history.service.ts:450) while the list
 * filter takes the member's Mongo `_id`. The two id spaces never overlap
 * (24-hex vs `U`+32-hex), but the param contract must say which one it wants.
 *
 * `channel_user_id` is the channel-neutral name the migration already uses
 * (`mirror-field-pair.ts`: chat_rooms line_user_id ↔ channel_user_id) and the
 * FE already sends elsewhere (ticketService.ts:290,310). The resolve uses the
 * members mirror pair `$or [{member_user_id},{line_user_id}]` — the exact
 * precedent of ticket-category-upgrade.helper.ts:160 — so nothing here is
 * pinned to the word "line".
 *
 * 🔴 UNKNOWN id ⇒ EMPTY LIST, never "no filter". Silently widening to every
 * ticket is the exact bug the 400 guard was built to kill.
 */
describe('[FIX-20260827-CHANNELUSERPARAM] channel_user_id — resolve แล้วกรอง', () => {
  const MID = new Types.ObjectId('a0d000000000000000000088');
  const EXT = 'Uhelperflow00000000000000000test1';

  const stubWithMember = (found: boolean) => {
    const base = stub({});
    const memberFindOne = jest.fn(() => ({
      select: () => ({
        lean: () => ({
          exec: () => Promise.resolve(found ? { _id: MID } : null),
        }),
      }),
    }));
    (base.service as unknown as { memberModel: unknown }).memberModel = {
      ...(base.service as unknown as { memberModel: object }).memberModel,
      findOne: memberFindOne,
    };
    return { ...base, memberFindOne };
  };

  it('🔴 Uxxx ที่มี member ⇒ resolve เป็น _id แล้วกรอง chat_user_id ถูกคน', async () => {
    const { service, calls, memberFindOne } = stubWithMember(true);
    await service.listTickets(
      { job_status: '0,1', channel_user_id: EXT, limit: 'all' } as never,
      String(H1),
    );
    const f = calls.count[0] as Record<string, unknown>;
    expect(String(f['chat_user_id'])).toBe(String(MID));
    // resolve ต้องครอบทั้งคู่ mirror — ไม่ผูกชื่อ line เดี่ยว ๆ
    const mf = (memberFindOne.mock.calls[0] as unknown[])[0] as {
      $or: Record<string, unknown>[];
    };
    const keys = mf.$or.map((c) => Object.keys(c)[0]).sort();
    expect(keys).toEqual(['line_user_id', 'member_user_id']);
  });

  it('🔴 Uxxx ที่ไม่รู้จัก ⇒ ลิสต์ว่าง — ห้ามตัดตัวกรองทิ้งเด็ดขาด', async () => {
    const { service, calls } = stubWithMember(false);
    const res = (await service.listTickets(
      {
        channel_user_id: 'Unknowna0d000000000000000000010x',
        limit: 'all',
      } as never,
      String(H1),
    )) as { data: unknown[] };
    expect(res.data).toEqual([]);
    expect(calls.find.length).toBe(0); // ไม่แตะ collection เลย
    expect(calls.count.length).toBe(0);
  });

  it('ส่งคู่กับ member_id แล้วขัดกัน ⇒ 400 (กติกาความกำกวมเดิม)', async () => {
    const { service } = stubWithMember(true);
    await expect(
      service.listTickets(
        {
          channel_user_id: EXT,
          member_id: 'a0d000000000000000000039',
          limit: '10',
        } as never,
        String(H1),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('ไม่ส่ง ⇒ พฤติกรรมเดิมทุกไบต์ (ไม่มี resolve ไม่มี filter)', async () => {
    const { service, calls, memberFindOne } = stubWithMember(true);
    await service.listTickets({ job_status: '2', limit: '10' }, String(H1));
    expect(memberFindOne).not.toHaveBeenCalled();
    const f = calls.count[0] as Record<string, unknown>;
    expect('chat_user_id' in f).toBe(false);
  });
});

/**
 * ⭐⭐ PART 3 END TO END — a vendor's tier paths reach the QUERY, not just the
 * reader.
 *
 * 🔴 THIS IS THE CASE THAT WOULD HAVE CAUGHT THE HOLE. Until 05/09 the Mongo
 * projection listed the three paths as literals while the reader took them as a
 * parameter, so a provider could declare `meta.rank`, the reader would look
 * there, and Mongo would have stripped the field before it arrived: configurable
 * paths, `null` answers, and nothing anywhere to say why.
 * เปลี่ยน path ได้แต่ query ยังดึงของเก่า = แก้แล้วเหมือนไม่ได้แก้
 */
describe('⭐ the active provider decides what the tier query fetches', () => {
  const v1 = U('1');
  const v2 = U('2');

  it('a vendor with its own tierPaths changes the projection AND the match', async () => {
    const { service, calls } = stub({
      ticketUsers: [v1, v2],
      tierDocs: [
        { _id: v1, raw_profile_data: { meta: { rank: 'Diamond' } } },
        { _id: v2, raw_profile_data: { meta: { rank: 'Bronze' } } },
      ],
      tierPaths: ['meta.rank'],
    });
    await service.listTickets(
      { job_status: '0,1', limit: 'all', tier: 'diamond' },
      String(H1),
    );

    // The QUERY asked Mongo for the vendor's field, not shopapi_v1's three.
    expect(calls.memberFinds[0]!.projection).toEqual({
      tier: 1,
      'raw_profile_data.meta.rank': 1,
    });
    // And the READER keyed off the same place, so only v1 survives the filter.
    expect(
      (
        (calls.find[0] as Record<string, unknown>)['chat_user_id'] as {
          $in: unknown[];
        }
      ).$in.map(String),
    ).toEqual([String(v1)]);
  });
});
