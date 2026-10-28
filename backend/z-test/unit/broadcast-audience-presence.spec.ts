/**
 * [FEAT-20260825-HASVALUE] "มีค่า" / "ไม่มีค่า" — the presence operators.
 * ===========================================================================
 * What was asked for: a broadcast audience that finds the customers who have
 * no value in `raw_profile_cleared_at` — *"เงื่อนไขคือมีหรือไม่มี ไม่ใช่น้อยหรือมาก"*.
 *
 * ⭐ THE CONSTRAINT THAT SHAPED THE ANSWER. This subsystem BANS `$exists` in
 * queries (`audience-source.types.ts`, `audience-filter.ts`), on measured
 * grounds. These operators are not a way around that ban — they satisfy the
 * question without it, because a bare `null` match already covers both a
 * missing field and an explicit null. Every case below that pins the ABSENCE of
 * `$exists` is pinning that promise, not decoration.
 */
import {
  buildAudienceFilter,
  getAudienceSource,
  listAudienceSources,
} from '@/modules/content';

const PATH = 'raw_profile_cleared_at';
const build = (op: string, value?: unknown) =>
  buildAudienceFilter({
    match: 'and',
    rules: [{ key: PATH, op, ...(value === undefined ? {} : { value }) }],
  } as never);

describe('[HASVALUE] §1 คลอสที่สร้างออกมา', () => {
  it('⭐⭐ (T1) ไม่มีค่า → `{path: null}` ซึ่งจับได้ทั้ง missing และ null จริง', () => {
    const r = build('no_value');
    expect(r.ok).toBe(true);
    expect(r.ok && r.filter).toEqual({ [PATH]: null });
  });

  it('⭐⭐ (T2) มีค่า → `{path: {$ne: null}}`', () => {
    const r = build('has_value');
    expect(r.ok).toBe(true);
    expect(r.ok && r.filter).toEqual({ [PATH]: { $ne: null } });
  });

  it('⭐⭐ (T3) ห้ามมี `$exists` ในคิวรี่ — คำสัญญาของไฟล์ audience-filter', () => {
    for (const op of ['has_value', 'no_value']) {
      const r = build(op);
      expect(JSON.stringify(r.ok && r.filter)).not.toContain('$exists');
    }
  });

  it('⭐ (T4) ค่าที่ติดมาถูกเมิน — กฎที่เพิ่งเปลี่ยน op ต้องยังสร้างได้', () => {
    /* ฟอร์มเก็บ `value: ''` ไว้ตอน addRule และไม่ล้างเมื่อสลับ op
       ⇒ ถ้าสองตัวนี้ปฏิเสธค่าที่ไม่เข้าพวก งานจะบันทึกผ่านแล้วไปพังตอนส่ง */
    for (const v of ['', 'ค่าเก่า', 0, null, [], { a: 1 }]) {
      expect(build('no_value', v).ok).toBe(true);
      expect(build('has_value', v).ok).toBe(true);
    }
  });
});

describe('[HASVALUE] §2 ตัว source ที่เพิ่มเข้าไป', () => {
  const src = getAudienceSource(PATH);

  it('⭐ (T5) มีอยู่จริงและเปิดให้ใช้ได้แค่สอง op นี้', () => {
    expect(src).not.toBeNull();
    expect(src?.ops).toEqual(['has_value', 'no_value']);
  });

  it('⭐⭐ (T6) `indexed: false` — ทิศที่ถูกขอมาเป็น COLLSCAN จอห้ามบอกว่าเร็ว', () => {
    /* index มีจริงและช่วยทิศ "มีค่า" ได้ (วัดแล้ว FETCH ← IXSCAN) แต่ทิศที่
       เจ้าของขอคือ "ไม่มีค่า" ซึ่งเป็น COLLSCAN เสมอ · `indexed` มีตัวเดียว
       คุมสองทิศ และฟอร์มเอาไปโชว์คำเตือน "ช้า" ⇒ true = โกหก */
    expect(src?.indexed).toBe(false);
  });

  it('⭐ (T7) เป็นของ members ⇒ ต้องไม่ scope ด้วย hook', () => {
    expect(src?.scope_by_hook).toBe(false);
  });

  it('⭐⭐ (P1 PIN) ไม่มี source ไหนโฆษณา op ชื่อ `exists` (เทสเดิม 4 จุดยืนไว้)', () => {
    for (const s of listAudienceSources()) {
      expect(s.ops).not.toContain('exists');
    }
  });
});

describe('[HASVALUE] §3 PIN — ของเดิมห้ามขยับ', () => {
  it('⭐ (P2) op เดิมยังทำงานเหมือนเดิมทุกตัว', () => {
    const d = new Date('2026-08-01T00:00:00.000Z');
    const r = buildAudienceFilter({
      match: 'and',
      rules: [
        { key: 'follow_up.abandon_at', op: 'lte', value: d.toISOString() },
      ],
    } as never);
    expect(r.ok).toBe(true);
    /* ⚠️ [FEAT-20260825-FORCENOPROFILE] พลิก — กฎที่พูดถึงการตามลูกค้าถูก AND
       ด้วย "ยังไม่ผูกข้อมูล" อัตโนมัติตั้งแต่ 25/08 · สิ่งที่เคสนี้ยังปักคือ
       "op เดิมแปลงค่าเป็น date range ได้เหมือนเดิมทุกประการ" ซึ่งยังจริงอยู่
       ⚠️ [FIX-20260828-FORCEPERLEG] เงื่อนไขบังคับย้ายมาอยู่ใน clause ของกฎเอง
       (ไม่ใช่ `$and` ชั้นนอก) ⇒ กฎเดียวได้ object แบนใบเดียว · เจตนาเคสเท่าเดิม */
    expect(r.ok && r.filter).toEqual({
      'config.follow_up.line.abandon_trigger_at': { $lte: d },
      raw_profile_data: null,
    });
  });

  it('⭐⭐ (P3) op ที่ไม่รู้จักยัง "ปฏิเสธทั้งงาน" ไม่ใช่ปล่อยผ่าน', () => {
    /* ปล่อยผ่าน = ทิ้งตัวกรอง = ผู้รับกว้างกว่าที่ตั้งใจ = ยิงโดนคนที่ไม่ควรโดน */
    const r = build('whatever');
    expect(r.ok).toBe(false);
  });

  it('⭐ (P4) op ใหม่ใช้กับ key ที่ไม่ได้เปิดให้ ไม่ได้', () => {
    const r = buildAudienceFilter({
      match: 'and',
      rules: [{ key: 'phone_number', op: 'no_value' }],
    } as never);
    expect(r.ok).toBe(false);
  });
});
