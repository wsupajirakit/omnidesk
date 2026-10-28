/**
 * [FEAT-20260825-HELPERTRIGGER] ประทับเวลาเมื่อเสนอ customer-helper
 * ===========================================================================
 * สิ่งที่ต้องได้: stamp เวลาเมื่อ webhook event นั้นมีการส่ง customer_helper ·
 * ไม่มีเคลียร์ เก็บไว้ · **ทับเวลาไปทุกครั้งที่เข้าเงื่อนไข** ·
 * ห้ามกระทบส่วนอื่นเด็ดขาด seamless ห้ามพังระบบ
 */
import {
  CUSTOMER_HELPER_TRIGGER_KEY,
  shouldStampCustomerHelper,
  stampCustomerHelperTrigger,
} from '@/modules/webhook/follow-up';

const USER = 'U2e9daca4b8ab5265a21e3ecda626a720';
const NOW = new Date('2026-08-25T07:30:00.000Z');

const buildDeps = (over: Record<string, unknown> = {}) => {
  const seen: Array<{ filter: unknown; update: unknown }> = [];
  const warned: string[] = [];
  return {
    seen,
    warned,
    deps: {
      memberModel: {
        updateOne: (filter: unknown, update: unknown) => {
          seen.push({ filter, update });
          return { exec: () => Promise.resolve({ modifiedCount: 1 }) };
        },
      },
      channelUserId: USER,
      offered: true,
      sent: true,
      now: NOW,
      warn: (m: string) => warned.push(m),
      ...over,
    } as never,
  };
};

describe('[HELPERTRIGGER] §1 เงื่อนไข — อยู่ในไฟล์ rule แก้ที่เดียว', () => {
  it('⭐⭐ (T1) เสนอ + ส่งสำเร็จ = ประทับ', () => {
    expect(shouldStampCustomerHelper(true, true)).toBe(true);
  });

  it('⭐⭐ (T2) เสนอแต่ส่งไม่ผ่าน = ไม่ประทับ', () => {
    /* ถ้าประทับตอนตั้งใจจะส่ง แล้ว LINE ปฏิเสธ (โควตาหมด / token หมดอายุ)
       เราจะบันทึกว่าลูกค้าได้รับ ทั้งที่เขาไม่เคยเห็นอะไรเลย
       กติกาเดียวกับ notice runtime: ส่งก่อน ค่อยบันทึก */
    expect(shouldStampCustomerHelper(true, false)).toBe(false);
  });

  it('⭐ (T3) ไม่ได้เสนอ = ไม่ประทับ ไม่ว่าส่งอะไรออกไป', () => {
    expect(shouldStampCustomerHelper(false, true)).toBe(false);
    expect(shouldStampCustomerHelper(false, false)).toBe(false);
  });
});

describe('[HELPERTRIGGER] §2 การเขียนจริง', () => {
  it('⭐⭐ (T4) เขียนคีย์ที่ถูก ด้วยเวลาที่ให้มา และยิงที่ลูกค้าคนนั้น', async () => {
    const { deps, seen } = buildDeps();
    await expect(stampCustomerHelperTrigger(deps)).resolves.toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.filter).toEqual({ line_user_id: USER });
    expect(seen[0]?.update).toEqual({
      $set: { [`config.${CUSTOMER_HELPER_TRIGGER_KEY}`]: NOW },
    });
  });

  it('⭐⭐ (T5) ทับเวลาเดิมเสมอ — ไม่มีเงื่อนไข "เขียนครั้งแรกครั้งเดียว"', async () => {
    /* 🔴 หัวใจของข้อสั่ง: *"ทับเวลาไปทุกครั้งที่เข้าเงื่อนไข"*
       ถ้าใครเปลี่ยนไปใช้ `writeMemberConfigOnce` filter จะมี `$or ... $exists`
       โผล่มา และคีย์จะค้างที่ครั้งแรกตลอดไป = ตอบคนละคำถาม */
    const { deps, seen } = buildDeps();
    await stampCustomerHelperTrigger(deps);
    expect(JSON.stringify(seen[0]?.filter)).not.toContain('$exists');
    expect(JSON.stringify(seen[0]?.filter)).not.toContain('$or');
    expect(Object.keys(seen[0]?.filter as object)).toEqual(['line_user_id']);
  });

  it('⭐ (T6) ไม่เข้าเงื่อนไข = ไม่แตะฐานข้อมูลเลย', async () => {
    const { deps, seen } = buildDeps({ sent: false });
    await expect(stampCustomerHelperTrigger(deps)).resolves.toBe(false);
    expect(seen).toHaveLength(0);
  });

  it('⭐⭐ (T7) ไม่มี line_user_id = ไม่เขียน (กันเขียนทับข้อมูลคนอื่น)', async () => {
    /* filter ว่างจะไปโดนแถวแรกที่เจอ ซึ่งคือการประทับเวลาให้ลูกค้าที่ไม่เกี่ยว */
    for (const bad of ['', '   ', undefined, null]) {
      const { deps, seen } = buildDeps({ channelUserId: bad });
      await expect(stampCustomerHelperTrigger(deps)).resolves.toBe(false);
      expect(seen).toHaveLength(0);
    }
  });
});

describe('[HELPERTRIGGER] §3 SEAMLESS — พังแล้วต้องไม่ลามไปกระทบคำตอบลูกค้า', () => {
  it('⭐⭐ (T8) ฐานข้อมูลพัง = คืน false + เตือน ไม่โยน error ออกไป', async () => {
    /* ข้อความถูกส่งไปหาลูกค้าแล้ว การจดบันทึกไม่สำเร็จต้องไม่กลายเป็น
       webhook error ที่ทำให้ LINE ส่งซ้ำหรือขึ้นแดงในระบบ */
    const warned: string[] = [];
    const deps = {
      memberModel: {
        updateOne: () => {
          throw new Error('mongo ล่ม');
        },
      },
      channelUserId: USER,
      offered: true,
      sent: true,
      warn: (m: string) => warned.push(m),
    } as never;
    await expect(stampCustomerHelperTrigger(deps)).resolves.toBe(false);
    expect(warned.join(' ')).toContain('mongo ล่ม');
  });

  it('⭐ (T9) จุดเรียกใน webhook ต้อง fire-and-forget และอยู่หลังส่ง', () => {
    const src = require('fs')
      .readFileSync(
        require('path').join(
          process.cwd(),
          'src/modules/webhook/webhook.service.ts',
        ),
        'utf8',
      )
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const at = src.indexOf('stampCustomerHelperTrigger({');
    expect(at).toBeGreaterThan(-1);
    // `void` = ไม่ await ⇒ ต่อให้ช้าก็ไม่ถ่วงเวลาตอบลูกค้า
    expect(src.slice(Math.max(0, at - 20), at)).toContain('void ');
    // ต้องอยู่ **หลัง** บรรทัดที่ส่ง ไม่งั้นมันขวางข้อความได้
    expect(src.indexOf('const lineResponse')).toBeLessThan(at);
  });
});
