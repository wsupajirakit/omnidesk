/**
 * [FEAT-20260824-BCASTCLEARNOTICE] ล้างป้าย notice ของคนที่ multicast ไปถึงจริง
 * ===========================================================================
 * เจ้าของ 24/08: *"follow_up.notice_deposit_at / notice_withdraw_at เราจะต้อง
 * เคลียร์ออก หาก multicast สำเร็จ (ของ member คนนั้น ๆ)"* ·
 * *"ถ้ามันติดค่า notice มาเพราะแบงค์มีปัญหาใหม่ไง"*
 *
 * ทุกเคสในไฟล์นี้ปกป้อง "ใครถูกล้าง" ไม่ใช่ "โค้ดรันผ่านไหม" — การล้างผิดคน
 * แปลว่าลูกค้าที่ยังไม่รู้ว่าแบงค์ปกติ ถูกทำเครื่องหมายว่าบอกแล้ว ซึ่งกู้คืนไม่ได้
 */
import {
  clearNoticeForReached,
  MULTICAST_CLEARS_KEYS,
} from '@/modules/content';

/** Model ปลอมที่จำว่าถูกเรียกด้วยอะไรบ้าง */
function fakeMemberModel(opts: { throwOn?: string; modified?: number } = {}) {
  const calls: Array<{ filter: unknown; update: unknown }> = [];
  return {
    calls,
    updateMany(filter: unknown, update: unknown) {
      calls.push({ filter, update });
      const path = Object.keys(
        (update as { $unset?: Record<string, unknown> }).$unset ?? {},
      )[0];
      if (opts.throwOn && path?.includes(opts.throwOn)) {
        return { exec: () => Promise.reject(new Error('mongo down')) };
      }
      return {
        exec: () => Promise.resolve({ modifiedCount: opts.modified ?? 1 }),
      };
    },
  } as never;
}

describe('คีย์ที่ล้าง — ต้องตรงกับที่ประกาศไว้ที่ตัวกลาง', () => {
  it('ล้าง deposit กับ withdraw เท่านั้น', () => {
    expect([...MULTICAST_CLEARS_KEYS]).toEqual([
      'follow_up.line.notice_deposit_at',
      'follow_up.line.notice_withdraw_at',
    ]);
  });

  /**
   * 🔴 payment ต้องไม่อยู่ในนี้ — แคมเปญพูดเรื่องฝาก/ถอน ไม่ได้พูดเรื่องการชำระ
   *    ล้างป้ายที่เราไม่ได้พูดถึง = อ้างว่าบอกเขาไปแล้วทั้งที่ไม่ได้บอก
   */
  it('ไม่แตะ notice_payment_at', () => {
    expect([...MULTICAST_CLEARS_KEYS]).not.toContain(
      'follow_up.line.notice_payment_at',
    );
  });
});

describe('clearNoticeForReached', () => {
  it('ล้างทั้งสองคีย์ ด้วย $unset ทีละ leaf', async () => {
    const model = fakeMemberModel();
    const out = await clearNoticeForReached(model, {
      lineUserIds: ['U1', 'U2'],
    });

    const calls = (model as unknown as { calls: Array<{ update: unknown }> })
      .calls;
    expect(calls).toHaveLength(2);
    /* ⚠️ หนึ่ง path ต่อหนึ่งครั้ง — เขียน object `config` ทั้งก้อนจะกลืนคีย์ของ
       ฟีเจอร์อื่นที่อยู่ในถุงเดียวกัน */
    for (const c of calls) {
      const unset = (c.update as { $unset: Record<string, unknown> }).$unset;
      expect(Object.keys(unset)).toHaveLength(1);
      expect(Object.keys(unset)[0]).toMatch(
        /^config\.follow_up\.line\.notice_/,
      );
    }
    expect(out.failed).toBe(false);
  });

  /**
   * 🔴 เคสสำคัญที่สุด — ยิงไม่ถึง = ยังไม่ได้บอก ⇒ ป้ายต้องอยู่ต่อ
   *    ตัวเรียกส่งเฉพาะคนที่ LINE ตอบรับมาให้ ฟังก์ชันนี้จึงต้องไม่ไปกว้างกว่านั้นเอง
   */
  it('กรองด้วย line_user_id ที่ส่งมาเท่านั้น ไม่กว้างกว่านั้น', async () => {
    const model = fakeMemberModel();
    await clearNoticeForReached(model, { lineUserIds: ['U1', 'U2'] });

    const calls = (model as unknown as { calls: Array<{ filter: unknown }> })
      .calls;
    for (const c of calls) {
      expect(c.filter).toEqual({ line_user_id: { $in: ['U1', 'U2'] } });
    }
  });

  it('ไม่มีใครได้รับ ⇒ ไม่ยิงคิวรี่เลย', async () => {
    const model = fakeMemberModel();
    const out = await clearNoticeForReached(model, { lineUserIds: [] });
    expect((model as unknown as { calls: unknown[] }).calls).toHaveLength(0);
    expect(out.failed).toBe(false);
  });

  it('ทิ้ง id ที่ว่างหรือไม่ใช่สตริง', async () => {
    const model = fakeMemberModel();
    await clearNoticeForReached(model, {
      lineUserIds: ['U1', '', undefined as never, 'U2'],
    });
    const calls = (model as unknown as { calls: Array<{ filter: unknown }> })
      .calls;
    expect(calls[0]?.filter).toEqual({ line_user_id: { $in: ['U1', 'U2'] } });
  });

  it('0 แถวไม่ใช่ความล้มเหลว — ส่วนใหญ่ไม่เคยถูกประทับป้าย', async () => {
    const model = fakeMemberModel({ modified: 0 });
    const out = await clearNoticeForReached(model, { lineUserIds: ['U1'] });
    expect(out.failed).toBe(false);
    expect(Object.values(out.clearedByKey)).toEqual([0, 0]);
  });

  /**
   * ⚠️ ไม่โยนออกไป — ข้อความอยู่บนมือถือลูกค้าแล้ว การล้างพลาดต้องไม่ทำให้
   *    แคมเปญที่สำเร็จกลายเป็นล้มเหลว แต่ต้อง "บอกได้ว่าพลาด" ไม่ใช่เงียบ
   */
  it('คีย์แรกพัง คีย์ที่สองยังต้องถูกล้าง และรายงานว่า failed', async () => {
    const model = fakeMemberModel({ throwOn: 'notice_deposit_at' });
    const out = await clearNoticeForReached(model, { lineUserIds: ['U1'] });

    expect(out.failed).toBe(true);
    /* คีย์ที่สองยังทำงาน — พังทีละคีย์ ไม่ล้มทั้งชุด */
    expect(out.clearedByKey['follow_up.line.notice_withdraw_at']).toBe(1);
    expect(
      out.clearedByKey['follow_up.line.notice_deposit_at'],
    ).toBeUndefined();
  });

  it('ไม่โยน exception ออกไปหาตัวเรียก', async () => {
    const model = fakeMemberModel({ throwOn: 'notice_' });
    await expect(
      clearNoticeForReached(model, { lineUserIds: ['U1'] }),
    ).resolves.toBeDefined();
  });
});
