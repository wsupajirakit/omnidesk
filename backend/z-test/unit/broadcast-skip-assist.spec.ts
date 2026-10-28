/**
 * [FEAT-20260825-BCASTSKIPASSIST] "ข้ามคนที่แอดมินกำลังคุยอยู่"
 * ===========================================================================
 * โจทย์ (เจ้าของ 25/08): ติ๊ก ⇒ งานใบนี้ไม่ส่งให้คนที่ `assist_status` เป็น true
 * ไม่ติ๊ก ⇒ ส่งทุกคนเหมือนเดิมทุกประการ · และ *"ต้องรู้ว่า skip หรือไม่"*
 *
 * ไฟล์นี้เทสสองชั้นที่แยกกันจริง ๆ:
 *   1. ตัวตัดสิน + รูปคิวรี่ (`audience/skip-assist/`) — ไม่แตะฐานข้อมูลเลย
 *   2. ตัวกรองที่ออกมา (`buildAudienceFilter`) — เงื่อนไข "ไม่เอาคนพวกนี้"
 *      ต้องอยู่ **นอกสุด** ไม่ใช่กลายเป็นสมาชิกของ `$or`
 */
import {
  SKIP_ASSIST_ENABLED,
  shouldSkipAssisted,
  planAssistedLookup,
  assistedIdsFrom,
} from '../../src/modules/content/audience/skip-assist';
import { buildAudienceFilter } from '../../src/modules/content/audience/sources/audience-filter';

describe('[SKIPASSIST] ตัวตัดสิน — งานใบนี้ต้องถามเรื่อง assist ไหม', () => {
  it('⭐ (T1) วันนี้เปิดใช้งานอยู่', () => {
    expect(SKIP_ASSIST_ENABLED).toBe(true);
  });

  it('⭐⭐ (T2) ติ๊ก = ต้องถาม', () => {
    expect(shouldSkipAssisted({ skip_assist: true })).toBe(true);
  });

  it('⭐⭐ (T3) ติ๊กออก = ไม่ถาม', () => {
    expect(shouldSkipAssisted({ skip_assist: false })).toBe(false);
  });

  it('⭐⭐ (T4) งานเก่าที่ไม่มีคีย์นี้เลย = ไม่ถาม (ต้องเหมือนติ๊กออกเป๊ะ)', () => {
    /* นี่คือข้อที่ทำให้ฟีเจอร์ seamless: งานทุกใบที่มีอยู่ก่อนคอลัมน์นี้
       ต้องได้พฤติกรรมเดิมโดยไม่ต้อง migrate อะไรเลย */
    expect(shouldSkipAssisted({ name: 'งานเก่า' })).toBe(false);
    expect(shouldSkipAssisted({})).toBe(false);
    expect(shouldSkipAssisted(null)).toBe(false);
    expect(shouldSkipAssisted(undefined)).toBe(false);
  });

  it('⭐ (T5) ค่าที่ไม่ใช่ boolean ไม่นับว่าติ๊ก', () => {
    // truthy แต่ไม่ใช่ true — ต้องไม่ถูกตีความว่าเปิด
    expect(shouldSkipAssisted({ skip_assist: 'true' })).toBe(false);
    expect(shouldSkipAssisted({ skip_assist: 1 })).toBe(false);
  });
});

describe('[SKIPASSIST] รูปคิวรี่ที่ไปถามห้อง', () => {
  it('⭐⭐ (T6) ถามเฉพาะ OA ของงานใบนี้ และเฉพาะห้องที่มีคนดูแลอยู่', () => {
    const plan = planAssistedLookup(['h1', 'h2']);
    expect(plan).not.toBeNull();
    expect(plan!.model).toBe('ChatRoom');
    expect(plan!.filter).toEqual({
      hook_id: { $in: ['h1', 'h2'] },
      assist_status: true,
    });
  });

  it('⭐⭐ (T7) อ่านคอลัมน์เดียว และไม่ลาก _id กลับมา', () => {
    const plan = planAssistedLookup(['h1']);
    expect(plan!.projection).toEqual({ line_user_id: 1, _id: 0 });
    expect(plan!.field).toBe('line_user_id');
  });

  it('⭐⭐ (T8) ไม่มี OA เลย = ไม่ถาม ไม่ใช่ถามแบบไม่จำกัด OA', () => {
    /* คิวรี่ที่ไม่มีเงื่อนไข OA จะกวาดห้องของ OA ที่ไม่เกี่ยวกับงานใบนี้
       มาข้ามด้วย = ข้ามคนผิด */
    expect(planAssistedLookup([])).toBeNull();
    expect(planAssistedLookup(['', ''])).toBeNull();
  });

  it('⭐ (T9) id ว่างถูกคัดทิ้งก่อนถาม', () => {
    expect(planAssistedLookup(['h1', ''])!.filter).toEqual({
      hook_id: { $in: ['h1'] },
      assist_status: true,
    });
  });
});

describe('[SKIPASSIST] แปลงแถวเป็นรายชื่อที่ต้องข้าม', () => {
  it('⭐⭐ (T10) คนเดียวมีหลายห้อง = ต้องเหลือชื่อเดียว', () => {
    const rows = [
      { line_user_id: 'U1' },
      { line_user_id: 'U2' },
      { line_user_id: 'U1' },
    ];
    expect(assistedIdsFrom(rows)).toEqual(['U1', 'U2']);
  });

  it('⭐ (T11) แถวเสีย/ค่าว่าง ถูกข้ามโดยไม่ระเบิด', () => {
    const rows = [null, {}, { line_user_id: '' }, { line_user_id: 'U9' }, 7];
    expect(assistedIdsFrom(rows as unknown[])).toEqual(['U9']);
  });
});

describe('[SKIPASSIST] ตัวกรองที่ออกมา', () => {
  const RULE = {
    key: 'follow_up.customer_helper_at',
    op: 'has_value' as const,
  };

  it('⭐⭐ (T12) ไม่มีรายชื่อข้าม = คิวรี่เดิมทุกตัวอักษร', () => {
    const withOut = buildAudienceFilter({ match: 'and', rules: [RULE] });
    const withEmpty = buildAudienceFilter({
      match: 'and',
      rules: [RULE],
      skip_line_user_ids: [],
    });
    expect(withOut.ok).toBe(true);
    expect(withEmpty.ok).toBe(true);
    expect((withEmpty as { filter: unknown }).filter).toEqual(
      (withOut as { filter: unknown }).filter,
    );
  });

  it('⭐⭐ (T13) มีรายชื่อข้าม = `$nin` โผล่ในคิวรี่จริง', () => {
    const r = buildAudienceFilter({
      match: 'and',
      rules: [RULE],
      skip_line_user_ids: ['U1', 'U2'],
    });
    expect(r.ok).toBe(true);
    expect(JSON.stringify((r as { filter: unknown }).filter)).toContain(
      '"$nin":["U1","U2"]',
    );
  });

  it('⭐⭐⭐ (T14) กับ `or` เงื่อนไขข้ามต้องอยู่นอกสุด ไม่ใช่ตัวเลือกหนึ่งของ or', () => {
    /* 🔴 ความพังที่เงียบที่สุดที่เป็นไปได้: ถ้ามันไปอยู่ใน `$or` มันจะกลายเป็น
       "หรือไม่ได้ถูกดูแล" ⇒ คนที่กำลังถูกดูแลอยู่จะ**หลุดเข้ามา** แทนที่จะถูก
       กรองออก คือตรงข้ามกับที่สั่งพอดี */
    const r = buildAudienceFilter({
      match: 'or',
      /* ⚠️ กฎที่สองต้องใช้ op ที่คีย์นั้น**รับจริง** — เจอตอนเขียนเทสนี้ว่ามีแค่
         `follow_up.customer_helper_at` ที่รับ `has_value` ส่วนคีย์ธงอย่าง
         `abandon_at` รับ op วันที่ · ใส่ผิดแล้วตัวกรองปฏิเสธทั้งงาน ซึ่งจะทำให้
         เคสนี้แดงด้วยเหตุผลที่ไม่เกี่ยวกับสิ่งที่มันตั้งใจพิสูจน์ */
      rules: [
        RULE,
        {
          key: 'follow_up.abandon_at',
          op: 'lte' as const,
          value: '2026-08-25T00:00:00+07:00',
        },
      ],
      skip_line_user_ids: ['U1'],
    });
    expect(r.ok).toBe(true);
    const filter = (r as { filter: Record<string, unknown> }).filter;
    expect(Object.keys(filter)).toContain('$and');
    const and = filter['$and'] as Record<string, unknown>[];
    const skipClause = and.find((c) => 'line_user_id' in c);
    expect(skipClause).toEqual({ line_user_id: { $nin: ['U1'] } });
    // และ `$or` ต้องยังอยู่ครบ ไม่ถูกกลืน
    expect(JSON.stringify(and)).toContain('$or');
  });

  it('⭐⭐ (T15) อยู่ร่วมกับกฎ force-no-profile ได้ ไม่ทับกัน', () => {
    /* `follow_up.customer_helper_at` เป็นหนึ่งในคีย์ที่บังคับ
       `raw_profile_data: null` ⇒ คิวรี่นี้ต้องมีทั้งสองเงื่อนไข */
    const r = buildAudienceFilter({
      match: 'and',
      rules: [RULE],
      skip_line_user_ids: ['U1'],
    });
    const s = JSON.stringify((r as { filter: unknown }).filter);
    expect(s).toContain('raw_profile_data');
    expect(s).toContain('$nin');
  });
});
