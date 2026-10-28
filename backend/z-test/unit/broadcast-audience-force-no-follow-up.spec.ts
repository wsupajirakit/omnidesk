/**
 * [FEAT-20260827-FORCENOFOLLOWUP] "การ์ดลงทะเบียน = ต้องยังไม่เคยถูกตาม"
 * ===========================================================================
 * เจ้าของ 27/08/2026: ตัวกรอง **"ได้รับการ์ดลงทะเบียนแต่ยังไม่ลงทะเบียน"**
 * (`follow_up.customer_helper_at`) ต้องบังคับเพิ่มอีกสองข้อ — ทั้งคู่ต้อง **ไม่มีค่า**:
 *     `config.follow_up.line.abandon_trigger_at`
 *     `config.follow_up.line.request_reg_at`
 * ⇒ ยิงเฉพาะคนที่ได้การ์ดแล้ว **และยังไม่เคยถูกตามด้วยสองตัวนี้**
 *
 * ⭐ ทำไมต้องบังคับ ไม่ใช่ปล่อยให้แอดมินเลือกเอง: ฟอร์ม **ซ่อน** สอง source นั้นไว้
 *    (`omnidesk-console/components/campaign/audience/visibleSources.ts`) ⇒ เลือกเองไม่ได้
 *    และต่อให้เลือกได้ การพึ่ง "คนจำได้ทุกครั้ง" คือเหตุผลเดียวกับที่
 *    `force-no-profile.policy.ts` ถูกเขียนขึ้นมาแต่แรก
 *
 * ⭐ วงจรที่มันประกอบกับของเดิม: multicast ที่ใช้ตัวกรองนี้และไม่ติ๊ก "เปิดเคส" จะไป
 *    ปักธง `abandon_trigger_at` ให้ทุกคนที่ยิงถึง (`stamp-abandon-on-multicast.ts`)
 *    ⇒ กฎนี้ทำให้ **รอบถัดไปคนกลุ่มนั้นหลุดออกจากตัวกรองเอง** = ตามครั้งเดียว ไม่ทวงซ้ำ
 *
 * ⚠️ นโยบายทั้งหมดปรับได้ที่ `force-no-follow-up.policy.ts` ไฟล์เดียว
 * 📖 แผนงาน + ตัวเลขจากฐานจริง: `todo/task/27082026/todo4_27082026_card-audience-force-no-follow-up.md`
 */
import { buildAudienceFilter } from '@/modules/content';
import { getAudienceSource } from '@/modules/content/audience/sources/audience-source.registry';
import {
  FORCE_NO_FOLLOW_UP_ENABLED,
  FORCE_NO_FOLLOW_UP_RULES,
  forceNoFollowUpClause,
} from '@/modules/content/audience/sources/force-no-follow-up.policy';

/** คีย์ของตัวกรอง "ได้รับการ์ดลงทะเบียนแต่ยังไม่ลงทะเบียน" */
const CARD = 'follow_up.customer_helper_at';
const CARD_PATH = 'config.follow_up.line.customer_helper_trigger_at';
/** สอง path ที่โจทย์สั่งให้ "ต้องไม่มีค่า" — เขียนเป็นค่าดิบเพื่อปักโจทย์ไว้ตรงนี้ */
const ABANDON_PATH = 'config.follow_up.line.abandon_trigger_at';
const REQUEST_REG_PATH = 'config.follow_up.line.request_reg_at';

const filterOf = (
  rules: ReadonlyArray<Record<string, unknown>>,
  match: 'and' | 'or' = 'and',
): Record<string, unknown> => {
  const r = buildAudienceFilter({ match, rules } as never);
  expect(r.ok).toBe(true);
  return r.ok ? r.filter : {};
};

describe('[FORCENOFOLLOWUP] §1 นโยบายล้วน', () => {
  it('⭐ (N1) วันนี้เปิดอยู่ และบังคับสองข้อให้ตัวกรองการ์ดใบเดียว', () => {
    expect(FORCE_NO_FOLLOW_UP_ENABLED).toBe(true);
    expect(Object.keys(FORCE_NO_FOLLOW_UP_RULES)).toEqual([CARD]);
    expect([...(FORCE_NO_FOLLOW_UP_RULES[CARD] ?? [])].sort()).toEqual([
      'follow_up.abandon_at',
      'follow_up.request_reg_at',
    ]);
  });

  it('⭐⭐ (N2) ทุกคีย์ในตารางมีจริงในทะเบียน — ไม่มีคีย์ผี', () => {
    /* 🔴 ตารางนี้เก็บ **source key** แล้วไปถอด `path` จากทะเบียนตอนสร้าง clause
       ⇒ คีย์ที่สะกดผิด/ถูกลบ จะกลายเป็นเงื่อนไขที่หายไป = ผู้รับกว้างกว่าที่สั่ง
       เคสนี้คือตัวกันไม่ให้เรื่องนั้นรอดไปถึง runtime */
    for (const [trigger, required] of Object.entries(
      FORCE_NO_FOLLOW_UP_RULES,
    )) {
      expect(getAudienceSource(trigger)).not.toBeNull();
      for (const key of required) expect(getAudienceSource(key)).not.toBeNull();
    }
  });

  it('⭐⭐ (N3) clause ที่ได้ = สอง path ตามโจทย์ และ path มาจากทะเบียน ไม่ได้พิมพ์ซ้ำ', () => {
    const out = forceNoFollowUpClause([CARD]);
    expect(out.ok).toBe(true);
    expect(out.ok && out.clause).toEqual({
      [ABANDON_PATH]: null,
      [REQUEST_REG_PATH]: null,
    });
    // และ path สองตัวนั้นคือ path ที่ทะเบียนประกาศไว้จริง ๆ
    expect(getAudienceSource('follow_up.abandon_at')?.path).toBe(ABANDON_PATH);
    expect(getAudienceSource('follow_up.request_reg_at')?.path).toBe(
      REQUEST_REG_PATH,
    );
  });

  it('⭐ (N4) คีย์ที่ไม่ใช่ตัวกรองการ์ด ไม่ถูกบังคับอะไรเลย', () => {
    for (const k of [
      [],
      ['display_name'],
      ['follow_up.notice_deposit_at'],
      /* 🔴 สำคัญ: `abandon_at` เองต้อง **ไม่** ถูกบังคับ ไม่งั้นงานที่ขอ
         "abandon มีค่า" จะได้คิวรี่ที่ขัดกันเอง ⇒ ผู้รับ 0 คนตลอดกาลแบบเงียบ ๆ */
      ['follow_up.abandon_at'],
      ['follow_up.request_reg_at'],
    ]) {
      const out = forceNoFollowUpClause(k);
      expect(out.ok).toBe(true);
      expect(out.ok && out.clause).toBeNull();
    }
  });

  it('⭐⭐ (N8) ค่าที่บังคับต้องเป็น `null` ตรง ๆ — จับทั้ง "ไม่มี field" และ null จริง', () => {
    /* ใน MongoDB `{path: null}` จับได้ทั้งสองสภาพอยู่แล้ว ⇒ ไม่ต้องใช้ `$exists`
       ซึ่งระบบ audience **ห้าม** (วัดแล้วว่าทำลาย covered read — `audience-filter.ts`) */
    const out = forceNoFollowUpClause([CARD]);
    const s = JSON.stringify(out.ok && out.clause);
    expect(s).not.toContain('$exists');
    expect(s).not.toContain('$eq');
    expect(s).not.toContain('$ne');
  });

  it('⭐⭐ (N9) คีย์ในตารางที่ทะเบียนไม่รู้จัก ⇒ ปฏิเสธ ไม่ใช่ข้ามเงียบ', () => {
    /* 🔴 ข้ามเงียบ = ทิ้งเงื่อนไข = ผู้รับ**กว้างกว่า**ที่สั่ง ซึ่งเป็นความพังที่
       ทั้งโมดูลนี้ถูกออกแบบมาเพื่อกัน (`audience-filter.ts` หัวไฟล์) */
    const out = forceNoFollowUpClause([CARD], {
      rules: { [CARD]: ['follow_up.this_key_does_not_exist'] },
    });
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.reason).toContain(
      'follow_up.this_key_does_not_exist',
    );
  });

  it('⭐ (N10) ปิดสวิตช์ ⇒ ไม่มีเงื่อนไขเพิ่มเลย (ทางถอยที่ต้องใช้ได้จริง)', () => {
    const out = forceNoFollowUpClause([CARD], { enabled: false });
    expect(out.ok).toBe(true);
    expect(out.ok && out.clause).toBeNull();
  });
});

describe('[FORCENOFOLLOWUP] §2 ผลที่ออกมาจากตัวสร้างคิวรี่จริง', () => {
  it('⭐⭐⭐ (N5) ตัวกรองการ์ด ⇒ คิวรี่มีครบสามก้อน: การ์ด + ยังไม่ผูกข้อมูล + ยังไม่เคยถูกตาม', () => {
    /* [FIX-20260828-FORCEPERLEG] all three conditions still have to be there —
       what changed is that they now sit in the triggering rule's own clause
       instead of an outer `$and`. Pinned whole with `toEqual`, because a
       condition going MISSING is what this file exists to catch. */
    expect(filterOf([{ key: CARD, op: 'has_value' }])).toEqual({
      [CARD_PATH]: { $ne: null },
      raw_profile_data: null,
      [ABANDON_PATH]: null,
      [REQUEST_REG_PATH]: null,
    });
  });

  it('⭐ (N5b) ตัวกรองอื่นไม่ถูกแตะ — ของเดิมต้องเหมือนเดิมทุกตัวอักษร', () => {
    expect(
      filterOf([{ key: 'display_name', op: 'eq', value: 'judy' }]),
    ).toEqual({ display_name: 'judy' });
    /* กฎที่บังคับ "ยังไม่ผูกข้อมูล" อยู่แล้วแต่ไม่ใช่ตัวกรองการ์ด ⇒ ต้องได้สองก้อนเท่าเดิม */
    expect(
      filterOf([
        {
          key: 'follow_up.request_reg_at',
          op: 'gte',
          value: '2026-08-01T00:00:00.000Z',
        },
      ]),
    ).toEqual({
      [REQUEST_REG_PATH]: { $gte: new Date('2026-08-01T00:00:00.000Z') },
      raw_profile_data: null,
    });
  });

  it('⭐⭐⭐ (N6) `match:or` → only the card leg is forced; the other legs stay clean', () => {
    /* [FIX-20260828-FORCEPERLEG] Owner, 28/08: "deposit OR withdraw must NOT
       carry the raw-profile rule, but the register card MUST." So a forced
       condition attaches to the leg that asked for it, never to the whole job.

       🔴 The quietest failure is still guarded: a forced condition must never
       become a MEMBER of the `$or` (that reads "or was never chased" and lets
       chased members back in). This case checks both halves — the card leg
       carries every forced condition, and no leg is forced-only. */
    const f = filterOf(
      [
        { key: CARD, op: 'has_value' },
        { key: 'display_name', op: 'eq', value: 'judy' },
      ],
      'or',
    );
    expect(Object.keys(f)).toEqual(['$or']);
    const or = f['$or'] as Array<Record<string, unknown>>;
    expect(or).toHaveLength(2);

    // card leg: rule + not-linked + never-chased in one object = an AND for that leg
    expect(or[0]).toEqual({
      [CARD_PATH]: { $ne: null },
      raw_profile_data: null,
      [ABANDON_PATH]: null,
      [REQUEST_REG_PATH]: null,
    });
    // any other leg: untouched
    expect(or[1]).toEqual({ display_name: 'judy' });
    /* No leg may consist ONLY of forced conditions: such a leg reads "or was
       never chased" and lets exactly the wrong people qualify. */
    const FORCED_ONLY_KEYS = [
      ABANDON_PATH,
      REQUEST_REG_PATH,
      'raw_profile_data',
    ];
    for (const leg of or) {
      const keys = Object.keys(leg);
      const isForcedOnly =
        keys.length > 0 && keys.every((k) => FORCED_ONLY_KEYS.includes(k));
      expect(isForcedOnly).toBe(false);
    }
  });

  it('⭐ (N6b) บังคับครั้งเดียว ไม่ซ้อนกันเมื่อกฎหลายข้อชี้ตัวกรองการ์ด', () => {
    const s = JSON.stringify(
      filterOf([
        { key: CARD, op: 'has_value' },
        { key: 'display_name', op: 'eq', value: 'judy' },
      ]),
    );
    expect(s.split(ABANDON_PATH).length - 1).toBe(1);
    expect(s.split(REQUEST_REG_PATH).length - 1).toBe(1);
  });

  it('⭐⭐ (N7) ไม่มี `$exists` หลุดเข้าไปในคิวรี่', () => {
    expect(
      JSON.stringify(filterOf([{ key: CARD, op: 'has_value' }])),
    ).not.toContain('$exists');
  });

  it('⭐⭐ (N11) อยู่ร่วมกับ "ข้ามคนที่แอดมินกำลังคุยอยู่" ได้ ไม่ทับกัน', () => {
    const r = buildAudienceFilter({
      match: 'and',
      rules: [{ key: CARD, op: 'has_value' }],
      skip_line_user_ids: ['U1'],
    } as never);
    expect(r.ok).toBe(true);
    const and = (r.ok ? r.filter['$and'] : []) as Array<
      Record<string, unknown>
    >;
    expect(and.find((c) => 'raw_profile_data' in c)).toBeTruthy();
    expect(and.find((c) => ABANDON_PATH in c)).toBeTruthy();
    expect(and.find((c) => 'line_user_id' in c)).toEqual({
      line_user_id: { $nin: ['U1'] },
    });
  });
});
