/**
 * [FEAT-20260825-MCASTABANDON] multicast ที่ขอข้อมูล → ติดธง follow-up ให้คนที่ได้รับ
 * ===========================================================================
 * เงื่อนไขที่สั่งไว้ ต้องครบทั้งสองถึงจะ stamp:
 *   · ใช้ตัวกรอง "ได้รับการ์ดลงทะเบียนแต่ยังไม่ลงทะเบียน" (`follow_up.customer_helper_at`)
 *   · **ไม่ได้ติ๊ก** "เปิดเคสให้ลูกค้าที่ได้รับข้อความนี้"
 * นอกนั้นห้ามกระทบ — ติ๊กก็เหมือนเดิม · ตัวกรองอื่นก็เหมือนเดิม
 *
 * 🔴 ทำไมเคสพวกนี้สำคัญกว่าปกติ: ธงนี้ **ถูกอ่านไปตัดสิน** ไม่ใช่แค่ไว้นับ
 *    ติดธงให้ใคร = ข้อความถัดไปของคนนั้นเปิดเคสและจบ flow ทันที ไม่ว่าจะพิมพ์อะไร
 *    ⇒ stamp เกินไปหนึ่งคน = เคสเกินมาหนึ่งใบ และบอทหยุดดูแลห้องนั้น
 */
import {
  stampAbandonForReached,
  shouldStampAbandon,
  ABANDON_STAMP_KEY,
  ABANDON_TRIGGER_SOURCE_KEYS,
  STAMP_ABANDON_ENABLED,
} from '@/modules/content';

const TRIGGER = 'follow_up.customer_helper_at';

const buildModel = (impl?: () => Promise<unknown>) => {
  const seen: Array<{ filter: unknown; update: unknown }> = [];
  return {
    seen,
    model: {
      updateOne: (filter: unknown, update: unknown) => {
        seen.push({ filter, update });
        return {
          exec: () => (impl ? impl() : Promise.resolve({ modifiedCount: 1 })),
        };
      },
    } as never,
  };
};
const warned: string[] = [];
const warn = (m: string) => warned.push(m);
beforeEach(() => {
  warned.length = 0;
});

describe('[MCASTABANDON] §1 เงื่อนไข — ต้องครบทั้งสอง', () => {
  it('⭐ (T1) วันนี้เปิดอยู่ และผูกกับตัวกรองเดียวเท่านั้น', () => {
    expect(STAMP_ABANDON_ENABLED).toBe(true);
    expect([...ABANDON_TRIGGER_SOURCE_KEYS]).toEqual([TRIGGER]);
    expect(ABANDON_STAMP_KEY).toBe('follow_up.line.abandon_trigger_at');
  });

  it('⭐⭐ (T2) ตัวกรองถูก + ไม่ติ๊ก = stamp', () => {
    expect(
      shouldStampAbandon({ usedKeys: [TRIGGER], directTicket: false }),
    ).toBe(true);
  });

  it('⭐⭐ (T3) ติ๊กเปิดเคส = ไม่ stamp (ทำเหมือนเดิมทุกอย่าง)', () => {
    /* แคมเปญเปิดเคสเองอยู่แล้ว ⇒ ติดธงจะได้เคสใบที่สองต่อคิว */
    expect(
      shouldStampAbandon({ usedKeys: [TRIGGER], directTicket: true }),
    ).toBe(false);
  });

  it('⭐⭐ (T4) ตัวกรองอื่น = ไม่ stamp ทั้งติ๊กและไม่ติ๊ก', () => {
    for (const k of [
      'follow_up.abandon_at',
      'follow_up.request_reg_at',
      'follow_up.notice_deposit_at',
      'display_name',
      'customer_tag',
    ]) {
      expect(shouldStampAbandon({ usedKeys: [k], directTicket: false })).toBe(
        false,
      );
      expect(shouldStampAbandon({ usedKeys: [k], directTicket: true })).toBe(
        false,
      );
    }
  });

  it('⭐ (T5) ไม่มีกฎเลย = ไม่ stamp', () => {
    expect(shouldStampAbandon({ usedKeys: [], directTicket: false })).toBe(
      false,
    );
  });

  it('⭐ (T6) มีตัวกรองที่ใช่ปนอยู่กับตัวอื่น = stamp', () => {
    expect(
      shouldStampAbandon({
        usedKeys: ['display_name', TRIGGER],
        directTicket: false,
      }),
    ).toBe(true);
  });
});

describe('[MCASTABANDON] §2 การเขียนจริง', () => {
  const ok = { usedKeys: [TRIGGER], directTicket: false };

  it('⭐⭐ (T7) เขียนคีย์ถูก และเขียนแบบ "ครั้งแรกชนะ"', async () => {
    const { model, seen } = buildModel();
    const r = await stampAbandonForReached(
      model,
      { lineUserIds: ['U1'] },
      ok,
      warn,
    );
    expect(r.stamped).toBe(1);
    expect(seen).toHaveLength(1);
    const f = seen[0]?.filter as Record<string, unknown>;
    expect(f['line_user_id']).toBe('U1');
    /* 🔴 first-writer-wins อยู่ใน filter ของประตู — ถ้าหายไป คีย์จะเปลี่ยนความหมาย
       จาก "ค้างมาตั้งแต่เมื่อไหร่" เป็น "ถูกยิงล่าสุดเมื่อไหร่" */
    expect(JSON.stringify(f)).toContain('$or');
    expect(JSON.stringify(seen[0]?.update)).toContain(
      'config.follow_up.line.abandon_trigger_at',
    );
  });

  it('⭐⭐ (T8) ไม่เข้าเงื่อนไข = ไม่แตะฐานข้อมูลเลย', async () => {
    for (const d of [
      { usedKeys: [TRIGGER], directTicket: true },
      { usedKeys: ['display_name'], directTicket: false },
    ]) {
      const { model, seen } = buildModel();
      const r = await stampAbandonForReached(
        model,
        { lineUserIds: ['U1'] },
        d,
        warn,
      );
      expect(r).toEqual({ stamped: 0, failed: false });
      expect(seen).toHaveLength(0);
    }
  });

  it('⭐⭐ (T9) ไม่มีคนได้รับ (เช่นงาน broadcast) = ไม่ทำอะไร', async () => {
    /* broadcast ไม่มีรายชื่อผู้รับ ⇒ ตัวเรียกส่งลิสต์ว่างมา ⇒ เงียบโดยธรรมชาติ
       ไม่ต้องมี if send_kind ที่ไหนเลย */
    const { model, seen } = buildModel();
    const r = await stampAbandonForReached(
      model,
      { lineUserIds: [] },
      ok,
      warn,
    );
    expect(r).toEqual({ stamped: 0, failed: false });
    expect(seen).toHaveLength(0);
  });

  it('⭐⭐ (T10) id ซ้ำ/ว่าง ถูกกรองทิ้ง — ห้ามติดธงคนเดียวสองรอบ', async () => {
    const { model, seen } = buildModel();
    await stampAbandonForReached(
      model,
      { lineUserIds: ['U1', 'U1', '  ', '', 'U2'] },
      ok,
      warn,
    );
    expect(seen).toHaveLength(2);
  });

  it('⭐⭐ (T11) SEAMLESS — เขียนพังก็ไม่โยนออกไป', async () => {
    /* ข้อความอยู่บนมือถือลูกค้าแล้ว การจดบันทึกพลาดต้องไม่ทำให้แคมเปญที่สำเร็จ
       กลายเป็นล้มเหลว */
    const { model } = buildModel(() => Promise.reject(new Error('mongo ล่ม')));
    const r = await stampAbandonForReached(
      model,
      { lineUserIds: ['U1'] },
      ok,
      warn,
    );
    expect(r.failed).toBe(true);
    expect(r.stamped).toBe(0);
    expect(warned.join(' ')).toContain('mongo ล่ม');
  });
});
