/**
 * [FEAT-20260824-BCASTAUDTIER] Picking an audience by membership tier.
 * ===========================================================================
 * เจ้าของ 24/08: *"เพิ่ม ท่อ สามารถเลือกเป้าหมาย … และในอนาคตจะมี tier + อื่น ๆ อีก"*
 * และ *"dive อย่าสร้างหนี้ ห้ามพัง"*.
 *
 * 🔑 WHAT THIS FILE IS FOR. The registry's promise is "add a field = add one
 * entry", so the risk of a new entry is never a crash — it is a filter that is
 * built successfully, runs successfully, and matches NOBODY. Every case here is
 * about that silent zero. ความเสี่ยงคือ "สร้าง filter ผ่าน แต่ไม่โดนใครเลย" ไม่ใช่ error.
 *
 * 🔴 THE PATHS BELOW WERE READ OFF A REAL ROW, NOT OFF THE SCHEMA. On the dev
 * database `boardcast_lane_24aug`, 2026-08-24, `members._id
 * a0d000000000000000000006` holds:
 *     tier: { code: 'normal', name: 'Normal', level: 0, raw: {…}, updated_at }
 * The writer is `external/custom-tool.service.ts:1418` — `extractTier()` returns
 * that object and the next line `$set`s it onto the member. Both `code` and
 * `name` go through `asText()` there, which is why they are typed `string` here.
 *
 * NOT A DUPLICATE of `broadcast-audience-sources.spec.ts`: that file pins the
 * builder's RULES (unknown key fails closed, the ceiling, no `$exists`). This
 * one pins the two new entries and the reasons they are shaped the way they are.
 *
 * revert: delete this file; the registry entries stand on their own.
 */
import {
  buildAudienceFilter,
  getAudienceSource,
  listAudienceSources,
  unindexedKeys,
} from '@/modules/content';

/** The value a real row actually carries — not an invented sample. */
const REAL_CODE = 'normal';
const REAL_NAME = 'Normal';

describe('[FEAT-20260824-BCASTAUDTIER] the tier entries are registered', () => {
  it('tier.code answers from the RAW BLOB (owner 27/08) · tier.name stays normalised', () => {
    /* [FEAT-2708-TIERWHERE] เจ้าของ 27/08 (งาน 5.5) สั่งชัด: *"ตอน where member
       raw profile ใช้ code นะเพื่อไปหา response.data.profile.tier.x ...ห้ามเดา"*
       — เทียบกับข้อมูลจริงแล้ว (dev-local §4): blob จับ 3/18 ตรงกับป้าย tier
       บนจอ (`utils/memberTier.ts` อ่าน raw-first) ส่วน `tier.code` normalized
       จับได้ 2/18 (คนที่ profile fetch สำเร็จเท่านั้น) ⇒ path ย้ายไป blob
       · เหตุผลเดิม (envelope ต่างตามเจ้า — ย่อหน้าที่เคยอยู่ตรงนี้) ยังจริง และ
         ถูกจดไว้ที่ registry พร้อมวิธีถอยกลับ/วิธีสลับไป match ด้วย level
       · `tier.name` คงชี้ที่ normalized — จอไม่ใช้ และไม่มีคำสั่งให้ย้าย */
    expect(getAudienceSource('tier.code')?.path).toBe(
      'raw_profile_data.data.profile.tier.code',
    );
    expect(getAudienceSource('tier.name')?.path).toBe('tier.name');
  });

  it('the raw blob itself is still not selectable', () => {
    // The registry exists so a request cannot name an arbitrary path (§0c.3).
    expect(getAudienceSource('raw_profile_data')).toBeNull();
    expect(
      getAudienceSource('raw_profile_data.data.profile.tier.code'),
    ).toBeNull();
  });

  it('🔴 neither claims to scope itself by OA — both read `members`', () => {
    /* `members` carries no `hook_id`; the ids still have to be narrowed through
       `chat_rooms`. A `true` here reaches members of OTHER OAs. */
    expect(getAudienceSource('tier.code')?.scope_by_hook).toBe(false);
    expect(getAudienceSource('tier.name')?.scope_by_hook).toBe(false);
  });

  it('🔴 both declare `indexed: false`, because no tier index exists', () => {
    /* `db.members.getIndexes()` on 2026-08-24 returns 14 entries and not one
       names `tier`. This is a DECLARATION OF TRUTH, not a preference: `true`
       would hide a collection scan behind a green dropdown, and the admin only
       finds out when the run takes minutes. ประกาศความจริง ไม่ใช่ความชอบ. */
    expect(getAudienceSource('tier.code')?.indexed).toBe(false);
    expect(getAudienceSource('tier.name')?.indexed).toBe(false);
  });

  it('so the dry-run preview warns the admin BEFORE they schedule', () => {
    const r = buildAudienceFilter({
      match: 'and',
      rules: [{ key: 'tier.code', op: 'eq', value: REAL_CODE }],
    });
    expect(r.ok).toBe(true);
    expect(r.ok && unindexedKeys(r.usedSources)).toEqual(['tier.code']);
  });

  it('both are offered to the form — they are not deprecated on arrival', () => {
    const offered = listAudienceSources().map((s) => s.key);
    expect(offered).toContain('tier.code');
    expect(offered).toContain('tier.name');
  });
});

describe('[FEAT-20260824-BCASTAUDTIER] the filter each one builds', () => {
  it('`eq` builds a plain equality on the nested column', () => {
    const r = buildAudienceFilter({
      match: 'and',
      rules: [{ key: 'tier.code', op: 'eq', value: REAL_CODE }],
    });
    expect(r.ok && r.filter).toEqual({
      'raw_profile_data.data.profile.tier.code': 'normal',
    });
  });

  it('`in` builds a `$in` — "any of these grades"', () => {
    const r = buildAudienceFilter({
      match: 'and',
      rules: [{ key: 'tier.name', op: 'in', value: [REAL_NAME, 'VIP'] }],
    });
    expect(r.ok && r.filter).toEqual({
      'tier.name': { $in: ['Normal', 'VIP'] },
    });
  });

  it('combines with the fields that were already there', () => {
    const r = buildAudienceFilter({
      match: 'and',
      rules: [
        { key: 'tier.code', op: 'eq', value: REAL_CODE },
        { key: 'phone_number', op: 'in', value: ['0925550014'] },
      ],
    });
    expect(r.ok && r.filter).toEqual({
      $and: [
        { 'raw_profile_data.data.profile.tier.code': 'normal' },
        { phone_number: { $in: ['0925550014'] } },
      ],
    });
  });

  it('🔴 never emits `$exists` — §6 measured that it destroys a covered read', () => {
    const r = buildAudienceFilter({
      match: 'or',
      rules: [
        { key: 'tier.code', op: 'in', value: ['normal', 'gold'] },
        { key: 'tier.name', op: 'eq', value: REAL_NAME },
      ],
    });
    expect(JSON.stringify(r.ok && r.filter)).not.toContain('$exists');
  });
});

describe('[FEAT-20260824-BCASTAUDTIER] 🔴 the operators that are refused', () => {
  /**
   * THE LOAD-BEARING CASES. "tier ตั้งแต่ X ขึ้นไป" is the obvious next wish, and
   * the reason it is not offered is not taste: `audience-filter.ts` routes BOTH
   * `lte` and `gte` through `parseAdminTime`, so every range in this system is a
   * DATE range. Allowed on a string column it would build
   * `{ 'tier.code': { $gte: <a Date> } }` — no error, no match, a campaign that
   * reports success and reaches zero people.
   * ช่วง = ช่วงเวลาเท่านั้น ใส่กับ string แล้วจะเงียบ ๆ ไม่โดนใคร.
   */
  it('refuses `gte`/`lte` on a tier, rather than building a Date clause', () => {
    for (const key of ['tier.code', 'tier.name']) {
      for (const op of ['gte', 'lte'] as const) {
        expect(getAudienceSource(key)?.ops).not.toContain(op);
        const r = buildAudienceFilter({
          match: 'and',
          rules: [{ key, op, value: REAL_CODE }],
        });
        expect(r.ok).toBe(false);
        expect(r.ok === false && r.badKey).toBe(key);
      }
    }
  });

  it('refuses `contains` — that is the array operator, a tier is one value', () => {
    /* `contains` emits bare equality, which on a SCALAR is indistinguishable
       from `eq`. Offering both would put two dropdown entries in front of the
       admin that do exactly the same thing, one of which reads as if it does
       substring matching. It does not. */
    for (const key of ['tier.code', 'tier.name']) {
      expect(getAudienceSource(key)?.ops).not.toContain('contains');
      expect(
        buildAudienceFilter({
          match: 'and',
          rules: [{ key, op: 'contains', value: 'norm' }],
        }).ok,
      ).toBe(false);
    }
  });

  it('refuses an empty or blank value instead of dropping the condition', () => {
    /* A dropped filter WIDENS the audience — 200 intended, 20,000 messaged.
       ทิ้งเงื่อนไข = ยิงกว้างกว่าที่สั่ง. */
    for (const bad of ['', '   ', null, undefined, {}, []]) {
      const r = buildAudienceFilter({
        match: 'and',
        rules: [{ key: 'tier.code', op: 'eq', value: bad }],
      });
      expect(r.ok).toBe(false);
    }
    expect(
      buildAudienceFilter({
        match: 'and',
        rules: [{ key: 'tier.name', op: 'in', value: [] }],
      }).ok,
    ).toBe(false);
  });
});

describe('[FEAT-20260824-BCASTAUDTIER] ⛔ what is NOT selectable, and stays that way', () => {
  /**
   * The owner asked for four things. Two are entries; two cannot be, because
   * every `path` in the registry is a path on `members` and those answers live
   * in other collections. A key that builds a filter matching nobody is worse
   * than a missing key, so their ABSENCE is asserted — putting one back without
   * doing the design work goes red here.
   * คีย์ที่ยิงไม่โดนใคร แย่กว่าคีย์ที่ยังไม่มี.
   */
  it('customer tag is PRESENT since 24/08 — but only under the one key', () => {
    /**
     * ⚠️ REWRITTEN 24/08. This used to assert that `customer_tag` was ABSENT,
     * and the reason it gave was right at the time: a tag is `tags` (identity)
     * + `customer_tags` (member_id, tag_id, hook_id), not one of the 25 member
     * rows carries a tag field, and `buildAudienceFilter` builds ONE `members`
     * filter.
     *
     * 🔴 What changed is not the data but WHEN the join happens. The third step
     *    this case asked for exists — `audience/prefilter/` resolves
     *    `customer_tags.find({tag_id}) → member_id[]` BEFORE the filter is
     *    built and substitutes the ids into the rule, so the builder still
     *    knows nothing about other collections. The shape of that entry, the
     *    `or` semantics and the empty-resolve rule are all pinned by
     *    `broadcast-audience-tag-prefilter.spec.ts`.
     *
     * What this case still guards is the NAME. Four plausible spellings are
     * still nothing, so a job or a form that sends one of them is refused
     * rather than quietly matching nobody. ชื่ออื่นต้องไม่มี.
     */
    expect(getAudienceSource('customer_tag')?.path).toBe('_id');
    for (const key of ['tag', 'tags', 'customer_tags', 'tag_id']) {
      expect(getAudienceSource(key)).toBeNull();
    }
  });

  it('ticket type and ticket status are absent — the owner said "อนาคต"', () => {
    /* A real `tickets` row holds `category` ('Other' | 'Payment' — the "type"),
       `chat_status` ('admin' | 'bot') and `job_status` (0|1|2), and links to the
       member through `chat_user_id`, which is the member `_id` (re-verified on
       the lane db 24/08 against a real row).
       เจ้าของ 24/08: "ติดไว้ก่อน ทำท่อเผื่อไว้" — the PIPE is built (the tag
       resolver above proves the seam works) and the FEATURE is not. Registering
       a key with no resolver behind it would put a choice in the admin's
       dropdown that resolves to nobody, which is worse than a missing key. What
       a ticket resolver has to provide is written in English at the top of
       `src/modules/content/audience/prefilter/index.ts`. */
    for (const key of [
      'ticket_type',
      'ticket_status',
      'category',
      'chat_status',
      'job_status',
    ]) {
      expect(getAudienceSource(key)).toBeNull();
    }
  });

  it('`tier.level` is absent — a number with no numeric range is a trap', () => {
    /* `extractTier()` does write it (`level: 0` on both tiered rows), so the data
       is real. The only useful question about a level is a RANGE, and there is
       no numeric range in the builder. `eq`/`in` alone would also make it the
       first `number` ever offered to the form, where a dropdown sending `"0"`
       instead of `0` matches nothing in Mongo without a single error.
       `tier.code` answers the same question as a proven string. */
    expect(getAudienceSource('tier.level')).toBeNull();
    expect(getAudienceSource('tier')).toBeNull();
    expect(getAudienceSource('tier.raw')).toBeNull();
  });

  it('🔴 only tier.code (owner-ordered) reaches the raw blob — nobody else may', () => {
    /* หลักเดิมยังยืน: envelope ของ blob เป็นของ vendor (`raw-blob.reader.ts`
       รองรับสี่รูปเพราะมันเคยต่างจริง) — path ตายตัวจะเงียบ ๆ ไม่โดนใครบนแถว
       ของเจ้าที่ห่อคนละแบบ · [FEAT-2708-TIERWHERE] เจ้าของสั่งข้อยกเว้นเดียว
       27/08: `tier.code` ชี้ blob เพื่อให้ WHERE ตรงกับป้ายบนจอ — เคสนี้จึงกลาย
       เป็น ALLOWLIST: ตัวอื่นห้ามเพิ่มแบบเงียบ ๆ ตลอดไป */
    const blobbed = listAudienceSources()
      .filter((s) => s.path.includes('raw_profile_data'))
      .map((s) => s.key);
    expect(blobbed).toEqual(['tier.code']);
  });
});
