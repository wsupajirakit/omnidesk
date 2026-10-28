/**
 * [FEAT-20260824-BCASTTAGPRE] Targeting a campaign by customer tag.
 * ===========================================================================
 * เจ้าของ 24/08: *"เพิ่ม ท่อ สามารถเลือกเป้าหมาย จาก customer tag ได้ด้วย ว่า member คนไหน
 * ใช้ tag นี้"* · *"seamless ไหมกระทบไหม ห้ามพังระบบนะ"* · *"ห้ามสร้างหนี้ ห้ามบวม ห้ามคอขวด"*
 *
 * Every case here is about one of four ways this can send to the WRONG people:
 *   1. a campaign with no tag rule behaving even slightly differently          → §1
 *   2. `match: 'or'` losing the other conditions (fails narrow, silently)      → §3
 *   3. an empty resolve becoming "everyone" (fails WIDE — the worst one)       → §4
 *   4. the pager's keyset cursor erasing the id clause from page 2 onward      → §6
 */
import { readFileSync } from 'node:fs';

import {
  AUDIENCE_SOURCES,
  CUSTOMER_TAG_KEY,
  PREFILTER_RESOLVERS,
  buildAudienceFilter,
  getAudienceSource,
  getPrefilterResolver,
  keysetSafeFilter,
  needsPrefilter,
  resolveAudiencePrefilter,
  unindexedKeys,
  withCursor,
  type AudienceQuery,
  type PrefilterLookup,
} from '@/modules/content';

const TAG_A = 'a0d00000000000000000002a'; // real rows on the lane db, 24/08
const TAG_B = 'a0d000000000000000000007';
const MEM_1 = 'a0d00000000000000000002b';
const MEM_2 = 'a0d00000000000000000002c';

/** A reader that answers with rows and counts how many times it was asked. */
function reader(rows: Array<Record<string, unknown>>) {
  const calls: PrefilterLookup[] = [];
  return {
    calls,
    read: (lookup: PrefilterLookup) => {
      calls.push(lookup);
      return Promise.resolve(rows as readonly unknown[]);
    },
  };
}

const tagRule = (op: 'eq' | 'in', value: unknown) => ({
  key: CUSTOMER_TAG_KEY,
  op,
  value,
});

/* Fixed so a case can assert the exact value; production generates a random one
   per resolve — §4 pins that it is never a real member id. */
const SENTINEL = 'a0d000000000000000000014';
const stub = { newSentinelId: () => SENTINEL };

/* ══ §0 the two registries must agree ═══════════════════════════════════════ */
describe('§0 registry — a key in one table and not the other matches nobody', () => {
  it('the tag key is offered, and it is offered with `path: "_id"`', () => {
    const s = getAudienceSource(CUSTOMER_TAG_KEY);
    expect(s).not.toBeNull();
    expect(s?.path).toBe('_id');
    expect(s?.ops).toEqual(['eq', 'in']);
    /* `members` has no hook_id — the OA narrowing still happens in the pager.
       A `true` here would skip it and reach members of OTHER OAs. */
    expect(s?.scope_by_hook).toBe(false);
    /* Both halves are indexed: `tag_id_1` on the join, `_id_` on members. */
    expect(s?.indexed).toBe(true);
    expect(unindexedKeys([s!])).toEqual([]);
  });

  it('🔴 every pre-filter resolver has a registry entry with `path: "_id"`', () => {
    /* A resolver with no entry resolves a rule the builder then refuses; an
       entry with no resolver reaches Mongo still holding TAG ids in an `_id`
       clause — valid, silent, and empty. */
    for (const r of PREFILTER_RESOLVERS) {
      const s = getAudienceSource(r.key);
      expect(s).not.toBeNull();
      expect(s?.path).toBe('_id');
    }
  });

  it('🔴 …and every `_id` entry has a resolver', () => {
    for (const s of Object.values(AUDIENCE_SOURCES)) {
      if (s.path === '_id') expect(getPrefilterResolver(s.key)).not.toBeNull();
    }
  });

  it('the registry does NOT import the pre-filter folder — it must stay deletable', () => {
    const src = readFileSync(
      'src/modules/content/audience/sources/audience-source.registry.ts',
      'utf8',
    );
    expect(src).not.toMatch(/^import .*prefilter/m);
  });
});

/* ══ §1 a campaign with no tag rule ═════════════════════════════════════════ */
describe('§1 no tag rule ⇒ byte-identical to today, and no extra query', () => {
  it('🔴 returns the SAME OBJECT and never asks the database anything', async () => {
    const q: AudienceQuery = {
      match: 'and',
      rules: [{ key: 'display_name', op: 'eq', value: 'a' }],
    };
    const io = reader([{ member_id: MEM_1 }]);
    const out = await resolveAudiencePrefilter(q, { read: io.read });
    expect(out.ok).toBe(true);
    /* `toBe`, not `toEqual`: an equal-but-new object would still be a change in
       what `runBroadcast` is handed. เท่ากันไม่พอ ต้องเป็นตัวเดิม. */
    expect(out.ok && out.audience).toBe(q);
    expect(out.ok && out.resolved).toBe(false);
    expect(io.calls).toHaveLength(0);
  });

  it('an empty rule list is untouched — "everyone" is still a real answer', async () => {
    const q: AudienceQuery = { match: 'and', rules: [] };
    const io = reader([]);
    const out = await resolveAudiencePrefilter(q, { read: io.read });
    expect(out.ok && out.audience).toBe(q);
    expect(io.calls).toHaveLength(0);
    expect(buildAudienceFilter(q)).toEqual({
      ok: true,
      filter: {},
      usedSources: [],
    });
  });

  it('the filter such a campaign builds is handed on unchanged', () => {
    const built = buildAudienceFilter({
      match: 'and',
      rules: [{ key: 'display_name', op: 'eq', value: 'a' }],
    });
    expect(built.ok).toBe(true);
    const f = built.ok ? built.filter : {};
    // Same reference out — the guard cannot touch a filter with no `_id`.
    expect(keysetSafeFilter(f)).toBe(f);
  });

  it('`needsPrefilter` is the gate, and it says no for every ordinary rule', () => {
    expect(needsPrefilter([])).toBe(false);
    expect(needsPrefilter([{ key: 'tier.code', op: 'eq', value: 'x' }])).toBe(
      false,
    );
    expect(needsPrefilter([null, 7, 'x'])).toBe(false);
    expect(needsPrefilter([tagRule('in', [TAG_A])])).toBe(true);
  });
});

/* ══ §2 the resolve itself ══════════════════════════════════════════════════ */
describe('§2 the join — planned here, run by the caller', () => {
  it('plans ONE indexed lookup on `customer_tags`, projecting only member_id', async () => {
    const io = reader([{ member_id: MEM_1 }]);
    await resolveAudiencePrefilter(
      { match: 'and', rules: [tagRule('in', [TAG_A, TAG_B])] },
      { read: io.read, ...stub },
    );
    expect(io.calls).toHaveLength(1);
    expect(io.calls[0]!).toMatchObject({
      ruleIndex: 0,
      model: 'CustomerTag',
      filter: { tag_id: { $in: [TAG_A, TAG_B] } },
      projection: { member_id: 1, _id: 0 },
      memberIdField: 'member_id',
    });
  });

  it('substitutes member ids into the rule and leaves the key alone', async () => {
    const io = reader([{ member_id: MEM_1 }, { member_id: MEM_2 }]);
    const out = await resolveAudiencePrefilter(
      { match: 'and', rules: [tagRule('in', [TAG_A])] },
      { read: io.read, ...stub },
    );
    expect(out.ok && out.audience.rules).toEqual([
      { key: CUSTOMER_TAG_KEY, op: 'in', value: [MEM_1, MEM_2] },
    ]);
    expect(out.ok && out.resolved && out.matched).toBe(2);
  });

  it('`eq` on one tag is normalised to a one-element `$in`', async () => {
    const io = reader([{ member_id: MEM_1 }]);
    const out = await resolveAudiencePrefilter(
      { match: 'and', rules: [tagRule('eq', TAG_A)] },
      { read: io.read, ...stub },
    );
    expect(io.calls[0]!.filter).toEqual({ tag_id: { $in: [TAG_A] } });
    expect(out.ok && out.audience.rules[0]!).toEqual({
      key: CUSTOMER_TAG_KEY,
      op: 'in',
      value: [MEM_1],
    });
  });

  it('reads ObjectId-shaped ids, and never through `String()`', async () => {
    /* `String(obj)` on anything without `toHexString` yields '[object Object]',
       and a list of those dedupes to ONE id — a tag with 500 members would
       resolve to a single bogus id. ห้าม String() ตรง ๆ. */
    const io = reader([
      { member_id: { toHexString: () => MEM_1 } },
      { member_id: { nope: true } },
      { member_id: null },
      { member_id: '  ' },
    ]);
    const out = await resolveAudiencePrefilter(
      { match: 'and', rules: [tagRule('in', [TAG_A])] },
      { read: io.read, ...stub },
    );
    expect(out.ok && out.audience.rules[0]!.value).toEqual([MEM_1]);
  });

  it('dedupes a member who carries two of the named tags', async () => {
    const io = reader([
      { member_id: MEM_1 },
      { member_id: MEM_1 },
      { member_id: MEM_2 },
    ]);
    const out = await resolveAudiencePrefilter(
      { match: 'and', rules: [tagRule('in', [TAG_A, TAG_B])] },
      { read: io.read, ...stub },
    );
    expect(out.ok && out.audience.rules[0]!.value).toEqual([MEM_1, MEM_2]);
  });

  it('the resolved rule builds the `members` clause the pager will page', async () => {
    const io = reader([{ member_id: MEM_1 }]);
    const out = await resolveAudiencePrefilter(
      { match: 'and', rules: [tagRule('in', [TAG_A])] },
      { read: io.read, ...stub },
    );
    const built = buildAudienceFilter(out.ok ? out.audience : ({} as never));
    expect(built.ok && built.filter).toEqual({ _id: { $in: [MEM_1] } });
  });
});

/* ══ §3 and / or ════════════════════════════════════════════════════════════ */
describe('§3 🔴 `or` — the rule is rewritten IN PLACE, never AND-ed over the top', () => {
  const other = { key: 'display_name', op: 'eq' as const, value: 'ann' };

  it('an OR keeps the tag clause INSIDE the $or, so the other rule still fires', async () => {
    const io = reader([{ member_id: MEM_1 }]);
    const out = await resolveAudiencePrefilter(
      { match: 'or', rules: [tagRule('in', [TAG_A]), other] },
      { read: io.read, ...stub },
    );
    const built = buildAudienceFilter(out.ok ? out.audience : ({} as never));
    expect(built.ok && built.filter).toEqual({
      $or: [{ _id: { $in: [MEM_1] } }, { display_name: 'ann' }],
    });
  });

  it('🔴 and it is NOT the naive merge, which would drop everyone matching only the other rule', async () => {
    const io = reader([{ member_id: MEM_1 }]);
    const out = await resolveAudiencePrefilter(
      { match: 'or', rules: [tagRule('in', [TAG_A]), other] },
      { read: io.read, ...stub },
    );
    const built = buildAudienceFilter(out.ok ? out.audience : ({} as never));
    const wrong = {
      $and: [{ $or: [{ display_name: 'ann' }] }, { _id: { $in: [MEM_1] } }],
    };
    expect(built.ok && built.filter).not.toEqual(wrong);
  });

  it('an AND puts it beside the others, in the position the admin built', async () => {
    const io = reader([{ member_id: MEM_1 }]);
    const out = await resolveAudiencePrefilter(
      { match: 'and', rules: [other, tagRule('in', [TAG_A])] },
      { read: io.read, ...stub },
    );
    const built = buildAudienceFilter(out.ok ? out.audience : ({} as never));
    expect(built.ok && built.filter).toEqual({
      $and: [{ display_name: 'ann' }, { _id: { $in: [MEM_1] } }],
    });
  });

  it('two tag rules each get their own lookup and their own clause', async () => {
    const calls: PrefilterLookup[] = [];
    const out = await resolveAudiencePrefilter(
      {
        match: 'or',
        rules: [tagRule('in', [TAG_A]), tagRule('in', [TAG_B])],
      },
      {
        read: (l) => {
          calls.push(l);
          return Promise.resolve(
            calls.length === 1
              ? [{ member_id: MEM_1 }]
              : [{ member_id: MEM_2 }],
          );
        },
        ...stub,
      },
    );
    expect(calls.map((c) => c.ruleIndex)).toEqual([0, 1]);
    const built = buildAudienceFilter(out.ok ? out.audience : ({} as never));
    expect(built.ok && built.filter).toEqual({
      $or: [{ _id: { $in: [MEM_1] } }, { _id: { $in: [MEM_2] } }],
    });
  });
});

/* ══ §4 the empty resolve — the one that could reach the whole OA ═══════════ */
describe('§4 🔴 a tag nobody carries reaches NOBODY, never everyone', () => {
  it('keeps the condition and fills it with an id no member can have', async () => {
    const io = reader([]);
    const out = await resolveAudiencePrefilter(
      { match: 'and', rules: [tagRule('in', [TAG_A])] },
      { read: io.read, ...stub },
    );
    expect(out.ok).toBe(true);
    expect(out.ok && out.audience.rules).toHaveLength(1);
    expect(out.ok && out.audience.rules[0]!.value).toEqual([SENTINEL]);
    const built = buildAudienceFilter(out.ok ? out.audience : ({} as never));
    /* 🔴 THE CASE. `{}` here — a dropped rule — is the whole OA.
       ทิ้งเงื่อนไข = ยิงทั้ง OA. */
    expect(built.ok && built.filter).not.toEqual({});
    expect(built.ok && built.filter).toEqual({ _id: { $in: [SENTINEL] } });
  });

  it('under `or` the OTHER conditions still fire — an empty tag is not a refusal', async () => {
    const io = reader([]);
    const out = await resolveAudiencePrefilter(
      {
        match: 'or',
        rules: [
          tagRule('in', [TAG_A]),
          { key: 'display_name', op: 'eq', value: 'ann' },
        ],
      },
      { read: io.read, ...stub },
    );
    const built = buildAudienceFilter(out.ok ? out.audience : ({} as never));
    expect(built.ok && built.filter).toEqual({
      $or: [{ _id: { $in: [SENTINEL] } }, { display_name: 'ann' }],
    });
  });

  it('the real sentinel is freshly generated, 24 hex, and never a queried id', async () => {
    const io = reader([]);
    const a = await resolveAudiencePrefilter(
      { match: 'and', rules: [tagRule('in', [TAG_A])] },
      { read: io.read },
    );
    const b = await resolveAudiencePrefilter(
      { match: 'and', rules: [tagRule('in', [TAG_A])] },
      { read: io.read },
    );
    const idA = (a.ok ? a.audience.rules[0]!.value : []) as string[];
    const idB = (b.ok ? b.audience.rules[0]!.value : []) as string[];
    expect(idA[0]!).toMatch(/^[0-9a-f]{24}$/);
    expect(idA[0]!).not.toBe(idB[0]);
    // Never the tag it failed to find, and never a fixed constant somebody
    // could one day insert. ห้ามเป็นค่าคงที่ที่มีคนเผลอ insert ได้.
    expect(idA[0]!).not.toBe(TAG_A);
    expect(idA[0]!).not.toBe('a0d000000000000000000010');
  });

  it('`matched: 0` is reported, so the caller can say the tag found nobody', async () => {
    const io = reader([]);
    const out = await resolveAudiencePrefilter(
      { match: 'and', rules: [tagRule('in', [TAG_A])] },
      { read: io.read, ...stub },
    );
    expect(out.ok && out.resolved && out.matched).toBe(0);
  });
});

/* ══ §5 refusals — readable, and never a throw ══════════════════════════════ */
describe('§5 it refuses with a reason; it never rejects into the send path', () => {
  it('a reader that throws is an answer, not a crashed scheduled run', async () => {
    const out = await resolveAudiencePrefilter(
      { match: 'and', rules: [tagRule('in', [TAG_A])] },
      {
        read: () =>
          Promise.reject(new Error('Schema hasn`t been registered for model')),
      },
    );
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.reason).toMatch(
      /could not read customer tag/,
    );
    expect(out.ok === false && out.reason).toMatch(/registered/);
  });

  it('a value that is not a tag id is refused BEFORE anything is queried', async () => {
    /* Handing a non-castable value to mongoose raises a CastError from inside
       the send. ปฏิเสธก่อนยิง ไม่ใช่ปล่อยให้ throw. */
    const io = reader([{ member_id: MEM_1 }]);
    for (const bad of ['nope', '', 42, null, { $ne: 1 }]) {
      const out = await resolveAudiencePrefilter(
        { match: 'and', rules: [tagRule('in', [bad])] },
        { read: io.read },
      );
      expect(out.ok).toBe(false);
    }
    expect(io.calls).toHaveLength(0);
  });

  it('an operator the resolver cannot plan is refused, never skipped', async () => {
    /* Skipping is a DROPPED filter, and a dropped filter is a wider audience. */
    const io = reader([]);
    const out = await resolveAudiencePrefilter(
      { match: 'and', rules: [{ key: CUSTOMER_TAG_KEY, op: 'lte', value: 1 }] },
      { read: io.read },
    );
    expect(out.ok).toBe(false);
    expect(io.calls).toHaveLength(0);
  });

  it('a condition naming no tag at all is refused', async () => {
    const io = reader([]);
    for (const v of [[], undefined, 'x']) {
      const out = await resolveAudiencePrefilter(
        { match: 'and', rules: [tagRule('in', v)] },
        { read: io.read },
      );
      expect(out.ok).toBe(false);
    }
  });

  it('too many tags in one condition is refused, never trimmed', async () => {
    const io = reader([]);
    const many = Array.from({ length: 21 }, (_, i) =>
      String(i).padStart(24, '0'),
    );
    const out = await resolveAudiencePrefilter(
      { match: 'and', rules: [tagRule('in', many)] },
      { read: io.read },
    );
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.reason).toMatch(/at most 20/);
    expect(io.calls).toHaveLength(0);
  });

  it('a reader that answers with something that is not rows is refused', async () => {
    const out = await resolveAudiencePrefilter(
      { match: 'and', rules: [tagRule('in', [TAG_A])] },
      {
        read: () => Promise.resolve(undefined as unknown as readonly unknown[]),
      },
    );
    expect(out.ok).toBe(false);
  });
});

/* ══ §5b กันบวมชั้นสอง — the ceiling that already exists ════════════════════ */
describe('§5b the bound is the send cell`s own ceiling, not a new constant', () => {
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      member_id: String(i).padStart(24, '0'),
    }));

  it('under the ceiling it resolves normally', async () => {
    const io = reader(rows(10));
    const out = await resolveAudiencePrefilter(
      { match: 'and', rules: [tagRule('in', [TAG_A])] },
      { read: io.read, maxMembers: 10, ...stub },
    );
    expect(out.ok).toBe(true);
    expect(out.ok && out.resolved && out.matched).toBe(10);
  });

  it('🔴 past it the job is REFUSED, and the reason names the number', async () => {
    /* Trimming would pick an arbitrary subset by `_id` order and report a
       success — an admin cannot see who was dropped. ตัดเงียบ ๆ ไม่ได้. */
    const io = reader(rows(11));
    const out = await resolveAudiencePrefilter(
      { match: 'and', rules: [tagRule('in', [TAG_A])] },
      { read: io.read, maxMembers: 10, ...stub },
    );
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.reason).toMatch(/more than 10 members/);
    expect(out.ok === false && out.reason).toMatch(/customer tag/);
  });

  it('a cell that does not address recipients (broadcast) has no bound to apply', async () => {
    const io = reader(rows(5000));
    const out = await resolveAudiencePrefilter(
      { match: 'and', rules: [tagRule('in', [TAG_A])] },
      { read: io.read, maxMembers: null, ...stub },
    );
    expect(out.ok).toBe(true);
  });
});

/* ══ §6 the keyset cursor ═══════════════════════════════════════════════════ */
describe('§6 🔴 the pager`s cursor must not erase the id clause on page 2', () => {
  const point = { hookId: 'h1', afterId: 'm5', nextChunkIndex: 0 };
  const oid = (id: string) => ({ __oid: id });

  it('THE BUG, shown: an unwrapped `_id` clause is gone from page 2', () => {
    /* `withCursor` spreads the filter and then sets `_id` — so a top-level
       `_id` is overwritten and the campaign walks the whole collection.
       This case exists to show the failure the wrap prevents. */
    const raw = { _id: { $in: [MEM_1] } };
    expect(withCursor(raw, point, oid)).toEqual({ _id: { $gt: oid('m5') } });
  });

  it('THE FIX: wrapped, the `$in` survives beside the cursor', () => {
    const safe = keysetSafeFilter({ _id: { $in: [MEM_1] } });
    expect(safe).toEqual({ $and: [{ _id: { $in: [MEM_1] } }] });
    expect(withCursor(safe, point, oid)).toEqual({
      $and: [{ _id: { $in: [MEM_1] } }],
      _id: { $gt: oid('m5') },
    });
  });

  it('page 1 is unchanged either way — which is why the bug hides', () => {
    const safe = keysetSafeFilter({ _id: { $in: [MEM_1] } });
    const page1 = { hookId: 'h1', afterId: null, nextChunkIndex: 0 };
    expect(withCursor(safe, page1, oid)).toEqual(safe);
  });

  it('a filter with no top-level `_id` is handed back untouched, by reference', () => {
    const f = { $and: [{ display_name: 'a' }, { _id: { $in: [MEM_1] } }] };
    expect(keysetSafeFilter(f)).toBe(f);
    const g = { display_name: 'a' };
    expect(keysetSafeFilter(g)).toBe(g);
  });

  it('an explicit `_id: undefined` is wrapped too — the spread would still overwrite it', () => {
    const f = { _id: undefined } as Record<string, unknown>;
    expect(keysetSafeFilter(f)).toEqual({ $and: [f] });
  });

  it('end to end: a single tag rule survives paging', async () => {
    const io = reader([{ member_id: MEM_1 }, { member_id: MEM_2 }]);
    const out = await resolveAudiencePrefilter(
      { match: 'and', rules: [tagRule('in', [TAG_A])] },
      { read: io.read, ...stub },
    );
    const built = buildAudienceFilter(out.ok ? out.audience : ({} as never));
    const safe = keysetSafeFilter(built.ok ? built.filter : {});
    const page2 = withCursor(safe, point, oid);
    expect(JSON.stringify(page2)).toContain(MEM_1);
    expect(JSON.stringify(page2)).toContain(MEM_2);
  });
});

/**
 * [FIX-20260828-TAGOPMISMATCH] `eq` ที่ถือหลายค่า — ข้อความต้องบอกความจริง
 * ===========================================================================
 * เจอบน stg 28/08: แคมเปญตีกลับด้วยข้อความว่าเงื่อนไขต้องระบุ tag ด้วย id
 * ทั้งที่ id **ทั้งสองตัวถูกต้องและมีอยู่จริงใน `tags`** (คิวรี่ยืนยันแล้ว)
 *
 * 🔴 ต้นเหตุ: `eq` ห่อค่าหนึ่งชั้น (`[rule.value]`) ⇒ กฎที่ถูกเซฟเป็น
 *    `{op:'eq', value:[id1,id2]}` มาถึงเป็น `[[id1,id2]]` = สมาชิกตัวเดียวที่เป็น
 *    **อาร์เรย์** ด่านเช็ค id จึงตอบว่า "ต้องระบุด้วย id" ซึ่งเป็นคำตอบที่ผิด
 *    และส่งคนอ่านไปไล่หา id เสียที่ไม่มีอยู่จริง — ความผิดอยู่ที่ **operator**
 *
 * 🔴 ต้อง **ปฏิเสธ** ไม่ใช่ตีความใหม่เป็น `in` ให้เอง — การเดาเจตนาแล้วขยายเป็น
 *    หลายแท็กคือการยิงกว้างกว่าที่สั่ง ซึ่งเป็นสิ่งเดียวที่ทั้งไฟล์นี้มีไว้กันไม่ให้เกิด
 *
 * ⚠️ เทสนี้ปัก **เนื้อความ** ไม่ใช่แค่ `ok === false` — ของเดิมก็ตอบ false อยู่แล้ว
 *    ถ้าปักแค่ false เทสจะเขียวทั้งที่ข้อความยังโกหกเหมือนเดิม
 */
describe('[TAGOPMISMATCH] §5c `eq` ถือหลายค่า = ผิดที่ operator ไม่ใช่ผิดที่ id', () => {
  it('⭐⭐ 🔴 ปฏิเสธพร้อมชี้ที่ operator และไม่ยิงคิวรี่เลย', async () => {
    const io = reader([{ member_id: MEM_1 }]);
    const out = await resolveAudiencePrefilter(
      { match: 'and', rules: [tagRule('eq', [TAG_A, TAG_B])] },
      { read: io.read },
    );

    expect(out.ok).toBe(false);
    const reason = out.ok === false ? out.reason : '';
    /* ต้องพูดถึง operator และจำนวนที่ระบุมา */
    expect(reason).toMatch(/"eq"/);
    expect(reason).toMatch(/2/);
    expect(reason).toMatch(/"in"/);
    /* 🔴 และต้อง **ไม่** โทษ id — นี่คือประโยคที่ทำให้คนหลงทางบน stg */
    expect(reason).not.toMatch(/must name a tag by its id/);
    /* ปฏิเสธก่อนแตะฐานข้อมูล */
    expect(io.calls).toHaveLength(0);
  });

  it('⭐ `eq` ค่าเดียวยังทำงานเหมือนเดิมทุกประการ (PIN)', async () => {
    const io = reader([{ member_id: MEM_1 }]);
    const out = await resolveAudiencePrefilter(
      { match: 'and', rules: [tagRule('eq', TAG_A)] },
      { read: io.read },
    );

    expect(out.ok).toBe(true);
    /* ยิงคิวรี่จริงหนึ่งครั้ง และเป็น `$in` ใบเดียว — สัญญาเดิมของ `eq` */
    expect(io.calls).toHaveLength(1);
    expect(io.calls[0]?.filter).toEqual({ tag_id: { $in: [TAG_A] } });
  });

  it('⭐ `in` ที่ถือหลายค่า = ถูกต้อง ต้องไม่โดนด่านนี้', async () => {
    const io = reader([{ member_id: MEM_1 }]);
    const out = await resolveAudiencePrefilter(
      { match: 'and', rules: [tagRule('in', [TAG_A, TAG_B])] },
      { read: io.read },
    );

    expect(out.ok).toBe(true);
    expect(io.calls[0]?.filter).toEqual({ tag_id: { $in: [TAG_A, TAG_B] } });
  });
});
