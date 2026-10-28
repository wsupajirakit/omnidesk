/**
 * [FEAT-20260825-FORCENOPROFILE] "เจอเงื่อนไขตามลูกค้า = บังคับ ยังไม่ผูกข้อมูล"
 * ===========================================================================
 * สิ่งที่ต้องได้: *"ถ้า job multicast ใดก็ตาม เจอเงื่อนไขพวกนี้ ต้อง where
 * no raw profile ให้ทันที (force)"* — `customer_helper_trigger_at` ·
 * `request_reg_at` · `abandon_trigger_at`
 *
 * ⭐ ทำไมต้องบังคับ: สาม stamp นั้นเป็น RECORD ในถุง follow_up ที่ **ไม่มีใครลบ**
 * ⇒ ลูกค้าที่สมัครไปแล้วยังติดอยู่ในกลุ่มตลอดไป · ป้ายของ source ทุกตัวลงท้ายว่า
 * "ยังไม่ลงทะเบียน" ⇒ ถ้าไม่บังคับ ป้ายจะโกหก และคนที่โดนโกหกคือคนที่ทำเสร็จแล้ว
 *
 * ⚠️ นโยบายทั้งหมดปรับได้ที่ `force-no-profile.policy.ts` ไฟล์เดียว
 */
import { buildAudienceFilter } from '@/modules/content';
import {
  FORCE_NO_PROFILE_ENABLED,
  FORCE_NO_PROFILE_KEYS,
  NO_PROFILE_CLAUSE,
  forceNoProfileClause,
} from '@/modules/content/audience/sources/force-no-profile.policy';

const WHEN = '2026-08-01T00:00:00.000Z';
const filterFor = (key: string, op = 'lte', value: unknown = WHEN) => {
  const r = buildAudienceFilter({
    match: 'and',
    rules: [{ key, op, value }],
  } as never);
  expect(r.ok).toBe(true);
  return r.ok ? r.filter : {};
};

describe('[FORCENOPROFILE] §1 นโยบายล้วน', () => {
  it('⭐ (T1) วันนี้เปิดอยู่ และครอบสามคีย์ตามที่สั่ง', () => {
    expect(FORCE_NO_PROFILE_ENABLED).toBe(true);
    expect([...FORCE_NO_PROFILE_KEYS].sort()).toEqual([
      'follow_up.abandon_at',
      'follow_up.customer_helper_at',
      'follow_up.request_reg_at',
    ]);
  });

  it('⭐⭐ (T2) "ยังไม่ผูก" คือ `{raw_profile_data: null}` — จับทั้ง missing และ null', () => {
    /* ตรวจกับฐานจริง 25/08: ไม่มี field 0 · null 25 · มีค่า 3 · object ว่าง 0
       ⇒ ไม่ต้องเผื่อ `{}` และ **ห้ามใช้ `$exists`** ตามข้อห้ามของระบบ audience */
    expect(NO_PROFILE_CLAUSE).toEqual({ raw_profile_data: null });
    expect(JSON.stringify(NO_PROFILE_CLAUSE)).not.toContain('$exists');
  });

  it('⭐ (T3) คีย์นอกลิสต์ไม่โดนบังคับ', () => {
    expect(forceNoProfileClause(['display_name'])).toBeNull();
    expect(forceNoProfileClause([])).toBeNull();
  });

  it('⭐ (T4) เจอแค่ตัวเดียวในหลายกฎ ก็บังคับ', () => {
    expect(
      forceNoProfileClause(['display_name', 'follow_up.request_reg_at']),
    ).toEqual({ raw_profile_data: null });
  });
});

describe('[FORCENOPROFILE] §2 ผลที่ออกมาจากตัวสร้างคิวรี่จริง', () => {
  /* ⚠️ [UI-20260825-LOCKHASVALUE] `customer_helper_at` ถูกล็อคเป็น `has_value`
     อย่างเดียว (ค่ามันทับใหม่ทุกครั้ง ⇒ ช่วงเวลาเปลี่ยนความหมายไปเอง)
     ⇒ เคสนี้ต้องใช้ op ที่ source นั้นเปิดจริง · **เจตนาของเคสไม่เปลี่ยน**:
       ยังพิสูจน์ว่าตัวกรองกลุ่ม "ตามลูกค้า" ถูก AND ด้วย "ยังไม่ผูกข้อมูล" */
  /* ⚠️ [FEAT-20260827-FORCENOFOLLOWUP] แถวที่สามได้ clause **ที่สาม** เพิ่มมา 27/08
     — นโยบายคนละใบ (`force-no-follow-up.policy.ts`) ที่บังคับเฉพาะตัวกรองการ์ด
     ว่า `abandon_trigger_at` และ `request_reg_at` ต้องไม่มีค่า
     ⇒ ช่องที่สี่ของ `it.each` คือ clause ที่ **นโยบายอื่น** ต่อเข้ามา · เจตนาของเคสนี้
       ไม่เปลี่ยน: ยังพิสูจน์ว่ากลุ่ม "ตามลูกค้า" ถูก AND ด้วย "ยังไม่ผูกข้อมูล"
     🔴 ปักทั้งก้อนด้วย `toEqual` ต่อไป ไม่ใช่ `toContain` — เงื่อนไขที่ **หายไป**
        คือความพังที่ทั้งไฟล์นี้ถูกเขียนมาเพื่อกัน และ `toContain` มองไม่เห็นมัน */
  const NO_FOLLOW_UP = {
    'config.follow_up.line.abandon_trigger_at': null,
    'config.follow_up.line.request_reg_at': null,
  };
  it.each([
    [
      'follow_up.abandon_at',
      'config.follow_up.line.abandon_trigger_at',
      'lte',
      [],
    ],
    [
      'follow_up.request_reg_at',
      'config.follow_up.line.request_reg_at',
      'lte',
      [],
    ],
    [
      'follow_up.customer_helper_at',
      'config.follow_up.line.customer_helper_trigger_at',
      'has_value',
      [NO_FOLLOW_UP],
    ],
  ])(
    '⭐⭐ (T5) %s → ถูก AND ด้วย "ยังไม่ผูกข้อมูล"',
    (key, path, op, alsoForced) => {
      const clause =
        op === 'has_value' ? { $ne: null } : { $lte: new Date(WHEN) };
      /* [FIX-20260828-FORCEPERLEG] the forced conditions now live INSIDE the
         triggering rule's own clause instead of an outer `$and`. Intent of this
         case is unchanged and still pinned whole with `toEqual`: the rule is
         ANDed with "not linked" (and, for the card rule, "never chased"). What
         moved is WHERE — a single rule is one flat object now. */
      expect(filterFor(key, op)).toEqual({
        [path]: clause,
        raw_profile_data: null,
        ...Object.assign({}, ...(alsoForced as Record<string, unknown>[])),
      });
    },
  );

  it('⭐ (T6) source ที่ไม่เกี่ยวกับการตามลูกค้า ต้องไม่ถูกแตะ', () => {
    expect(filterFor('display_name', 'eq', 'judy')).toEqual({
      display_name: 'judy',
    });
  });

  it('⭐⭐⭐ (T7) match:or → the forced condition binds ONLY to the leg that asked for it', () => {
    /* [FIX-20260828-FORCEPERLEG] Owner, 28/08, from a job that sent to nobody:
       the forced clause used to sit at the outer level, so the deposit and
       withdraw legs — which have nothing to do with registering — were also
       required to be "not linked". Every linked member dropped out and the run
       recorded `this OA was skipped: empty`.

       🔴 The danger the previous comment guarded is still guarded here: the
       forced condition must never become another MEMBER of the `$or` (that
       reads "or is not linked"). It has to be an AND inside its own leg. */
    const r = buildAudienceFilter({
      match: 'or',
      rules: [
        { key: 'follow_up.abandon_at', op: 'lte', value: WHEN },
        { key: 'display_name', op: 'eq', value: 'judy' },
      ],
    } as never);
    expect(r.ok).toBe(true);
    const f = r.ok
      ? (r.filter as { $or: Array<Record<string, unknown>> })
      : { $or: [] };

    expect(Object.keys(f)).toEqual(['$or']);
    expect(f.$or).toHaveLength(2);
    // the triggering leg: original rule + forced condition in one object = an AND
    expect(f.$or[0]).toEqual({
      'config.follow_up.line.abandon_trigger_at': { $lte: new Date(WHEN) },
      raw_profile_data: null,
    });
    // the unrelated leg: clean, no forced condition carried over
    expect(f.$or[1]).toEqual({ display_name: 'judy' });
    // and no leg may be forced-only, which would act as an escape hatch
    for (const leg of f.$or) {
      expect(Object.keys(leg)).not.toEqual(['raw_profile_data']);
    }
  });

  it('⭐ (T8) บังคับครั้งเดียว ไม่ซ้อนกันเมื่อเข้าเงื่อนไขหลายกฎ', () => {
    const r = buildAudienceFilter({
      match: 'and',
      rules: [
        { key: 'follow_up.abandon_at', op: 'lte', value: WHEN },
        { key: 'follow_up.request_reg_at', op: 'lte', value: WHEN },
      ],
    } as never);
    /* [FIX-20260828-FORCEPERLEG] with per-leg placement each triggering rule
       carries its own copy, so `match:'and'` with two triggering rules holds it
       twice — and that is still ONE condition per leg, never a stack of copies
       inside a single clause. The invariant this case exists for is unchanged:
       the forced condition must never multiply WITHIN one leg. */
    const legs =
      (r.ok ? (r.filter as { $and: Record<string, unknown>[] }).$and : []) ??
      [];
    expect(legs).toHaveLength(2);
    for (const leg of legs) {
      expect(JSON.stringify(leg).split('raw_profile_data').length - 1).toBe(1);
    }
  });

  it('⭐⭐ (T9) ยังไม่มี `$exists` หลุดเข้าไปในคิวรี่', () => {
    /* ใช้ op ที่แต่ละ source เปิดจริง — `customer_helper_at` ล็อคเป็น has_value */
    for (const k of FORCE_NO_PROFILE_KEYS) {
      const op = k === 'follow_up.customer_helper_at' ? 'has_value' : 'lte';
      expect(JSON.stringify(filterFor(k, op))).not.toContain('$exists');
    }
  });
});
