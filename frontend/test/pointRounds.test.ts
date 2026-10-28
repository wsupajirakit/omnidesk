/* [FEAT-20260825-POINTROUNDS] "สิทธิ์ร่วมกิจกรรมคงเหลือ" = เหรียญ ÷ spend_amount
 * ก้อนข้อมูลในเคสข้างล่างคัดมาจาก site rules จริงที่เจ้าของส่งมา 25/08 —
 * รวมทั้งสินค้าที่ `default_config: null` และตัว `OMNI_POINT_ROUND` ที่ชื่อ
 * คล้ายกันแต่ไม่ใช่ตัวนี้ เพราะนั่นคือกับดักที่โค้ดต้องผ่านให้ได้
 */
import { describe, it, expect } from 'vitest';
import {
  pointRoundSpendAmount,
  pointRounds,
  pointRoundsText,
  POINT_ROUND_PRODUCT_ID,
} from '../components/member/activity/pointRounds';

/** โครงเดียวกับของจริง — สินค้าปิดหลายตัว ตามด้วยรอบสะสมแต้มที่เปิดอยู่ */
const shop = (spendAmount: unknown, extra: unknown[] = []) => ({
  products: {
    products: [
      { id: 'RAND_BOX', default_config: null, is_active: false },
      { id: 'OMNI_POINT_ROUND', default_config: null, is_active: false },
      ...extra,
      {
        id: POINT_ROUND_PRODUCT_ID,
        is_active: true,
        default_config: { spend_amount: spendAmount, spend_asset: 'coin' },
      },
    ],
  },
});

describe('[POINTROUNDS] อ่าน spend_amount จากก้อน site rules', () => {
  it('⭐⭐ (T1) เจอค่าจริงจากสินค้าที่ id ตรง', () => {
    expect(pointRoundSpendAmount(shop(10))).toBe(10);
  });

  it('⭐⭐⭐ (T2) ไม่หลงไปเอา OMNI_POINT_ROUND ที่ชื่อคล้ายกัน', () => {
    /* ตัวนั้น default_config เป็น null ⇒ ถ้าจับด้วยชื่อสินค้าแบบหลวม ๆ (regex) จะได้ null
       แล้วการ์ดจะขึ้น N/A ทั้งที่ตั้งค่าไว้แล้ว */
    expect(pointRoundSpendAmount(shop(10))).not.toBeNull();
  });

  it('⭐⭐ (T3) ไม่มีสินค้ารอบสะสมแต้มเลย = null', () => {
    expect(pointRoundSpendAmount({ products: { products: [{ id: 'RAND_BOX' }] } })).toBeNull();
  });

  it('⭐⭐ (T4) default_config เป็น null = null', () => {
    expect(
      pointRoundSpendAmount({ products: { products: [{ id: POINT_ROUND_PRODUCT_ID, default_config: null }] } }),
    ).toBeNull();
  });

  it('⭐ (T5) ก้อนพัง/ไม่มี = null ไม่ใช่ระเบิด', () => {
    for (const bad of [null, undefined, {}, { products: null }, { products: { products: 'x' } }, 7]) {
      expect(pointRoundSpendAmount(bad)).toBeNull();
    }
  });

  it('⭐ (T6) ค่าที่ไม่ใช่ตัวเลข = null', () => {
    expect(pointRoundSpendAmount(shop('10'))).toBeNull();
    expect(pointRoundSpendAmount(shop(null))).toBeNull();
  });
});

describe('[POINTROUNDS] เหรียญ → จำนวนครั้ง', () => {
  it('⭐⭐ (T7) หารลงตัว', () => {
    expect(pointRounds(100, 10)).toEqual({ value: 10, na: false });
  });

  it('⭐⭐ (T8) ปัดลง — เล่นครึ่งครั้งไม่มีจริง', () => {
    expect(pointRounds(25, 10)).toEqual({ value: 2, na: false });
  });

  it('⭐⭐ (T9) เหรียญน้อยกว่าราคาหนึ่งครั้ง = 0 ครั้ง และ **ไม่ใช่** N/A', () => {
    /* ต่างจาก "ไม่ได้ตั้งค่า" ชัดเจน — คนนี้หมุนไม่ได้จริง ๆ ซึ่งเป็นคำตอบ */
    expect(pointRounds(5, 10)).toEqual({ value: 0, na: false });
  });

  it('⭐⭐⭐ (T10) spend_amount = 0 ⇒ ไม่หาร คืนเหรียญจริง + N/A', () => {
    expect(pointRounds(37, 0)).toEqual({ value: 37, na: true });
  });

  it('⭐⭐⭐ (T11) ไม่มี config ⇒ ไม่หาร คืนเหรียญจริง + N/A', () => {
    expect(pointRounds(37, null)).toEqual({ value: 37, na: true });
  });

  it('⭐ (T12) play ติดลบ ถือเหมือนไม่ได้ตั้งค่า', () => {
    expect(pointRounds(37, -5)).toEqual({ value: 37, na: true });
  });

  it('⭐ (T13) เหรียญอ่านไม่ได้/ติดลบ = 0 ไม่ปล่อยตัวเลขประหลาดออกจอ', () => {
    expect(pointRounds(undefined, 10)).toEqual({ value: 0, na: false });
    expect(pointRounds(-9, 10)).toEqual({ value: 0, na: false });
    expect(pointRounds('abc', 10)).toEqual({ value: 0, na: false });
  });
});

describe('[POINTROUNDS] ข้อความบนจอ', () => {
  it('⭐⭐ (T14) หารได้ = ตัวเลขเปล่า ไม่มีวงเล็บ', () => {
    expect(pointRoundsText({ value: 3, na: false })).toBe('3');
  });

  it('⭐⭐ (T15) หารไม่ได้ = ค่าจริง + (N/A) ตามที่สั่ง', () => {
    expect(pointRoundsText({ value: 37, na: true })).toBe('37 (N/A)');
  });

  it('⭐⭐ (T16) ทางเดียวจบ: เหรียญจริง + config ที่ยังไม่ตั้ง', () => {
    expect(pointRoundsText(pointRounds(37, pointRoundSpendAmount(shop(0))))).toBe('37 (N/A)');
    expect(pointRoundsText(pointRounds(100, pointRoundSpendAmount(shop(10))))).toBe('10');
  });
});

describe('[POINTROUNDS] ก้อนที่มาห่อหลายชั้น', () => {
  /* เจอจริงตอนอ่านโค้ดการ์ด site rules: ปลายทางส่งมาได้ทั้ง `{shop:…}`,
     `{data:{shop:…}}` และเคยห่อสองชั้น ⇒ ฝั่งเรียกไม่ควรต้องรู้รูปห่อ */
  const inner = {
    products: { products: [{ id: POINT_ROUND_PRODUCT_ID, default_config: { spend_amount: 10 } }] },
  };

  it('⭐⭐ (T17) คลี่ shop / data / data.data.shop ได้ทุกแบบ', () => {
    expect(pointRoundSpendAmount(inner)).toBe(10);
    expect(pointRoundSpendAmount({ shop: inner })).toBe(10);
    expect(pointRoundSpendAmount({ data: inner })).toBe(10);
    expect(pointRoundSpendAmount({ data: { shop: inner } })).toBe(10);
    expect(pointRoundSpendAmount({ data: { data: { shop: inner } } })).toBe(10);
  });

  it('⭐ (T18) ห่อวนลึกเกินไป/ไม่มีของ = null ไม่ใช่ค้าง', () => {
    const deep: any = { data: { data: { data: { data: { data: inner } } } } };
    expect(pointRoundSpendAmount(deep)).toBeNull();
    const loop: any = {}; loop.data = loop;
    expect(pointRoundSpendAmount(loop)).toBeNull();
  });
});

/* ── หมุดฝั่งหน้าจอ (source pins) ────────────────────────────────────────────
 * สองข้อนี้ปักที่ `PersonalPanel.tsx` เพราะเป็นเรื่องของ "ต่อสายถูกที่ไหม"
 * ซึ่งฟังก์ชันบริสุทธิ์ข้างบนพิสูจน์ให้ไม่ได้ · ไฟล์นั้นต้องมี ticket จริง +
 * หลายบริการถึงจะ render ได้ ⇒ อ่าน source แล้วตัดคอมเมนต์ทิ้งก่อน
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const panel = readFileSync(join(process.cwd(), 'components/profile-panel/ProfilePanel.tsx'), 'utf8')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

describe('[POINTROUNDS] ต่อสายเข้าหน้าจอ', () => {
  it('⭐⭐⭐ (T19) ใช้ก้อน site rules ที่การ์ดขวาโหลดไว้ — ห้ามยิงเส้นใหม่', () => {
    /* 🔴 เจ้าของสั่งตรง ๆ ว่า *"ไม่ต้องดึงใหม่ เปลือง"* · ถ้าวันไหนมีคนเติม
       getHookSiteRules ตัวที่สองเข้ามาในไฟล์นี้ เคสนี้จะแดงทันที */
    expect(panel).toContain('onShopLoaded={setSrShop}');
    const calls = panel.match(/getHookSiteRules\(/g) ?? [];
    expect({ siteRuleFetches: calls.length }, 'ต้องมีเส้นดึงเดียวในไฟล์นี้').toEqual({
      siteRuleFetches: 1,
    });
  });

  it('⭐⭐ (T20) สิทธิ์ร่วมกิจกรรมมาจากการคำนวณ ไม่ใช่ตัวเลขที่ปลายทางส่งมา', () => {
    expect(panel).toContain('pointRounds(acCoinBal, pointRoundSpendAmount(srShop))');
    expect(panel).not.toContain('activity?.point_round?.rounds_available');
  });

  it('⭐⭐ (T21) จอโชว์ผ่าน pointRoundsText ⇒ (N/A) มาจากที่เดียว', () => {
    expect(panel).toContain('pointRoundsText(acPointRound)');
  });

  it('⭐⭐ (T22) ประวัติฝากอ่าน "สถานะ" และ fallback เหมือนประวัติถอน', () => {
    // เดิม: {xpStatusTH(h.status) || xpChannel(h.channel)} ใต้หัวข้อ "ช่องทาง"
    expect(panel).not.toContain('xpStatusTH(h.status) || xpChannel(h.channel)');
    const both = panel.match(/xpStatusTH\(h\.status\) \|\| 'สำเร็จ'/g) ?? [];
    expect({ tables: both.length }, 'ฝากกับถอนต้องอ่านแบบเดียวกันทั้งคู่').toEqual({
      tables: 2,
    });
  });
});
