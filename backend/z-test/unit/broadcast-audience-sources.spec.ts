/**
 * [FEAT-20260822-BCASTAUDSRC] Choosing who receives a campaign. Every case here
 * is about sending to the wrong people or to more people than intended.
 */
import {
  AUDIENCE_SOURCES,
  MAX_AUDIENCE_RULES,
  buildAudienceFilter,
  getAudienceSource,
  listAudienceSources,
  unindexedKeys,
} from '@/modules/content';

const WHEN = new Date('2026-08-19T00:00:00.000Z');

describe('registry — both shapes are one shape', () => {
  it('offers a nested follow-up path and a plain column alike', () => {
    expect(getAudienceSource('follow_up.abandon_at')?.path).toBe(
      'config.follow_up.line.abandon_trigger_at',
    );
    expect(getAudienceSource('display_name')?.path).toBe('display_name');
  });

  it('an unknown key is null, never a guess', () => {
    expect(getAudienceSource('config.follow_up.line.anything')).toBeNull();
    expect(getAudienceSource('raw_profile_data')).toBeNull();
    expect(getAudienceSource(undefined)).toBeNull();
  });

  it('🔴 nothing on `members` may claim to be OA-scoped', () => {
    // members has no hook_id at all, so every one of these still needs the
    // chat_rooms narrowing. A `true` here would send into the wrong channel.
    for (const s of listAudienceSources()) {
      expect(s.scope_by_hook).toBe(false);
    }
  });

  it('every entry declares whether it is indexed', () => {
    for (const s of listAudienceSources()) {
      expect(typeof s.indexed).toBe('boolean');
      expect(s.ops.length).toBeGreaterThan(0);
      expect(s.label_th.length).toBeGreaterThan(0);
      expect(s.label_en.length).toBeGreaterThan(0);
    }
  });

  it('🔴 no entry offers `exists` — it destroys the covered read (§6)', () => {
    for (const s of listAudienceSources()) {
      expect(s.ops).not.toContain('exists');
    }
  });

  it('operators fit the type they are offered on', () => {
    // `plates` is deliberately not registered — see the ⛔ block in the
    // registry. This asserts the ABSENCE, so putting it back without doing the
    // three steps written there goes red here as well as in member-plates.spec.
    expect(AUDIENCE_SOURCES).not.toHaveProperty('plates');
    expect(AUDIENCE_SOURCES['follow_up.abandon_at'].ops).not.toContain(
      'contains',
    );
  });
});

describe('filter — the builder never learns a field name', () => {
  it('turns a nested-path rule into a real date range', () => {
    const r = buildAudienceFilter({
      match: 'and',
      rules: [{ key: 'follow_up.abandon_at', op: 'lte', value: WHEN }],
    });
    expect(r.ok).toBe(true);
    /* ⚠️ [FEAT-20260825-FORCENOPROFILE] เคสนี้ถูก **พลิก** ไม่ใช่ลบ
       เดิมคาดว่าได้ clause เดี่ยว ๆ · ตั้งแต่ 25/08 กฎที่พูดถึง "การตามลูกค้า"
       จะถูก AND ด้วย "ยังไม่ผูกข้อมูล" โดยอัตโนมัติ เพราะ stamp พวกนั้นเป็น
       RECORD ที่ไม่มีใครลบ ⇒ เลือกด้วยมันอย่างเดียวจะได้คนที่สมัครไปแล้วติดมาด้วย
       สิ่งที่เคสนี้ยังทำหน้าที่เดิม: พิสูจน์ว่า nested path ถูกแปลงเป็น date range จริง
       นโยบายทั้งหมดอยู่ที่ `force-no-profile.policy.ts` (ปิดได้ด้วยบรรทัดเดียว) */
    /* ⚠️ [FIX-20260828-FORCEPERLEG] เงื่อนไขบังคับผูกกับ clause ของกฎที่ขอมันแล้ว
       ⇒ กฎเดียวได้ object แบนใบเดียว · หน้าที่เดิมของเคสไม่เปลี่ยน */
    expect(r.ok && r.filter).toEqual({
      'config.follow_up.line.abandon_trigger_at': { $lte: WHEN },
      raw_profile_data: null,
    });
  });

  it('turns a plain-column rule into the same shape of clause', () => {
    const r = buildAudienceFilter({
      match: 'and',
      rules: [{ key: 'display_name', op: 'eq', value: 'judy' }],
    });
    expect(r.ok && r.filter).toEqual({ display_name: 'judy' });
  });

  it('combines with AND or OR as asked', () => {
    const rules = [
      { key: 'follow_up.abandon_at', op: 'lte' as const, value: WHEN },
      { key: 'display_name', op: 'eq' as const, value: 'สมชาย' },
    ];
    expect(buildAudienceFilter({ match: 'and', rules }).ok).toBe(true);
    const or = buildAudienceFilter({ match: 'or', rules });
    /* ⚠️ [FIX-20260828-FORCEPERLEG] `match:'or'` คืน `['$or']` ตามที่สั่งอีกครั้ง
       เพราะเงื่อนไขบังคับย้ายไปอยู่ในขาของกฎที่ขอมัน ไม่ใช่ครอบทั้งก้อน
       เคสนี้ยังกันจุดที่พังเงียบที่สุดไว้เหมือนเดิม: เงื่อนไขบังคับ **ห้ามเป็น
       สมาชิกอีกตัวของ `$or`** (นั่นจะอ่านว่า "หรือยังไม่ผูกข้อมูล" ⇒ คนที่ผูกแล้ว
       เข้าเกณฑ์แทนที่จะถูกกรองออก) — มันต้องเป็น AND อยู่ข้างในขาของตัวเอง */
    expect(or.ok && Object.keys(or.filter)).toEqual(['$or']);
    const parts = or.ok
      ? (or.filter as { $or: Array<Record<string, unknown>> }).$or
      : [];
    expect(parts).toHaveLength(2);
    // ขาที่จุดชนวน: กฎ + บังคับ อยู่ด้วยกัน = AND ของขานั้น
    expect(parts[0]).toEqual({
      'config.follow_up.line.abandon_trigger_at': { $lte: WHEN },
      raw_profile_data: null,
    });
    // ขาที่ไม่เกี่ยว: ต้องไม่ถูกบังคับตามไปด้วย
    expect(parts[1]).toEqual({ display_name: 'สมชาย' });
    // และห้ามมีขาไหนเป็นเงื่อนไขบังคับล้วน
    for (const leg of parts) {
      expect(Object.keys(leg)).not.toEqual(['raw_profile_data']);
    }
  });

  it('🔴 an unknown key refuses the WHOLE selection', () => {
    // Skipping it would drop a filter, and a dropped filter makes the audience
    // wider — 200 intended, 20,000 messaged, no error anywhere.
    const r = buildAudienceFilter({
      match: 'and',
      rules: [{ key: 'nope', op: 'eq', value: 1 }],
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.badKey).toBe('nope');
  });

  it('🔴 refuses an operator the field does not allow', () => {
    const r = buildAudienceFilter({
      match: 'and',
      rules: [{ key: 'display_name', op: 'gte', value: WHEN }],
    });
    expect(r.ok).toBe(false);
  });

  it('🔴 refuses a value that cannot be used, rather than dropping the rule', () => {
    for (const bad of [undefined, null, 'not-a-date', {}, []]) {
      const r = buildAudienceFilter({
        match: 'and',
        rules: [{ key: 'follow_up.abandon_at', op: 'lte', value: bad }],
      });
      expect(r.ok).toBe(false);
    }
  });

  it('refuses a rule that is not even an object', () => {
    const r = buildAudienceFilter({
      match: 'and',
      rules: ['nonsense' as unknown as { key: string; op: 'eq' }],
    });
    expect(r.ok).toBe(false);
  });

  it('🔴 never emits $exists — a covered read dies on it', () => {
    const r = buildAudienceFilter({
      match: 'and',
      rules: [
        { key: 'follow_up.request_reg_at', op: 'gte', value: WHEN },
        { key: 'phone_number', op: 'in', value: ['0812345678'] },
      ],
    });
    expect(JSON.stringify(r.ok && r.filter)).not.toContain('$exists');
  });

  it('no rules means everyone — a real answer, bounded by the ceilings', () => {
    const r = buildAudienceFilter({ match: 'and', rules: [] });
    expect(r.ok && r.filter).toEqual({});
  });

  it('refuses a malformed query outright', () => {
    expect(buildAudienceFilter({ match: 'nope' as 'and', rules: [] }).ok).toBe(
      false,
    );
    expect(
      buildAudienceFilter({ match: 'and', rules: 5 as unknown as [] }).ok,
    ).toBe(false);
  });

  it('reports which chosen fields have no index, for the preview', () => {
    const r = buildAudienceFilter({
      match: 'and',
      rules: [{ key: 'first_ticket_at', op: 'gte', value: WHEN }],
    });
    expect(r.ok && unindexedKeys(r.usedSources)).toEqual([]);
  });
});

describe('[FEAT-20260823-BCASTAUDCAP] a ceiling on how many conditions', () => {
  /**
   * 🔴 ADDED WITH THE UI THAT MADE IT REACHABLE. Nothing could send rules until
   * 23/08, so an unbounded list cost nothing; the new builder has an "add
   * condition" button with no natural stop, and every rule is another clause in
   * an `$and` against `members`. เพดานต้องมาพร้อมปุ่มที่กดได้ไม่จำกัด.
   */
  const rule = (i: number) => ({
    key: 'display_name',
    op: 'eq' as const,
    value: `v${i}`,
  });

  it('accepts a list at the ceiling', () => {
    const rules = Array.from({ length: MAX_AUDIENCE_RULES }, (_, i) => rule(i));
    expect(buildAudienceFilter({ match: 'and', rules }).ok).toBe(true);
  });

  it('🔴 REFUSES one past it — never trims', () => {
    /* Dropping the extra rule would make the audience WIDER than asked, the
       same failure an unknown key is refused to avoid. ตัดทิ้ง = ยิงกว้างเกิน. */
    const rules = Array.from({ length: MAX_AUDIENCE_RULES + 1 }, (_, i) =>
      rule(i),
    );
    const out = buildAudienceFilter({ match: 'and', rules });
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.reason).toMatch(
      /too many audience conditions/,
    );
  });

  it('the ceiling is generous enough that an admin never fights it', () => {
    /**
     * ⚠️ REWRITTEN 24/08. This used to assert
     * `MAX_AUDIENCE_RULES >= Object.keys(AUDIENCE_SOURCES).length - 1`, tying
     * the per-campaign condition CAP to the size of the field CATALOGUE — and
     * those answer different questions.
     *
     * 🔴 The coupling made the registry unextendable. `MAX_AUDIENCE_RULES` has
     *    a real reason (each condition is a term in one Mongo filter, and
     *    the cap is what stops a campaign becoming an unbounded query), while
     *    the catalogue is just how many fields we OFFER. Adding the tenth key
     *    turned this red with nothing actually wrong — the cap would have had to
     *    rise every time someone offered a new field, forever.
     *    เพดานเงื่อนไขต่อแคมเปญ กับ จำนวนฟิลด์ที่มีให้เลือก เป็นคนละเรื่อง.
     *
     * What the case is really for is unchanged: the cap must not be so small
     * that combining a few conditions is impossible. A floor states that without
     * pinning it to a number that grows for unrelated reasons.
     *
     * ⚠️ 25/08 — the cap moved 8 → 20 on the owner's instruction after a live run
     *    hit the refusal. This case did not need editing, which is the point of
     *    asserting a floor instead of the number.
     */
    expect(MAX_AUDIENCE_RULES).toBeGreaterThanOrEqual(5);
  });

  it('🔴 the cap does NOT move when a field is added to the catalogue', () => {
    /* The regression the rewrite above prevents: a registry entry must never be
       able to change how many conditions a campaign may carry.
       เพิ่ม key ในทะเบียน ต้องไม่ไปขยับเพดานของแคมเปญ.

       ⚠️ พลิกจาก 8 เป็น 20 เมื่อ 25/08/2026 — **ไม่ใช่การผ่อนกฎ**
       สิ่งที่เคสนี้กันคือ "เพดานขยับเพราะมีคนเพิ่ม field ในทะเบียน" ซึ่งยังกันอยู่
       เหมือนเดิมทุกประการ · ที่ขยับรอบนี้เป็นการตัดสินใจของเจ้าของโดยตรงหลังยิงจริง
       แล้วชนเพดาน ("อนุญาติแล้วปลดสิ") และวัดได้ว่าทะเบียนมี 14 source /
       24 คู่ source×operator ⇒ 8 ใส่ได้ไม่ครบแม้แต่ source ละหนึ่งข้อ
       ⇒ ถ้าวันหนึ่งเลขนี้ขยับอีกโดยไม่มีบรรทัดอธิบายเพิ่ม แปลว่ามีคนขยับโดยไม่ได้ตั้งใจ
       ซึ่งคือสิ่งที่เคสนี้มีไว้จับ */
    expect(MAX_AUDIENCE_RULES).toBe(20);
  });
});
